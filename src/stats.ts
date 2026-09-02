/**
 * AI 프록시 — 앱 레지스트리 · 호출 통계 · rate limit (Cloudflare D1).
 *
 *  - apps  : 앱 1개 = 토큰 1개. 어떤 용도에 어떤 모델을 쓸지, 상한은 얼마인지 담는다.
 *  - calls : 호출 1건씩 기록. app·model·meta까지 남겨 앱별/모델별 집계와 메타 해석에 쓴다.
 *
 * 비용은 "용도"가 아니라 "실제 호출한 모델" 기준으로 계산한다.
 * 그래야 모델을 갈아끼워도 과거 비용이 틀어지지 않는다.
 */


export interface StatsEnv {
	DB: D1Database;
}

// ─────────────────────────────────────────────────────────────
// 모델 단가 (USD / 100만 토큰, OpenRouter 기준)
// 모델을 추가하면 여기에 단가만 넣으면 프록시·대시보드가 함께 맞춰진다.
// ─────────────────────────────────────────────────────────────
export const MODEL_PRICES: Record<string, { inPerM: number; outPerM: number }> = {
	"openai/gpt-5.6-luna": { inPerM: 0.2, outPerM: 1.2 },
	"openai/gpt-5.6-luna-pro": { inPerM: 1.0, outPerM: 6.0 },
	"google/gemini-3.6-flash": { inPerM: 0.75, outPerM: 3.75 },
	"google/gemini-3.7-flash": { inPerM: 0.75, outPerM: 3.75 },
	"google/gemini-3.1-flash-lite": { inPerM: 0.25, outPerM: 1.5 },
	"google/gemini-2.5-flash": { inPerM: 0.3, outPerM: 2.5 },
	"google/gemini-2.5-flash-lite": { inPerM: 0.1, outPerM: 0.4 },
	"google/gemini-2.5-pro": { inPerM: 1.25, outPerM: 10.0 },
	"google/gemini-embedding-001": { inPerM: 0.15, outPerM: 0 },
};
/** 단가 미등록 모델의 추정 단가(대시보드에 별표로 표시). */
export const PRICE_FALLBACK = { inPerM: 0.75, outPerM: 3.75 };
export const DEFAULT_MODEL = "google/gemini-3.6-flash";

export function priceOf(model: string | null | undefined) {
	return (model && MODEL_PRICES[model]) || PRICE_FALLBACK;
}
/** 실제 청구액(있으면) + 아직 cost가 없는 과거 행은 단가표로 추정해 더한다. */
export function mergeCost(realCost: number, model: string | null | undefined, eIn: number, eOut: number): number {
	return (realCost || 0) + (eIn || eOut ? costOf(model, eIn, eOut) : 0);
}

export function costOf(model: string | null | undefined, inTok: number, outTok: number): number {
	const p = priceOf(model);
	return (inTok / 1_000_000) * p.inPerM + (outTok / 1_000_000) * p.outPerM;
}

// ─────────────────────────────────────────────────────────────
// 스키마
// ─────────────────────────────────────────────────────────────
// 스키마는 schema.sql로 이미 적용돼 있다. 정상 경로에선 DDL을 한 줄도 돌리지 않는다
// (요청마다 CREATE/ALTER 12개를 날리면 D1 왕복만으로 수 초가 든다).
// "no such table/column" 오류가 났을 때만 withSchema가 1회 복구한다.
let schemaReady = true;

/** 스키마 복구가 필요할 때만 호출된다(정상 운영 중엔 실행되지 않음). */
export async function ensureSchema(env: StatsEnv): Promise<void> {
	if (schemaReady) return;
	await env.DB.prepare(
		"CREATE TABLE IF NOT EXISTS apps (id TEXT PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL UNIQUE, models TEXT NOT NULL DEFAULT '{}', per_min INTEGER NOT NULL DEFAULT 20, per_day INTEGER NOT NULL DEFAULT 300, active INTEGER NOT NULL DEFAULT 1, note TEXT, created_at INTEGER NOT NULL)",
	).run();
	await env.DB.prepare(
		"CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, http INTEGER, latency_ms INTEGER, ip TEXT, in_tokens INTEGER DEFAULT 0, out_tokens INTEGER DEFAULT 0, err TEXT)",
	).run();
	// 기존 테이블 확장(이미 있으면 조용히 실패 → 무시). D1엔 ADD COLUMN IF NOT EXISTS가 없다.
	for (const sql of [
		"ALTER TABLE calls ADD COLUMN app TEXT",
		"ALTER TABLE calls ADD COLUMN model TEXT",
		"ALTER TABLE calls ADD COLUMN meta TEXT",
		// 지리 정보 — Cloudflare가 요청마다 붙여주는 값(외부 조회 없음). 국가는 ISO 2자리.
		"ALTER TABLE calls ADD COLUMN country TEXT",
		"ALTER TABLE calls ADD COLUMN region TEXT",
		"ALTER TABLE calls ADD COLUMN city TEXT",
		// 지도 표시용 좌표(도시 단위 근사, 소수 1자리로 반올림해 저장).
		"ALTER TABLE calls ADD COLUMN lat REAL",
		// OpenRouter가 응답에 실어주는 실제 청구액(USD). 웹검색 등 토큰 외 요금까지 포함된다.
		"ALTER TABLE calls ADD COLUMN cost REAL",
		"ALTER TABLE calls ADD COLUMN lon REAL",
	]) {
		try {
			await env.DB.prepare(sql).run();
		} catch {
			/* 이미 존재 */
		}
	}
	for (const sql of [
		"CREATE INDEX IF NOT EXISTS idx_calls_ts ON calls(ts)",
		"CREATE INDEX IF NOT EXISTS idx_calls_ip_ts ON calls(ip, ts)",
		"CREATE INDEX IF NOT EXISTS idx_calls_app_ts ON calls(app, ts)",
		"CREATE INDEX IF NOT EXISTS idx_calls_country_ts ON calls(country, ts)",
	]) {
		try {
			await env.DB.prepare(sql).run();
		} catch {
			/* 무시 */
		}
	}
	schemaReady = true;
}

/**
 * 스키마 오류(테이블·컬럼 없음)일 때만 마이그레이션을 1회 돌리고 재시도한다.
 * 정상 경로에선 추가 왕복이 0회라 대시보드·API 응답이 빨라진다.
 */
export async function withSchema<T>(env: StatsEnv, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (!/no such table|no such column/i.test(String(e))) throw e;
		schemaReady = false;
		await ensureSchema(env);
		return await fn();
	}
}

// ─────────────────────────────────────────────────────────────
// 앱 레지스트리
// ─────────────────────────────────────────────────────────────
export interface AppConfig {
	id: string;
	name: string;
	token: string;
	models: Record<string, string>;
	perMin: number;
	perDay: number;
	active: boolean;
	note: string | null;
	createdAt: number;
}

interface AppRow {
	id: string; name: string; token: string; models: string;
	per_min: number; per_day: number; active: number; note: string | null; created_at: number;
}

function toApp(r: AppRow): AppConfig {
	let models: Record<string, string> = {};
	try {
		const parsed = JSON.parse(r.models || "{}");
		if (parsed && typeof parsed === "object") models = parsed as Record<string, string>;
	} catch {
		/* 잘못된 JSON은 빈 맵으로 */
	}
	return {
		id: r.id, name: r.name, token: r.token, models,
		perMin: r.per_min, perDay: r.per_day, active: r.active === 1,
		note: r.note, createdAt: r.created_at,
	};
}

/** 토큰 → 앱 조회. isolate 안에서 짧게 캐시해 매 호출 DB 조회를 줄인다. */
const tokenCache = new Map<string, { app: AppConfig | null; at: number }>();
const TOKEN_TTL = 60_000;
// 못 찾은 토큰은 아주 짧게만 기억한다 — 방금 추가한 앱이 곧바로 호출되게 하려고.
const TOKEN_TTL_MISS = 3_000;

