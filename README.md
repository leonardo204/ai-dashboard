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
| `GET /admin` | 요약 대시보드 (세션 로그인) |
| `GET /admin/usage` | 앱·모델·용도별 사용량 |
| `GET /admin/trend` | 기간별 추이 · 요일×시각 히트맵 |
| `GET /admin/geo` | 국가·도시별 호출 분포 |
| `GET /admin/logs` | 호출 로그 검색 (`/admin/logs.csv` 로 내려받기) |
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
  stats.ts      앱 레지스트리 · 화면별 집계 쿼리 · 로그 검색
  ui.ts         관리 화면 공통 틀 · 스타일 · 차트(SVG)
  views.ts      화면 6개 본문 (요약 · 사용량 · 추이 · 지역 · 로그 · 앱 관리)
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

배포 뒤 호출이 정상인지 확인합니다.

```bash
curl -sS https://ai.zerolive.co.kr/v1/ai \
  -H "Authorization: Bearer <앱 토큰>" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"1+1은? 숫자만."}],
       "response_format":{"type":"text"},"max_tokens":800}'
```

---

## 관리 화면

화면 6개로 나뉩니다. 상단 메뉴에서 옮겨 다닙니다.

**기간·앱 조건은 화면마다 따로 놉니다.** 상단 메뉴로 다른 화면에 가면 기본값(최근 30일 · 전체 앱)에서 다시 시작하고, 돌아와도 앞서 걸어둔 조건은 남지 않습니다. 한 화면에서 고른 값이 나머지 다섯 화면까지 바꿔 버리는 일을 막기 위해서입니다.

다만 화면 안에서 눌러 파고드는 링크는 다릅니다. 요약의 `자세히 →`, 도넛 조각, 표 오른쪽의 `로그 →` 는 보고 있던 기간·앱을 그대로 들고 넘어갑니다.

| 화면 | 무엇을 보나 |
| --- | --- |
| 요약 | 호출 수·비용·지연 카드, 추이 차트, 앱·모델 비중 도넛. 긴 표를 두지 않습니다. |
| 사용량 | 앱별·모델별·용도별 표. 모델이 많아 표 위 검색칸으로 걸러 봅니다. |
| 추이 | 기간별 흐름과 요일×시각 히트맵. 언제 몰리는지 봅니다. |
| 지역 | 세계 지도, 국가별·도시별 표. |
| 로그 | 호출 1건씩 검색합니다. 줄을 누르면 상세가 펼쳐집니다. |
| 앱 관리 | 앱 1개가 카드 1장. 토큰 발급·모델 맵·상한을 다룹니다. |

- **화면마다 자기 집계만 돕니다.** 예전에는 대시보드 한 장이 집계 12개를 한꺼번에 돌려서, 보지도 않는 표 때문에 화면이 느렸습니다.
- **요약 카드의 ▲▼는 직전 같은 기간과 비교한 값입니다.** 기간을 "전체"로 두면 비교 대상이 없어 표시되지 않습니다.
- **도넛 조각과 표의 "로그 →"를 누르면** 그 조건이 걸린 로그 화면으로 바로 넘어갑니다.
- **자동 갱신은 로그 화면에서만 꺼져 있습니다.** 보던 목록이 몇 초마다 다시 그려지면 읽기 어려워서입니다.
- **앱 관리는 평소에 요약만 보여줍니다.** 편집 폼, 새 앱 추가 폼, 호출 방법 안내는 눌렀을 때만 펼쳐집니다. 토큰도 가운데를 가려 두고 `보기`를 눌러야 전체가 나옵니다.

### 로그 검색

날짜(KST) · 앱 · 모델 · 용도 · 상태 · HTTP 코드 · 국가 · IP · 최소 지연 · 찾을 말(오류·메타·모델)로 거릅니다. 자주 쓰는 조건은 버튼으로 있습니다 — 실패만, 3초 이상, 10초 이상, 오늘.

- 100건씩 보여주고 `id` 커서로 다음 쪽을 읽습니다. `OFFSET`은 뒤로 갈수록 느려져서 쓰지 않습니다.
- `GET /admin/logs.csv` 로 같은 조건의 최근 5000건을 내려받습니다.

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
