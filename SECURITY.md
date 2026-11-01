# Security

Do not commit API keys, bearer tokens, GitHub tokens, or provider credentials. Use environment variables and a secret manager in deployment.

The MCP endpoint should be placed behind TLS. Public deployments should validate allowed hosts/origins and use an OAuth/resource-server gate for privileged mutation operations. Write tools are disabled by default in this repository's production adapter.

Report security issues privately to the project maintainer rather than opening a public exploit issue.

## Dependency minimums

The development lockfile adopts upstream fixes for [source-map-js section-offset denial of service](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) (1.2.2), [sharp's librsvg dependency](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) (0.35.5), [MCP client OAuth credential disclosure](https://github.com/advisories/GHSA-6qxp-vccf-f47h) (2.2.0), and [smol-toml parsing complexity](https://github.com/advisories/GHSA-r4xh-jqrq-34v2) (1.9.0). Narrow pnpm overrides keep transitive installations above the affected ranges. These fixes are not additional audit suppressions.

The development lockfile also pins affected Hono versions to 4.13.11 for
[GHSA-5r4p-p66f-jhc7](https://github.com/advisories/GHSA-5r4p-p66f-jhc7).
The upstream fix prevents double decoding in `serveStatic` from bypassing
middleware mounted on static path prefixes. This adds no audit exception.

## Continuous checks and their scope

The trial candidate adopts `@hono/node-server@2.1.3` for
[GHSA-rmxm-3fg6-px4f](https://github.com/advisories/GHSA-rmxm-3fg6-px4f).
The MCP Node SDK explicitly accepts this adapter version. The application uses
its request listener, not protected static serving; a dependency regression also
checks public-file access and refusal of the second-decoding middleware bypass.

Development linting uses ESLint 10.14.0 with minimatch 11.0.1 for
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
ESLint 9's older callable minimatch API is not compatible with a blind major
override. The new linter and its config-array dependency use the supported named
API; tests verify matching, bounded preprocessing, ignored files and rejection
of undefined identifiers. Repository development now requires Node 22.13+;
the distributed CLI's Node requirement is unchanged. No new audit exception is
added. Revisit these narrow overrides when upstream dependency ranges catch up.

Pull requests and the release gate run `pnpm audit` after dependency regression
tests. A daily scheduled workflow rechecks the default branch against new
advisories. An unavailable registry is a failed check, not a clean audit. Registry
results describe known affected packages; they do not prove exploitability or
formal compliance. The cache exception below remains explicit.

CI, release and scheduled checks run Gitleaks 8.30.1, downloaded from its official
release and verified against a pinned SHA-256. The scanner checks all fetched
refs with full history, including merge diffs. It disables inline allow comments
and retains the default detection rules. Closed PR refs, GitHub caches, external
forks and deployment artifacts are not covered by this CI checkout. Local edits
must be committed before this history scan covers them. Tracked environment
files (except reviewed `.env.example` templates), private-key containers, local
Vercel/brain state and SQLite databases are separately blocked by filename.
Ignore rules alone do not remove previously committed files.

`.gitleaksignore` contains six exact historical fingerprints for three generated
artifact checksums in `releases/0.1.0-build-evidence.json`. At each named commit,
the flagged SHA-256 was recomputed from its referenced generated file and matched.
The exclusions apply only to those immutable commits and lines; a new secret in
the same file remains blocking. Review scanner configuration and ignore-file
changes as security-sensitive. Scanner failures must not be treated as passes.

The lockfile additionally adopts Vite 8.3.3, MCP Node 2.1.2 / Server 2.4.0 /
Client 2.3.0, Zod 4.6.6 and Undici 8.12.2. These address the affected prior
versions without new audit suppressions. Recheck advisory data at release time;
a green historical run is not evidence of current dependency status.

## Pinned cache dependency hardening

Astro currently depends on `http-cache-semantics@4.2.0`. The earlier
[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
was withdrawn on 28 October 2026 as not a valid vulnerability. A remaining
Dependabot alert for that advisory does not establish a current vulnerability.
The existing conservative cache policy and its regression tests remain in place;
this trial does not silently remove previously verified behavior.

The pnpm patch in `patches/http-cache-semantics@4.2.0.patch` requires synchronous revalidation whenever the policy's effective maximum age is zero. This prevents client `max-stale` and `stale-while-revalidate` from reviving security-zeroed entries. It conservatively disables stale reuse of all zero-age policies; normal fresh caching and positive-age stale allowances remain supported.

The historical audit exception names only this withdrawn advisory; registry audits identify package versions rather than locally patched behavior. `tests/http-cache-security.test.mjs` exercises the actual Astro-resolved dependency with cookie-bearing, no-cache and no-store responses plus public-cache controls. CI runs those regressions before dependency audit. Reassess removal of the patch and exception together against the intended cache policy and current registry data; other advisories remain blocking.
