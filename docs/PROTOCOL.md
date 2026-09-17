# MCP protocol target

The production adapter targets MCP protocol revision **2026-07-28** with the official TypeScript SDK v2 packages. It uses `createMcpHandler` for stateless request handling and the Node adapter for `node:http`.

The 2026 revision uses self-describing requests, modern discovery, and header-based routing (`Mcp-Method` / `Mcp-Name`) handled by the SDK. The project does not hand-roll the production wire protocol.