export async function findAppByToken(env: StatsEnv, token: string): Promise<AppConfig | null> {
	if (!token) return null;
	const hit = tokenCache.get(token);
	const now = Date.now();
	if (hit && now - hit.at < (hit.app ? TOKEN_TTL : TOKEN_TTL_MISS)) return hit.app;
	const row = await withSchema(env, () =>
		env.DB.prepare("SELECT * FROM apps WHERE token = ?1").bind(token).first<AppRow>());
	const app = row ? toApp(row) : null;
	tokenCache.set(token, { app, at: now });
	return app;
}
export function clearAppCache(): void {
	tokenCache.clear();
}

export async function listApps(env: StatsEnv): Promise<AppConfig[]> {
	const rs = await withSchema(env, () =>
		env.DB.prepare("SELECT * FROM apps ORDER BY created_at ASC").all<AppRow>());
	return (rs.results ?? []).map(toApp);
}

export async function getApp(env: StatsEnv, id: string): Promise<AppConfig | null> {
	await ensureSchema(env);
	const row = await env.DB.prepare("SELECT * FROM apps WHERE id = ?1").bind(id).first<AppRow>();
	return row ? toApp(row) : null;
}

export function newToken(): string {
	const b = new Uint8Array(24);
	crypto.getRandomValues(b);
	return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function upsertApp(
	env: StatsEnv,
	a: { id: string; name: string; token: string; models: string; perMin: number; perDay: number; active: boolean; note: string | null },
): Promise<void> {
	await ensureSchema(env);
	await env.DB.prepare(
		"INSERT INTO apps (id,name,token,models,per_min,per_day,active,note,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)" +
			" ON CONFLICT(id) DO UPDATE SET name=?2, token=?3, models=?4, per_min=?5, per_day=?6, active=?7, note=?8",
	)
		.bind(a.id, a.name, a.token, a.models, a.perMin, a.perDay, a.active ? 1 : 0, a.note, Date.now())
		.run();
	clearAppCache();
}

export async function deleteApp(env: StatsEnv, id: string): Promise<void> {
	await ensureSchema(env);
	await env.DB.prepare("DELETE FROM apps WHERE id = ?1").bind(id).run();
	clearAppCache();
}

// ─────────────────────────────────────────────────────────────
// rate limit · 로깅
// ─────────────────────────────────────────────────────────────

/** 앱별 상한 기준으로 (앱, IP) 분당·일일 초과 여부. 초과면 true(차단). */
export async function rateLimited(env: StatsEnv, appId: string, ip: string, now: number, perMin: number, perDay: number): Promise<boolean> {
	try {
		await ensureSchema(env);
		const row = await env.DB.prepare(
			"SELECT SUM(CASE WHEN ts > ?1 THEN 1 ELSE 0 END) AS m, COUNT(*) AS d FROM calls WHERE app = ?2 AND ip = ?3 AND ts > ?4",
		)
			.bind(now - 60_000, appId, ip, now - 86_400_000)
			.first<{ m: number | null; d: number | null }>();
		return (row?.m ?? 0) >= perMin || (row?.d ?? 0) >= perDay;
	} catch {
		// 저장소 장애 시엔 서비스는 살리고(차단 안 함) 로깅만 건너뛴다.
		return false;
	}
}

export interface CallLog {
	ts: number;
	app: string;
	kind: string;
	model: string | null;
	status: "ok" | "error";
	http: number | null;
	latency_ms: number;
	ip: string;
	in_tokens: number;
	out_tokens: number;
	cost: number | null;   // OpenRouter usage.cost (없으면 단가표로 추정)
	err: string | null;
	meta: string | null;
	country: string | null;   // ISO 3166-1 alpha-2 (예: KR)
	region: string | null;    // 광역 지역 (예: Seoul)
	city: string | null;      // 도시
	lat: number | null;       // 위도(소수 1자리)
	lon: number | null;       // 경도(소수 1자리)
}

/** 호출 1건 기록. 실패해도 요청 흐름은 막지 않는다. */
export async function logCall(env: StatsEnv, c: CallLog): Promise<void> {
	try {
		await withSchema(env, () => env.DB.prepare(
			"INSERT INTO calls (ts, kind, status, http, latency_ms, ip, in_tokens, out_tokens, err, app, model, meta, country, region, city, lat, lon, cost)" +
				" VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
		)
			.bind(c.ts, c.kind, c.status, c.http, c.latency_ms, c.ip, c.in_tokens, c.out_tokens, c.err, c.app, c.model, c.meta,
				c.country, c.region, c.city, c.lat, c.lon, c.cost)
			.run());
	} catch {
		/* 통계 실패는 무시 */
	}
}

/** 180일 지난 로그 정리(가끔만 실행해 비용 최소화). */
export async function maybeCleanup(env: StatsEnv, now: number): Promise<void> {
	try {
		await ensureSchema(env);
		await env.DB.prepare("DELETE FROM calls WHERE ts < ?1").bind(now - 180 * 86_400_000).run();
	} catch {
		/* 무시 */
	}
}

/**
 * 대시보드 자동 갱신용 신호 — 최신 호출의 id·시각만 본다.
 * 집계 쿼리(11개)를 매번 돌리면 부담이 크니, 화면은 이 값이 바뀔 때만 다시 그린다.
 * MAX(id)·MAX(ts)는 인덱스로 바로 잡혀서 행 수와 무관하게 가볍다.
 */
export async function pulse(env: StatsEnv, appFilter: string): Promise<{ mx: number; ts: number }> {
	const row = await withSchema(env, () => {
		const st = appFilter
			? env.DB.prepare("SELECT MAX(id) AS mx, MAX(ts) AS ts FROM calls WHERE app = ?1").bind(appFilter)
			: env.DB.prepare("SELECT MAX(id) AS mx, MAX(ts) AS ts FROM calls");
		return st.first<{ mx: number | null; ts: number | null }>();
	});
	return { mx: row?.mx ?? 0, ts: row?.ts ?? 0 };
}

// ─────────────────────────────────────────────────────────────
// 집계
// ─────────────────────────────────────────────────────────────
export const PERIODS: Record<string, { label: string; days: number; bucket: "day" | "week" | "month" }> = {
	week: { label: "주", days: 7, bucket: "day" },
	month: { label: "월", days: 30, bucket: "day" },
	quarter: { label: "분기", days: 90, bucket: "week" },
	half: { label: "반기", days: 182, bucket: "week" },
	year: { label: "년", days: 365, bucket: "month" },
	all: { label: "전체", days: 0, bucket: "month" },
};

/** KST(+9h) 기준 버킷 표현식. */
function bucketExpr(b: "day" | "week" | "month"): string {
	const base = "ts/1000, 'unixepoch', '+9 hours'";
	if (b === "day") return `strftime('%Y-%m-%d', ${base})`;
	if (b === "week") return `strftime('%Y-W%W', ${base})`;
	return `strftime('%Y-%m', ${base})`;
}

/** ISO 국가 코드 → 한국어 이름. 목록에 없으면 코드를 그대로 쓴다. */
const COUNTRY_KO: Record<string, string> = {
	KR: "대한민국", JP: "일본", CN: "중국", TW: "대만", HK: "홍콩", SG: "싱가포르",
	US: "미국", CA: "캐나다", MX: "멕시코", BR: "브라질",
	GB: "영국", DE: "독일", FR: "프랑스", NL: "네덜란드", ES: "스페인", IT: "이탈리아",
	SE: "스웨덴", NO: "노르웨이", FI: "핀란드", PL: "폴란드", IE: "아일랜드",
	AU: "호주", NZ: "뉴질랜드", IN: "인도", ID: "인도네시아", TH: "태국", VN: "베트남",
	PH: "필리핀", MY: "말레이시아", RU: "러시아", TR: "튀르키예", AE: "아랍에미리트",
	SA: "사우디아라비아", ZA: "남아프리카공화국",
};
export function countryName(code: string): string {
	if (!code || code === "(미상)") return "(미상)";
	return COUNTRY_KO[code] ? `${COUNTRY_KO[code]} (${code})` : code;
}

export interface GroupRow {
	key: string;
	total: number; ok: number; error: number;
	inTok: number; outTok: number; cost: number;
	latency: number; // 합계 지연(ms) — 평균 계산용
}
export interface StatsSummary {
	period: string;
	appFilter: string;
	since: number;
	total: number; ok: number; error: number;
	inTokens: number; outTokens: number; cost: number;
	avgLatency: number; p95Latency: number; uniqueIPs: number;
	apps: { id: string; name: string; active: boolean }[];
	byApp: (GroupRow & { name: string })[];
	byModel: GroupRow[];
	byKind: GroupRow[];
	buckets: { b: string; total: number; ok: number; error: number; tokens: number; cost: number }[];
	errors: { http: number | null; count: number; sample: string | null }[];
	metaKeys: { key: string; values: { v: string; c: number }[]; total: number }[];
	byCountry: (GroupRow & { ips: number })[];
	points: { country: string; city: string; lat: number; lon: number; total: number; ips: number; cost: number }[];
	geoUnknown: number;   // 좌표가 없어 지도에 못 찍는 호출 수
	byRegion: { country: string; region: string; city: string; total: number; ok: number; error: number; tokens: number; cost: number; ips: number }[];
	recent: {
		ts: number; app: string; kind: string; model: string | null; status: string;
		http: number | null; latency_ms: number; tokens: number; cost: number;
		err: string | null; meta: string | null; country: string; region: string; city: string;
	}[];
}

function emptyRow(key: string): GroupRow {
	return { key, total: 0, ok: 0, error: 0, inTok: 0, outTok: 0, cost: 0, latency: 0 };
}
function addTo(map: Map<string, GroupRow>, key: string, r: { total: number; ok: number; error: number; inTok: number; outTok: number; cost: number; latency: number }) {
	const cur = map.get(key) ?? emptyRow(key);
	cur.total += r.total; cur.ok += r.ok; cur.error += r.error;
	cur.inTok += r.inTok; cur.outTok += r.outTok; cur.cost += r.cost; cur.latency += r.latency;
	map.set(key, cur);
}
const desc = (a: GroupRow, b: GroupRow) => b.total - a.total;

export async function collectStats(env: StatsEnv, period: string, appFilter: string): Promise<StatsSummary> {
	return withSchema(env, () => collectStatsInner(env, period, appFilter));
}

async function collectStatsInner(env: StatsEnv, period: string, appFilter: string): Promise<StatsSummary> {
	const p = PERIODS[period] ?? PERIODS.month;
	const since = p.days ? Date.now() - p.days * 86_400_000 : 0;
	const appWhere = appFilter ? " AND app = ?2" : "";
	const bind = (sql: string) => {
		const st = env.DB.prepare(sql);
		return appFilter ? st.bind(since, appFilter) : st.bind(since);
	};
	const bexpr = bucketExpr(p.bucket);

	// 서로 독립적인 집계라 한 번에 보낸다. 순차로 돌리면 D1 왕복 지연이 그대로 쌓여
	// 화면 한 장에 수 초가 걸린다(행 수와 무관한 왕복 비용).
	const [appsRs, grouped, bucketRows, errRows, ipRow, cRows, cIpRows, rRows, okCnt, metaRows, recentRows] =
		await Promise.all([
			env.DB.prepare("SELECT * FROM apps ORDER BY created_at ASC").all<AppRow>(),

			bind(
				"SELECT COALESCE(app,'(미상)') AS app, kind, model, COUNT(*) AS total," +
					" SUM(status='ok') AS ok, SUM(status='error') AS error," +
					" COALESCE(SUM(in_tokens),0) AS inTok, COALESCE(SUM(out_tokens),0) AS outTok, COALESCE(SUM(cost),0) AS realCost, COALESCE(SUM(CASE WHEN cost IS NULL THEN in_tokens ELSE 0 END),0) AS eIn, COALESCE(SUM(CASE WHEN cost IS NULL THEN out_tokens ELSE 0 END),0) AS eOut," +
					" COALESCE(SUM(latency_ms),0) AS lat" +
					` FROM calls WHERE ts >= ?1${appWhere} GROUP BY app, kind, model`,
			).all<{ app: string; kind: string; model: string | null; total: number; ok: number | null; error: number | null; inTok: number; outTok: number; realCost: number; eIn: number; eOut: number; lat: number }>(),

			bind(
				`SELECT ${bexpr} AS b, model, COUNT(*) AS total, SUM(status='ok') AS ok, SUM(status='error') AS error,` +
					" COALESCE(SUM(in_tokens),0) AS inTok, COALESCE(SUM(out_tokens),0) AS outTok, COALESCE(SUM(cost),0) AS realCost, COALESCE(SUM(CASE WHEN cost IS NULL THEN in_tokens ELSE 0 END),0) AS eIn, COALESCE(SUM(CASE WHEN cost IS NULL THEN out_tokens ELSE 0 END),0) AS eOut" +
					` FROM calls WHERE ts >= ?1${appWhere} GROUP BY b, model ORDER BY b DESC`,
			).all<{ b: string; model: string | null; total: number; ok: number | null; error: number | null; inTok: number; outTok: number; realCost: number; eIn: number; eOut: number }>(),

			bind(
				`SELECT http, COUNT(*) AS c, MAX(err) AS sample FROM calls WHERE ts >= ?1${appWhere} AND status='error' GROUP BY http ORDER BY c DESC LIMIT 8`,
			).all<{ http: number | null; c: number; sample: string | null }>(),

			bind(`SELECT COUNT(DISTINCT ip) AS n FROM calls WHERE ts >= ?1${appWhere}`).first<{ n: number }>(),

			// 국가별 — 모델 단가로 비용까지 정확히 내려고 (국가, 모델)로 뽑아 JS에서 합산한다.
			bind(
				"SELECT COALESCE(NULLIF(country,''),'(미상)') AS c, model, COUNT(*) AS total," +
					" SUM(status='ok') AS ok, SUM(status='error') AS error," +
					" COALESCE(SUM(in_tokens),0) AS inTok, COALESCE(SUM(out_tokens),0) AS outTok, COALESCE(SUM(cost),0) AS realCost, COALESCE(SUM(CASE WHEN cost IS NULL THEN in_tokens ELSE 0 END),0) AS eIn, COALESCE(SUM(CASE WHEN cost IS NULL THEN out_tokens ELSE 0 END),0) AS eOut," +
					" COALESCE(SUM(latency_ms),0) AS lat" +
					` FROM calls WHERE ts >= ?1${appWhere} GROUP BY c, model`,
			).all<{ c: string; model: string | null; total: number; ok: number | null; error: number | null; inTok: number; outTok: number; realCost: number; eIn: number; eOut: number; lat: number }>(),

			bind(
				`SELECT COALESCE(NULLIF(country,''),'(미상)') AS c, COUNT(DISTINCT ip) AS n FROM calls WHERE ts >= ?1${appWhere} GROUP BY c`,
			).all<{ c: string; n: number }>(),

			bind(
				"SELECT COALESCE(NULLIF(country,''),'(미상)') AS c, COALESCE(NULLIF(region,''),'-') AS rg," +
					" COALESCE(NULLIF(city,''),'-') AS ct, model, COUNT(*) AS total," +
					" SUM(status='ok') AS ok, SUM(status='error') AS error," +
					" COALESCE(SUM(in_tokens),0) AS inTok, COALESCE(SUM(out_tokens),0) AS outTok, COALESCE(SUM(cost),0) AS realCost, COALESCE(SUM(CASE WHEN cost IS NULL THEN in_tokens ELSE 0 END),0) AS eIn, COALESCE(SUM(CASE WHEN cost IS NULL THEN out_tokens ELSE 0 END),0) AS eOut," +
					" COUNT(DISTINCT ip) AS ips," +
					" AVG(lat) AS la, AVG(lon) AS lo, SUM(lat IS NOT NULL) AS geoN" +
					` FROM calls WHERE ts >= ?1${appWhere} GROUP BY c, rg, ct, model`,
			).all<{ c: string; rg: string; ct: string; model: string | null; total: number; ok: number | null; error: number | null; inTok: number; outTok: number; realCost: number; eIn: number; eOut: number; ips: number; la: number | null; lo: number | null; geoN: number }>(),

			bind(`SELECT COUNT(*) AS n FROM calls WHERE ts >= ?1${appWhere} AND status='ok'`).first<{ n: number }>(),

			// 메타 요약 — 최근 300건에서 키·값 분포를 뽑는다(스키마 변경 없이 어떤 키든 해석).
			bind(
				`SELECT meta FROM calls WHERE ts >= ?1${appWhere} AND meta IS NOT NULL AND meta <> '' ORDER BY ts DESC LIMIT 300`,
			).all<{ meta: string }>(),

			bind(
				"SELECT ts, COALESCE(app,'(미상)') AS app, kind, model, status, http, latency_ms," +
					" in_tokens AS inTok, out_tokens AS outTok, cost AS realCost, err, meta, country, region, city" +
					` FROM calls WHERE ts >= ?1${appWhere} ORDER BY ts DESC LIMIT 50`,
			).all<{ ts: number; app: string; kind: string; model: string | null; status: string; http: number | null; latency_ms: number; inTok: number; outTok: number; realCost: number | null; err: string | null; meta: string | null; country: string | null; region: string | null; city: string | null }>(),
		]);

	const apps = (appsRs.results ?? []).map(toApp);
	const nameOf = new Map(apps.map((a) => [a.id, a.name]));

	// 앱·모델·용도별 합산
	const byApp = new Map<string, GroupRow>();
	const byModel = new Map<string, GroupRow>();
	const byKind = new Map<string, GroupRow>();
	let total = 0, ok = 0, error = 0, inTokens = 0, outTokens = 0, cost = 0, latSum = 0;

	for (const r of grouped.results ?? []) {
		const c = mergeCost(r.realCost, r.model, r.eIn, r.eOut);
		const unit = { total: r.total, ok: r.ok ?? 0, error: r.error ?? 0, inTok: r.inTok, outTok: r.outTok, cost: c, latency: r.lat };
		addTo(byApp, r.app, unit);
		addTo(byModel, r.model ?? "(미상)", unit);
		addTo(byKind, r.kind, unit);
		total += r.total; ok += r.ok ?? 0; error += r.error ?? 0;
		inTokens += r.inTok; outTokens += r.outTok; cost += c; latSum += r.lat;
	}

	// 추이 버킷
	const bmap = new Map<string, { b: string; total: number; ok: number; error: number; tokens: number; cost: number }>();
	for (const r of bucketRows.results ?? []) {
		const cur = bmap.get(r.b) ?? { b: r.b, total: 0, ok: 0, error: 0, tokens: 0, cost: 0 };
		cur.total += r.total; cur.ok += r.ok ?? 0; cur.error += r.error ?? 0;
		cur.tokens += r.inTok + r.outTok; cur.cost += mergeCost(r.realCost, r.model, r.eIn, r.eOut);
		bmap.set(r.b, cur);
	}
	const buckets = Array.from(bmap.values()).sort((a, b) => (a.b < b.b ? 1 : -1)).slice(0, 30);

	// p95 지연 — 성공 호출 기준. 개수를 안 뒤 OFFSET으로 한 건만 읽는다(위 개수 조회와 이어지는 유일한 순차 쿼리).
	let p95 = 0;
	if ((okCnt?.n ?? 0) > 0) {
		const off = Math.max(0, Math.floor(((okCnt?.n ?? 1) - 1) * 0.95));
		const st = env.DB.prepare(
			`SELECT latency_ms AS v FROM calls WHERE ts >= ?1${appWhere} AND status='ok' ORDER BY latency_ms LIMIT 1 OFFSET ${off}`,
		);
		const row = await (appFilter ? st.bind(since, appFilter) : st.bind(since)).first<{ v: number }>();
		p95 = row?.v ?? 0;
	}

	// 국가별
	const cIp = new Map((cIpRows.results ?? []).map((r) => [r.c, r.n]));
	const byCountryMap = new Map<string, GroupRow>();
	for (const r of cRows.results ?? []) {
		addTo(byCountryMap, r.c, {
			total: r.total, ok: r.ok ?? 0, error: r.error ?? 0,
			inTok: r.inTok, outTok: r.outTok, cost: mergeCost(r.realCost, r.model, r.eIn, r.eOut), latency: r.lat,
		});
	}
	const byCountry = Array.from(byCountryMap.values()).sort(desc)
		.map((r) => ({ ...r, ips: cIp.get(r.key) ?? 0 }));

	// 지역·도시별 — 상위 20곳
	type RegionAcc = {
		country: string; region: string; city: string;
		total: number; ok: number; error: number; tokens: number; cost: number; ips: number;
		latSum: number; lonSum: number; geoN: number;
	};
	const regionMap = new Map<string, RegionAcc>();
	for (const r of rRows.results ?? []) {
		const k = `${r.c}|${r.rg}|${r.ct}`;
		const cur = regionMap.get(k) ?? {
			country: r.c, region: r.rg, city: r.ct,
			total: 0, ok: 0, error: 0, tokens: 0, cost: 0, ips: 0, latSum: 0, lonSum: 0, geoN: 0,
		};
		cur.total += r.total; cur.ok += r.ok ?? 0; cur.error += r.error ?? 0;
		cur.tokens += r.inTok + r.outTok; cur.cost += mergeCost(r.realCost, r.model, r.eIn, r.eOut);
		cur.ips = Math.max(cur.ips, r.ips);   // 모델별로 쪼개져 중복 계산되므로 최댓값을 쓴다(근사)
		// 좌표는 모델별로 쪼개진 평균이라 건수로 가중해 다시 합친다.
		if (r.la != null && r.lo != null && r.geoN > 0) {
			cur.latSum += r.la * r.geoN; cur.lonSum += r.lo * r.geoN; cur.geoN += r.geoN;
		}
		regionMap.set(k, cur);
	}
	const regionAll = Array.from(regionMap.values());
	const coordOf = (r: RegionAcc) =>
		r.geoN > 0 ? { lat: r.latSum / r.geoN, lon: r.lonSum / r.geoN } : { lat: null, lon: null };

	const geoUnknown = regionAll.reduce((n, r) => n + (r.geoN > 0 ? 0 : r.total), 0);

	// 지도용 좌표 점 — 도시 단위. 많아도 상위 200곳이면 화면엔 충분하다.
	const points = regionAll
		.filter((r) => r.geoN > 0)
		.sort((a, b) => b.total - a.total)
		.slice(0, 200)
		.map((r) => {
			const c = coordOf(r);
			return {
				country: r.country, city: r.city === "-" ? r.region : r.city,
				lat: c.lat as number, lon: c.lon as number,
				total: r.total, ips: r.ips, cost: r.cost,
			};
		});
	const byRegion = regionAll.sort((a, b) => b.total - a.total).slice(0, 20)
		.map((r) => ({
			country: r.country, region: r.region, city: r.city,
			total: r.total, ok: r.ok, error: r.error, tokens: r.tokens, cost: r.cost, ips: r.ips,
		}));

	// 메타 키·값 분포
	const metaAgg = new Map<string, Map<string, number>>();
	for (const r of metaRows.results ?? []) {
		let obj: unknown;
		try { obj = JSON.parse(r.meta); } catch { continue; }
		if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			const val = typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40);
			const m = metaAgg.get(k) ?? new Map<string, number>();
			m.set(val, (m.get(val) ?? 0) + 1);
			metaAgg.set(k, m);
		}
	}
	const metaKeys = Array.from(metaAgg.entries())
		.map(([key, m]) => {
			const values = Array.from(m.entries()).map(([v, c]) => ({ v, c })).sort((a, b) => b.c - a.c);
			return { key, values: values.slice(0, 6), total: values.reduce((s, x) => s + x.c, 0) };
		})
		.sort((a, b) => b.total - a.total)
		.slice(0, 10);

	return {
		period, appFilter, since,
		total, ok, error, inTokens, outTokens, cost,
		avgLatency: total ? Math.round(latSum / total) : 0,
		p95Latency: p95,
		uniqueIPs: ipRow?.n ?? 0,
		apps: apps.map((a) => ({ id: a.id, name: a.name, active: a.active })),
		byApp: Array.from(byApp.values()).sort(desc).map((r) => ({ ...r, name: nameOf.get(r.key) ?? r.key })),
		byModel: Array.from(byModel.values()).sort(desc),
		byKind: Array.from(byKind.values()).sort(desc),
		buckets,
		errors: (errRows.results ?? []).map((r) => ({ http: r.http, count: r.c, sample: r.sample })),
		metaKeys,
		byCountry,
		byRegion,
		points,
		geoUnknown,
		recent: (recentRows.results ?? []).map((r) => ({
			ts: r.ts, app: r.app, kind: r.kind, model: r.model, status: r.status,
			http: r.http, latency_ms: r.latency_ms, tokens: r.inTok + r.outTok,
			cost: r.realCost ?? costOf(r.model, r.inTok, r.outTok), err: r.err, meta: r.meta,
			country: r.country ?? "", region: r.region ?? "", city: r.city ?? "",
		})),
	};
}

