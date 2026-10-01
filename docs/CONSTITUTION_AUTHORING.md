# Constitution authoring API

`scripts/constitution-authoring.mjs` creates reviewed, hash-bound constitution
candidates from an existing repository whose `spec/` directory validates through
the project canonical validator. It never edits that source repository.

```js
import {
  importCssSuggestions,
  createConstitutionCandidate,
  exportConstitutionCandidate
} from './scripts/constitution-authoring.mjs';

const imported=importCssSuggestions(localCssText);
// Review `imported.suggestions`; they are never applied automatically.

const candidate=await createConstitutionCandidate('/team/source',{
  changes:[
    {path:'tokens.typography.fontSize.300.$value',value:'18px'},
    {path:'components.button.accessibility.minimumTarget',value:'48px'}
  ],
  exceptions:[{
    rule:'STYLE-A11Y-009',
    target:'#legacy-control',
    reason:'Requires a separately tracked human remediation review.'
  }]
});

await exportConstitutionCandidate(
  '/team/source', candidate, candidate.candidateSha256, '/team/new-constitution'
);
```

## Import suggestions

`importCssSuggestions(cssText)` reads bounded custom-property declarations in
the supplied local CSS string. It recognizes hex color values for
`--color-<family>-<step>`, dimension values for `--space-<step>` and
`--font-size-<step>`, and simple semantic names. Each suggestion includes its
source variable and JavaScript string offset, has `accepted: false`, and has no filesystem
effect. Unknown mappings, executable or external values, and values that do not
match the mapped token type are returned in `unmapped` with a reason.

Imported paths still need to be reviewed and supplied as explicit `changes`.

## Candidate scope and bindings

`getConstitutionAuthoringCatalog(sourceRoot)` is a read-only UI helper. It
returns the current canonical base hash, every existing allowlisted token value
and type, and the supported button minimum-target field. A client should bind a
selection to the returned base hash before it creates a candidate; the catalog
does not mutate the source or create an approval.

Candidate changes are limited to existing canonical token leaf values below:

- `tokens.color.*.$value`
- `tokens.semantic.*.$value`
- `tokens.typography.*.$value`
- `tokens.space.*.$value`
- `components.button.accessibility.minimumTarget`, with a minimum of `40px`

All paths reject empty segments and prototype-related keys. Component focus
behavior is outside the supported authoring scope, so it remains subject to the
canonical validator. The candidate contains the exact base SHA-256, a SHA-256
of its complete canonical payload, structured before/after entries, and a
`reviewRecord` marked `pending-human-review`. Candidate mutation changes its
payload hash and causes export refusal.

An exception has `rule`, `target`, and `reason`, and remains visible in the
candidate review record. It does not alter evaluator results or waive contrast,
focus, target-size, or other checks.

## Export rules

`exportConstitutionCandidate(sourceRoot, candidate, expectedHash,
newDestination)` checks all of the following before writing:

1. The supplied expected hash exactly matches the candidate SHA-256.
2. The candidate payload hashes to that same SHA-256 and validates as a
   canonical constitution.
3. The source canonical snapshot still hashes to the candidate base SHA-256.
4. The destination is a new path outside both the source repository and its
   `spec/` directory.

The function rejects existing destinations and symlinked canonical input. It
then creates a fresh repository containing only the candidate `spec/` files.
Alongside `spec/`, it writes `constitution-review.json` with mode `0600` where
the host filesystem supports POSIX file modes.
It contains the base hash, candidate hash, pending review record, and every
exception. This record is outside `/spec` and does not change validator output.
To adopt it in a consumer project, create a separate v0.6 constitution pin with
`pinConstitution` and record that returned SHA-256 in the project configuration.
