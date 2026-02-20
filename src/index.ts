#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import os from "node:os";

const API_BASE = process.env.PEXBOT_API_URL || "https://pex.bot/api/v1";

let authToken: string | null = process.env.PEXBOT_TOKEN || null;

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

async function login(): Promise<string> {
  const email = process.env.PEXBOT_EMAIL;
  const password = process.env.PEXBOT_PASSWORD;
  if (!email || !password) {
    throw new Error("PEXBOT_EMAIL and PEXBOT_PASSWORD environment variables are required");
  }

  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Login failed" }));
    throw new Error(`Login failed: ${(err as any).message || res.statusText}`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function ensureAuth(): Promise<string> {
  if (!authToken) {
    authToken = await login();
  }
  return authToken;
}

async function apiGet<T>(path: string): Promise<T> {
  const token = await ensureAuth();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const token = await ensureAuth();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
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
  const token = await ensureAuth();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
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
  version: "0.1.0",
});

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

// ── Start ──

async function main() {
  // Auto-login on start if credentials are provided
  if (process.env.PEXBOT_EMAIL && process.env.PEXBOT_PASSWORD && !authToken) {
    try {
      authToken = await login();
      process.stderr.write(`[pexbot-mcp] Logged in successfully\n`);
    } catch (err: any) {
      process.stderr.write(`[pexbot-mcp] Auto-login failed: ${err.message}\n`);
    }
  } else if (authToken) {
    process.stderr.write(`[pexbot-mcp] Using provided PEXBOT_TOKEN\n`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[pexbot-mcp] Server running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`[pexbot-mcp] Fatal error: ${err.message}\n`);
  process.exit(1);
});
