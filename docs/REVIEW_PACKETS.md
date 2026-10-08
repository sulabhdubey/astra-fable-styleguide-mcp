# Offline review packets

Available in the v0.9.0 CLI archive. The older v0.8.0 archive does not include this workflow.

Send a designer, client or teammate a readable **local HTML document** without
requiring them to install Style Constitution. Every recorded check stays in the
packet, including failed, not-checked and unsupported results. Passed checks are
collapsed for easier reading. Open them before printing if you want those details.

## Create one in Studio

1. Run checks for your configured static HTML or React/Vite project.
2. Choose **Prepare review packet**. Inspect the outcomes, measurements, omissions
   and exact packet data. The document replaces private target names and selectors
   with numbered elements; tell your recipient which page and elements these mean.
3. Confirm that you reviewed the contents. Download **HTML review** for a person
   or **packet JSON** for a format/checksum check.
4. Open the HTML locally and inspect it before sharing through your own chosen
   channel. Nothing is uploaded or sent by Studio.

Changing the source, constitution or configuration invalidates the download.
Run checks and prepare a fresh preview. Historical records cannot create a live
review preview; an already exported packet remains an explicitly historical
observation. After corrections, recheck the same rules and coverage before
claiming resolution. Use Studio history or the Git-bound CI comparison for that
comparison; a review packet itself is not a comparison or an approval.

## CLI

Create a JSON report with `stylecon check`, then use the current project and that
report. Use new output paths outside the checked project; existing files cannot
be overwritten.

```sh
stylecon review create ./project /private/check.json /private/review.html
stylecon review create ./project /private/check.json /private/review.json
stylecon review verify /private/review.json
```

`create` does not run a browser check; it requires a report matching the current
source/configuration/rules. Inspect the generated document before sharing it.
`verify` checks the supported schema, internal counts and checksum. Its success
does **not** mean the application passed, the sender is authenticated, the evidence
is true, or the source is still current. A sender can modify and rehash a packet.
These commands exit 0 for successful creation/format verification and 2 for an
error. Use `stylecon check` or the CI comparison for check-result exit codes.

## Disclosure and trust

| Included | Excluded by the minimal-v1 policy |
| --- | --- |
| Every recorded result and check count | Source paths, source bodies, repair material, session credentials |
| Numbered element labels and known check/rule labels | Original target names, selectors and custom rule identifiers |
| Bounded numbers, booleans, dimensions, colors and supported measurement fields | Free-form text, arbitrary nested objects, diagnostic messages, custom exception text |
| Recorded viewports and source/rule/configuration/report fingerprints | Account identity, automatic uploads, release approval |

Unknown measurement fields are omitted and counted. Unknown check/rule names
remain as generic rows with their original status. A missing expected value says
**Not included**; it never becomes a pass. Ask the developer for an explanation of
omitted diagnostics, limitations and exceptions. Keep the original private
report for detailed troubleshooting.

This reduces disclosure; it is not guaranteed anonymization or comprehensive
secret detection. Numeric measurements and fingerprints can also be sensitive.
The static document uses no scripts, external assets, network calls or telemetry.
It reports scoped observations, not complete accessibility certification, signed
attestation, policy approval, repair permission or enterprise security assurance.
