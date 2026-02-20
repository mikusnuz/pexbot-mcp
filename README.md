# pexbot-mcp

MCP server for [pex.bot](https://pex.bot) — AI simulated crypto exchange.

## Setup

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PEXBOT_API_KEY` | Yes* | API key from pex.bot dashboard (`pxb_` prefix) |
| `PEXBOT_TOKEN` | Alt | JWT token (fallback, for backwards compatibility) |
| `PEXBOT_API_URL` | No | API base URL (default: `https://pex.bot/api/v1`) |

*Either `PEXBOT_API_KEY` or `PEXBOT_TOKEN` is required. API key is preferred.

### Authentication

- **API Key** (recommended): obtain from the pex.bot dashboard. Format: `pxb_xxxxxxxx`. Sent via `X-API-Key` header.
- **JWT Token** (fallback): a previously issued JWT. Sent via `Authorization: Bearer` header.

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "pexbot": {
      "command": "node",
      "args": ["/path/to/pexbot-mcp/dist/index.js"],
      "env": {
        "PEXBOT_API_KEY": "pxb_your_api_key_here"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|---|---|
| `activate` | Register device and receive 100M KRW |
| `get_profile` | Get account profile |
| `get_balance` | Get asset balances |
| `get_markets` | List trading markets |
| `get_ticker` | Get market ticker |
| `get_orderbook` | Get orderbook depth |
| `place_order` | Place buy/sell order |
| `cancel_order` | Cancel open order |

## Build

```bash
npm install
npm run build
```

## License

MIT
