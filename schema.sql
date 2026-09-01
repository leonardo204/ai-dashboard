-- AI 프록시 — 앱 레지스트리 · 호출 로그 (Cloudflare D1)
-- 적용: wrangler d1 execute hamzzi-stats --remote --file=schema.sql
-- (worker 코드도 기동 시 CREATE/ALTER로 보강하지만, 이 파일로 한 번 적용해 두면 확실함)

-- 앱 레지스트리 — 토큰 1개 = 앱 1개. 관리 화면(/admin/apps)에서 추가·수정한다.
CREATE TABLE IF NOT EXISTS apps (
  id         TEXT PRIMARY KEY,            -- 앱 식별자 (예: hamzzi-diet)
  name       TEXT NOT NULL,               -- 표시 이름
  token      TEXT NOT NULL UNIQUE,        -- 앱 전용 프록시 토큰(Bearer)
  models     TEXT NOT NULL DEFAULT '{}',  -- JSON: {"weight":"openai/...","default":"google/..."}
  per_min    INTEGER NOT NULL DEFAULT 20, -- IP 기준 분당 상한
  per_day    INTEGER NOT NULL DEFAULT 300,-- IP 기준 일일 상한
  active     INTEGER NOT NULL DEFAULT 1,  -- 0이면 호출 거부
  note       TEXT,                        -- 메모
  created_at INTEGER NOT NULL
);

-- 호출 로그 — 통계 대시보드와 rate limit을 함께 처리한다.
CREATE TABLE IF NOT EXISTS calls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,        -- 호출 시각 (epoch ms)
  kind       TEXT    NOT NULL,        -- 용도 (weight | food | default | ...)
  status     TEXT    NOT NULL,        -- ok | error
  http       INTEGER,                 -- 상류 응답 HTTP 코드
  latency_ms INTEGER,                 -- 프록시가 잰 왕복 지연
  ip         TEXT,                    -- 클라이언트 IP (rate limit용)
  in_tokens  INTEGER DEFAULT 0,
  out_tokens INTEGER DEFAULT 0,
  err        TEXT,                    -- 실패 사유(요약)
  app        TEXT,                    -- 호출한 앱 id
  model      TEXT,                    -- 실제 호출한 모델
  meta       TEXT                     -- 앱이 보낸 메타 JSON(그대로 보관, 나중에 해석)
);

CREATE INDEX IF NOT EXISTS idx_calls_ts     ON calls(ts);
CREATE INDEX IF NOT EXISTS idx_calls_ip_ts  ON calls(ip, ts);
CREATE INDEX IF NOT EXISTS idx_calls_app_ts ON calls(app, ts);

-- 지리 정보 (Cloudflare request.cf — 외부 조회 없음)
ALTER TABLE calls ADD COLUMN country TEXT;   -- ISO 3166-1 alpha-2 (예: KR)
ALTER TABLE calls ADD COLUMN region  TEXT;   -- 광역 지역 (예: Seoul)
ALTER TABLE calls ADD COLUMN city    TEXT;   -- 도시
CREATE INDEX IF NOT EXISTS idx_calls_country_ts ON calls(country, ts);

-- 지도 표시용 좌표 (도시 단위 근사 · 소수 1자리로 반올림해 저장)
ALTER TABLE calls ADD COLUMN lat REAL;
ALTER TABLE calls ADD COLUMN lon REAL;

-- 실제 청구액 (OpenRouter usage.cost) — 웹검색 등 토큰 외 요금까지 포함된 값.
-- 단가표 추정 대신 이 값을 우선 쓰고, 값이 없는 과거 행만 단가표로 보완한다.
ALTER TABLE calls ADD COLUMN cost REAL;
