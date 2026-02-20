**English** | [한국어](README.ko.md)

# pexbot-mcp

[![npm version](https://img.shields.io/npm/v/@mikusnuz/pexbot-mcp)](https://www.npmjs.com/package/@mikusnuz/pexbot-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Badge](https://lobehub.com/badge/mcp/mikusnuz-pexbot-mcp)](https://lobehub.com/discover/mcp/mikusnuz-pexbot-mcp)

MCP server for [pex.bot](https://pex.bot) — AI-powered simulated crypto exchange.

Trade cryptocurrencies with virtual money (100M KRW) through natural language. No real funds at risk.

## Features

- **8 tools** for account management, market data, and order execution
- **2 resources** for real-time account profile and balance
- **2 prompts** for AI trading assistant and portfolio overview
- Simulated trading with 100M KRW virtual balance
- API Key and JWT authentication support
- Device fingerprinting for account activation

## Installation

### npx (Recommended)

```json
{
  "mcpServers": {
    "pexbot": {
      "command": "npx",
      "args": ["-y", "@mikusnuz/pexbot-mcp"],
      "env": {
        "PEXBOT_API_KEY": "pxb_your_api_key_here"
      }
    }
  }
}
```

### Manual

```bash
git clone https://github.com/mikusnuz/pexbot-mcp.git
cd pexbot-mcp
npm install
npm run build
```

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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PEXBOT_API_KEY` | Yes* | API key from pex.bot dashboard (`pxb_` prefix) |
| `PEXBOT_TOKEN` | Alt | JWT token (fallback, for backwards compatibility) |
| `PEXBOT_API_URL` | No | API base URL (default: `https://pex.bot/api/v1`) |

*Either `PEXBOT_API_KEY` or `PEXBOT_TOKEN` is required. API key is preferred.

### Authentication

- **API Key** (recommended): Obtain from the pex.bot dashboard. Format: `pxb_xxxxxxxx`. Sent via `X-API-Key` header.
- **JWT Token** (fallback): A previously issued JWT. Sent via `Authorization: Bearer` header.

## Tools

| Tool | Description |
|------|-------------|
| `activate` | Register device and receive 100M KRW virtual balance |
| `get_profile` | Get account profile and activation status |
| `get_balance` | Get asset balances across all holdings |
| `get_markets` | List all available trading markets |
| `get_ticker` | Get current ticker (price, volume) for a market |
| `get_orderbook` | Get orderbook bid/ask levels for a market |
| `place_order` | Place a buy or sell order (limit or market) |
| `cancel_order` | Cancel an open order by ID |

## Resources

| Resource URI | Description |
|-------------|-------------|
| `pexbot://profile` | Account profile and activation status |
| `pexbot://balance` | Current asset balances |

## Prompts

| Prompt | Description |
|--------|-------------|
| `trading_assistant` | AI trading assistant that checks markets and suggests trades |
| `portfolio_overview` | Comprehensive portfolio breakdown with current valuations |

## License

MIT