// ─────────────────────────────────────────────────────────────
// 화면별 조회
//
// 예전에는 대시보드 한 장이 집계 12개를 한꺼번에 돌렸다. 지역·메타·최근 호출까지
// 매번 계산하느라, 보지도 않는 표 때문에 화면이 느려졌다.
// 지금은 화면마다 필요한 집계만 돈다.
// ─────────────────────────────────────────────────────────────

export interface AppBrief {
	id: string;
	name: string;
	active: boolean;
}

export interface Bucket {
	b: string;
	total: number;
	ok: number;
	error: number;
	tokens: number;
	cost: number;
}

/** 기간 문자열 → 시작 시각과 직전 같은 기간의 시작 시각. */
export function periodInfo(period: string) {
	const p = PERIODS[period] ?? PERIODS.month;
	const now = Date.now();
	const since = p.days ? now - p.days * 86_400_000 : 0;
	const prevSince = p.days ? since - p.days * 86_400_000 : 0;
	return { p, since, prevSince, now };
}

export const bucketLabelOf = (b: "day" | "week" | "month") => (b === "day" ? "일" : b === "week" ? "주" : "월");

/** 화면마다 필요한 기간·앱 탭용 앱 목록. 토큰까지 읽지 않는다. */
async function appBriefs(env: StatsEnv): Promise<AppBrief[]> {
	const rs = await env.DB.prepare("SELECT id, name, active FROM apps ORDER BY created_at ASC").all<{
		id: string;
		name: string;
		active: number;
	}>();
	return (rs.results ?? []).map((r) => ({ id: r.id, name: r.name, active: !!r.active }));
}

