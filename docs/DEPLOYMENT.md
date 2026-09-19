# Deployment

## GitHub Pages
Enable Pages with **GitHub Actions** as the source. `.github/workflows/pages.yml` builds the Astro site from `/spec` and deploys `apps/docs/dist`.

## MCP service
The public `v0.1.0` MCP service runs on Vercel Hobby at `https://astra-fable-styleguide-mcp.vercel.app/mcp`. Health and version are available at `/health` and `/version` on the same host. The production deployment uses the released `v0.1.0` source at commit `4874c7d3b338c69b48435509be122bab495263b6` and the repository's `Dockerfile.vercel` with Vercel's **Container** framework preset.

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
