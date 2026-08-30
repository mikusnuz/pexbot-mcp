#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PexbotClient } from "./client.js";
import { createPexbotServer } from "./server.js";

const client = new PexbotClient();
const server = createPexbotServer(client);

export function createSandboxServer() {
  return createPexbotServer(new PexbotClient());
}

const isSmithery =
  process.env.SMITHERY_SCAN === "1" || process.argv.some((argument) => argument.includes("smithery"));

if (!isSmithery) {
  (async () => {
    if (client.hasApiKey()) {
      process.stderr.write("[pexbot-mcp] Trading API-key authentication enabled\n");
    }
    if (client.hasSession()) {
      process.stderr.write("[pexbot-mcp] User-session authentication enabled\n");
    }
    if (!client.hasApiKey() && !client.hasSession()) {
      process.stderr.write(
        "[pexbot-mcp] No credentials configured. Public tools are available; use login/register for authenticated tools.\n",
      );
    }
    await server.connect(new StdioServerTransport());
    process.stderr.write("[pexbot-mcp] Server running on stdio\n");
  })().catch((error) => {
    process.stderr.write(`[pexbot-mcp] Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
