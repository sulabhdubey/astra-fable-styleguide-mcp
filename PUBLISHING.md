# Publishing

## GitHub

Create an empty repository named `astra-fable-styleguide-mcp`, then push this repository's `main` branch. The repository already contains CI and GitHub Pages workflows.

```bash
git remote add origin https://github.com/<owner>/astra-fable-styleguide-mcp.git
git push -u origin main
```

Then in GitHub: **Settings → Pages → Source: GitHub Actions**. The Pages workflow will deploy the docs after dependencies install and the Astro build succeeds.

## MCP deployment

Deploy the included Dockerfile on a Node/container host. For public hosting, set `HOST=0.0.0.0`, `PORT`, and `MCP_ALLOWED_HOSTS`. Leave `MCP_ENABLE_WRITES=false` until a proper authenticated deployment is configured.
