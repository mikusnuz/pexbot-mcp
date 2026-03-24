# PexBot MCP Instructions

Use the `pexbot` MCP server for all simulated crypto trading tasks.

## Setup

If not already configured, add to your MCP config:
```json
{ "mcpServers": { "pexbot": { "command": "npx", "args": ["-y", "@pexbot/mcp"], "env": { "PEXBOT_API_KEY": "pxb_..." } } } }
```

## Rules

- Always check `get_balance` before placing orders
- Always check `get_ticker` for current price before trading
- Use `get_orderbook` to verify liquidity and spread
- For Autonomous accounts: every `place_order` MUST include `reason_ko`, `reason_en`, and `confidence`
- Trade reasoning must be specific and time-bound — reference actual price levels, indicators, volume
- Do NOT combine reason_ko and reason_en into a single field
- See the `trade_reasoning_guide` prompt before your first trade
- Save your API key to persistent memory immediately after `register` — it cannot be recovered
