# telegram-bot-mcp

Self-hosted [MCP](https://modelcontextprotocol.io/) server for sending Telegram messages via [Bot API](https://core.telegram.org/bots/api). Designed as a remote connector for [Claude.ai](https://claude.ai) scheduled tasks, but works with any MCP client.

## Why?

There are many Telegram MCP servers, but they all use MTProto (your personal Telegram account). This one uses the **Bot API** — simpler, safer, and ideal for notifications and alerts.

## Features

- **One tool**: `send_message` — send text to any Telegram chat
- **OAuth 2.1**: Fixed client credentials derived from `MCP_SECRET` — no user database
- **Persistent OAuth tokens**: Issued tokens are written to disk so they survive container/pod restarts (no re-auth in Claude.ai after redeploys)
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
  -e MCP_SECRET=$(openssl rand -hex 32) \
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
MCP_SECRET=$(openssl rand -hex 32) \
TELEGRAM_DEFAULT_CHAT_ID=your_chat_id \
SERVER_URL=https://your-domain.com \
node server.js
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `MCP_SECRET` | Yes | Secret used to derive the OAuth credentials (e.g. `openssl rand -hex 32`). Rotating it revokes every issued token. |
| `SERVER_URL` | Yes | Public HTTPS URL of this server (used as OAuth issuer) |
| `TELEGRAM_DEFAULT_CHAT_ID` | No | Default chat ID for messages |
| `TOKEN_STORE_PATH` | No | Path for persisted OAuth tokens (default: `/data/oauth-tokens.json`). Mount a writable volume at this directory to survive restarts. |
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

- **Fixed client credentials** — A single `client_id` and `client_secret` are derived deterministically from `MCP_SECRET` via SHA-256. Printed to stdout on startup. No dynamic client registration (`/register` is neither served nor advertised), no user database: the credentials only reach a client by being pasted into its settings.
- **Rotating `MCP_SECRET` revokes everything**: on startup, codes and tokens issued to the previous `client_id` are dropped from the token store, and a bearer token of another client is refused.
- **Revocation**: `POST /revoke` (RFC 7009) revokes an access or refresh token, only when it belongs to the authenticated client.
- **Auto-approve** — The `/authorize` endpoint auto-approves requests. Security is enforced by the fixed client credentials — only someone with `MCP_SECRET` can derive them.
- **PKCE** (S256) — Proof Key for Code Exchange, mandatory for all clients
- **Redirect URI validation** — Only `claude.ai` and `claude.com` callback URLs are accepted
- **File-persisted token store** — Authorization codes and bearer/refresh tokens are written to `TOKEN_STORE_PATH` (default `/data/oauth-tokens.json`) on every mutation. Mount a volume at that location so connectors don't have to re-auth after pod restarts. If no volume is mounted, the path falls back to ephemeral container storage.

### How it works

1. On startup, the server derives a unique `client_id` and `client_secret` from `MCP_SECRET` and prints them
2. You paste these credentials into the connector's **Advanced settings** when adding it in Claude.ai
3. Claude.ai completes the OAuth flow automatically (no manual approval needed)
4. Only someone with `MCP_SECRET` can generate matching credentials

## Claude.ai Connector Setup

1. Deploy this server with HTTPS (e.g., behind Cloudflare Tunnel, nginx, or a cloud provider)
2. Check the server logs for `client_id` and `client_secret`
3. Go to [claude.ai/settings/connectors](https://claude.ai/settings/connectors)
4. Click **Add custom connector**
5. Enter the URL: `https://your-domain.com/mcp`
6. Open **Advanced settings** and paste the `client_id` and `client_secret` from the logs there. They have to be entered by hand: the server does not support dynamic client registration, so a connector added without them cannot link.
7. The connector links automatically — available in conversations and scheduled tasks

## Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | No | Health check |
| `GET /.well-known/oauth-authorization-server` | No | OAuth metadata (RFC 8414) |
| `GET /.well-known/oauth-protected-resource` | No | Protected resource metadata (RFC 9728) |
| `GET /authorize` | No | OAuth authorization (auto-approve) |
| `POST /token` | Client credentials | Token exchange |
| `POST /revoke` | Client credentials | Token revocation (RFC 7009) |
| `POST /mcp` | Bearer | Streamable HTTP — MCP requests |
| `GET /mcp` | Bearer | Streamable HTTP — server notifications |
| `DELETE /mcp` | Bearer | Session termination |

## Kubernetes Deployment

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: telegram-mcp-data
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 50Mi
---
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
      securityContext:
        fsGroup: 1000
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
            - name: MCP_SECRET
              valueFrom:
                secretKeyRef:
                  name: telegram-mcp-secrets
                  key: MCP_SECRET
            - name: SERVER_URL
              value: "https://your-domain.com"
            - name: TELEGRAM_DEFAULT_CHAT_ID
              value: "your_chat_id"
            - name: TOKEN_STORE_PATH
              value: "/data/oauth-tokens.json"
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: telegram-mcp-data
```

Expose via ClusterIP Service + Cloudflare Tunnel (or any HTTPS reverse proxy). The PVC is what allows OAuth tokens to survive pod restarts — without it, Claude.ai will need to re-auth every time the pod is recreated.

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
