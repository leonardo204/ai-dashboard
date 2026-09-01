# AI 프록시 API 가이드

`https://ai.zerolive.co.kr` — 여러 앱의 LLM 호출을 한곳으로 모으는 중계 서버입니다.
앱에서 API 키를 없애고, 어떤 앱이 어떤 모델을 얼마나 썼는지 한 화면에서 봅니다.

**이 문서 하나로 연결·운영·문제 해결이 모두 됩니다.** 사람이 읽어도 되고, AI 에이전트에게 그대로 줘도 됩니다.

## 어디부터 보면 되나요

| 지금 하려는 일 | 볼 곳 |
| --- | --- |
| 프록시가 뭔지 먼저 알고 싶다 | [1. 무엇을 하는 서버인가](#1-무엇을-하는-서버인가) |
| 새 앱을 처음 연결한다 | [2. 빠른 시작](#2-빠른-시작-5분) |
| 요청 형식·필드를 확인한다 | [3. API 레퍼런스](#3-api-레퍼런스) |
| 어떤 모델을 쓸지 고른다 | [4. 모델 고르기](#4-모델-고르기) |
| 웹검색·임베딩을 붙인다 | [5. 웹검색](#5-웹검색) · [6. 임베딩](#6-임베딩) |
| 호출이 실패한다 | [7. 에러 코드와 대처](#7-에러-코드와-대처) · [8. 자주 걸리는 함정](#8-자주-걸리는-함정) |
| 사용량·비용을 본다 | [9. 사용량 모니터링](#9-사용량-모니터링) |
| 앱을 추가·수정·중지한다 | [10. 앱 관리 API](#10-앱-관리-api) |
| AI에게 연결 작업을 시킨다 | [부록 A. 에이전트 지시 프롬프트](#부록-a-에이전트-지시-프롬프트) |

---

## 1. 무엇을 하는 서버인가

앱이 OpenRouter를 직접 부르지 않고 이 프록시를 거칩니다.

```
앱  ──(앱 토큰)──▶  ai.zerolive.co.kr  ──(서버 키)──▶  OpenRouter  ──▶  실제 모델
                          │
                          └─▶ D1에 호출 기록 (앱·모델·토큰·비용·지역)
```

얻는 것은 셋입니다.

- **키를 앱에서 없앱니다.** OpenRouter 키는 서버에만 있습니다. 앱에는 앱 전용 토큰만 들어가고, 그 토큰으로는 상한이 걸린 중계만 열립니다. 앱이 털려도 키는 안 나갑니다.
- **여러 앱을 한곳에서 봅니다.** 앱별 호출 수·토큰·비용·지연·지역이 대시보드 한 장에 쌓입니다.
- **모델을 코드 수정 없이 바꿉니다.** 앱은 용도 이름만 보내고 실제 모델은 서버 설정에서 정합니다.

**엔드포인트는 둘입니다.**

| 용도 | 주소 |
| --- | --- |
| 채팅 · 비전 · 웹검색 · 도구 호출 | `POST /v1/ai` |
| 임베딩 | `POST /v1/embeddings` |

관리 화면은 `https://ai.zerolive.co.kr/admin` 입니다.

**HTTPS만 받습니다.** 평문 `http://`로 `/v1`·`/admin`을 부르면 403으로 거부합니다. 이미 노출된 요청이라 리다이렉트하지 않고 막습니다.

---

## 2. 빠른 시작 (5분)

### 2-1. 앱 등록 → 토큰 발급

관리자 API 키(`ADMIN_API_KEY`)를 환경변수에 넣고 실행합니다.

```bash
curl -sS -X POST https://ai.zerolive.co.kr/admin/api/apps \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-app",
    "name": "내 앱",
    "models": { "default": "google/gemini-3.6-flash" },
    "perMin": 20,
    "perDay": 300,
    "note": "용도 메모"
  }'
```

응답(201)의 `app.token`이 앱 전용 토큰입니다. 이 값을 앱에 넣습니다.

> 새로 발급한 토큰은 **몇 초 뒤부터** 듣습니다. 서버가 토큰을 짧게 캐시합니다. 등록 직후 401이 나면 3~5초 뒤 다시 시도하십시오.

### 2-2. 첫 호출

```bash
curl -sS https://ai.zerolive.co.kr/v1/ai \
  -H "Authorization: Bearer $APP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"1+1은? 숫자만 답해."}],
       "response_format":{"type":"text"},"max_tokens":800}'
```

`choices[0].message.content`에 `2`가 오면 연결된 것입니다.

### 2-3. 집계 확인

```bash
curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" \
  "https://ai.zerolive.co.kr/admin/stats.json?period=week&app=my-app" \
  | python3 -c 'import json,sys;s=json.load(sys.stdin);print("호출",s["total"],"성공",s["ok"],"비용",s["cost"])'
```

---

## 3. API 레퍼런스

### 3-1. 공통 — 인증·헤더·상한

| 항목 | 값 |
| --- | --- |
| 메서드 | `POST` 만 (그 외 405) |
| 인증 | `Authorization: Bearer <앱 토큰>` |
| 용도 지정 | `X-Ai-Kind: <용도>` — 앱 `models` 맵의 키. 생략하면 `default` |
| 본문 크기 | 최대 8MB (초과 413) |
| 타임아웃 | 채팅 120초 · 임베딩 60초 |
| 호출 상한 | 앱별 `perMin` / `perDay`, **(앱 + 클라이언트 IP)** 기준 (초과 429) |

### 3-2. `POST /v1/ai` — 채팅·비전·웹검색

요청 본문은 **OpenAI 형식(`messages`)** 또는 **Gemini 형식(`contents`)** 둘 다 받습니다.
**보낸 형식 그대로 응답합니다.** Gemini 형식으로 보내면 `candidates[0].content.parts[0].text`로 돌아오므로, 기존 Gemini 코드는 주소와 헤더만 바꾸면 됩니다.

```jsonc
{
  "messages": [{ "role": "user", "content": "..." }],

  "model": "google/gemini-2.5-pro",        // 선택. 지정하면 이 모델을 씁니다
  "max_tokens": 2000,                       // 기본 2000, 상한 32000
  "response_format": { "type": "text" },    // 기본 {"type":"json_object"} — 8-① 참고
  "temperature": 0.3,                       // openai/ 계열에서는 무시됩니다
  "reasoning_effort": "low",                // openai/ 계열 전용, 기본 "low"
  "top_p": 0.9,
  "stop": ["\n\n"],
  "tools": [ ... ],                         // 도구 호출 그대로 전달
  "tool_choice": "auto",
  "plugins": [{ "id": "web" }],             // 웹검색 — 5장 참고

  "meta": { "ver": "1.2.0", "screen": "detail" }   // 통계용. 모델에는 안 보냅니다
}
```

응답은 OpenRouter 원본을 그대로 전달합니다. `choices[0].message.content`로 읽습니다.

**모델이 정해지는 순서**는 이렇습니다.

```
body.model  →  앱 models[X-Ai-Kind]  →  앱 models.default  →  google/gemini-3.6-flash
```

**모델 제한은 없습니다.** OpenRouter에 있는 모델이면 이름을 그대로 씁니다. 오타나 없는 모델이면 OpenRouter가 400과 사유를 주고, 프록시는 그 사유를 그대로 앱에 전달합니다.

### 3-3. `POST /v1/embeddings` — 임베딩

```jsonc
{
  "model": "google/gemini-embedding-001",
  "input": "문장 하나",                 // 또는 ["문장1", "문장2"] 배열
  "dimensions": 1536,                   // 선택
  "encoding_format": "float",           // 선택
  "meta": { "ver": "1.2.0" }            // 선택
}
```

응답도 OpenRouter 원본입니다. `data[0].embedding`이 벡터입니다.

`gemini-embedding-001` 기준 3072차원이고, 임베딩은 출력 토큰이 없어 입력 토큰만 청구됩니다.

### 3-4. `meta` — 앱이 보내는 부가 정보

통계에 그대로 쌓이는 자유 형식 객체입니다. 대시보드가 키와 값 분포를 자동으로 보여주므로, 버전별·화면별 사용량을 나눠 볼 수 있습니다. 서버 스키마를 고치지 않아도 새 키가 바로 잡힙니다.

- 모델에는 전달하지 않습니다. 응답 품질에 영향이 없습니다.
- 전체 2KB를 넘으면 잘립니다.
- **개인정보는 넣지 마십시오.** 사용자 식별자·이메일·건강정보는 금지합니다.

권장 키: `ver`(앱 버전) · `screen`(호출 화면) · `tier`(요금제) · `ab`(실험군).

---

## 4. 모델 고르기

### 앱 `models` 맵

"용도 이름 → 모델" 대응표입니다. 앱이 `X-Ai-Kind: summary`를 보내면 `models.summary`로 호출됩니다.

```json
"models": {
  "summary": "google/gemini-2.5-flash-lite",
  "vision":  "openai/gpt-5.6-luna",
  "search":  "google/gemini-2.5-pro",
  "default": "google/gemini-3.6-flash"
}
```

이 맵을 바꾸면 **앱 코드를 건드리지 않고** 모델이 바뀝니다.

### 자주 쓰는 모델

| 모델 | 입력 / 출력 (USD per 1M) | 쓰임새 |
| --- | --- | --- |
| `google/gemini-2.5-flash-lite` | 0.10 / 0.40 | 가장 저렴, 단순 분류·요약 |
| `openai/gpt-5.6-luna` | 0.20 / 1.20 | 빠름, 이미지 속 숫자 읽기에 강함 |
| `google/gemini-3.6-flash` | 0.75 / 3.75 | 기본값, 한국어·음식 판별에 강함 |
| `google/gemini-2.5-pro` | 1.25 / 10.00 | 어려운 추론, 웹검색 |
| `google/gemini-embedding-001` | 0.15 / — | 임베딩 전용 |

전체 목록은 카탈로그 API로 조회합니다.

```bash
# 이름 검색
curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" \
  "https://ai.zerolive.co.kr/admin/api/models?q=gemini"

# 이미지 입력이 되는 모델만
curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" \
  "https://ai.zerolive.co.kr/admin/api/models?vision=1"
```

각 항목에 `inPerM`·`outPerM`·`webSearchPerCall`·`inputModalities`가 함께 옵니다. 임베딩 모델은 채팅 카탈로그에 없지만 `/v1/embeddings`로 호출됩니다.

---

## 5. 웹검색

모델이 최신 정보를 찾아 답하게 합니다. 두 방법이 **같은 동작**입니다.

```jsonc
// 방법 1 — 모델 이름에 :online 붙이기
{ "model": "google/gemini-2.5-pro:online", "messages": [...] }

// 방법 2 — plugins (옵션 조절 가능)
{ "model": "google/gemini-2.5-pro",
  "plugins": [{ "id": "web", "engine": "exa", "max_results": 5 }],
  "messages": [...] }
```

응답의 `choices[0].message.annotations`에 참고한 출처(`url_citation`)가 들어옵니다. 화면에 출처를 함께 보여주십시오.

> **검색료는 토큰과 별개로 붙습니다.** Exa 기준 요청당 $0.007, 모델 자체 검색(native)은 $0.014 수준입니다. 한 번 호출에 $0.03이 나올 수 있어 채팅 기본 호출보다 10배 이상 비쌉니다. 최신 정보가 꼭 필요할 때만 켜십시오.
>
> 이 요금은 OpenRouter가 응답에 실어주는 실제 청구액에 포함돼 대시보드 비용에 그대로 반영됩니다.

---

## 6. 임베딩

문장을 벡터로 바꿔 검색·유사도·RAG에 씁니다.

```bash
curl -sS https://ai.zerolive.co.kr/v1/embeddings \
  -H "Authorization: Bearer $APP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"google/gemini-embedding-001","input":["문장1","문장2"]}'
```

- 배열로 보내면 한 번에 여러 개를 처리합니다. 건별로 부르는 것보다 빠르고 쌉니다.
- 같은 검색 공간에서는 **모델과 차원을 고정**하십시오. 모델이 바뀌면 기존 벡터와 비교가 안 됩니다.
- 벡터 저장은 앱이 알아서 합니다. 프록시는 중계와 집계만 합니다.

---

## 7. 에러 코드와 대처

| 코드 | 뜻 | 할 일 |
| --- | --- | --- |
| **400** | 본문이 잘못됐거나 상류가 거절 | 응답 본문에 사유가 그대로 옵니다. 모델 이름 오타, `messages` 누락, `response_format` 문제(8-①)를 확인하십시오 |
| **401** | 토큰이 없거나 틀림 | 토큰 확인. 재발급했다면 앱에도 반영. 방금 등록했다면 3~5초 뒤 재시도 |
| **403** | 앱이 중지됨 | 관리자에게 문의 안내. 관리 화면에서 재개할 수 있습니다 |
| **405** | POST가 아님 | 메서드를 POST로 |
| **413** | 본문 8MB 초과 | 이미지를 줄여서 재시도 |
| **429** | 분당·일일 상한 초과 | 잠시 후 재시도 안내. 상한은 앱 설정에서 올릴 수 있습니다 |
| **500** | 서버 AI 키 미설정 | 관리자 확인 필요 |
| **502** | 상류 연결 실패·타임아웃 | 재시도, 또는 수동 입력 같은 대체 경로 제공 |

**실패를 조용히 넘기지 마십시오.** 사용자에게 상태를 알리고, 가능하면 대체 경로를 주십시오.

---

## 8. 자주 걸리는 함정

실제로 부딪혔던 것만 모았습니다. 호출이 이상하면 여기부터 보십시오.

**① `response_format`을 명시하십시오.**
지정하지 않으면 서버가 `{"type":"json_object"}`를 기본으로 넣습니다. 이 상태에서 프롬프트에 "json"이라는 단어가 없으면 **`openai/` 계열 모델이 400으로 실패**합니다.
- 일반 텍스트를 원하면 → `"response_format": {"type":"text"}`
- JSON을 원하면 → 프롬프트에 "JSON으로 출력" 문구를 넣기

**② `max_tokens`를 넉넉히 잡으십시오.**
요즘 모델은 답을 내기 전에 추론 토큰을 먼저 씁니다. 작게 잡으면 추론에만 소진돼 `content: null`에 `finish_reason: "length"`가 옵니다. 짧은 답이라도 최소 500, 보통은 기본값 2000이면 됩니다.

**③ 이미지는 앱에서 먼저 줄이십시오.**
긴 변 1024px, JPEG 품질 0.8 정도가 적당합니다. 원본을 base64로 보내면 8MB 상한(413)에 걸리고 비용도 몇 배가 됩니다.

**④ 설정 변경은 바로 반영되지 않습니다.**
서버가 토큰을 캐시합니다. **새로 등록한 토큰은 약 3초 뒤**부터 듣고, **이미 쓰던 토큰의 변경(모델 교체·상한·중지·재발급)은 최대 60초** 걸립니다. 등록 직후 401이 나면 3~5초 기다렸다 다시 하십시오.

**⑤ `temperature`는 모델에 따라 무시됩니다.**
`openai/` 계열(추론 모델)은 `temperature`를 받지 않아 서버가 대신 `reasoning_effort`를 넣습니다. 조절하려면 `"reasoning_effort": "low" | "medium" | "high"`를 직접 보내십시오. Gemini 계열은 `temperature`가 그대로 반영됩니다.

**⑥ 상한은 앱이 아니라 (앱 + IP) 기준입니다.**
같은 IP에서 여러 사용자가 몰리면(사무실·학교 공용망) 먼저 429가 날 수 있습니다. 앱 상한을 정할 때 감안하십시오.

---

## 9. 사용량 모니터링

### 화면

`https://ai.zerolive.co.kr/admin` — 아이디·비밀번호로 로그인합니다. 세션은 12시간입니다.

- 요약 카드: 호출 수 · 비용 · 평균/p95 지연 · 성공률 · 고유 IP · 국가 수
- 기간 탭: 주 / 월 / 분기 / 반기 / 년 / 전체, 앱별 필터
- 추이 차트(호출·비용), 세계 지도(도시별 호출), 앱별·모델별 비중
- 앱별·모델별·용도별·국가별·지역별 표, 실패 분석, 메타 키 분포, 최근 호출 50건

### JSON

```bash
curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" \
  "https://ai.zerolive.co.kr/admin/stats.json?period=month&app=my-app"
```

| 파라미터 | 값 |
| --- | --- |
| `period` | `week` · `month` · `quarter` · `half` · `year` · `all` |
| `app` | 앱 id (생략하면 전체) |

주요 필드입니다.

| 필드 | 뜻 |
| --- | --- |
| `total` / `ok` / `error` | 호출 수 · 성공 · 실패 |
| `inTokens` / `outTokens` / `cost` | 입력·출력 토큰, 비용(USD) |
| `avgLatency` / `p95Latency` | 평균 · 상위 5% 지연(ms) |
| `byApp` / `byModel` / `byKind` | 앱별 · 모델별 · 용도별 집계 |
| `buckets` | 기간 추이 |
| `errors` | HTTP 코드별 실패와 대표 메시지 |
| `metaKeys` | 앱이 보낸 메타 키·값 분포 |
| `byCountry` / `byRegion` | 국가별 · 지역별 |
| `recent` | 최근 호출 50건 |

**비용은 OpenRouter가 응답에 실어주는 실제 청구액입니다.** 추정이 아니라서 웹검색처럼 토큰 외 요금이 붙어도 그대로 잡힙니다. 최종 청구액은 OpenRouter 대시보드가 기준입니다.

지역 정보는 Cloudflare가 요청에 붙여주는 값이라 외부 조회 없이 기록됩니다. VPN·통신사 경로에 따라 실제와 다를 수 있습니다.

---

## 10. 앱 관리 API

인증은 `Authorization: Bearer $ADMIN_API_KEY`입니다. 관리 화면에 로그인한 브라우저에서는 헤더 없이도 됩니다.

```
GET    /admin/api/apps              앱 목록(토큰 포함)
POST   /admin/api/apps              앱 추가 → 토큰 자동 발급
GET    /admin/api/apps/<id>         앱 하나 조회
PATCH  /admin/api/apps/<id>         부분 수정 (이름·모델 맵·상한·중지)
POST   /admin/api/apps/<id>/token   토큰 재발급 (이전 토큰은 최대 60초 뒤 무효)
DELETE /admin/api/apps/<id>         앱 삭제 (호출 기록은 통계에 남음)
GET    /admin/api/models            OpenRouter 모델 카탈로그 (?q= ?vision=1)
```

### 앱 필드

| 필드 | 설명 |
| --- | --- |
| `id` | 영문·숫자·하이픈, 2~41자. 등록 후 변경 불가 |
| `name` | 표시 이름 |
| `token` | 앱 전용 토큰 (자동 발급) |
| `models` | 용도 → 모델 맵. `{"default":"..."}`는 넣어 두십시오 |
| `perMin` / `perDay` | (앱 + IP) 기준 상한. 기본 20 / 300 |
| `active` | `false`면 호출이 403으로 막힙니다. 반영까지 최대 60초 |
| `note` | 메모 |

### 자주 쓰는 조작

```bash
# 모델 교체 — 앱 코드 수정 없이
curl -sS -X PATCH https://ai.zerolive.co.kr/admin/api/apps/my-app \
  -H "Authorization: Bearer $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"models":{"default":"google/gemini-2.5-flash-lite"}}'

# 상한 조정
curl -sS -X PATCH https://ai.zerolive.co.kr/admin/api/apps/my-app \
  -H "Authorization: Bearer $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"perMin":60,"perDay":2000}'

# 임시 중지 / 재개
curl -sS -X PATCH https://ai.zerolive.co.kr/admin/api/apps/my-app \
  -H "Authorization: Bearer $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"active":false}'

# 토큰 유출 시 재발급 (이전 토큰은 최대 60초 뒤 무효 — 아래 경고 참고)
curl -sS -X POST https://ai.zerolive.co.kr/admin/api/apps/my-app/token \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

> **변경은 최대 60초 뒤에 반영됩니다.** 서버가 토큰을 60초 캐시하고, 그 캐시는 요청을 처리한 서버 인스턴스마다 따로 있습니다. 중지·토큰 재발급·모델 교체 모두 마찬가지입니다.
>
> 토큰이 유출돼 급히 막아야 하면, 재발급 뒤 **1분간은 이전 토큰도 살아 있다고 보고** 대응하십시오. 그 사이 호출은 대시보드 최근 호출에서 확인할 수 있습니다.

| 응답 | 뜻 |
| --- | --- |
| 201 | 생성됨 |
| 400 | 입력값 오류 (사유가 본문에 옵니다) |
| 401 | 관리자 인증 실패 |
| 404 | 없는 앱 |
| 409 | 이미 있는 앱 id |

---

## 11. 운영 규칙

- 앱 번들·저장소에 **OpenRouter 키를 넣지 않습니다.** 프록시를 쓰는 이유가 사라집니다.
- 앱 토큰을 코드에 **하드코딩하거나 커밋하지 않습니다.** 환경변수나 gitignore된 설정 파일에 둡니다.
- `meta`에 **개인정보를 담지 않습니다.**
- 프록시를 거치지 않는 **직접 호출 경로를 남기지 않습니다.** 남으면 그만큼 통계에서 빠집니다.
- 서버가 돌려준 **응답 원본을 가리지 않습니다.** 오류 사유가 그대로 담겨 있어 원인 파악에 씁니다.
- 토큰이 유출됐다고 판단되면 **재발급이 먼저입니다.** 다만 이전 토큰이 완전히 막히기까지 최대 60초가 걸립니다(10장 경고 참고).

---

## 부록 A. 에이전트 지시 프롬프트

다른 앱을 연결하는 작업을 AI 에이전트에게 맡길 때, 아래 `---` 사이를 복사해 붙여넣으십시오.
`<<< >>>` 부분만 실제 값으로 채웁니다. `ADMIN_API_KEY`와 앱 토큰은 대화에 붙여넣지 말고 환경변수로 넘기십시오.

---

이 앱이 LLM을 직접 호출하고 있다면, 그 호출을 자체 AI 프록시(`https://ai.zerolive.co.kr`)를 거치도록 바꿔줘.

**가이드 문서**: https://github.com/leonardo204/ai-dashboard/blob/main/docs/PROXY-API.md — 요청 형식·모델 목록·에러 코드·함정이 전부 여기 있어. 작업 전에 읽고, 막히면 7·8장을 봐.

**이 앱 정보**
- 앱 id: `<<<my-app>>>` (영문·숫자·하이픈, 2~41자)
- 앱 이름: `<<<내 앱>>>`
- 지금 쓰는 모델: `<<<예: gemini-2.5-flash 직접 호출>>>`
- 용도: `<<<예: 텍스트 요약 1종>>>`
- 웹검색 필요: `<<<예/아니오>>>`
- 임베딩 필요: `<<<예/아니오>>>`

**할 일**

1. 가이드 2장대로 앱을 등록하고 토큰을 받아. `models` 맵은 이 앱 용도에 맞게 짜(4장 참고).
2. 앱의 LLM 호출부를 프록시로 바꿔. 기존 요청이 Gemini 형식이면 주소·헤더만 바꾸고 파싱은 그대로 둬도 돼(3-2장).
3. 토큰은 이 앱이 시크릿을 관리하는 기존 방식(환경변수·gitignore된 설정 파일)에 넣어. 커밋되지 않는지 확인해.
4. `meta`에 `ver`·`screen`을 넣어줘. 개인정보는 절대 넣지 마.
5. 8장의 함정 6가지를 하나씩 확인해. 특히 `response_format`과 `max_tokens`.
6. 가이드 2-2, 2-3의 검증 명령을 직접 실행하고 결과를 보고해.

**하지 말 것**: 11장 운영 규칙을 그대로 지켜줘.

작업이 끝나면 바꾼 파일, 등록한 앱 id, 검증 결과(호출 성공 여부·집계 반영 여부)를 정리해서 알려줘.

---

## 부록 B. 서버 구성 (관리자용)

| 항목 | 값 |
| --- | --- |
| repo | [github.com/leonardo204/ai-dashboard](https://github.com/leonardo204/ai-dashboard) |
| 코드 | `src/` — `index.ts`(라우팅·인증·관리 API) · `proxy.ts`(중계) · `stats.ts`(집계·화면) · `worldmap.ts`(지도) |
| 스키마 | `schema.sql` — `apps`(앱 레지스트리) · `calls`(호출 로그) |
| 저장소 | Cloudflare D1 (분리 전부터 쓰던 데이터베이스를 그대로 씁니다) |
| 시크릿 | `OPENROUTER_API_KEY` · `ADMIN_USER` · `ADMIN_PASS` · `ADMIN_API_KEY` |
| 배포 | `npm run deploy` |
| 도메인 | `ai.zerolive.co.kr` |

**로그 보관**: 호출 기록은 180일이 지나면 정리됩니다.

**요청 형식 호환**: Gemini 형식(`contents`)으로 보내면 응답도 Gemini 형식으로 돌려줍니다. 이미 Gemini SDK 형태로 짜둔 앱이 파싱 코드를 고치지 않아도 되게 한 것입니다.

**시크릿 교체**:

```bash
npx wrangler secret put OPENROUTER_API_KEY
```

`ADMIN_PASS`를 바꾸면 관리 화면의 기존 로그인 세션이 한 번에 무효가 됩니다(서명 키로 쓰기 때문입니다).
