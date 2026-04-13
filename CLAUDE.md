# CLAUDE.md

## What is this?

A self-hosted MCP server that sends Telegram messages via Bot API. One tool: `send_message`. Protected by OAuth 2.1 with password-based authorization.

## Stack

- Node.js (ESM), single file: `server.js`
- `@modelcontextprotocol/sdk` — MCP protocol + OAuth handlers
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
TELEGRAM_BOT_TOKEN=token OAUTH_PASSWORD=pass SERVER_URL=http://localhost:3000 node server.js
```

## Key design decisions

- **OAuth 2.1 in-memory** — Tokens and clients are stored in memory. Single-instance only. If the pod restarts, clients must re-authorize. This is acceptable for a personal-use server.
- **Auto-approve with password** — The `/authorize` endpoint shows a login page. No user database — just a single `OAUTH_PASSWORD` env var.
- **Redirect URI validation** — Only `claude.ai` and `claude.com` callback URLs are accepted.
- **No polling** — The bot is created with `node-telegram-bot-api` in non-polling mode (only sends, never receives).

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
