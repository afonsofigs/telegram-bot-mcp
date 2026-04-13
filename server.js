import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import TelegramBot from "node-telegram-bot-api";
import { z } from "zod";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_DEFAULT_CHAT_ID || "";
const PORT = parseInt(process.env.PORT || "3000", 10);
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";

if (!BOT_TOKEN) {
  console.error("Error: TELEGRAM_BOT_TOKEN environment variable is required");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN);

function createServer() {
  const server = new McpServer({
    name: "telegram-bot-mcp",
    version: "1.0.0",
  });

  server.tool(
    "send_message",
    "Send a text message to a Telegram chat via Bot API",
    {
      text: z.string().describe("Message text (max 4096 characters per Telegram limit)"),
      chat_id: z.string().optional().describe("Telegram chat ID. Uses TELEGRAM_DEFAULT_CHAT_ID if omitted."),
      parse_mode: z
        .enum(["Markdown", "MarkdownV2", "HTML"])
        .optional()
        .describe("Optional parse mode for formatting"),
    },
    async ({ text, chat_id, parse_mode }) => {
      const targetChat = chat_id || DEFAULT_CHAT_ID;
      if (!targetChat) {
        return {
          content: [{ type: "text", text: "Error: no chat_id provided and TELEGRAM_DEFAULT_CHAT_ID not set" }],
          isError: true,
        };
      }

      try {
        // Split long messages (Telegram limit: 4096 chars)
        const maxLen = 4096;
        const chunks = [];
        for (let i = 0; i < text.length; i += maxLen) {
          chunks.push(text.slice(i, i + maxLen));
        }

        const results = [];
        for (const chunk of chunks) {
          const opts = parse_mode ? { parse_mode } : {};
          const msg = await bot.sendMessage(targetChat, chunk, opts);
          results.push(msg.message_id);
        }

        return {
          content: [
            {
              type: "text",
              text: `Sent ${chunks.length} message(s) to chat ${targetChat}. Message IDs: ${results.join(", ")}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Telegram API error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// Express app with SSE transport for remote MCP connections
const app = express();
const transports = {};

// Optional auth middleware
if (AUTH_TOKEN) {
  app.use((req, res, next) => {
    if (req.path === "/health") return next();
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${AUTH_TOKEN}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  });
}

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  const server = createServer();
  await server.connect(transport);
});

app.post("/messages", express.json(), async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) return res.status(400).json({ error: "Unknown session" });
  await transport.handlePostMessage(req, res);
});

app.get("/health", (_, res) => res.json({ ok: true, version: "1.0.0" }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`telegram-bot-mcp listening on :${PORT}`);
  console.log(`Default chat ID: ${DEFAULT_CHAT_ID || "(not set)"}`);
  console.log(`Auth: ${AUTH_TOKEN ? "enabled" : "disabled"}`);
});
