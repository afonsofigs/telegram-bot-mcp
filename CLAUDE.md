# CLAUDE.md

## What is this?

A self-hosted MCP server that sends Telegram messages via Bot API. One tool: `send_message`. Protected by OAuth 2.1 with credentials derived from `MCP_SECRET`.

## Stack

- Node.js (ESM), single file: `server.js`
- `@modelcontextprotocol/sdk` — MCP protocol, OAuth handlers, Streamable HTTP transport
- `node-telegram-bot-api` — Telegram Bot API
- `express` — HTTP server
- `zod` — schema validation

## Project structure

```
server.js          — All server code (OAuth provider, MCP tool, Express app)
package.json       — Dependencies
Dockerfile         — Container build
.github/workflows/ — CI/CD to ghcr.io
```

## Running locally

```bash
npm install
TELEGRAM_BOT_TOKEN=token MCP_SECRET=secret SERVER_URL=http://localhost:3000 node server.js
```

## Key design decisions

- **OAuth 2.1 file-persisted** — Tokens and authorization codes stored in `TOKEN_STORE_PATH` (default `/data/oauth-tokens.json`) via `TokenStore`. Single-instance only (no shared store across replicas), but clients survive pod restarts as long as the path is on a mounted volume.
- **Fixed client credentials** — `client_id` and `client_secret` derived from `MCP_SECRET` (required) via SHA-256. Deterministic across restarts. No dynamic registration: `/register` is not served, so the credentials are pasted by hand into the connector's settings.
- **Rotating `MCP_SECRET` revokes everything** — on startup the token store drops codes and tokens issued to the previous `client_id`, and `verifyAccessToken` refuses a token of another client.
- **Auto-approve authorize** — No login page. Security enforced by fixed client credentials. Only someone with `MCP_SECRET` can derive matching credentials.
- **Redirect URI validation** — Only `claude.ai` and `claude.com` callback URLs accepted.
- **Manual bearer auth** — Uses custom middleware instead of SDK's `requireBearerAuth` for better logging and control.
- **No polling** — Bot created in non-polling mode (only sends, never receives).

## Common tasks

### Add a new tool
Add another `server.tool()` call in the `createMcpServer()` function.

### Change OAuth token expiry
In `OAuthProvider.exchangeAuthorizationCode()`, change `expiresIn` (default: 86400 = 24h).

### Test locally
```bash
curl http://localhost:3000/health
curl http://localhost:3000/.well-known/oauth-authorization-server
```

## CI/CD

Push to `main` triggers GitHub Actions:
1. Builds Docker image
2. Pushes to `ghcr.io/afonsofigs/telegram-bot-mcp:latest` + SHA tag
