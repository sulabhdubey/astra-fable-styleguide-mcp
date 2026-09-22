import { collectUiObservations, journeys } from './browser-journey.mjs';
import { evaluateObservations, createRepairPacket } from '../packages/browser-verification/src/index.mjs';

/** Run through a CUA tab. Browser interaction stays in that adapter. No browser launch or paid calls. */
export async function runUiSuite(tab, origin = 'http://127.0.0.1:4178') {
  const base = new URL(origin);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Use an explicit loopback UI lab origin');
  const controls = { target: 'target', focus: 'focus', contrast: 'focus-contrast', name: 'name', initial: 'initial-focus', containment: 'containment', escape: 'escape', return: 'return-focus' };
  const cases = [['settings', ''], ...Object.keys(controls).map(defect => ['settings', defect]), ['codex', ''], ['grok', '']];
  const results = [];
  for (const [fixture, defect] of cases) {
    const query = new URLSearchParams({ case: fixture, defect });
    const metadata = async () => {
      const response = await fetch(`${base.origin}/case.json?${query}`);
      if (!response.ok) throw new Error('UI lab metadata unavailable');
      return response.json();
    };
    await tab.goto(`${base.origin}/?${query}`);
    await tab.playwright.domSnapshot();
    const before = await metadata();
    const observations = await collectUiObservations(tab, journeys[fixture]);
    const after = await metadata();
    if (before.artifactSha256 !== after.artifactSha256 || before.contract.specSha256 !== after.contract.specSha256) throw new Error('Source changed during browser verification');
    const report = evaluateObservations(before.contract, observations, { artifactSha256: before.artifactSha256 });
    const source = fixture === 'settings' ? 'examples/settings/index.html' : `tests/fixtures/agent-trial-${fixture === 'codex' ? 'codex-luna' : 'grok-46'}.html`;
    const targetPaths = Object.fromEntries([...journeys[fixture].buttons, ...journeys[fixture].dialogButtons, 'dialog'].map(target => [target, source]));
    const repair = createRepairPacket({ report, expectedSpecSha256: before.contract.specSha256, expectedArtifactSha256: before.artifactSha256, targetPaths });
    const expectedDetected = defect ? report.checks.some(c => c.check === controls[defect] && c.status === 'fail') : report.status === 'pass';
    results.push({ fixture, defect, expectedDetected, report, observations, repair });
  }
  return { schemaVersion: 1, passed: results.every(r => r.expectedDetected), results,
    limitations: ['Native focus restoration sampled for 1.2 seconds, not indefinitely.', 'Configured button/dialog paths only; no arbitrary UI certification.', 'Injected faults are experimental negative controls, not faults in shipped v0.3.'] };
}
