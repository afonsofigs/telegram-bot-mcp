# telegram-bot-mcp

Self-hosted [MCP](https://modelcontextprotocol.io/) server for sending Telegram messages via [Bot API](https://core.telegram.org/bots/api). Designed as a remote connector for [Claude.ai](https://claude.ai) scheduled tasks, but works with any MCP client.

## Why?

There are many Telegram MCP servers, but they all use MTProto (your personal Telegram account). This one uses the **Bot API** — simpler, safer, and ideal for notifications and alerts.

## Features

- **One tool**: `send_message` — send text to any Telegram chat
- **OAuth 2.1**: Fixed client credentials derived from bot token — no separate passwords needed
- **Streamable HTTP**: `/mcp` endpoint for remote MCP connections (Claude.ai connectors, etc.)
- **Auto-split**: Messages over 4096 chars are split automatically
- **Docker**: Ready to deploy on K8s, Fly.io, Railway, etc.

## Quick Start

### 1. Create a Telegram bot

Talk to [@BotFather](https://t.me/BotFather) on Telegram and create a bot. Copy the token.

Get your chat ID by messaging [@userinfobot](https://t.me/userinfobot) on Telegram.

### 2. Run with Docker

```bash
docker run -d \
  -e TELEGRAM_BOT_TOKEN=your_bot_token \
  -e TELEGRAM_DEFAULT_CHAT_ID=your_chat_id \
  -e SERVER_URL=https://your-domain.com \
  -p 3000:3000 \
  ghcr.io/afonsofigs/telegram-bot-mcp:latest
```

### 3. Run with Node.js

```bash
git clone https://github.com/afonsofigs/telegram-bot-mcp.git
cd telegram-bot-mcp
npm install

TELEGRAM_BOT_TOKEN=your_token \
TELEGRAM_DEFAULT_CHAT_ID=your_chat_id \
SERVER_URL=https://your-domain.com \
node server.js
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather (also used to derive OAuth credentials) |
| `SERVER_URL` | Yes | Public HTTPS URL of this server (used as OAuth issuer) |
| `TELEGRAM_DEFAULT_CHAT_ID` | No | Default chat ID for messages |
| `PORT` | No | Server port (default: 3000) |

## MCP Tool

### `send_message`

Send a text message to a Telegram chat via Bot API.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | Message text (max 4096 chars, auto-split if longer) |
| `chat_id` | string | No | Target chat ID (uses `TELEGRAM_DEFAULT_CHAT_ID` if omitted) |
| `parse_mode` | string | No | `Markdown`, `MarkdownV2`, or `HTML` |

## Authentication

This server implements **OAuth 2.1** with:

- **Fixed client credentials** — A single `client_id` and `client_secret` are derived deterministically from `TELEGRAM_BOT_TOKEN`. Printed to stdout on startup.
- **Auto-approve** — The `/authorize` endpoint auto-approves requests. Security is enforced by the fixed client credentials — only someone with the bot token can derive them.
- **PKCE** (S256) — Proof Key for Code Exchange, mandatory for all clients
- **Redirect URI validation** — Only `claude.ai` and `claude.com` callback URLs are accepted

### How it works

1. On startup, the server derives a unique `client_id` and `client_secret` from your bot token and prints them
2. You enter these credentials when adding the connector in Claude.ai
3. Claude.ai completes the OAuth flow automatically (no manual approval needed)
4. Only someone with your bot token can generate matching credentials

## Claude.ai Connector Setup

1. Deploy this server with HTTPS (e.g., behind Cloudflare Tunnel, nginx, or a cloud provider)
2. Check the server logs for `client_id` and `client_secret`
3. Go to [claude.ai/settings/connectors](https://claude.ai/settings/connectors)
4. Click **Add custom connector**
5. Enter the URL: `https://your-domain.com/mcp`
6. Enter the `client_id` and `client_secret` from the logs
7. The connector links automatically — available in conversations and scheduled tasks

## Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | No | Health check |
| `GET /.well-known/oauth-authorization-server` | No | OAuth metadata (RFC 8414) |
| `GET /.well-known/oauth-protected-resource` | No | Protected resource metadata (RFC 9728) |
| `POST /register` | No | Client registration (returns fixed client) |
| `GET /authorize` | No | OAuth authorization (auto-approve) |
| `POST /token` | No | Token exchange |
| `POST /revoke` | Bearer | Token revocation |
| `POST /mcp` | Bearer | Streamable HTTP — MCP requests |
| `GET /mcp` | Bearer | Streamable HTTP — server notifications |
| `DELETE /mcp` | Bearer | Session termination |

## Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: telegram-mcp
spec:
  replicas: 1
  selector:
    matchLabels:
      app: telegram-mcp
  template:
    spec:
      containers:
        - name: telegram-mcp
          image: ghcr.io/afonsofigs/telegram-bot-mcp:latest
          ports:
            - containerPort: 3000
          env:
            - name: TELEGRAM_BOT_TOKEN
              valueFrom:
                secretKeyRef:
                  name: telegram-mcp-secrets
                  key: TELEGRAM_BOT_TOKEN
            - name: SERVER_URL
              value: "https://your-domain.com"
            - name: TELEGRAM_DEFAULT_CHAT_ID
              value: "your_chat_id"
```

Expose via ClusterIP Service + Cloudflare Tunnel (or any HTTPS reverse proxy).

## Architecture

```
Claude.ai / MCP Client
        |
        v (HTTPS + OAuth 2.1 + Streamable HTTP)
  telegram-bot-mcp
        |
        v (HTTPS)
  Telegram Bot API
        |
        v
  Your Telegram Chat
```

## Dependencies

- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) — Official MCP TypeScript SDK (OAuth + Streamable HTTP)
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) (9000+ stars) — Telegram Bot API client
- [express](https://expressjs.com/) — HTTP server
- [zod](https://zod.dev/) — Schema validation

## License

MIT