/** 집계 SELECT 절 — 호출 수·성공·실패·토큰·비용·지연을 한 번에 뽑는다. */
const AGG =
	" COUNT(*) AS total, SUM(status='ok') AS ok, SUM(status='error') AS error," +
	" COALESCE(SUM(in_tokens),0) AS inTok, COALESCE(SUM(out_tokens),0) AS outTok," +
	" COALESCE(SUM(cost),0) AS realCost," +
	" COALESCE(SUM(CASE WHEN cost IS NULL THEN in_tokens ELSE 0 END),0) AS eIn," +
	" COALESCE(SUM(CASE WHEN cost IS NULL THEN out_tokens ELSE 0 END),0) AS eOut," +
	" COALESCE(SUM(latency_ms),0) AS lat";

interface AggRow {
	total: number;
	ok: number | null;
	error: number | null;
	inTok: number;
	outTok: number;
	realCost: number;
	eIn: number;
	eOut: number;
	lat: number;
}
const unitOf = (r: AggRow, model: string | null) => ({
	total: r.total,
	ok: r.ok ?? 0,
	error: r.error ?? 0,
	inTok: r.inTok,
	outTok: r.outTok,
	cost: mergeCost(r.realCost, model, r.eIn, r.eOut),
	latency: r.lat,
});

