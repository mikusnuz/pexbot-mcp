import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_CONTRACT_VERSION,
  MCP_VERSION,
  PexbotApiError,
  PexbotClient,
  createAgentRegistrationToken,
  queryString,
} from "../src/client.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("sends current client-contract headers on every request", async () => {
  let captured: RequestInit | undefined;
  const client = new PexbotClient({
    apiBase: "https://example.test/api/v1",
    fetchFn: async (_url, init) => {
      captured = init;
      return jsonResponse({ ok: true });
    },
  });

  await client.get("/markets");
  const headers = captured?.headers as Record<string, string>;
  assert.equal(headers["X-Pexbot-Client"], "mcp");
  assert.equal(headers["X-Pexbot-Client-Version"], MCP_VERSION);
  assert.equal(headers["X-Pexbot-Client-Contract"], CLIENT_CONTRACT_VERSION);
  assert.equal(headers["X-Pexbot-Client-Build"], MCP_VERSION);
});

test("prefers API key for trading and forwards idempotency and trading-account headers", async () => {
  let captured: RequestInit | undefined;
  const client = new PexbotClient({
    apiBase: "https://example.test/api/v1",
    apiKey: "pxb_test",
    sessionToken: "jwt-test",
    fetchFn: async (_url, init) => {
      captured = init;
      return jsonResponse({ ok: true });
    },
  });

  await client.post("/orders", { symbol: "BTC-KRW" }, {
    auth: "trading",
    idempotencyKey: "e3cf5cb9-56ef-4a87-9d2c-43fdb0b090b0",
    tradingAccount: "season-user-id",
  });
  const headers = captured?.headers as Record<string, string>;
  assert.equal(headers["X-API-Key"], "pxb_test");
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers["Idempotency-Key"], "e3cf5cb9-56ef-4a87-9d2c-43fdb0b090b0");
  assert.equal(headers["X-Trading-Account"], "season-user-id");
});

test("uses only the session token for session-scoped routes", async () => {
  let captured: RequestInit | undefined;
  const client = new PexbotClient({
    apiBase: "https://example.test/api/v1",
    apiKey: "pxb_test",
    sessionToken: "jwt-test",
    fetchFn: async (_url, init) => {
      captured = init;
      return jsonResponse({ ok: true });
    },
  });

  await client.get("/auth/me", { auth: "session" });
  const headers = captured?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer jwt-test");
  assert.equal(headers["X-API-Key"], undefined);
});

test("derives the futures base and preserves structured API errors", async () => {
  let capturedUrl = "";
  const client = new PexbotClient({
    apiBase: "https://example.test/api/v1",
    fetchFn: async (url) => {
      capturedUrl = String(url);
      return jsonResponse({ error: "client_update_required", message: "Upgrade required" }, 426);
    },
  });

  await assert.rejects(
    client.get("/tickers", { surface: "futures" }),
    (error: unknown) => {
      assert.ok(error instanceof PexbotApiError);
      assert.equal(error.status, 426);
      assert.equal(error.code, "client_update_required");
      assert.equal(error.message, "Upgrade required");
      return true;
    },
  );
  assert.equal(capturedUrl, "https://example.test/api/v2/futures/tickers");
});

test("builds encoded query strings without undefined values", () => {
  assert.equal(queryString({ symbol: "BTC/KRW", limit: 20, cursor: undefined }), "?symbol=BTC%2FKRW&limit=20");
});

test("agent registration token is deterministic for the bound request", () => {
  const token = createAgentRegistrationToken("secret", {
    timestamp: "123",
    email: "BOT@EXAMPLE.COM",
    modelName: "gpt-5.4",
    macAddress: "aa:bb:cc:dd:ee:ff",
    hostname: "agent-host",
    cpuInfo: "cpu",
    nonce: "nonce",
    solution: "42",
  });
  assert.match(token, /^123\.[0-9a-f]{64}$/);
  assert.equal(token, createAgentRegistrationToken("secret", {
    timestamp: "123",
    email: "bot@example.com",
    modelName: "gpt-5.4",
    macAddress: "aa:bb:cc:dd:ee:ff",
    hostname: "agent-host",
    cpuInfo: "cpu",
    nonce: "nonce",
    solution: "42",
  }));
});
