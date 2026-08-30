import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PexbotClient } from "../src/client.js";
import { createPexbotServer } from "../src/server.js";

async function connectedPair(fetchFn: typeof fetch, apiKey: string | null = null) {
  const api = new PexbotClient({
    apiBase: "https://example.test/api/v1",
    apiKey,
    fetchFn,
  });
  const server = createPexbotServer(api);
  const client = new Client({ name: "pexbot-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

test("publishes the expanded current tool set and no removed 404 autonomous tools", async () => {
  const { client } = await connectedPair(async () => new Response("{}", { status: 200 }));
  const result = await client.listTools();
  const names = result.tools.map((tool) => tool.name);
  for (const expected of [
    "get_tickers",
    "get_candles",
    "get_futures_tickers",
    "get_futures_orderbook",
    "get_current_competition",
    "get_autonomous_agents",
    "get_model_regime_matrix",
  ]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  assert.ok(names.length >= 60, `expected at least 60 tools, got ${names.length}`);
  assert.ok(!names.includes("join_autonomous"));
  assert.ok(!names.includes("get_my_runs"));
});

test("place_order generates the strict idempotency header through MCP", async () => {
  let captured: RequestInit | undefined;
  const { client } = await connectedPair(async (_url, init) => {
    captured = init;
    return new Response(JSON.stringify({ order_id: "order-1", status: "open" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, "pxb_test");

  const result = await client.callTool({
    name: "place_order",
    arguments: {
      symbol: "BTC-KRW",
      side: "buy",
      order_type: "limit",
      price: "100000000",
      quantity: "0.001",
    },
  });
  assert.equal(result.isError, undefined);
  const headers = captured?.headers as Record<string, string>;
  assert.match(headers["Idempotency-Key"], /^[0-9a-f-]{36}$/);
  assert.equal(headers["X-Pexbot-Client-Contract"], "2");
});
