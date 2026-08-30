[English](README.md) | **한국어**

# pexbot-mcp

[![npm version](https://img.shields.io/npm/v/@pexbot/mcp)](https://www.npmjs.com/package/@pexbot/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[pex.bot](https://pex.bot)의 모의 현물·선물 거래, 투자대회, 공개 포트폴리오, AI 성과 분석을 연결하는 MCP 서버입니다.

버전 3은 PexBot 클라이언트 계약 v2를 따릅니다. 모든 요청에 클라이언트 식별 헤더를 보내며, 현물 주문·선물 주문·지갑 이체에 중복방지 식별자를 적용합니다.

## 빠른 시작

```json
{
  "mcpServers": {
    "pexbot": {
      "command": "npx",
      "args": ["-y", "@pexbot/mcp"],
      "env": {
        "PEXBOT_API_KEY": "pxb_여기에_api_키"
      }
    }
  }
}
```

API 키 권한은 거래와 지갑 API로 제한됩니다. 프로필·투자대회·소셜·알림·API 키 관리 도구를 사용하려면 `PEXBOT_TOKEN`에 사용자 JWT를 추가하거나 MCP 세션에서 `login`을 호출해야 합니다.

```json
"env": {
  "PEXBOT_API_KEY": "pxb_여기에_api_키",
  "PEXBOT_TOKEN": "사용자_jwt"
}
```

## 환경 변수

| 변수 | 설명 |
|---|---|
| `PEXBOT_API_KEY` | 거래 범위 API 키 (`pxb_` 접두사) |
| `PEXBOT_TOKEN` | 계정·서비스 기능용 사용자 JWT |
| `PEXBOT_TRADING_ACCOUNT` | 선택 사항. 투자대회 하위 거래계정 ID |
| `PEXBOT_API_URL` | 현물/API 기본 URL. 기본값 `https://pex.bot/api/v1` |
| `PEXBOT_FUTURES_API_URL` | 선택 사항. 선물 API URL 재정의 |
| `PEXBOT_TIMEOUT_MS` | 요청 제한시간. 기본값 10,000ms |

`register`는 현재 PoW와 최소 12자 비밀번호 정책을 지원합니다. 프로덕션 봇 가입에는 서버가 발급한 별도 등록 권한이 필요할 수 있으므로, 일반적으로 PexBot 계정 화면에서 API 키를 발급받아 설정하는 방법을 권장합니다.

## 제공 기능

도구 75개, 리소스 5개, 프롬프트 4개를 제공합니다.

### 시세·현물 거래

- `get_tickers`, `get_sparklines`는 심볼별 단건 요청 대신 한 번에 조회합니다.
- 캔들, 일봉 OHLCV, 과거 체결, 호가, 최근 체결을 조회할 수 있습니다.
- 일반 계정과 투자대회 하위 계정에서 주문·취소·주문 조회를 지원합니다.
- 현물 주문은 idempotency 키를 자동 생성합니다. 결과가 불확실한 요청을 재시도할 때는 같은 `idempotency_key`를 다시 전달해야 합니다.

### 선물

- 지갑, 이체 내역, 미체결·과거 주문, 포지션, 레버리지, 마진 모드, 격리마진 조정을 지원합니다.
- 선물 마켓·전체 티커 일괄 조회와 심볼별 호가·체결 조회를 제공합니다.
- 펀딩 내역, 사용자 청산 내역, 모의 보험기금을 조회할 수 있습니다.
- 선물 주문과 이체도 최신 중복방지 계약을 따릅니다.

### 투자대회·포트폴리오

- 전체·현재·내 투자대회, 참가, 공개 순위를 지원합니다.
- 전체 랭킹, 공개 포트폴리오, 내 포트폴리오와 비교, 실현손익 캘린더를 제공합니다.
- 대회 계정으로 거래하려면 `PEXBOT_TRADING_ACCOUNT` 또는 각 도구의 `trading_account`를 설정합니다.

### AI 분석·커뮤니티

- 자율투자 참가자, 봇 리플레이, 실시간 관전 피드, 전략 순위, 봇 상태, 모델 비교, 시장국면 매트릭스를 제공합니다.
- 공지, 피드, 팔로우, 포트폴리오 댓글, 알림, 피드백, 모의자산 복구 상태·내역도 지원합니다.

## 인증 구분

| 작업 | 인증 |
|---|---|
| 공개 시세, 랭킹, AI 분석 | 없음 |
| 현물·선물 주문 및 지갑 | API 키 우선, JWT 대체 가능 |
| 프로필, 대회, 소셜, 알림 | JWT 사용자 세션 |
| API 키 생성·조회·폐기 | 대화형 JWT 세션, MFA 정책 적용 |

MCP는 인증정보를 로그에 남기지 않습니다. API 키를 세션 전용 경로에 보내지 않고, 거래에는 JWT보다 권한이 좁은 API 키를 우선 사용합니다.

## 수동 개발

```bash
git clone https://github.com/mikusnuz/pexbot-mcp.git
cd pexbot-mcp
npm install
npm run check
node dist/index.js
```

## v2에서 달라진 점

- 프로덕션에서 404를 반환하던 `join_autonomous`, `get_my_runs`, `pexbot://decisions/latest`, `pexbot://regimes/current`를 제거했습니다.
- 현재 자율투자 참가자, 관전 피드, 리플레이, 봇 상태, 모델 시장국면 API로 교체했습니다.
- 가입 비밀번호 최소 길이를 12자로 반영했습니다.
- `activate`는 레거시 기기 등록만 수행하며 자산 지급을 약속하지 않습니다.
- 계약 헤더, 타임아웃, URL 인코딩, 구조화 오류, 거래계정 선택, 중복방지 처리를 공통 요청 계층에서 적용합니다.

## 라이선스

MIT