/** p95 지연 — 성공 호출을 지연 순으로 세워 95% 지점 한 건만 읽는다. */
async function p95Of(env: StatsEnv, since: number, appFilter: string, okCount: number): Promise<number> {
	if (okCount <= 0) return 0;
	const off = Math.max(0, Math.floor((okCount - 1) * 0.95));
	const where = appFilter ? " AND app = ?2" : "";
	const st = env.DB.prepare(
		`SELECT latency_ms AS v FROM calls WHERE ts >= ?1${where} AND status='ok' ORDER BY latency_ms LIMIT 1 OFFSET ${off}`,
	);
	const row = await (appFilter ? st.bind(since, appFilter) : st.bind(since)).first<{ v: number }>();
	return row?.v ?? 0;
}

// ── 요약 화면 ────────────────────────────────────────────────

export interface SummaryData {
	period: string;
	appFilter: string;
	since: number;
	bucketLabel: string;
	apps: AppBrief[];
	total: number;
	ok: number;
	error: number;
	inTokens: number;
	outTokens: number;
	cost: number;
	avgLatency: number;
	p95Latency: number;
	uniqueIPs: number;
	byApp: (GroupRow & { name: string })[];
	byModel: GroupRow[];
	modelCount: number;
	buckets: Bucket[];
	errors: { http: number | null; count: number; sample: string | null }[];
	countries: { key: string; total: number }[];
	countryCount: number;
	/** 직전 같은 기간(전체 기간을 볼 땐 없다) */
	prev: { total: number; error: number; cost: number; avgLatency: number } | null;
	/** 맨 아래에 붙는 최근 호출 몇 건 — 자세히는 로그 화면에서 본다. */
	recent: LogRow[];
}

/** 요약 화면 맨 아래에 보여줄 최근 호출 건수. */
export const SUMMARY_RECENT = 5;

export async function collectSummary(env: StatsEnv, period: string, appFilter: string): Promise<SummaryData> {
	return withSchema(env, () => collectSummaryInner(env, period, appFilter));
}

