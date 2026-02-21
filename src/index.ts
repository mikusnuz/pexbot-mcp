#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import os from "node:os";
import crypto from "node:crypto";

const API_BASE = process.env.PEXBOT_API_URL || "https://pex.bot/api/v1";

const API_KEY = process.env.PEXBOT_API_KEY || null;
let sessionToken: string | null = process.env.PEXBOT_TOKEN || null;

// ── Fingerprint collection ──

function getFingerprint() {
  const interfaces = os.networkInterfaces();
  let macAddress = "00:00:00:00:00:00";
  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (!nets) continue;
    for (const net of nets) {
      if (!net.internal && net.mac && net.mac !== "00:00:00:00:00:00") {
        macAddress = net.mac;
        break;
      }
    }
    if (macAddress !== "00:00:00:00:00:00") break;
  }

  const cpus = os.cpus();
  return {
    mac_address: macAddress,
    hostname: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    model_name: cpus.length > 0 ? cpus[0].model : undefined,
    cpu_info: cpus.length > 0 ? `${cpus[0].model} (${cpus.length} cores)` : undefined,
  };
}

// ── API helpers ──

function getAuthHeaders(): Record<string, string> {
  if (API_KEY) {
    return { "X-API-Key": API_KEY };
  }
  if (sessionToken) {
    return { Authorization: `Bearer ${sessionToken}` };
  }
  throw new Error(
    "Authentication required: set PEXBOT_API_KEY, or use the 'register' tool first"
  );
}

// Public API calls (no auth needed)
async function apiGetPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function apiPostPublic<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

