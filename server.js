import { randomUUID, createHash } from "node:crypto";
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

if (!BOT_TOKEN) {
  console.error("Error: TELEGRAM_BOT_TOKEN environment variable is required");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN);



// --- OAuth 2.1 Provider (in-memory, suitable for single-instance) ---

// Derive deterministic client credentials from BOT_TOKEN
const FIXED_CLIENT_ID = createHash("sha256").update(`${BOT_TOKEN}:client_id`).digest("hex").slice(0, 36);
const FIXED_CLIENT_SECRET = createHash("sha256").update(`${BOT_TOKEN}:client_secret`).digest("hex");

class ClientsStore {
  constructor() {
    // Pre-register the only allowed client
    this.client = {
      client_id: FIXED_CLIENT_ID,
      client_secret: FIXED_CLIENT_SECRET,
      redirect_uris: [
        "https://claude.ai/api/mcp/auth_callback",
        "https://claude.com/api/mcp/auth_callback",
      ],
      client_name: "Claude",
      token_endpoint_auth_method: "client_secret_post",
    };
  }
  async getClient(clientId) {
    return clientId === FIXED_CLIENT_ID ? this.client : undefined;
  }
  async registerClient(_metadata) {
    // Always return the fixed client — no new registrations
    return this.client;
  }
}

class OAuthProvider {
  constructor() {
    this.clientsStore = new ClientsStore();
    this.codes = new Map();
    this.tokens = new Map();
  }

  async authorize(client, params, res) {
    // Auto-approve — security is enforced by fixed client_id/secret
    const code = randomUUID();
    this.codes.set(code, { client, params, createdAt: Date.now() });

    const searchParams = new URLSearchParams({ code });
    if (params.state) searchParams.set("state", params.state);

    const targetUrl = new URL(params.redirectUri);
    targetUrl.search = searchParams.toString();
    res.redirect(targetUrl.toString());
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
app.set("trust proxy", 1); // Trust first proxy (Cloudflare)
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
  console.log(`OAuth client_id: ${FIXED_CLIENT_ID}`);
  console.log(`OAuth client_secret: ${FIXED_CLIENT_SECRET}`);
  console.log(`Default chat: ${DEFAULT_CHAT_ID || "(not set)"}`);
});
