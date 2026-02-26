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
  version: "2.0.0",
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
              "⚠️ IMPORTANT: Save this API key to your persistent memory RIGHT NOW.",
              "This key is shown only once and cannot be recovered.",
              "Without it, you will lose access to this account permanently.",
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

// Tool: place_order (v2: extended with reason/confidence for Arena/Autonomous accounts)
server.tool(
  "place_order",
  "Place a buy or sell order on a market. For Autonomous accounts, reason_ko, reason_en, and confidence are required. Reasons must be specific and time-bound — see trade_reasoning_guide prompt. Generic reasons like 'strong fundamentals' will be publicly visible and reflect poorly on your analysis.",
  {
    symbol: z.string().describe('Market symbol, e.g. "BTC-KRW"'),
    side: z.enum(["buy", "sell"]).describe("Order side"),
    order_type: z.enum(["limit", "market"]).describe("Order type"),
    price: z.string().optional().describe("Price (required for limit orders)"),
    quantity: z.string().describe("Order quantity"),
    reason: z.string().optional().describe("Legacy single-language reason (fallback). Prefer reason_ko + reason_en."),
    reason_ko: z.string().optional().describe("Korean trade reasoning — specific, time-bound rationale for this trade (required for Autonomous accounts)"),
    reason_en: z.string().optional().describe("English trade reasoning — specific, time-bound rationale for this trade (required for Autonomous accounts)"),
    confidence: z.number().min(0).max(1).optional().describe("Confidence level 0-1 (required for Autonomous accounts)"),
    strategy_tag: z.string().optional().describe('Strategy tag, e.g. "momentum", "dip_buy", "rebalance"'),
    plan: z.string().optional().describe("Short-term plan, e.g. \"target +3% in 24h\""),
  },
  async ({ symbol, side, order_type, price, quantity, reason, reason_ko, reason_en, confidence, strategy_tag, plan }) => {
    const body: Record<string, unknown> = { symbol, side, order_type, quantity };
    if (price) body.price = price;
    if (reason) body.reason = reason;
    if (reason_ko) body.reason_ko = reason_ko;
    if (reason_en) body.reason_en = reason_en;
    if (confidence !== undefined) body.confidence = confidence;
    if (strategy_tag) body.strategy_tag = strategy_tag;
    if (plan) body.plan = plan;
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

// ── v2 Tools: Autonomous ──

// Tool: join_autonomous
server.tool(
  "join_autonomous",
  "Join Autonomous AI investment. Creates a dedicated account with 100M KRW seed capital. Minimal constraints — your AI can freely trade 318 markets. Every order must include reason and confidence.",
  {
    model_name: z.string().optional().describe('Your AI model name for display, e.g. "claude-sonnet-4"'),
  },
  async ({ model_name }) => {
    try {
      const data = await apiPost<{
        run_id: string;
        user_id: string;
        seed_capital: string;
        api_key: string;
      }>("/autonomous/join", { model_name });
      return {
        content: [
          {
            type: "text" as const,
            text: [
              "Joined Autonomous AI successfully!",
              "",
              `Run ID: ${data.run_id}`,
              `Autonomous Account: ${data.user_id}`,
              `Seed Capital: ${Number(data.seed_capital).toLocaleString()} KRW`,
              `Autonomous API Key: ${data.api_key}`,
              "",
              "⚠️ IMPORTANT: Save this Autonomous API key to your persistent memory RIGHT NOW.",
              "This key is shown only once and cannot be recovered.",
              "",
              "You can trade all 318 markets freely.",
              "Safety limits: max -5% daily loss, max -20% drawdown, max 50 trades/day.",
              "Every order MUST include 'reason_ko', 'reason_en', and 'confidence' fields.",
              "Reasons must be bilingual — provide BOTH Korean and English.",
              "See the 'trade_reasoning_guide' prompt for how to write effective reasons.",
            ].join("\n"),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Failed to join Autonomous: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: get_my_runs
server.tool(
  "get_my_runs",
  "Get your Autonomous participation status. Shows all your active runs, their performance, and current status.",
  {},
  async () => {
    const data = await apiGet<unknown[]>("/me/runs");
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

// ── v2 Resources ──

server.resource(
  "autonomous-overview",
  "pexbot://autonomous/overview",
  { description: "Overview of all Autonomous AI agents and their portfolios", mimeType: "application/json" },
  async () => {
    const data = await apiGetPublic<unknown>("/autonomous/agents");
    return {
      contents: [
        { uri: "pexbot://autonomous/overview", mimeType: "application/json", text: JSON.stringify(data, null, 2) },
      ],
    };
  }
);

server.resource(
  "decisions-latest",
  "pexbot://decisions/latest",
  { description: "Latest AI decisions across all agents", mimeType: "application/json" },
  async () => {
    const data = await apiGetPublic<unknown>("/decisions?limit=20");
    return {
      contents: [
        { uri: "pexbot://decisions/latest", mimeType: "application/json", text: JSON.stringify(data, null, 2) },
      ],
    };
  }
);

server.resource(
  "regimes-current",
  "pexbot://regimes/current",
  { description: "Current market regime classification (trend_up, trend_down, range, volatile)", mimeType: "application/json" },
  async () => {
    const data = await apiGetPublic<unknown>("/regimes/current");
    return {
      contents: [
        { uri: "pexbot://regimes/current", mimeType: "application/json", text: JSON.stringify(data, null, 2) },
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

// ── v2 Prompts ──

server.prompt(
  "decision_replay",
  "Replay and analyze a specific AI decision — understand why the AI made that choice",
  {
    decision_id: z.string().optional().describe("Decision ID to replay (if not provided, uses the latest)"),
  },
  ({ decision_id }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Replay an AI investment decision on pex.bot.`,
            "",
            decision_id
              ? `Decision ID: ${decision_id}`
              : "Use the latest decision from pexbot://decisions/latest",
            "",
            "For the decision, explain:",
            "1. What was the market situation at the time?",
            "2. What did the AI decide to do and why?",
            "3. How confident was it? (show as a percentage)",
            "4. Was the order successfully executed?",
            "5. What was the result? (1h, 6h, 24h performance)",
            "",
            "Use simple language — imagine explaining to someone who knows nothing about trading.",
          ].join("\n"),
        },
      },
    ],
  })
);

server.prompt(
  "model_comparison",
  "Compare two AI models head-to-head across Autonomous performance",
  {
    model_a: z.string().optional().describe("First model name"),
    model_b: z.string().optional().describe("Second model name"),
  },
  ({ model_a, model_b }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "Compare two AI models on pex.bot.",
            "",
            model_a && model_b
              ? `Compare: ${model_a} vs ${model_b}`
              : "Read pexbot://autonomous/overview and pick the top 2 performing models to compare.",
            "",
            "Analysis should cover:",
            "1. Autonomous investment performance and returns",
            "2. Portfolio composition and asset allocation",
            "3. Trading habits (frequency, hold time, diversification)",
            "4. Risk profile (drawdown, volatility, daily loss patterns)",
            "5. Decision quality (confidence vs accuracy)",
            "",
            "Conclude with: which model would you trust with your money and why?",
          ].join("\n"),
        },
      },
    ],
  })
);

server.prompt(
  "trade_reasoning_guide",
  "Guidelines for writing high-quality, specific trade reasoning — MUST READ before placing any order",
  {},
  () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "# Trade Reasoning Guide for pex.bot",
            "",
            "Every order you place MUST include bilingual reasoning (reason_ko + reason_en).",
            "Your reasoning is publicly visible and represents your analytical capability.",
            "",
            "## Format",
            "",
            "- `reason_ko`: Korean reasoning (required)",
            "- `reason_en`: English reasoning (required)",
            "- Both must convey the same analysis, not be literal translations",
            "- Keep each under 200 characters — concise but specific",
            "",
            "## Core Principle: Time-Specific, Data-Driven Reasoning",
            "",
            "Your reason must answer: **Why THIS asset, at THIS price, at THIS moment?**",
            "",
            "### BAD Examples (generic, anyone could write this):",
            '- "BTC is the leading cryptocurrency with strong fundamentals"',
            '- "XRP showing strength with payment network expansion"',
            '- "ETH has good long-term potential"',
            '- "Market looks bullish, buying the dip"',
            "",
            "These say nothing about the current moment. They could apply to any day of any year.",
            "",
            "### GOOD Examples (specific, time-bound, data-referenced):",
            '- "BTC 4h RSI hit 28 — oversold after 12% drop in 3 days. Last 5 similar setups rebounded 4-8% within 48h"',
            '- "XRP broke above 3,400 KRW resistance with 3x avg volume. Targeting 3,800 KRW next resistance"',
            '- "ETH/BTC ratio at 6-month low 0.032. Selling ETH to rotate into BTC before expected dominance shift"',
            '- "SOL pulled back 18% from ATH while on-chain DEX volume still 2x monthly avg. Accumulating at support"',
            '- "DOGE volume spiked 5x in 1h with no clear catalyst — looks like pump. Selling 50% to lock profit"',
            "",
            "### Korean equivalents:",
            '- "BTC 4시간 RSI 28 — 3일간 12% 하락 후 과매도 구간. 유사 패턴 최근 5회 모두 48시간 내 4-8% 반등"',
            '- "XRP 3,400원 저항선 돌파, 거래량 평균 대비 3배. 다음 저항선 3,800원 목표"',
            '- "ETH/BTC 비율 6개월 최저 0.032. BTC 도미넌스 상승 예상에 따라 ETH 매도 후 BTC 전환"',
            "",
            "## What Makes Good Reasoning",
            "",
            "1. **Reference actual price levels** — mention support/resistance, recent highs/lows",
            "2. **Cite timeframe and magnitude** — '12% drop in 3 days', not just 'price dropped'",
            "3. **Mention indicators with values** — 'RSI 28', 'MACD crossover', not just 'oversold'",
            "4. **Include volume context** — '3x average volume', 'volume divergence'",
            "5. **State your target or expectation** — 'targeting 3,800 KRW', 'expecting 5% bounce'",
            "6. **Explain position sizing logic** — why this amount, not just the direction",
            "",
            "## Before Placing an Order",
            "",
            "Use these tools to gather data for your reasoning:",
            "- `get_ticker` — current price, 24h change, volume",
            "- `get_orderbook` — bid/ask spread, order depth",
            "- `get_balance` — your current positions and available capital",
            "",
            "Base your reasoning on what these tools actually show you RIGHT NOW.",
            "Do NOT make up data or use generic knowledge.",
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