async function collectSummaryInner(env: StatsEnv, period: string, appFilter: string): Promise<SummaryData> {
	const { p, since, prevSince } = periodInfo(period);
	const appWhere = appFilter ? " AND app = ?2" : "";
	const bind = (sql: string) => {
		const st = env.DB.prepare(sql);
		return appFilter ? st.bind(since, appFilter) : st.bind(since);
	};
	const bexpr = bucketExpr(p.bucket);

	const [apps, grouped, bucketRows, ipRow, okRow, errRows, cRows, prevRows, recentRs] = await Promise.all([
		appBriefs(env),

		bind(
			`SELECT COALESCE(app,'(미상)') AS app, model,${AGG} FROM calls WHERE ts >= ?1${appWhere} GROUP BY app, model`,
		).all<AggRow & { app: string; model: string | null }>(),

		bind(
			`SELECT ${bexpr} AS b, model,${AGG} FROM calls WHERE ts >= ?1${appWhere} GROUP BY b, model ORDER BY b DESC`,
		).all<AggRow & { b: string; model: string | null }>(),

		bind(`SELECT COUNT(DISTINCT ip) AS n FROM calls WHERE ts >= ?1${appWhere}`).first<{ n: number }>(),

		bind(`SELECT COUNT(*) AS n FROM calls WHERE ts >= ?1${appWhere} AND status='ok'`).first<{ n: number }>(),

		bind(
			`SELECT http, COUNT(*) AS c, MAX(err) AS sample FROM calls WHERE ts >= ?1${appWhere} AND status='error' GROUP BY http ORDER BY c DESC LIMIT 5`,
		).all<{ http: number | null; c: number; sample: string | null }>(),

		bind(
			`SELECT COALESCE(NULLIF(country,''),'(미상)') AS c, COUNT(*) AS n FROM calls WHERE ts >= ?1${appWhere} GROUP BY c ORDER BY n DESC`,
		).all<{ c: string; n: number }>(),

		// 전체 기간을 보는 중이면 비교 대상이 없다.
		p.days
			? (appFilter
					? env.DB.prepare(
							`SELECT model,${AGG} FROM calls WHERE ts >= ?1 AND ts < ?2 AND app = ?3 GROUP BY model`,
						).bind(prevSince, since, appFilter)
					: env.DB.prepare(
							`SELECT model,${AGG} FROM calls WHERE ts >= ?1 AND ts < ?2 GROUP BY model`,
						).bind(prevSince, since)
				).all<AggRow & { model: string | null }>()
			: Promise.resolve({ results: [] as (AggRow & { model: string | null })[] }),

		// 맨 아래 "최근 호출" — id 역순 몇 건. 인덱스로 바로 잡혀서 행 수와 무관하게 가볍다.
		(appFilter
			? env.DB.prepare(`SELECT ${LOG_COLS} FROM calls WHERE app = ?1 ORDER BY id DESC LIMIT ?2`).bind(appFilter, SUMMARY_RECENT)
			: env.DB.prepare(`SELECT ${LOG_COLS} FROM calls ORDER BY id DESC LIMIT ?1`).bind(SUMMARY_RECENT)
		).all<RawLogRow>(),
	]);

	const nameOf = new Map(apps.map((a) => [a.id, a.name]));
	const byAppMap = new Map<string, GroupRow>();
	const byModelMap = new Map<string, GroupRow>();
	let total = 0, ok = 0, error = 0, inTokens = 0, outTokens = 0, cost = 0, latSum = 0;

	for (const r of grouped.results ?? []) {
		const unit = unitOf(r, r.model);
		addTo(byAppMap, r.app, unit);
		addTo(byModelMap, r.model ?? "(미상)", unit);
		total += unit.total; ok += unit.ok; error += unit.error;
		inTokens += unit.inTok; outTokens += unit.outTok; cost += unit.cost; latSum += unit.latency;
	}

	const bmap = new Map<string, Bucket>();
	for (const r of bucketRows.results ?? []) {
		const cur = bmap.get(r.b) ?? { b: r.b, total: 0, ok: 0, error: 0, tokens: 0, cost: 0 };
		cur.total += r.total; cur.ok += r.ok ?? 0; cur.error += r.error ?? 0;
		cur.tokens += r.inTok + r.outTok; cur.cost += mergeCost(r.realCost, r.model, r.eIn, r.eOut);
		bmap.set(r.b, cur);
	}
	const buckets = Array.from(bmap.values()).sort((a, b) => (a.b < b.b ? 1 : -1)).slice(0, 30);

	let prev: SummaryData["prev"] = null;
	if (p.days) {
		let pT = 0, pE = 0, pC = 0, pL = 0;
		for (const r of prevRows.results ?? []) {
			pT += r.total; pE += r.error ?? 0; pC += mergeCost(r.realCost, r.model, r.eIn, r.eOut); pL += r.lat;
		}
		prev = { total: pT, error: pE, cost: pC, avgLatency: pT ? Math.round(pL / pT) : 0 };
	}

	const countries = (cRows.results ?? []).map((r) => ({ key: r.c, total: r.n }));

	return {
		period,
		appFilter,
		since,
		bucketLabel: bucketLabelOf(p.bucket),
		apps,
		total, ok, error, inTokens, outTokens, cost,
		avgLatency: total ? Math.round(latSum / total) : 0,
		p95Latency: await p95Of(env, since, appFilter, okRow?.n ?? 0),
		uniqueIPs: ipRow?.n ?? 0,
		byApp: Array.from(byAppMap.values()).sort(desc).map((r) => ({ ...r, name: nameOf.get(r.key) ?? r.key })),
		byModel: Array.from(byModelMap.values()).sort(desc),
		modelCount: byModelMap.size,
		buckets,
		errors: (errRows.results ?? []).map((r) => ({ http: r.http, count: r.c, sample: r.sample })),
		countries: countries.slice(0, 6),
		countryCount: countries.filter((c) => c.key !== "(미상)").length,
		prev,
		recent: (recentRs.results ?? []).map(toLogRow),
	};
}

// ── 사용량 화면 ──────────────────────────────────────────────

export interface UsageData {
	period: string;
	appFilter: string;
	since: number;
	apps: AppBrief[];
	total: number;
	cost: number;
	byApp: (GroupRow & { name: string })[];
	byModel: GroupRow[];
	byKind: GroupRow[];
	/** 직전 같은 기간의 호출 수 — 증감 표시에 쓴다. */
	prevApp: Record<string, number>;
	prevModel: Record<string, number>;
	hasPrev: boolean;
}

export async function collectUsage(env: StatsEnv, period: string, appFilter: string): Promise<UsageData> {
	return withSchema(env, () => collectUsageInner(env, period, appFilter));
}

async function collectUsageInner(env: StatsEnv, period: string, appFilter: string): Promise<UsageData> {
	const { p, since, prevSince } = periodInfo(period);
	const appWhere = appFilter ? " AND app = ?2" : "";
	const bind = (sql: string) => {
		const st = env.DB.prepare(sql);
		return appFilter ? st.bind(since, appFilter) : st.bind(since);
	};

	const [apps, grouped, prevRows] = await Promise.all([
		appBriefs(env),
		bind(
			`SELECT COALESCE(app,'(미상)') AS app, kind, model,${AGG} FROM calls WHERE ts >= ?1${appWhere} GROUP BY app, kind, model`,
		).all<AggRow & { app: string; kind: string; model: string | null }>(),
		p.days
			? (appFilter
					? env.DB.prepare(
							"SELECT COALESCE(app,'(미상)') AS app, model, COUNT(*) AS total FROM calls WHERE ts >= ?1 AND ts < ?2 AND app = ?3 GROUP BY app, model",
						).bind(prevSince, since, appFilter)
					: env.DB.prepare(
							"SELECT COALESCE(app,'(미상)') AS app, model, COUNT(*) AS total FROM calls WHERE ts >= ?1 AND ts < ?2 GROUP BY app, model",
						).bind(prevSince, since)
				).all<{ app: string; model: string | null; total: number }>()
			: Promise.resolve({ results: [] as { app: string; model: string | null; total: number }[] }),
	]);

	const nameOf = new Map(apps.map((a) => [a.id, a.name]));
	const byApp = new Map<string, GroupRow>();
	const byModel = new Map<string, GroupRow>();
	const byKind = new Map<string, GroupRow>();
	let total = 0, cost = 0;

	for (const r of grouped.results ?? []) {
		const unit = unitOf(r, r.model);
		addTo(byApp, r.app, unit);
		addTo(byModel, r.model ?? "(미상)", unit);
		addTo(byKind, r.kind, unit);
		total += unit.total;
		cost += unit.cost;
	}

	const prevApp: Record<string, number> = {};
	const prevModel: Record<string, number> = {};
	for (const r of prevRows.results ?? []) {
		prevApp[r.app] = (prevApp[r.app] ?? 0) + r.total;
		const m = r.model ?? "(미상)";
		prevModel[m] = (prevModel[m] ?? 0) + r.total;
	}

	return {
		period,
		appFilter,
		since,
		apps,
		total,
		cost,
		byApp: Array.from(byApp.values()).sort(desc).map((r) => ({ ...r, name: nameOf.get(r.key) ?? r.key })),
		byModel: Array.from(byModel.values()).sort(desc),
		byKind: Array.from(byKind.values()).sort(desc),
		prevApp,
		prevModel,
		hasPrev: !!p.days,
	};
}

