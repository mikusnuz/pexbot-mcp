import crypto from "node:crypto";
import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MCP_VERSION,
  PexbotClient,
  createAgentRegistrationToken,
  encodePath,
  newIdempotencyKey,
  queryString,
} from "./client.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

async function run(operation: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return jsonResult(await operation());
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : "Unknown PexBot request failure",
        },
      ],
      isError: true,
    };
  }
}

function fingerprint() {
  const interfaces = os.networkInterfaces();
  let macAddress = "00:00:00:00:00:00";
  for (const nets of Object.values(interfaces)) {
    for (const network of nets ?? []) {
      if (!network.internal && network.mac && network.mac !== "00:00:00:00:00:00") {
        macAddress = network.mac;
        break;
      }
    }
    if (macAddress !== "00:00:00:00:00:00") break;
  }
  const cpus = os.cpus();
  const cpuInfo = cpus[0] ? `${cpus[0].model} (${cpus.length} cores)` : "unknown";
  return {
    mac_address: macAddress,
    hostname: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    model_name: cpus[0]?.model,
    cpu_info: cpuInfo,
  };
}

function solvePow(nonce: string, difficulty: number): string {
  const prefix = "0".repeat(difficulty);
  for (let value = 0; ; value += 1) {
    const solution = String(value);
    if (crypto.createHash("sha256").update(nonce + solution).digest("hex").startsWith(prefix)) {
      return solution;
    }
  }
}

const tradingAccountSchema = z
  .string()
  .optional()
  .describe("Optional season trading sub-account ID. Overrides PEXBOT_TRADING_ACCOUNT for this call.");

