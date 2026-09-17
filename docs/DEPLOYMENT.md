# Deployment

## GitHub Pages
Enable Pages with **GitHub Actions** as the source. `.github/workflows/pages.yml` builds the Astro site from `/spec` and deploys `apps/docs/dist`.

## MCP service
Deploy the repository to a Node 22-capable container host using the root `Dockerfile`. The service exposes `/health`, `/version`, and `/mcp`.

For a public internet deployment, terminate TLS at the platform/reverse proxy, set allowed host/origin policy, and add OAuth/resource-server authentication before enabling any mutation tools. Public v0.1.0 operation is intentionally read-oriented.
