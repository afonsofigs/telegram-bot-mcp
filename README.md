# telegram-bot-mcp

Self-hosted [MCP](https://modelcontextprotocol.io/) server for sending Telegram messages via [Bot API](https://core.telegram.org/bots/api). Designed as a remote connector for [Claude.ai](https://claude.ai) scheduled tasks, but works with any MCP client.

## Why?

There are many Telegram MCP servers, but they all use MTProto (your personal account). This one uses the **Bot API** — simpler, safer, and ideal for notifications.

## Features

- **One tool**: `send_message` — send text to any Telegram chat
- **HTTP transport**: SSE endpoint for remote MCP connections (Claude.ai connectors, etc.)
- **Auto-split**: Messages over 4096 chars are split automatically
- **Auth**: Optional Bearer token authentication
- **Docker**: Ready to deploy on K8s, Fly.io, Railway, etc.

## Quick Start

### 1. Create a Telegram bot

Talk to [@BotFather](https://t.me/BotFather) on Telegram and create a bot. Copy the token.

### 2. Run with Docker

```bash
docker run -d \
  -e TELEGRAM_BOT_TOKEN=your_bot_token \
  -e TELEGRAM_DEFAULT_CHAT_ID=your_chat_id \
  -e AUTH_TOKEN=your_secret_auth_token \
  -p 3000:3000 \
  ghcr.io/afonsofigs/telegram-bot-mcp:latest
```

### 3. Run with Node.js

```bash
git clone https://github.com/afonsofigs/telegram-bot-mcp.git
cd telegram-bot-mcp
npm install
TELEGRAM_BOT_TOKEN=your_token TELEGRAM_DEFAULT_CHAT_ID=your_chat_id node server.js
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_DEFAULT_CHAT_ID` | No | Default chat ID for messages |
| `AUTH_TOKEN` | No | Bearer token for authentication |
| `PORT` | No | Server port (default: 3000) |

## MCP Tool

### `send_message`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | Message text (max 4096 chars, auto-split) |
| `chat_id` | string | No | Target chat ID (uses default if omitted) |
| `parse_mode` | string | No | `Markdown`, `MarkdownV2`, or `HTML` |

## Claude.ai Connector Setup

1. Deploy this server with HTTPS (e.g., behind Cloudflare Tunnel, nginx, or a cloud provider)
2. Go to [claude.ai/settings/connectors](https://claude.ai/settings/connectors)
3. Add a custom connector with the SSE URL: `https://your-domain.com/sse`
4. Use it in Claude.ai conversations or scheduled tasks

## Health Check

```bash
curl http://localhost:3000/health
# {"ok":true,"version":"1.0.0"}
```

## Architecture

```
Claude.ai / MCP Client
        │
        ▼ (HTTPS + SSE)
  telegram-bot-mcp
        │
        ▼ (HTTPS)
  Telegram Bot API
        │
        ▼
  Your Telegram Chat
```

## Dependencies

- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) — Official MCP TypeScript SDK
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) (9000+ ⭐) — Telegram Bot API client
- [express](https://expressjs.com/) — HTTP server
- [zod](https://zod.dev/) — Schema validation

## License

MIT