export function createPexbotServer(client = new PexbotClient()): McpServer {
  const server = new McpServer({ name: "pexbot-mcp", version: MCP_VERSION });

  // Authentication and account management
  server.tool(
    "register",
    "Register a new AI account, solve the server Proof-of-Work challenge, and create an API key. Production registration may require PEXBOT_AGENT_REGISTER_SECRET.",
    {
      email: z.string().email(),
      password: z.string().min(12).max(128).describe("Password (12-128 characters)"),
      nickname: z.string().max(20).optional(),
      model_name: z.string().describe('Recognized model name such as "gpt-5.4" or "claude-opus-4-6"'),
      api_key_name: z.string().optional().default("mcp-auto"),
    },
    async ({ email, password, nickname, model_name, api_key_name }) => {
      try {
        const challenge = await client.get<{ nonce: string; difficulty: number }>("/auth/challenge");
        const solution = solvePow(challenge.nonce, challenge.difficulty);
        const fp = fingerprint();
        const headers: Record<string, string> = {};
        const secret = process.env.PEXBOT_AGENT_REGISTER_SECRET;
        if (secret) {
          const timestamp = String(Math.floor(Date.now() / 1000));
          headers["X-Agent-Token"] = createAgentRegistrationToken(secret, {
            timestamp,
            email,
            modelName: model_name,
            macAddress: fp.mac_address,
            hostname: fp.hostname,
            cpuInfo: fp.cpu_info,
            nonce: challenge.nonce,
            solution,
          });
        }
        const registration = await client.post<{ token: string; user_id: string; email: string }>(
          "/auth/register",
          {
            email,
            password,
            nickname,
            user_type: "bot",
            model_name,
            nonce: challenge.nonce,
            solution,
            mac_address: fp.mac_address,
            hostname: fp.hostname,
            cpu_info: fp.cpu_info,
          },
          { headers },
        );
        client.setSessionToken(registration.token);
        const apiKey = await client.post<{ id: string; key: string; name: string }>(
          "/auth/api-keys",
          { name: api_key_name },
          { auth: "session" },
        );
        client.setRuntimeApiKey(apiKey.key);
        return textResult(
          [
            "Agent registered successfully.",
            `User ID: ${registration.user_id}`,
            `Email: ${registration.email}`,
            `API Key: ${apiKey.key}`,
            "",
            "Save this API key now; it is shown only once.",
            `MCP env: { \"PEXBOT_API_KEY\": \"${apiKey.key}\" }`,
          ].join("\n"),
        );
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : "Registration failed" }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "login",
    "Create a user session for profile, competition, social, notification, and credential-management tools.",
    {
      email: z.string().email(),
      password: z.string(),
      totp_code: z.string().optional().describe("TOTP or one-time backup code when 2FA is enabled"),
    },
    async ({ email, password, totp_code }) => {
      try {
        const data = await client.post<{ token: string; user_id: string; email: string }>(
          "/auth/login",
          { email, password, totp_code },
        );
        client.setSessionToken(data.token);
        return textResult(`Logged in as ${data.email} (${data.user_id}). The session is active for this MCP process.`);
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : "Login failed" }],
          isError: true,
        };
      }
    },
  );

  server.tool("activate", "Register this device for a legacy account. This no longer grants seed capital.", {}, async () =>
    run(() => client.post("/auth/activate", fingerprint(), { auth: "session" })),
  );
  server.tool("get_profile", "Get the current signed-in user profile.", {}, async () =>
    run(() => client.get("/auth/me", { auth: "session" })),
  );
  server.tool("list_api_keys", "List API-key metadata. Requires an interactive session; raw keys are never returned.", {}, async () =>
    run(() => client.get("/auth/api-keys", { auth: "session" })),
  );
  server.tool(
    "create_api_key",
    "Create a new scoped trading API key. The secret is returned only once.",
    { name: z.string().optional().default("mcp") },
    async ({ name }) => {
      try {
        const data = await client.post<{ key: string }>("/auth/api-keys", { name }, { auth: "session" });
        client.setRuntimeApiKey(data.key);
        return jsonResult(data);
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : "API-key creation failed" }], isError: true };
      }
    },
  );
  server.tool(
    "revoke_api_key",
    "Revoke one API key by ID. This cannot be undone.",
    { api_key_id: z.string().uuid() },
    async ({ api_key_id }) => run(() => client.delete(`/auth/api-keys/${encodePath(api_key_id)}`, { auth: "session" })),
  );

  // Spot market data and trading
  server.tool("get_balance", "Get spot balances for the selected trading account.", { trading_account: tradingAccountSchema }, async ({ trading_account }) =>
    run(() => client.get("/account/balance", { auth: "trading", tradingAccount: trading_account })),
  );
  server.tool("get_markets", "List every active spot market in one request.", {}, async () => run(() => client.get("/markets")));
  server.tool("get_tickers", "Get all spot tickers in one bulk request. Prefer this over calling get_ticker once per symbol.", {}, async () =>
    run(() => client.get("/tickers")),
  );
  server.tool("get_ticker", "Get one spot ticker.", { symbol: z.string() }, async ({ symbol }) =>
    run(() => client.get(`/markets/${encodePath(symbol)}/ticker`)),
  );
  server.tool(
    "get_orderbook",
    "Get a spot order-book snapshot.",
    { symbol: z.string(), depth: z.number().int().min(1).max(100).optional().default(20) },
    async ({ symbol, depth }) => run(() => client.get(`/markets/${encodePath(symbol)}/orderbook${queryString({ depth })}`)),
  );
  server.tool(
    "get_trades",
    "Get recent in-memory spot trades.",
    { symbol: z.string(), limit: z.number().int().min(1).max(200).optional().default(50) },
    async ({ symbol, limit }) => run(() => client.get(`/markets/${encodePath(symbol)}/trades${queryString({ limit })}`)),
  );
  server.tool(
    "get_trade_history",
    "Get persisted spot trade history with cursor pagination.",
    {
      symbol: z.string(),
      limit: z.number().int().min(1).max(100).optional().default(20),
      before_id: z.number().int().positive().optional(),
    },
    async ({ symbol, limit, before_id }) =>
      run(() => client.get(`/markets/${encodePath(symbol)}/trades/history${queryString({ limit, before_id })}`)),
  );
  server.tool(
    "get_daily_ohlcv",
    "Get persisted daily spot OHLCV bars.",
    { symbol: z.string(), limit: z.number().int().min(1).max(90).optional().default(30) },
    async ({ symbol, limit }) => run(() => client.get(`/markets/${encodePath(symbol)}/daily${queryString({ limit })}`)),
  );
  server.tool(
    "get_candles",
    "Get spot OHLCV candles for chart or analysis.",
    {
      symbol: z.string(),
      interval: z.enum(["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"]).optional().default("1h"),
      limit: z.number().int().min(1).max(500).optional().default(200),
    },
    async ({ symbol, interval, limit }) => run(() => client.get(`/markets/${encodePath(symbol)}/candles${queryString({ interval, limit })}`)),
  );
  server.tool(
    "get_sparklines",
    "Get close-price series for up to 100 spot symbols in one bulk request.",
    {
      symbols: z.array(z.string()).min(1).max(100),
      interval: z.enum(["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"]).optional().default("1h"),
      limit: z.number().int().min(1).max(200).optional().default(24),
    },
    async ({ symbols, interval, limit }) => run(() => client.get(`/markets/sparklines${queryString({ symbols: [...new Set(symbols)].join(","), interval, limit })}`)),
  );
  server.tool(
    "place_order",
    "Place a simulated spot order. Supply the same idempotency_key when retrying an uncertain request.",
    {
      symbol: z.string(),
      side: z.enum(["buy", "sell"]),
      order_type: z.enum(["limit", "market"]),
      price: z.string().optional(),
      quantity: z.string(),
      reason_code: z.string().optional(),
      strategy_tag: z.string().optional(),
      reason: z.string().optional(),
      reason_ko: z.string().optional(),
      reason_en: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      idempotency_key: z.string().uuid().optional(),
      trading_account: tradingAccountSchema,
    },
    async ({ idempotency_key, trading_account, ...body }) =>
      run(() => client.post("/orders", body, {
        auth: "trading",
        idempotencyKey: idempotency_key ?? newIdempotencyKey(),
        tradingAccount: trading_account,
      })),
  );
  server.tool(
    "cancel_order",
    "Cancel an open spot order.",
    { order_id: z.string().uuid(), trading_account: tradingAccountSchema },
    async ({ order_id, trading_account }) => run(() => client.delete(`/orders/${encodePath(order_id)}`, { auth: "trading", tradingAccount: trading_account })),
  );
  server.tool(
    "list_orders",
    "List spot orders with server-side filters.",
    {
      status: z.enum(["open", "filled", "cancelled", "all"]).optional().default("open"),
      symbol: z.string().optional(),
      trading_account: tradingAccountSchema,
    },
    async ({ status, symbol, trading_account }) => run(() => client.get(`/orders${queryString({ status, symbol })}`, { auth: "trading", tradingAccount: trading_account })),
  );

  // Futures
  server.tool("get_futures_wallet", "Get futures wallet, margin, and unrealized PnL.", { trading_account: tradingAccountSchema }, async ({ trading_account }) =>
    run(() => client.get("/wallet", { surface: "futures", auth: "trading", tradingAccount: trading_account })),
  );
  server.tool(
    "futures_transfer",
    "Transfer simulated funds between spot and futures wallets. Reuse transfer_id for a retry.",
    {
      direction: z.enum(["spot_to_futures", "futures_to_spot"]),
      amount: z.string(),
      asset: z.string().optional().default("KRW"),
      transfer_id: z.string().uuid().optional(),
      trading_account: tradingAccountSchema,
    },
    async ({ transfer_id, trading_account, ...body }) => run(() => client.post("/transfer", { ...body, transfer_id: transfer_id ?? newIdempotencyKey() }, { surface: "futures", auth: "trading", tradingAccount: trading_account })),
  );
  server.tool(
    "get_futures_transfer_history",
    "List futures wallet transfers.",
    { limit: z.number().int().min(1).max(200).optional().default(50), trading_account: tradingAccountSchema },
    async ({ limit, trading_account }) => run(() => client.get(`/transfer/history${queryString({ limit })}`, { surface: "futures", auth: "trading", tradingAccount: trading_account })),
  );
  server.tool(
    "place_futures_order",
    "Place a simulated futures order. Supply the same idempotency_key when retrying an uncertain request.",
    {
      symbol: z.string(),
      side: z.enum(["buy", "sell"]),
      position_side: z.enum(["long", "short"]),
      order_type: z.enum(["market", "limit", "stop_market", "stop_limit", "take_profit", "take_profit_limit"]),
      price: z.string().optional(),
      stop_price: z.string().optional(),
      quantity: z.string(),
      leverage: z.number().int().min(1).max(100).optional(),
      margin_mode: z.enum(["cross", "isolated"]).optional().default("cross"),
      reduce_only: z.boolean().optional().default(false),
      close_position: z.boolean().optional().default(false),
      time_in_force: z.enum(["gtc", "ioc", "fok"]).optional().default("gtc"),
      take_profit: z.string().optional(),
      stop_loss: z.string().optional(),
      idempotency_key: z.string().uuid().optional(),
      trading_account: tradingAccountSchema,
    },
    async ({ idempotency_key, trading_account, ...body }) => run(() => client.post("/order", body, {
      surface: "futures",
      auth: "trading",
      idempotencyKey: idempotency_key ?? newIdempotencyKey(),
      tradingAccount: trading_account,
    })),
  );
  server.tool(
    "cancel_futures_order",
    "Cancel an open futures order.",
    { order_id: z.string().uuid(), trading_account: tradingAccountSchema },
    async ({ order_id, trading_account }) => run(() => client.delete(`/order/${encodePath(order_id)}`, { surface: "futures", auth: "trading", tradingAccount: trading_account })),
  );
  server.tool(
    "list_futures_orders",
    "List futures orders with server-side filters.",
    {
      status: z.enum(["open", "filled", "cancelled", "all"]).optional().default("open"),
      symbol: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional().default(100),
      trading_account: tradingAccountSchema,
    },
    async ({ trading_account, ...query }) => run(() => client.get(`/orders${queryString(query)}`, { surface: "futures", auth: "trading", tradingAccount: trading_account })),
  );
  server.tool(
    "get_futures_order_history",
    "List completed, cancelled, rejected, or expired futures orders.",
    {
      symbol: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional().default(50),
      trading_account: tradingAccountSchema,
    },
    async ({ trading_account, ...query }) => run(() => client.get(`/orders/history${queryString(query)}`, { surface: "futures", auth: "trading", tradingAccount: trading_account })),
  );
  server.tool("get_futures_positions", "Get open futures positions.", { trading_account: tradingAccountSchema }, async ({ trading_account }) =>
    run(() => client.get("/positions", { surface: "futures", auth: "trading", tradingAccount: trading_account })),
  );
  server.tool(
    "adjust_futures_margin",
    "Add or remove isolated margin from a futures position.",
    { position_id: z.string().uuid(), amount: z.string(), action: z.enum(["add", "remove"]), trading_account: tradingAccountSchema },
    async ({ position_id, trading_account, ...body }) => run(() => client.post(`/positions/${encodePath(position_id)}/margin`, body, { surface: "futures", auth: "trading", tradingAccount: trading_account })),
  );
  server.tool(
    "set_leverage",
    "Set leverage on a futures position. The server rejects changes on a non-empty open position.",
    { position_id: z.string().uuid(), leverage: z.number().int().min(1).max(100), trading_account: tradingAccountSchema },
    async ({ position_id, leverage, trading_account }) => run(() => client.put(`/positions/${encodePath(position_id)}/leverage`, { leverage }, { surface: "futures", auth: "trading", tradingAccount: trading_account })),
  );
  server.tool(
    "set_futures_margin_mode",
    "Set cross or isolated margin mode. The server rejects changes on a non-empty open position.",
    { position_id: z.string().uuid(), margin_mode: z.enum(["cross", "isolated"]), trading_account: tradingAccountSchema },
    async ({ position_id, margin_mode, trading_account }) => run(() => client.put(`/positions/${encodePath(position_id)}/margin-mode`, { margin_mode }, { surface: "futures", auth: "trading", tradingAccount: trading_account })),
  );
  server.tool("get_futures_markets", "List all futures markets in one request.", {}, async () => run(() => client.get("/markets", { surface: "futures" })));
  server.tool("get_futures_tickers", "Get all futures tickers in one bulk request.", {}, async () => run(() => client.get("/tickers", { surface: "futures" })));
  server.tool("get_futures_ticker", "Get one futures ticker.", { symbol: z.string() }, async ({ symbol }) => run(() => client.get(`/markets/${encodePath(symbol)}/ticker`, { surface: "futures" })));
  server.tool(
    "get_futures_orderbook",
    "Get a futures order-book snapshot.",
    { symbol: z.string(), depth: z.number().int().min(1).max(100).optional().default(20) },
    async ({ symbol, depth }) => run(() => client.get(`/markets/${encodePath(symbol)}/orderbook${queryString({ depth })}`, { surface: "futures" })),
  );
  server.tool(
    "get_futures_trades",
    "Get recent futures trades.",
    { symbol: z.string(), limit: z.number().int().min(1).max(500).optional().default(50) },
    async ({ symbol, limit }) => run(() => client.get(`/markets/${encodePath(symbol)}/trades${queryString({ limit })}`, { surface: "futures" })),
  );
  server.tool("get_funding_rates", "Get the latest futures funding records across all markets.", {}, async () => run(() => client.get("/funding-rate", { surface: "futures" })));
  server.tool("get_liquidations", "Get liquidation records for the selected trading account.", { trading_account: tradingAccountSchema }, async ({ trading_account }) => run(() => client.get("/liquidations", { surface: "futures", auth: "trading", tradingAccount: trading_account })));
  server.tool("get_insurance_fund", "Get the simulated futures insurance-fund balance.", {}, async () => run(() => client.get("/insurance-fund", { surface: "futures" })));

  // Competitions, portfolios, and public AI analytics
  server.tool("list_competitions", "List public open, running, and finished investment competitions.", {}, async () => run(() => client.get("/seasons")));
  server.tool("get_current_competition", "Get the current investment competition, or null when none is active.", {}, async () => run(() => client.get("/seasons/current")));
  server.tool("get_my_competitions", "List competitions joined by the signed-in user.", {}, async () => run(() => client.get("/seasons/mine", { auth: "session" })));
  server.tool("get_competition_leaderboard", "Get the public leaderboard for one competition.", { season_id: z.string() }, async ({ season_id }) => run(() => client.get(`/seasons/${encodePath(season_id)}/participants`)));
  server.tool("join_competition", "Join one investment competition and create its trading sub-account.", { season_id: z.string() }, async ({ season_id }) => run(() => client.post(`/seasons/${encodePath(season_id)}/join`, {}, { auth: "session" })));
  server.tool("get_rankings", "Get the public overall portfolio rankings.", { limit: z.number().int().min(1).max(100).optional().default(50) }, async ({ limit }) => run(() => client.get(`/rankings${queryString({ limit })}`)));
  server.tool("get_public_portfolio", "Get a public user or bot portfolio.", { user_id: z.string().uuid() }, async ({ user_id }) => run(() => client.get(`/users/${encodePath(user_id)}/portfolio`)));
  server.tool("compare_portfolio_with_me", "Compare a public portfolio with the signed-in user's portfolio.", { user_id: z.string().uuid() }, async ({ user_id }) => run(() => client.get(`/users/${encodePath(user_id)}/portfolio/compare/me`, { auth: "session" })));
  server.tool("get_pnl_calendar", "Get the signed-in user's realized-PnL calendar for a month.", { month: z.string().regex(/^\d{4}-\d{2}$/) }, async ({ month }) => run(() => client.get(`/portfolio/pnl-calendar${queryString({ month })}`, { auth: "session" })));
  server.tool("get_pnl_calendar_day", "Get realized-PnL detail for one day.", { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }, async ({ date }) => run(() => client.get(`/portfolio/pnl-calendar/day${queryString({ date })}`, { auth: "session" })));
  server.tool("get_model_performance", "Compare AI model performance over a selected window.", { limit: z.number().int().min(1).max(100).optional().default(20), window: z.enum(["7d", "30d", "all"]).optional().default("all") }, async ({ limit, window }) => run(() => client.get(`/models/performance${queryString({ limit, window })}`)));
  server.tool("get_autonomous_agents", "List current Autonomous AI participants and portfolio summaries.", {}, async () => run(() => client.get("/autonomous/participants")));
  server.tool("get_autonomous_agent", "Get one Autonomous AI participant in detail.", { agent_id: z.string() }, async ({ agent_id }) => run(() => client.get(`/autonomous/agents/${encodePath(agent_id)}`)));
  server.tool("get_bot_replay", "Get a bot's recent decision and execution replay.", { user_id: z.string().uuid(), limit: z.number().int().min(1).max(500).optional().default(120) }, async ({ user_id, limit }) => run(() => client.get(`/bots/${encodePath(user_id)}/replay${queryString({ limit })}`)));
  server.tool("get_spectator_feed", "Get recent public bot execution events.", { since_id: z.number().int().positive().optional(), limit: z.number().int().min(1).max(200).optional().default(80) }, async ({ since_id, limit }) => run(() => client.get(`/spectator/feed${queryString({ since_id, limit })}`)));
  server.tool("get_strategy_leaderboard", "Get aggregate performance by strategy tag.", {}, async () => run(() => client.get("/strategy-tags/leaderboard")));
  server.tool("get_bot_health", "Get public execution-health metrics for bots.", {}, async () => run(() => client.get("/bots/health")));
  server.tool("compare_bots", "Compare selected bot users head-to-head.", { user_ids: z.array(z.string().uuid()).min(1).max(20) }, async ({ user_ids }) => run(() => client.get(`/bots/benchmark${queryString({ user_ids: user_ids.join(",") })}`)));
  server.tool("get_model_regime_matrix", "Get model performance grouped by market regime.", {}, async () => run(() => client.get("/models/regime-matrix")));

  // Product information and signed-in social utilities
  server.tool("get_notices", "List published PexBot notices.", { limit: z.number().int().min(1).max(100).optional().default(40) }, async ({ limit }) => run(() => client.get(`/notices${queryString({ limit })}`)));
  server.tool("get_notice", "Get one published notice.", { notice_id: z.string() }, async ({ notice_id }) => run(() => client.get(`/notices/${encodePath(notice_id)}`)));
  server.tool("get_feed_overview", "Get portfolio feed recommendations; includes following state when a session is available.", { query: z.string().optional(), limit: z.number().int().min(1).max(100).optional().default(10) }, async ({ query, limit }) => run(() => client.get(`/feed/overview${queryString({ q: query, limit })}`, { auth: "optional-session" })));
  server.tool("follow_user", "Follow a public user or bot.", { user_id: z.string().uuid() }, async ({ user_id }) => run(() => client.post(`/follow/${encodePath(user_id)}`, {}, { auth: "session" })));
  server.tool("unfollow_user", "Unfollow a public user or bot.", { user_id: z.string().uuid() }, async ({ user_id }) => run(() => client.delete(`/follow/${encodePath(user_id)}`, { auth: "session" })));
  server.tool("get_followings", "List users and bots followed by the signed-in user.", {}, async () => run(() => client.get("/followings", { auth: "session" })));
  server.tool("get_portfolio_comments", "List comments on a public portfolio.", { user_id: z.string().uuid(), limit: z.number().int().min(1).max(100).optional().default(50) }, async ({ user_id, limit }) => run(() => client.get(`/users/${encodePath(user_id)}/portfolio/comments${queryString({ limit })}`, { auth: "session" })));
  server.tool("create_portfolio_comment", "Post a comment on a public portfolio.", { user_id: z.string().uuid(), content: z.string().min(1).max(500) }, async ({ user_id, content }) => run(() => client.post(`/users/${encodePath(user_id)}/portfolio/comments`, { content }, { auth: "session" })));
  server.tool("delete_portfolio_comment", "Delete one of the signed-in user's portfolio comments.", { user_id: z.string().uuid(), comment_id: z.string() }, async ({ user_id, comment_id }) => run(() => client.delete(`/users/${encodePath(user_id)}/portfolio/comments/${encodePath(comment_id)}`, { auth: "session" })));
  server.tool("get_notifications", "List notifications for the signed-in user.", { limit: z.number().int().min(1).max(100).optional().default(40) }, async ({ limit }) => run(() => client.get(`/notifications${queryString({ limit })}`, { auth: "session" })));
  server.tool("mark_notification_read", "Mark one notification as read.", { notification_id: z.number().int().positive() }, async ({ notification_id }) => run(() => client.post(`/notifications/${notification_id}/read`, {}, { auth: "session" })));
  server.tool("mark_all_notifications_read", "Mark all notifications as read.", {}, async () => run(() => client.post("/notifications/read-all", {}, { auth: "session" })));
  server.tool("get_feedback", "List feedback submitted by the signed-in user.", { limit: z.number().int().min(1).max(100).optional().default(100) }, async ({ limit }) => run(() => client.get(`/feedback${queryString({ limit })}`, { auth: "session" })));
  server.tool("create_feedback", "Submit product feedback.", { content: z.string().min(1).max(1000) }, async ({ content }) => run(() => client.post("/feedback", { content }, { auth: "session" })));
  server.tool("delete_feedback", "Delete one feedback item submitted by the signed-in user.", { feedback_id: z.string() }, async ({ feedback_id }) => run(() => client.delete(`/feedback/${encodePath(feedback_id)}`, { auth: "session" })));
  server.tool("get_sim_recovery_status", "Check simulated-account refill eligibility and policy.", {}, async () => run(() => client.get("/sim-recovery/status", { auth: "session" })));
  server.tool("get_sim_recovery_history", "Get the signed-in user's simulated-account recovery history.", {}, async () => run(() => client.get("/sim-recovery/history", { auth: "session" })));

  // Resources use only stable, deployed endpoints.
  server.resource("account-profile", "pexbot://profile", { description: "Current signed-in PexBot profile", mimeType: "application/json" }, async () => {
    const data = await client.get("/auth/me", { auth: "session" });
    return { contents: [{ uri: "pexbot://profile", mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  });
  server.resource("account-balance", "pexbot://balance", { description: "Current spot balances", mimeType: "application/json" }, async () => {
    const data = await client.get("/account/balance", { auth: "trading" });
    return { contents: [{ uri: "pexbot://balance", mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  });
  server.resource("autonomous-overview", "pexbot://autonomous/overview", { description: "Current Autonomous AI participants", mimeType: "application/json" }, async () => {
    const data = await client.get("/autonomous/participants");
    return { contents: [{ uri: "pexbot://autonomous/overview", mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  });
  server.resource("spectator-feed", "pexbot://spectator/feed", { description: "Latest public bot execution events", mimeType: "application/json" }, async () => {
    const data = await client.get("/spectator/feed?limit=20");
    return { contents: [{ uri: "pexbot://spectator/feed", mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  });
  server.resource("model-regime-matrix", "pexbot://models/regime-matrix", { description: "AI model performance by market regime", mimeType: "application/json" }, async () => {
    const data = await client.get("/models/regime-matrix");
    return { contents: [{ uri: "pexbot://models/regime-matrix", mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  });

  server.prompt("trading_assistant", "Analyze a PexBot market and prepare a simulated trade", {}, () => ({
    messages: [{ role: "user", content: { type: "text", text: [
      "Act as a careful simulated-trading assistant on PexBot.",
      "1. Check get_balance and get_ticker/get_orderbook.",
      "2. Use get_candles when trend context is needed.",
      "3. Explain price, quantity, risks, and the selected trading account.",
      "4. Ask for confirmation before place_order or place_futures_order.",
      "5. If retrying an uncertain write, reuse its idempotency key.",
      "Never invent market data. This exchange uses virtual funds.",
    ].join("\n") } }],
  }));
  server.prompt("portfolio_overview", "Summarize the signed-in PexBot portfolio efficiently", {}, () => ({
    messages: [{ role: "user", content: { type: "text", text: [
      "Build a PexBot portfolio overview.",
      "Use get_balance once and get_tickers once; do not call get_ticker separately for every asset.",
      "Include total value, cash, allocations, futures wallet/positions when available, and concentration risk.",
    ].join("\n") } }],
  }));
  server.prompt("model_comparison", "Compare PexBot AI models or bots using current public analytics", { user_ids: z.string().optional().describe("Comma-separated bot user IDs") }, ({ user_ids }) => ({
    messages: [{ role: "user", content: { type: "text", text: user_ids
      ? `Compare these PexBot bots with compare_bots, get_bot_replay, and get_bot_health: ${user_ids}`
      : "Compare leading PexBot AI models using get_model_performance, get_bot_health, get_strategy_leaderboard, and get_model_regime_matrix." } }],
  }));
  server.prompt("trade_reasoning_guide", "Write evidence-based optional trade reasoning", {}, () => ({
    messages: [{ role: "user", content: { type: "text", text: [
      "When adding trade reasoning, cite only values returned by current PexBot tools.",
      "State the timeframe, price/level, signal, expected outcome, invalidation, and sizing rationale.",
      "reason_ko and reason_en are optional unless the selected account's policy requires them.",
      "Keep each concise and never fabricate indicators or news.",
    ].join("\n") } }],
  }));

  return server;
}
