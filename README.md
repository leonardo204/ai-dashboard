# AI Dashboard

OpenRouter 앞단에 서는 **AI 프록시 + 사용량 대시보드**입니다. Cloudflare Workers로 동작합니다.

여러 앱이 각자 LLM을 직접 부르면 키가 앱마다 흩어지고 사용량도 따로 놉니다. 이 서버는 그 호출을 한곳으로 모읍니다.

- **앱에 API 키를 두지 않습니다.** 실제 OpenRouter 키는 서버 시크릿에만 있고, 앱에는 앱 전용 토큰만 들어갑니다.
- **앱 1개 = 토큰 1개.** 호출은 앱·모델·용도·지역별로 자동 집계됩니다.
- **모델을 제한하지 않습니다.** 앱이 보낸 모델 이름을 그대로 OpenRouter에 넘깁니다.

운영 주소: `https://ai.zerolive.co.kr`

---

## 엔드포인트

| 경로 | 용도 |
| --- | --- |
| `POST /v1/ai` | 채팅·비전·웹검색 |
| `POST /v1/embeddings` | 임베딩 |
| `GET /admin` | 통계 대시보드 (세션 로그인) |
| `GET /admin/apps` | 앱 관리 화면 |
| `/admin/api/apps` | 앱 등록·수정 API |
| `/admin/api/models` | OpenRouter 모델 카탈로그 |
| `/admin/stats.json` | 통계 JSON |

앱을 붙이는 방법, 요청·응답 형식, 에러 대처는 **[docs/PROXY-API.md](docs/PROXY-API.md)** 에 있습니다.

---

## 구조

```
src/
  index.ts      라우팅 · 관리자 로그인(세션) · 앱 관리 API
  proxy.ts      OpenRouter 중계 — 인증·상한·형식 변환·로깅
  stats.ts      앱 레지스트리 · 집계 쿼리 · 대시보드 렌더
  worldmap.ts   지도용 육지 외곽선 (Natural Earth 110m, 퍼블릭 도메인)
schema.sql      D1 스키마 (apps · calls)
docs/           API 가이드
```

외부 라이브러리를 쓰지 않습니다. 차트·지도·대시보드 모두 서버에서 SVG로 그립니다.

---

## 시작하기

```bash
npm install
npm run typecheck      # 타입 검사
npm run dry-run        # 번들만 확인 (배포 안 함)
```

### D1

`wrangler.jsonc`의 `d1_databases`가 가리키는 데이터베이스를 씁니다. 새 환경에 처음 올린다면:

```bash
wrangler d1 create ai-stats                      # 나온 database_id를 wrangler.jsonc에 반영
wrangler d1 execute ai-stats --remote --file=schema.sql
```

### 시크릿

```bash
wrangler secret put OPENROUTER_API_KEY   # OpenRouter API 키
wrangler secret put ADMIN_USER           # 대시보드 로그인 아이디
wrangler secret put ADMIN_PASS           # 대시보드 로그인 비밀번호 (세션 서명 키로도 씀)
wrangler secret put ADMIN_API_KEY        # 관리 API 전용 키 (선택 — 없으면 브라우저 로그인으로만 접근)
```

`ADMIN_PASS`가 세션 쿠키의 서명 키를 겸합니다. 비밀번호를 바꾸면 기존 로그인 세션이 한 번에 무효가 됩니다.

### 배포

```bash
npm run deploy
```

---

## 도메인 전환 (최초 1회)

`ai.zerolive.co.kr` 은 이 코드가 분리되어 나온 **기존 worker에 아직 붙어 있습니다.** 그 상태로 배포하면 도메인 충돌로 실패합니다. 순서는 이렇습니다.

1. 기존 worker의 `wrangler.jsonc`에서 `ai.zerolive.co.kr` 라우트를 지우고 배포합니다.
2. 이 repo에서 `npm run deploy` 를 실행합니다.
3. 시크릿 4개를 등록합니다(위 참고). 등록 전까지 프록시는 500을 냅니다.
4. 호출이 정상인지 확인합니다.

```bash
curl -sS https://ai.zerolive.co.kr/v1/ai \
  -H "Authorization: Bearer <앱 토큰>" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"1+1은? 숫자만."}],
       "response_format":{"type":"text"},"max_tokens":800}'
```

1~2 사이에 짧은 중단이 생깁니다. 호출이 잦은 앱이 있으면 한산한 시간에 하십시오.

---

## 알아둘 것

- **D1은 분리 전부터 쓰던 데이터베이스를 그대로 씁니다.** `wrangler.jsonc` 에는 `database_id`(UUID)만 적어 두었고 바인딩은 그 id로 연결되므로, Cloudflare 대시보드에 보이는 표시 이름과는 무관합니다. 지금까지 쌓인 호출 기록과 등록된 앱이 그대로 보입니다.
- **앱 등록 정보는 D1의 `apps` 테이블이 유일한 기준입니다.** 코드에 하드코딩된 앱·토큰은 없습니다.
- **설정 변경은 바로 반영되지 않습니다.** 서버가 토큰을 60초 캐시합니다. 새로 등록한 토큰은 약 3초, 이미 쓰던 토큰의 변경(모델 교체·중지·재발급)은 최대 60초 걸립니다.
- **비용은 OpenRouter가 응답에 실어주는 실제 청구액(`usage.cost`)으로 기록합니다.** 웹검색처럼 토큰 외 요금이 붙어도 그대로 잡힙니다. 최종 금액은 OpenRouter 대시보드가 기준입니다.
- **평문 HTTP는 막습니다.** API·관리자 경로는 403, 그 외는 https로 301 리다이렉트합니다.

---

## 라이선스

개인 프로젝트입니다.