// ── 추이 화면 ────────────────────────────────────────────────

export interface TrendData {
	period: string;
	appFilter: string;
	since: number;
	bucketLabel: string;
	apps: AppBrief[];
	buckets: Bucket[];
	heat: { w: number; h: number; n: number }[];
	total: number;
	cost: number;
}

export async function collectTrend(env: StatsEnv, period: string, appFilter: string): Promise<TrendData> {
	return withSchema(env, () => collectTrendInner(env, period, appFilter));
}

async function collectTrendInner(env: StatsEnv, period: string, appFilter: string): Promise<TrendData> {
	const { p, since } = periodInfo(period);
	const appWhere = appFilter ? " AND app = ?2" : "";
	const bind = (sql: string) => {
		const st = env.DB.prepare(sql);
		return appFilter ? st.bind(since, appFilter) : st.bind(since);
	};
	const bexpr = bucketExpr(p.bucket);
	const kstBase = "ts/1000, 'unixepoch', '+9 hours'";

	const [apps, bucketRows, heatRows] = await Promise.all([
		appBriefs(env),
		bind(
			`SELECT ${bexpr} AS b, model,${AGG} FROM calls WHERE ts >= ?1${appWhere} GROUP BY b, model ORDER BY b DESC`,
		).all<AggRow & { b: string; model: string | null }>(),
		bind(
			`SELECT CAST(strftime('%w', ${kstBase}) AS INTEGER) AS w,` +
				` CAST(strftime('%H', ${kstBase}) AS INTEGER) AS h, COUNT(*) AS n` +
				` FROM calls WHERE ts >= ?1${appWhere} GROUP BY w, h`,
		).all<{ w: number; h: number; n: number }>(),
	]);

	const bmap = new Map<string, Bucket>();
	let total = 0, cost = 0;
	for (const r of bucketRows.results ?? []) {
		const c = mergeCost(r.realCost, r.model, r.eIn, r.eOut);
		const cur = bmap.get(r.b) ?? { b: r.b, total: 0, ok: 0, error: 0, tokens: 0, cost: 0 };
		cur.total += r.total; cur.ok += r.ok ?? 0; cur.error += r.error ?? 0;
		cur.tokens += r.inTok + r.outTok; cur.cost += c;
		bmap.set(r.b, cur);
		total += r.total;
		cost += c;
	}

	return {
		period,
		appFilter,
		since,
		bucketLabel: bucketLabelOf(p.bucket),
		apps,
		buckets: Array.from(bmap.values()).sort((a, b) => (a.b < b.b ? 1 : -1)).slice(0, 60),
		heat: heatRows.results ?? [],
		total,
		cost,
	};
}

// ── 지역 화면 ────────────────────────────────────────────────

export interface GeoData {
	period: string;
	appFilter: string;
	since: number;
	apps: AppBrief[];
	byCountry: (GroupRow & { ips: number })[];
	byRegion: { country: string; region: string; city: string; total: number; ok: number; error: number; tokens: number; cost: number; ips: number }[];
	points: StatsSummary["points"];
	geoUnknown: number;
}

export async function collectGeo(env: StatsEnv, period: string, appFilter: string): Promise<GeoData> {
	return withSchema(env, () => collectGeoInner(env, period, appFilter));
}

async function collectGeoInner(env: StatsEnv, period: string, appFilter: string): Promise<GeoData> {
	const { since } = periodInfo(period);
	const appWhere = appFilter ? " AND app = ?2" : "";
	const bind = (sql: string) => {
		const st = env.DB.prepare(sql);
		return appFilter ? st.bind(since, appFilter) : st.bind(since);
	};

	const [apps, cRows, cIpRows, rRows] = await Promise.all([
		appBriefs(env),
		bind(
			`SELECT COALESCE(NULLIF(country,''),'(미상)') AS c, model,${AGG} FROM calls WHERE ts >= ?1${appWhere} GROUP BY c, model`,
		).all<AggRow & { c: string; model: string | null }>(),
		bind(
			`SELECT COALESCE(NULLIF(country,''),'(미상)') AS c, COUNT(DISTINCT ip) AS n FROM calls WHERE ts >= ?1${appWhere} GROUP BY c`,
		).all<{ c: string; n: number }>(),
		bind(
			"SELECT COALESCE(NULLIF(country,''),'(미상)') AS c, COALESCE(NULLIF(region,''),'-') AS rg," +
				" COALESCE(NULLIF(city,''),'-') AS ct, model," +
				AGG +
				", COUNT(DISTINCT ip) AS ips, AVG(lat) AS la, AVG(lon) AS lo, SUM(lat IS NOT NULL) AS geoN" +
				` FROM calls WHERE ts >= ?1${appWhere} GROUP BY c, rg, ct, model`,
		).all<AggRow & { c: string; rg: string; ct: string; model: string | null; ips: number; la: number | null; lo: number | null; geoN: number }>(),
	]);

	const cIp = new Map((cIpRows.results ?? []).map((r) => [r.c, r.n]));
	const byCountryMap = new Map<string, GroupRow>();
	for (const r of cRows.results ?? []) addTo(byCountryMap, r.c, unitOf(r, r.model));
	const byCountry = Array.from(byCountryMap.values())
		.sort(desc)
		.map((r) => ({ ...r, ips: cIp.get(r.key) ?? 0 }));

	type RegionAcc = {
		country: string; region: string; city: string;
		total: number; ok: number; error: number; tokens: number; cost: number; ips: number;
		latSum: number; lonSum: number; geoN: number;
	};
	const regionMap = new Map<string, RegionAcc>();
	for (const r of rRows.results ?? []) {
		const k = `${r.c}|${r.rg}|${r.ct}`;
		const cur = regionMap.get(k) ?? {
			country: r.c, region: r.rg, city: r.ct,
			total: 0, ok: 0, error: 0, tokens: 0, cost: 0, ips: 0, latSum: 0, lonSum: 0, geoN: 0,
		};
		cur.total += r.total; cur.ok += r.ok ?? 0; cur.error += r.error ?? 0;
		cur.tokens += r.inTok + r.outTok; cur.cost += mergeCost(r.realCost, r.model, r.eIn, r.eOut);
		cur.ips = Math.max(cur.ips, r.ips);   // 모델별로 쪼개져 중복되므로 최댓값을 쓴다(근사)
		if (r.la != null && r.lo != null && r.geoN > 0) {
			cur.latSum += r.la * r.geoN; cur.lonSum += r.lo * r.geoN; cur.geoN += r.geoN;
		}
		regionMap.set(k, cur);
	}
	const regionAll = Array.from(regionMap.values());
	const geoUnknown = regionAll.reduce((n, r) => n + (r.geoN > 0 ? 0 : r.total), 0);

	const points = regionAll
		.filter((r) => r.geoN > 0)
		.sort((a, b) => b.total - a.total)
		.slice(0, 200)
		.map((r) => ({
			country: r.country,
			city: r.city === "-" ? r.region : r.city,
			lat: r.latSum / r.geoN,
			lon: r.lonSum / r.geoN,
			total: r.total,
			ips: r.ips,
			cost: r.cost,
		}));

	const byRegion = regionAll
		.sort((a, b) => b.total - a.total)
		.slice(0, 50)
		.map((r) => ({
			country: r.country, region: r.region, city: r.city,
			total: r.total, ok: r.ok, error: r.error, tokens: r.tokens, cost: r.cost, ips: r.ips,
		}));

	return { period, appFilter, since, apps, byCountry, byRegion, points, geoUnknown };
}

