[English](README.md) | **한국어**

# pexbot-mcp

[![npm version](https://img.shields.io/npm/v/@mikusnuz/pexbot-mcp)](https://www.npmjs.com/package/@mikusnuz/pexbot-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Badge](https://lobehub.com/badge/mcp/mikusnuz-pexbot-mcp)](https://lobehub.com/discover/mcp/mikusnuz-pexbot-mcp)

[pex.bot](https://pex.bot)을 위한 MCP 서버 — AI 기반 모의 암호화폐 거래소입니다.

가상 자금(1억 KRW)으로 자연어를 통해 암호화폐를 거래할 수 있습니다. 실제 자금 손실 위험이 없습니다.

## 기능

- **8가지 도구** — 계정 관리, 시세 조회, 주문 실행
- **2가지 리소스** — 실시간 계정 프로필 및 잔고
- **2가지 프롬프트** — AI 트레이딩 어시스턴트 및 포트폴리오 개요
- 1억 KRW 가상 잔고로 모의 거래
- API Key 및 JWT 인증 지원
- 계정 활성화를 위한 디바이스 핑거프린팅

## 설치

### npx (권장)

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

### 수동 설치

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

## 환경 변수

| 변수 | 필수 여부 | 설명 |
|------|-----------|------|
| `PEXBOT_API_KEY` | 예* | pex.bot 대시보드에서 발급한 API Key (`pxb_` 접두사) |
| `PEXBOT_TOKEN` | 대체 | JWT token (하위 호환용 폴백) |
| `PEXBOT_API_URL` | 아니오 | API 기본 URL (기본값: `https://pex.bot/api/v1`) |

*`PEXBOT_API_KEY` 또는 `PEXBOT_TOKEN` 중 하나는 반드시 필요합니다. API Key 사용을 권장합니다.

### 인증

- **API Key** (권장): pex.bot 대시보드에서 발급받습니다. 형식: `pxb_xxxxxxxx`. `X-API-Key` 헤더로 전송됩니다.
- **JWT Token** (폴백): 기존에 발급된 JWT입니다. `Authorization: Bearer` 헤더로 전송됩니다.

## 도구

| 도구 | 설명 |
|------|------|
| `activate` | 디바이스를 등록하고 1억 KRW 가상 잔고를 지급받습니다 |
| `get_profile` | 계정 프로필 및 활성화 상태를 조회합니다 |
| `get_balance` | 보유 자산의 잔고를 조회합니다 |
| `get_markets` | 거래 가능한 전체 마켓 목록을 조회합니다 |
| `get_ticker` | 특정 마켓의 현재 시세(가격, 거래량)를 조회합니다 |
| `get_orderbook` | 특정 마켓의 호가창(매수/매도) 정보를 조회합니다 |
| `place_order` | 매수 또는 매도 주문을 제출합니다 (지정가/시장가) |
| `cancel_order` | ID로 미체결 주문을 취소합니다 |

## 리소스

| 리소스 URI | 설명 |
|-----------|------|
| `pexbot://profile` | 계정 프로필 및 활성화 상태 |
| `pexbot://balance` | 현재 자산 잔고 |

## 프롬프트

| 프롬프트 | 설명 |
|---------|------|
| `trading_assistant` | 시장을 확인하고 거래를 제안하는 AI 트레이딩 어시스턴트 |
| `portfolio_overview` | 현재 평가액이 포함된 포트폴리오 상세 분석 |

## 라이선스

MIT
