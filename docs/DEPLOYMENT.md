# Deployment

## GitHub Pages
Enable Pages with **GitHub Actions** as the source. `.github/workflows/pages.yml` deploys only through a manual dispatch on `main` with a published, stable release tag such as `v0.2.0`. It verifies that the tag commit is reachable from `main` and that the attached release evidence names that exact commit with completed checks. It then builds the Astro site from the tag's `/spec` and deploys `apps/docs/dist`. A merge to `main` does not change the public documentation site.

## MCP service
The public `v0.1.0` MCP service runs at `https://astra-fable-styleguide-mcp.vercel.app/mcp`. Health and version are available at `/health` and `/version` on the same host. The production deployment uses the released `v0.1.0` source at commit `4874c7d3b338c69b48435509be122bab495263b6` and the repository's `Dockerfile.vercel` with Vercel's **Container** framework preset.

Set these production environment variables:

```text
MCP_ENABLE_WRITES=false
MCP_ENABLE_AI_ORCHESTRATION=false
MCP_ENABLE_RELEASE_TOOL=false
HOST=0.0.0.0
```

Do not set admin, human release, or provider API credentials on this public project. Vercel supplies `PORT` and its system host variables. An authenticated Vercel preview can require a deployment protection bypass token; the production alias is public.

Check the live service:

```bash
curl -i https://astra-fable-styleguide-mcp.vercel.app/health
curl -i https://astra-fable-styleguide-mcp.vercel.app/version
```

An MCP `server/discover` request with the `2026-07-28` version header, method header, and client metadata should advertise `2026-07-28`. The SDK also supports older clients through the legacy `initialize` handshake, which negotiates a 2025 revision. Public `tools/list` must contain only the eight read and compliance tools listed in the README.

For another Node 22-capable container host, use the root `Dockerfile`. The service exposes `/health`, `/version`, and `/mcp`.

For a public internet deployment, terminate TLS at the platform/reverse proxy, set allowed host/origin policy, and add OAuth/resource-server authentication before enabling any mutation tools. Public v0.1.0 operation is intentionally read-oriented.

## Future release gate

The GitHub Release Gate runs only through a manual workflow dispatch. It requires the intended version and the exact approved commit SHA; the job checks that SHA against its checkout before verification and publication. The `release-approval` environment remains the separate human approval step. After the approved GitHub Release is published, dispatch Pages with its tag and verify the live site. A green main-branch build or Vercel preview does not publish a new release. The v0.1.0 Vercel production branch remains pinned until a later deployment is explicitly approved.
