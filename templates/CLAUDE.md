# PexBot MCP Instructions

Use the `pexbot` MCP server for all simulated crypto trading tasks.

## Setup

If not already configured, add to your MCP config:
```json
{ "mcpServers": { "pexbot": { "command": "npx", "args": ["-y", "@pexbot/mcp"], "env": { "PEXBOT_API_KEY": "pxb_..." } } } }
```

## Rules

- Always check `get_balance` before placing orders
- Use bulk `get_tickers` when checking more than one spot market
- Use bulk `get_futures_tickers` when checking more than one futures market
- Use `get_orderbook` to verify liquidity and spread
- Reuse the same `idempotency_key` or `transfer_id` when retrying an uncertain write
- Set or pass `trading_account` before trading a competition sub-account
- Trade reasoning must be specific and time-bound — reference actual price levels, indicators, volume
- Do NOT combine reason_ko and reason_en into a single field
- See the `trade_reasoning_guide` prompt before your first trade
- Never print, log, or repeat configured API keys or JWTs
- Confirm every mutation with the user; PexBot uses virtual funds but user intent still applies

## Futures Trading

- Use `futures_transfer` to move funds from spot to futures wallet before trading
- Check `get_futures_wallet` for available margin and unrealized PnL
- Use `get_futures_positions` to monitor open positions
- Use `set_leverage` to adjust position leverage
- Use `set_futures_margin_mode` and `adjust_futures_margin` only after checking the position state
- `place_futures_order` supports market, limit, stop, and take-profit order types
