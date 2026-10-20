# Compare candidate repairs

Included in v0.10.0. Not available in the v0.9.0 archive.

Check a baseline and two proposed repairs using the same project configuration
and pinned constitution. Keep each JSON report private. Each candidate should
start from the baseline; the comparison does not generate or apply changes.

```sh
stylecon candidates compare baseline.json candidate-a.json candidate-b.json
```

The command prints JSON. Exit `0` means a complete comparison, including a tie
or no qualifying candidate. Exit `2` means incompatible, malformed or incomplete
evidence, or a runtime error. A successful comparison is not a passing verdict
for either candidate: inspect `preference`, `reason` and `candidates`.

In **Studio → Previous checks & comparison → Compare two candidate repairs**,
select three distinct saved runs and choose **Compare candidates**. After a
restart, reselect the same saved runs to recompute the same comparison.
Changing the selection hides the previous comparison. Saved runs remain subject
to the existing private storage capacity and integrity checks.

| Evidence | Decision |
| --- | --- |
| One candidate passes every recorded check, resolves a baseline failure, and the other does not qualify | Preference for that candidate |
| Both candidates qualify | No preference |
| Neither candidate completely improves the baseline | No preference; unresolved failures remain visible |
| Any baseline or candidate check is unsupported or not checked | Incomplete; no preference |
| Rules, configuration, expected values, selectors, viewports or recorded coverage differ | Incompatible; no preference |
| Identical source fingerprints have conflicting check outcomes | Recheck the environment; no preference |

Each result binds the baseline and candidates to their recorded artifact,
specification, configuration and canonicalized report SHA-256. Check identities
must be unique. Studio additionally checks target mappings and stored record
integrity. Expected requirements are part of comparison scope; observed values
are not. This allows a measurement to improve without falsely changing scope.
For v0.9 journey reports, known rule IDs identify fixed behavior; recorded
minimum thresholds, Escape policy and layout viewport remain requirements.
Unknown legacy formats cannot establish a preference.

## Limits and verification

These are comparisons of recorded observations, not a fresh source check.
Externally supplied JSON is not authenticated. Checksums detect differences;
they do not certify who ran a check or that a reported verdict is true.
Historical comparisons clear the live Studio repair review and confer no
repair, consensus or release permission. Run a fresh check before acting.
Unexercised application states remain untested.

The regression checks include a real rendered target-size repair, a competing
repair that breaks focus restoration, incomplete evidence, saved-history restart,
corrupted records and the installed CLI. Fixtures are manually constructed;
they do not demonstrate an advantage from model collaboration.

This workflow transfers matched comparison and explicit evaluation contracts
from [Harness²](https://arxiv.org/html/2610.14224v1) and
[The Agentic Scientist](https://arxiv.org/html/2610.18933v1).
It uses existing browser checks, rather than reviewer votes, as the recorded
evidence. Neither paper establishes a benefit for this project.
