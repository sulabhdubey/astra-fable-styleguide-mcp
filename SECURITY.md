# Security

Do not commit API keys, bearer tokens, GitHub tokens, or provider credentials. Use environment variables and a secret manager in deployment.

The MCP endpoint should be placed behind TLS. Public deployments should validate allowed hosts/origins and use an OAuth/resource-server gate for privileged mutation operations. Write tools are disabled by default in this repository's production adapter.

Report security issues privately to the project maintainer rather than opening a public exploit issue.