// Proof-of-Work solver: find solution where SHA256(nonce+solution) starts with "0000"
function solvePoW(nonce: string): string {
  for (let i = 0; ; i++) {
    const solution = String(i);
    const hash = crypto.createHash("sha256").update(nonce + solution).digest("hex");
    if (hash.startsWith("0000")) {
      return solution;
    }
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API DELETE ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── MCP Server ──

const server = new McpServer({
  name: "pexbot-mcp",
  version: "1.2.0",
});

// Tool: register
server.tool(
  "register",
  "Register a new AI agent account on pex.bot. Handles Proof-of-Work challenge, device fingerprint, and API key creation automatically. Returns API key for future use. No prior authentication needed.",
  {
    email: z.string().describe("Email address for the account"),
    password: z.string().min(6).describe("Password (min 6 chars)"),
    nickname: z.string().optional().describe("Display name"),
    model_name: z.string().describe('AI model name, e.g. "claude-sonnet-4", "gpt-4o"'),
  },
  async ({ email, password, nickname, model_name }) => {
    try {
      // Step 1: Get PoW challenge
      const challenge = await apiGetPublic<{ nonce: string; difficulty: number }>(
        "/auth/challenge"
      );

      // Step 2: Solve PoW
      const solution = solvePoW(challenge.nonce);

      // Step 3: Collect device fingerprint
      const fingerprint = getFingerprint();

      // Step 4: Register
      const registerResult = await apiPostPublic<{
        token: string;
        user_id: string;
        email: string;
      }>("/auth/register", {
        email,
        password,
        nickname,
        user_type: "agent",
        model_name,
        nonce: challenge.nonce,
        solution,
        mac_address: fingerprint.mac_address,
        hostname: fingerprint.hostname,
        cpu_info: fingerprint.cpu_info,
      });

      // Store JWT for this session
      sessionToken = registerResult.token;

      // Step 5: Auto-create API key
      const apiKeyResult = await apiPost<{
        id: string;
        key: string;
        name: string;
      }>("/auth/api-keys", { name: "mcp-auto" });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "Agent registered successfully!",
              "",
              `User ID: ${registerResult.user_id}`,
              `Email: ${registerResult.email}`,
              `API Key: ${apiKeyResult.key}`,
              "",
              "100,000,000 KRW virtual balance granted.",
              "",
              "To persist this API key, add to your MCP config:",
              `  "env": { "PEXBOT_API_KEY": "${apiKeyResult.key}" }`,
            ].join("\n"),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Registration failed: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: activate
server.tool(
  "activate",
  "Activate your pex.bot account by registering this device. Grants 100M KRW for simulated trading.",
  {},
  async () => {
    const fingerprint = getFingerprint();
    try {
      const result = await apiPost<{ activated: boolean; balance: string }>(
        "/auth/activate",
        fingerprint
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Account activated successfully! Balance: ${Number(result.balance).toLocaleString()} KRW`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Activation failed: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: get_profile
server.tool(
  "get_profile",
  "Get your pex.bot account profile information.",
  {},
  async () => {
    const data = await apiGet<{
      user_id: string;
      email: string;
      nickname: string | null;
      activated: boolean;
    }>("/auth/me");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

// Tool: get_balance
server.tool(
  "get_balance",
  "Get your current account balance across all assets.",
  {},
  async () => {
    const data = await apiGet<Array<{ asset: string; available: string; locked: string }>>(
      "/account/balance"
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

// Tool: get_markets
server.tool(
  "get_markets",
  "List all available trading markets with their symbol info.",
  {},
  async () => {
    const data = await apiGet<unknown[]>("/markets");
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Tool: get_ticker
server.tool(
  "get_ticker",
  "Get current ticker information for a specific market.",
  { symbol: z.string().describe('Market symbol, e.g. "BTC-KRW"') },
  async ({ symbol }) => {
    const data = await apiGet<unknown>(`/markets/${symbol}/ticker`);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Tool: get_orderbook
server.tool(
  "get_orderbook",
  "Get the current orderbook (bid/ask levels) for a market.",
  {
    symbol: z.string().describe('Market symbol, e.g. "BTC-KRW"'),
    depth: z.number().optional().default(20).describe("Number of price levels (default 20)"),
  },
  async ({ symbol, depth }) => {
    const data = await apiGet<unknown>(`/markets/${symbol}/orderbook?depth=${depth}`);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Tool: place_order
server.tool(
  "place_order",
  "Place a buy or sell order on a market.",
  {
    symbol: z.string().describe('Market symbol, e.g. "BTC-KRW"'),
    side: z.enum(["buy", "sell"]).describe("Order side"),
    order_type: z.enum(["limit", "market"]).describe("Order type"),
    price: z.string().optional().describe("Price (required for limit orders)"),
    quantity: z.string().describe("Order quantity"),
  },
  async ({ symbol, side, order_type, price, quantity }) => {
    const body: Record<string, unknown> = { symbol, side, order_type, quantity };
    if (price) body.price = price;
    const data = await apiPost<unknown>("/orders", body);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Tool: cancel_order
server.tool(
  "cancel_order",
  "Cancel an open order by its ID.",
  { order_id: z.string().describe("UUID of the order to cancel") },
  async ({ order_id }) => {
    const data = await apiDelete<unknown>(`/orders/${order_id}`);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ── Resources ──

server.resource(
  "account-profile",
  "pexbot://profile",
  { description: "Current pex.bot account profile and activation status", mimeType: "application/json" },
  async () => {
    const data = await apiGet<unknown>("/auth/me");
    return {
      contents: [
        { uri: "pexbot://profile", mimeType: "application/json", text: JSON.stringify(data, null, 2) },
      ],
    };
  }
);

server.resource(
  "account-balance",
  "pexbot://balance",
  { description: "Current asset balances across all holdings", mimeType: "application/json" },
  async () => {
    const data = await apiGet<unknown>("/account/balance");
    return {
      contents: [
        { uri: "pexbot://balance", mimeType: "application/json", text: JSON.stringify(data, null, 2) },
      ],
    };
  }
);

// ── Prompts ──

server.prompt(
  "trading_assistant",
  "AI trading assistant that checks markets and places orders",
  {},
  () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "You are a crypto trading assistant on pex.bot (simulated exchange).",
            "",
            "Please follow these steps:",
            "1. Use get_balance to check current asset holdings",
            "2. Use get_markets to list available trading pairs",
            "3. Ask me which market I'd like to trade",
            "4. Use get_ticker to check the current price",
            "5. Use get_orderbook to analyze bid/ask spread",
            "6. Suggest a trade and confirm before placing the order",
            "",
            "Always show the current price and my balance before suggesting trades.",
            "This is a simulation with virtual money — no real funds are at risk.",
          ].join("\n"),
        },
      },
    ],
  })
);

server.prompt(
  "portfolio_overview",
  "Get a comprehensive overview of your portfolio",
  {},
  () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "Give me a comprehensive portfolio overview on pex.bot.",
            "",
            "Use these tools:",
            "1. get_profile — Check account info and activation status",
            "2. get_balance — Get all asset balances",
            "3. get_markets — List available markets",
            "4. get_ticker — For each held asset, check current market price",
            "",
            "Then present:",
            "- Total portfolio value in KRW",
            "- Each asset: amount held, current price, total value, % of portfolio",
            "- Available KRW balance for new trades",
          ].join("\n"),
        },
      },
    ],
  })
);

// ── Start ──

async function main() {
  if (API_KEY) {
    process.stderr.write(`[pexbot-mcp] Using API key authentication\n`);
  } else if (sessionToken) {
    process.stderr.write(`[pexbot-mcp] Using JWT token authentication (fallback)\n`);
  } else {
    process.stderr.write(
      `[pexbot-mcp] No auth credentials found. Use the 'register' tool to create an account, or set PEXBOT_API_KEY.\n`
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[pexbot-mcp] Server running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`[pexbot-mcp] Fatal error: ${err.message}\n`);
  process.exit(1);
});
