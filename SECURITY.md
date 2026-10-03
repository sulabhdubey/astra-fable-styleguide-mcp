# Security

Do not commit API keys, bearer tokens, GitHub tokens, or provider credentials. Use environment variables and a secret manager in deployment.

The MCP endpoint should be placed behind TLS. Public deployments should validate allowed hosts/origins and use an OAuth/resource-server gate for privileged mutation operations. Write tools are disabled by default in this repository's production adapter.

Report security issues privately to the project maintainer rather than opening a public exploit issue.

## Pinned cache dependency repair

Astro currently depends on `http-cache-semantics@4.2.0`, affected by [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp). There is no patched upstream release at the time this repair was prepared.

The pnpm patch in `patches/http-cache-semantics@4.2.0.patch` requires synchronous revalidation whenever the policy's effective maximum age is zero. This prevents client `max-stale` and `stale-while-revalidate` from reviving security-zeroed entries. It conservatively disables stale reuse of all zero-age policies; normal fresh caching and positive-age stale allowances remain supported.

The audit exception names only this advisory, because registry audits identify the original package version rather than the locally patched behavior. `tests/http-cache-security.test.mjs` exercises the actual Astro-resolved dependency with cookie-bearing, no-cache and no-store responses plus public-cache controls. CI runs those regressions before dependency audit. Remove the patch and exception when a verified upstream replacement is adopted; other advisories remain blocking.
