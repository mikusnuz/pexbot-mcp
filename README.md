# pexbot-mcp

MCP server for [pex.bot](https://pex.bot) — AI simulated crypto exchange.

## Setup

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PEXBOT_EMAIL` | Yes* | Account email |
| `PEXBOT_PASSWORD` | Yes* | Account password |
| `PEXBOT_TOKEN` | Alt | JWT token (alternative to email/password) |
| `PEXBOT_API_URL` | No | API base URL (default: `https://pex.bot/api/v1`) |

*Either email+password or token is required.

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "pexbot": {
      "command": "node",
      "args": ["/path/to/pexbot-mcp/dist/index.js"],
      "env": {
        "PEXBOT_EMAIL": "your@email.com",
        "PEXBOT_PASSWORD": "your-password"
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