// ── 로그 화면 ────────────────────────────────────────────────

export interface LogFilter {
	period: string;
	app: string;
	model: string;
	kind: string;
	status: string;
	http: string;
	country: string;
	ip: string;
	/** 오류 메시지·메타에서 찾을 말 */
	q: string;
	/** KST 날짜 (YYYY-MM-DD). 비어 있으면 기간 탭을 따른다. */
	from: string;
	to: string;
	/** 이 지연(ms) 이상만 */
	slow: number;
	/** 커서 — 이 id보다 작은 것만(다음 쪽) */
	before: number;
	limit: number;
}

export interface LogRow {
	id: number;
	ts: number;
	app: string;
	kind: string;
	model: string | null;
	status: string;
	http: number | null;
	latency_ms: number;
	inTok: number;
	outTok: number;
	cost: number;
	err: string | null;
	meta: string | null;
	ip: string | null;
	country: string;
	region: string;
	city: string;
}

export interface LogsData {
	filter: LogFilter;
	apps: AppBrief[];
	models: string[];
	kinds: string[];
	rows: LogRow[];
	count: number;
	hasMore: boolean;
}

export const LOG_PAGE = 100;
/** LOG_COLS로 뽑은 그대로의 행. cost는 실제 청구액이라 없을 수 있다. */
interface RawLogRow {
	id: number; ts: number; app: string; kind: string; model: string | null; status: string;
	http: number | null; latency_ms: number; inTok: number; outTok: number; realCost: number | null;
	err: string | null; meta: string | null; ip: string | null;
	country: string | null; region: string | null; city: string | null;
}

/** 청구액이 없는 과거 행만 단가표로 채워 넣는다. */
function toLogRow(r: RawLogRow): LogRow {
	return {
		id: r.id, ts: r.ts, app: r.app, kind: r.kind, model: r.model, status: r.status,
		http: r.http, latency_ms: r.latency_ms, inTok: r.inTok, outTok: r.outTok,
		cost: r.realCost ?? costOf(r.model, r.inTok, r.outTok),
		err: r.err, meta: r.meta, ip: r.ip,
		country: r.country ?? "", region: r.region ?? "", city: r.city ?? "",
	};
}

const LOG_COLS =
	"id, ts, COALESCE(app,'(미상)') AS app, kind, model, status, http, latency_ms," +
	" COALESCE(in_tokens,0) AS inTok, COALESCE(out_tokens,0) AS outTok, cost AS realCost," +
	" err, meta, ip, country, region, city";

/** KST 날짜(YYYY-MM-DD) → epoch ms. 잘못된 값이면 null. */
function kstDay(d: string, endOfDay = false): number | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
	const t = Date.parse(`${d}T00:00:00+09:00`);
	if (!isFinite(t)) return null;
	return endOfDay ? t + 86_400_000 : t;
}

/** 검색 조건 → WHERE 절과 바인딩 값. */
function logWhere(f: LogFilter): { sql: string; args: unknown[] } {
	const w: string[] = [];
	const a: unknown[] = [];
	const from = kstDay(f.from);
	const to = kstDay(f.to, true);

	if (from != null) { w.push("ts >= ?"); a.push(from); }
	else { const { since } = periodInfo(f.period); if (since) { w.push("ts >= ?"); a.push(since); } }
	if (to != null) { w.push("ts < ?"); a.push(to); }

	if (f.app) { w.push("app = ?"); a.push(f.app); }
	if (f.model) { w.push("model = ?"); a.push(f.model); }
	if (f.kind) { w.push("kind = ?"); a.push(f.kind); }
	if (f.status === "ok" || f.status === "error") { w.push("status = ?"); a.push(f.status); }
	if (f.http && /^\d{3}$/.test(f.http)) { w.push("http = ?"); a.push(Number(f.http)); }
	if (f.country) { w.push("country = ?"); a.push(f.country); }
	if (f.ip) { w.push("ip = ?"); a.push(f.ip); }
	if (f.slow > 0) { w.push("latency_ms >= ?"); a.push(f.slow); }
	if (f.q) { w.push("(err LIKE ? OR meta LIKE ? OR model LIKE ?)"); a.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }

	return { sql: w.length ? ` WHERE ${w.join(" AND ")}` : "", args: a };
}

export async function queryLogs(env: StatsEnv, f: LogFilter): Promise<LogsData> {
	return withSchema(env, () => queryLogsInner(env, f));
}

async function queryLogsInner(env: StatsEnv, f: LogFilter): Promise<LogsData> {
	const { sql, args } = logWhere(f);
	const { since } = periodInfo(f.period);
	const limit = Math.min(500, Math.max(10, f.limit || LOG_PAGE));

	const rowSql = `SELECT ${LOG_COLS} FROM calls${sql}${f.before ? `${sql ? " AND" : " WHERE"} id < ?` : ""} ORDER BY id DESC LIMIT ?`;
	const rowArgs = f.before ? [...args, f.before, limit + 1] : [...args, limit + 1];

	const [rowsRs, cntRow, apps, modelRs, kindRs] = await Promise.all([
		env.DB.prepare(rowSql).bind(...rowArgs).all<RawLogRow>(),
		env.DB.prepare(`SELECT COUNT(*) AS n FROM calls${sql}`).bind(...args).first<{ n: number }>(),
		appBriefs(env),
		env.DB.prepare("SELECT DISTINCT model FROM calls WHERE ts >= ?1 AND model IS NOT NULL ORDER BY model LIMIT 300")
			.bind(since)
			.all<{ model: string }>(),
		env.DB.prepare("SELECT DISTINCT kind FROM calls WHERE ts >= ?1 AND kind IS NOT NULL ORDER BY kind LIMIT 60")
			.bind(since)
			.all<{ kind: string }>(),
	]);

	const raw = rowsRs.results ?? [];
	const hasMore = raw.length > limit;
	const rows: LogRow[] = raw.slice(0, limit).map(toLogRow);

	return {
		filter: { ...f, limit },
		apps,
		models: (modelRs.results ?? []).map((r) => r.model),
		kinds: (kindRs.results ?? []).map((r) => r.kind),
		rows,
		count: cntRow?.n ?? 0,
		hasMore,
	};
}

/** 검색 조건 그대로 CSV로 내려받기 (최대 5000건). */
export async function logsCsv(env: StatsEnv, f: LogFilter): Promise<string> {
	const { sql, args } = logWhere(f);
	const rs = await withSchema(env, () =>
		env.DB.prepare(`SELECT ${LOG_COLS} FROM calls${sql} ORDER BY id DESC LIMIT 5000`)
			.bind(...args)
			.all<Record<string, unknown>>(),
	);
	const head = [
		"id", "시각(KST)", "앱", "용도", "모델", "상태", "HTTP", "지연(ms)",
		"입력토큰", "출력토큰", "비용(USD)", "IP", "국가", "지역", "도시", "오류", "메타",
	];
	const esc = (v: unknown) => {
		const s = v == null ? "" : String(v);
		return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const lines = [head.join(",")];
	for (const r of rs.results ?? []) {
		const ts = Number(r.ts);
		const model = (r.model as string | null) ?? null;
		const cost = (r.realCost as number | null) ?? costOf(model, Number(r.inTok), Number(r.outTok));
		lines.push(
			[
				r.id,
				new Date(ts + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 19),
				r.app, r.kind, model ?? "", r.status, r.http ?? "", r.latency_ms,
				r.inTok, r.outTok, cost.toFixed(6), r.ip ?? "",
				r.country ?? "", r.region ?? "", r.city ?? "",
				r.err ?? "", r.meta ?? "",
			]
				.map(esc)
				.join(","),
		);
	}
	return `﻿${lines.join("\n")}\n`;
}
