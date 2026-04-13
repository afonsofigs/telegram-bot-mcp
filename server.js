import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import express from "express";
import TelegramBot from "node-telegram-bot-api";
import { z } from "zod";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_DEFAULT_CHAT_ID || "";
const PORT = parseInt(process.env.PORT || "3000", 10);
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const OAUTH_PASSWORD = process.env.OAUTH_PASSWORD;

if (!BOT_TOKEN) {
  console.error("Error: TELEGRAM_BOT_TOKEN environment variable is required");
  process.exit(1);
}
if (!OAUTH_PASSWORD) {
  console.error("Error: OAUTH_PASSWORD environment variable is required");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN);

function loginPage(pendingId, error) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Telegram MCP — Authorize</title>
<style>
  body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0}
  .card{background:#1e293b;padding:2rem;border-radius:12px;width:320px;box-shadow:0 4px 24px rgba(0,0,0,.3)}
  h2{margin:0 0 1rem;text-align:center}
  input[type=password]{width:100%;padding:.75rem;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;font-size:1rem;box-sizing:border-box}
  button{width:100%;padding:.75rem;margin-top:1rem;border:none;border-radius:8px;background:#3b82f6;color:#fff;font-size:1rem;cursor:pointer}
  button:hover{background:#2563eb}
  .error{color:#f87171;text-align:center;margin-top:.5rem;font-size:.9rem}
  .info{color:#94a3b8;text-align:center;font-size:.85rem;margin-top:1rem}
</style></head>
<body><div class="card">
  <h2>Telegram Bot MCP</h2>
  <form method="POST" action="/authorize">
    <input type="hidden" name="pending_id" value="${pendingId}">
    <input type="password" name="password" placeholder="Password" autofocus required>
    <button type="submit">Authorize</button>
    ${error ? '<p class="error">Password incorrecta</p>' : ''}
  </form>
  <p class="info">A MCP client is requesting access to send Telegram messages.</p>
</div></body></html>`;
}

// --- OAuth 2.1 Provider (in-memory, suitable for single-instance) ---

class ClientsStore {
  constructor() { this.clients = new Map(); }
  async getClient(clientId) { return this.clients.get(clientId); }
  async registerClient(metadata) {
    const client = { ...metadata, client_id: metadata.client_id || randomUUID() };
    this.clients.set(client.client_id, client);
    return client;
  }
}

class OAuthProvider {
  constructor() {
    this.clientsStore = new ClientsStore();
    this.codes = new Map();
    this.tokens = new Map();
  }

  async authorize(client, params, res) {
    // Store pending authorization
    const pendingId = randomUUID();
    this.codes.set(`pending:${pendingId}`, { client, params, createdAt: Date.now() });

    // Check if password was submitted via POST
    if (res.req.method === "POST" && res.req.body?.password) {
      const submitted = res.req.body.password;
      const pid = res.req.body.pending_id;
      const pending = this.codes.get(`pending:${pid}`);

      if (!pending || submitted !== OAUTH_PASSWORD) {
        res.status(403).send(loginPage(pendingId, true));
        return;
      }

      // Password correct — issue authorization code
      this.codes.delete(`pending:${pid}`);
      const code = randomUUID();
      this.codes.set(code, { client: pending.client, params: pending.params, createdAt: Date.now() });

      const searchParams = new URLSearchParams({ code });
      if (pending.params.state) searchParams.set("state", pending.params.state);
      const targetUrl = new URL(pending.params.redirectUri);
      targetUrl.search = searchParams.toString();
      res.redirect(targetUrl.toString());
      return;
    }

    // Show login page
    res.status(200).send(loginPage(pendingId, false));
  }

  async challengeForAuthorizationCode(_client, code) {
    const data = this.codes.get(code);
    if (!data) throw new Error("Invalid authorization code");
    return data.params.codeChallenge;
  }

  async exchangeAuthorizationCode(client, code, _codeVerifier) {
    const data = this.codes.get(code);
    if (!data) throw new Error("Invalid authorization code");
    if (data.client.client_id !== client.client_id) throw new Error("Client mismatch");
    this.codes.delete(code);

    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    const expiresIn = 86400; // 24 hours

    this.tokens.set(accessToken, {
      clientId: client.client_id,
      scopes: data.params.scopes || [],
      expiresAt: Date.now() + expiresIn * 1000,
      resource: data.params.resource,
    });
    this.tokens.set(refreshToken, {
      clientId: client.client_id,
      scopes: data.params.scopes || [],
      type: "refresh",
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: (data.params.scopes || []).join(" "),
    };
  }

  async exchangeRefreshToken(client, refreshToken, scopes, _resource) {
    const data = this.tokens.get(refreshToken);
    if (!data || data.type !== "refresh") throw new Error("Invalid refresh token");
    if (data.clientId !== client.client_id) throw new Error("Client mismatch");
    this.tokens.delete(refreshToken);

    const newAccessToken = randomUUID();
    const newRefreshToken = randomUUID();
    const expiresIn = 86400;

    this.tokens.set(newAccessToken, {
      clientId: client.client_id,
      scopes: scopes || data.scopes,
      expiresAt: Date.now() + expiresIn * 1000,
    });
    this.tokens.set(newRefreshToken, {
      clientId: client.client_id,
      scopes: scopes || data.scopes,
      type: "refresh",
    });

    return {
      access_token: newAccessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      refresh_token: newRefreshToken,
      scope: (scopes || data.scopes).join(" "),
    };
  }

  async verifyAccessToken(token) {
    const data = this.tokens.get(token);
    if (!data || data.type === "refresh") throw new Error("Invalid token");
    if (data.expiresAt && data.expiresAt < Date.now()) {
      this.tokens.delete(token);
      throw new Error("Token expired");
    }
    return {
      token,
      clientId: data.clientId,
      scopes: data.scopes,
      expiresAt: data.expiresAt ? Math.floor(data.expiresAt / 1000) : undefined,
      resource: data.resource,
    };
  }

  async revokeToken(token) {
    this.tokens.delete(token);
  }
}

// --- MCP Server (Telegram tool) ---

function createMcpServer() {
  const server = new McpServer({ name: "telegram-bot-mcp", version: "1.0.0" });

  server.tool(
    "send_message",
    "Send a text message to a Telegram chat via Bot API",
    {
      text: z.string().describe("Message text (max 4096 characters per Telegram limit)"),
      chat_id: z.string().optional().describe("Telegram chat ID. Uses default if omitted."),
      parse_mode: z.enum(["Markdown", "MarkdownV2", "HTML"]).optional().describe("Optional formatting"),
    },
    async ({ text, chat_id, parse_mode }) => {
      const targetChat = chat_id || DEFAULT_CHAT_ID;
      if (!targetChat) {
        return { content: [{ type: "text", text: "Error: no chat_id and no default set" }], isError: true };
      }
      try {
        const maxLen = 4096;
        const chunks = [];
        for (let i = 0; i < text.length; i += maxLen) chunks.push(text.slice(i, i + maxLen));

        const ids = [];
        for (const chunk of chunks) {
          const msg = await bot.sendMessage(targetChat, chunk, parse_mode ? { parse_mode } : {});
          ids.push(msg.message_id);
        }
        return { content: [{ type: "text", text: `Sent ${chunks.length} message(s) to ${targetChat}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Telegram API error: ${err.message}` }], isError: true };
      }
    }
  );

  return server;
}

// --- Express App ---

const provider = new OAuthProvider();
const app = express();
app.set("trust proxy", true);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health (unauthenticated)
app.get("/health", (_, res) => res.json({ ok: true, version: "1.0.0" }));

// OAuth endpoints (/.well-known/*, /authorize, /token, /register, /revoke)
const issuerUrl = new URL(SERVER_URL);
app.use(mcpAuthRouter({
  provider,
  issuerUrl,
  scopesSupported: ["mcp:tools"],
  allowedRedirectUris: [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
  ],
}));

// Protected MCP endpoints
const bearerAuth = requireBearerAuth({ provider });
const transports = {};

app.get("/sse", bearerAuth, async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  const server = createMcpServer();
  await server.connect(transport);
});

app.post("/messages", bearerAuth, express.json(), async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) return res.status(400).json({ error: "Unknown session" });
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`telegram-bot-mcp listening on :${PORT}`);
  console.log(`OAuth issuer: ${SERVER_URL}`);
  console.log(`OAuth password: set`);
  console.log(`Default chat: ${DEFAULT_CHAT_ID || "(not set)"}`);
});
