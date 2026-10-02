# Running React/Vite previews

`runRunningCheck` observes a manually started local Vite production preview at an explicit `http://127.0.0.1:PORT/` origin. Checking never starts package scripts or changes source. Explicitly mapped public CSS assets can produce verified correction candidates for the separate repair command.

Create `project.json` beside the application:

The v0.8.0 archive offers [guided setup in Local Studio](LOCAL_STUDIO.md#guided-reactvite-setup) for a first dialog journey and font-size/top-padding measurements. The older v0.7.0 archive uses the manual configuration below.

```json
{
  "schemaVersion": 2,
  "integration": "vite-preview",
  "url": "http://127.0.0.1:4173/",
  "sourceDirectory": "src",
  "buildDirectory": "dist",
  "identityFiles": ["package.json", "vite.config.mjs"],
  "journey": {
    "buttons": ["#open"], "trigger": "#open", "dialog": "#dialog",
    "name": "Review", "dialogButtons": ["#close"], "close": "#close"
  },
  "targetPaths": {
    "#open": "src/App.jsx", "#close": "src/App.jsx", "#title": "src/App.jsx",
    "dialog": "src/App.jsx", "page": "src/App.jsx"
  },
  "measurements": [{
    "selector": "#title", "target": "#title",
    "typography": {"fontFamily": "typography.fontFamily.sans", "fontSize": "typography.fontSize.500", "lineHeight": "typography.lineHeight.tight"},
    "spacing": {"paddingTop": "space.4"},
    "contrast": {"foreground": "semantic.text.primary", "background": "semantic.surface.primary"}
  }]
}
```

The measurement fields name tokens resolved from the complete bundled canonical `/spec` snapshot, or from an optional existing `constitution` pin with the same form used by static projects. Contrast minima come from the canonical contrast-pair entry that matches the two token paths. The report's constitution SHA-256 identifies that complete snapshot; it is not only a hash of the browser-contract documents.

Each measurement must contain a nonempty rule group, and measurement selectors and target labels must be unique. Combine multiple rules for an element into one measurement. Journey button IDs must be unique across both button lists and distinct from the dialog ID. These checks reject ambiguous or duplicate evidence before launching the browser. Missing or malformed viewport measurements remain `not_checked`; they cannot establish absence of overflow.

Start the application yourself after building it, then run `stylecon check project.json`. The result has the shape `{ result: { report, repair, ... }, summary, targetPaths }`; `repair` is null unless a failed measurement has a supported verified source mapping.

Every check hashes all bytes below the configured source and build directories plus each listed identity file before and after browser observation. Identity files must be outside those directories; redundant or case-aliased identities are rejected. Repair paths must use the exact file-name casing in the snapshot. When present, the pinned constitution snapshot is included in that identity. For served assets that directly map to a configured build file, it compares response bytes byte-for-byte to the build snapshot. Findings carry configured source path labels, but the check does not certify that browser bytes derive from those source files.

Only same-origin `GET` resources are allowed. Redirects, external resources, WebSockets, service workers, downloads, runtime errors, failed resources, changed configured files, and mismatched served build bytes make the run incomplete. The browser checks desktop and 390px widths. Typography, top padding, flat opaque text contrast, focus behavior, dialog behavior, and page overflow are measured only for configured light-DOM targets. Image, transparent, composited and unsupported surfaces remain unsupported or not checked.

## Verified CSS corrections

The first repair adapter supports `font-size` and `padding-top` as literal pixel values in plain, unique ID rules. Put these declarations in a dedicated Vite public stylesheet, link it from your HTML, and configure its source/build pair:

```json
"repairStylesheets": [{"source":"src/public/title.css","build":"title.css"}]
```

For example, use `publicDir: 'src/public'` in your reviewed Vite configuration, `<link rel="stylesheet" href="/title.css">`, and `#title { font-size: 20px; padding-top: 16px; }` in that stylesheet. Vite [copies public assets without transformation](https://vite.dev/guide/assets.html#the-public-directory). The checked-in React example demonstrates this adapter.

The checker requires identical source, built and served CSS bytes. It compares the browser's parsed stylesheet against those bytes and temporarily changes the declaration twice in the isolated check browser to establish that it controls the measured property. It restores the original declaration before returning. CSS variables, shorthand, `!important`, media rules, bundled/transformed CSS and JSX repairs are outside this adapter. Unsupported findings retain observations and manual guidance.

```sh
stylecon check project.json --format json --output /private/before.json
stylecon packet project.json /private/before.json /private/packet.json
# Put {"candidateId":"<id from packet.candidates>"} in /private/change.json.
stylecon repair preview project.json /private/packet.json /private/change.json
stylecon repair apply project.json /private/packet.json /private/change.json /private/receipts
# Rebuild using your project's reviewed Vite build command; keep its preview running.
stylecon check project.json --format json --output /private/after.json
stylecon repair undo project.json /private/receipts/<receipt-from-apply>.json /private/receipts
# Rebuild and check again after undo.
```

Create the private directories beforehand, outside the checked project. Preview and apply independently re-observe the application; editing a saved report cannot grant arbitrary write access. Apply journals the original bytes before an atomic source edit. A stale copied stylesheet blocks checking until rebuilt. Undo tolerates build-output changes but rejects intervening source, configuration, identity-file or constitution changes. Every apply/undo requires a fresh build and check; a successful write is not a verified correction. Source/build identity covers the configured directories and identity files, not an exhaustive Vite dependency graph.
