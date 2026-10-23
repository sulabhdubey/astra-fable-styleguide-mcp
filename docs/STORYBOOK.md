# Check a portable Storybook story

This local integration runs configured React stories through Storybook's public
`composeStories` / `run` API in a trusted Vite production build. It checks the
rendered state after the story finishes. It does not connect to the Storybook
manager UI or discover arbitrary Storybook installations.

Supported combination: Storybook **10.6.3**, React and ReactDOM **19.3.0**, Vite
**8.3.3**. Other combinations are rejected until verified. Chromium is supplied by
the CLI's pinned Playwright runtime. No model call or cloud account is required.

## Try the included fixture

From a reviewed source checkout:

```sh
pnpm install --frozen-lockfile
pnpm --filter @styleconstitution/storybook-fixture build
pnpm --filter @styleconstitution/storybook-fixture preview
```

In another terminal, after building the CLI:

```sh
node packages/cli/dist/stylecon.mjs check apps/storybook-fixture --story constitution-components--broken --rules typography,spacing
```

The broken story should report 12px font size against 16px and 3px top padding
against 16px. Button, input, card and the opened dialog examples should pass the
configured measurements. Skipped, failed and unfinished stories are incomplete,
not passes. The dialog example checks its rendered open state; it does not certify
focus containment, dismissal or the complete interaction journey.

## Use Local Studio

Start Studio with the fixture's parent as workspace and an existing private
evidence directory outside that workspace. Select `storybook-fixture`, choose a
story and one or more rule groups, then run checks.

- Inspect observed and expected values, with viewport excerpts highlighting failing elements.
- Select findings and prepare a correction brief for review before sharing.
- Make the intended change in your trusted project, rebuild, then check the same story and rules.
- Reopen the complete Studio link after restarting or refreshing authentication.
  Selecting the project restores the last checked story/rules; previous checks,
  screenshots and values remain in private history. They are historical evidence,
  and cannot restore correction or brief authority.

Story screenshots can contain private UI. They remain local and are omitted from
the sanitized review packet. No automatic JSX, component or transformed-CSS repair
is enabled. Existing static/Vite correction capabilities retain their own limits.

## Connect an existing project

Use `apps/storybook-fixture/project.json`, `src/main.mjs` and `vite.config.mjs` as
the versioned examples. Import the actual CSF modules using `composeStories`,
include project/addon annotations using `setProjectAnnotations`, and pass its
`beforeAll` hook into `mountStoryHarness`. The helper is shipped at
`@styleconstitution/cli/dist/runtime/packages/cli/storybook/harness.mjs` in the
development CLI archive. Build a separate self-contained Vite entry for these
portable stories. The Studio never executes your package scripts.

Configure each composed story's exact ID, source label and measurements. IDs can
be read from the composed story's public `id` property. Only plain unique element
IDs and the existing font, top-padding and declared contrast measurements are
supported. Story args and explicit globals must be JSON data; functions and
unsupported values fail closed. Include required decorators/styles in the entry.
Pass explicit `globals` to the harness when used; ambient manager UI globals are
not imported automatically.

Use `sourceDirectory` for all story/component source and `identityFiles` for
package metadata, build configuration and the lockfile. Include all relevant
inputs; this is configured-path provenance, not a complete dependency proof.
Source and build directories must be separate. The loopback origin must serve
the configured build's exact bytes. External requests, redirects, WebSockets,
downloads and runtime errors produce incomplete evidence. Development HMR servers
are unsupported. The browser runs trusted project code; this is not a hostile-code
sandbox or cryptographic attestation of story completion.

The receipt binds the configured source/build bytes, constitution hash, selected
story/rules, args/globals, viewport and tool versions. Changing source requires a
new check. Changing the selected rules or constitution prevents an old result
from being presented as resolution. A project constitution snapshot may be pinned
in configuration; Studio's interactive constitution adoption currently supports
static/Vite projects only.

## Verification

```sh
node --test tests/storybook.test.mjs
pnpm --filter @styleconstitution/storybook-fixture build
node scripts/test-storybook.mjs
```

The browser test checks all eight fixture states, changed served bytes, Studio
selection, highlighted evidence, brief creation, narrow layout, restart/history
and stale-source refusal.
The archive verifier also exercises the installed CLI and installed Studio path.
These are local fixtures, not independent developer adoption evidence.
