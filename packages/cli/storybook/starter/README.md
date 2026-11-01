# Storybook starter trial

This isolated sample uses React 19.3.0, Storybook portable stories 10.6.3 and Vite 8.3.3. It does not change your repository or support arbitrary Storybook installations. Node.js 22.12 or newer and the installed `stylecon` CLI are required.

Nothing is installed, built, uploaded or run by generating this folder. Review the files and commands first. Dependency installation downloads the locked packages from the npm registry; the checks themselves need only the local preview. No paid model calls are used.

## Set up

From this generated folder:

```sh
cd project
npm ci --ignore-scripts
npm run build
npm run preview
```

Leave the preview terminal running. It serves only the built sample at `http://127.0.0.1:4193/`. If that port is occupied, stop your own earlier preview or choose a free port in both `project.json` and the preview command. Do not terminate another process blindly.

In a second terminal, from this generated folder:

```sh
stylecon browser-install
stylecon doctor project
stylecon check project --story constitution-components--button --rules typography,spacing
stylecon check project --story constitution-components--broken --rules typography,spacing --format json --output evidence/broken.json
```

Doctor checks prerequisites and the served index; it does not certify story behavior or token compliance. Exit 0 means ready for checks. Exit 2 means a prerequisite failed; follow the named diagnostic. It never executes package scripts or follows preview redirects.

The clean Button, Input, Card and Dialog stories should pass the selected typography and spacing checks. Broken should exit 1 for 12px font size and 3px top padding, where the bundled constitution expects 16px and 16px. Skipped, Failed and Unfinished should exit 2 (incomplete), never pass. This is measured style coverage, not full accessibility or dialog conformance.

## Inspect, correct, recheck

```sh
stylecon studio project --evidence evidence
```

Open the private session URL printed by Studio. Select the current project (**.**), select **Broken**, run checks and inspect the highlighted findings. Select a finding and prepare its correction brief. Storybook source changes are manual: in `project/src/Components.stories.mjs`, change only Broken's `fontSize:'12px',paddingTop:'3px'` to `fontSize:'16px',paddingTop:'16px'`. Rebuild with `npm run build` in `project`, then recheck. Save another CLI report to a new filename if desired; existing evidence files are not overwritten.

Reload Studio, then open the complete private session link printed by the CLI **in a new tab** when prompted. Studio deliberately removes the secret URL fragment and does not retain authentication across reload. Merely adding the fragment back in the same document does not reauthenticate it. Select the current project and confirm the last checked story/rules and recorded checks remain available. For a second task, deliberately change Card's top padding to 3px, find it, restore it to 16px and recheck without setup help. Record whether this was useful, even if the answer is no. Agent-operated rehearsals are not independent developer trials.

Keep `evidence/` private: it can contain screenshots and project details. Review every file before voluntarily sharing. Fill in `PILOT_FEEDBACK.md` outside the checked project. Generated Git ignore rules exclude evidence, filled feedback, dependencies, builds and local environment files; ignore rules cannot protect files you force-add or share manually. Nothing is sent automatically. Stop the preview and Studio with Ctrl+C when done. Delete only this generated folder if you no longer need it; save any evidence you want first.
