/**
 * AI 프록시 — 앱 레지스트리 · 호출 통계 · rate limit (Cloudflare D1).
 *
 *  - apps  : 앱 1개 = 토큰 1개. 어떤 용도에 어떤 모델을 쓸지, 상한은 얼마인지 담는다.
 *  - calls : 호출 1건씩 기록. app·model·meta까지 남겨 앱별/모델별 집계와 메타 해석에 쓴다.
 *
 * 비용은 "용도"가 아니라 "실제 호출한 모델" 기준으로 계산한다.
 * 그래야 모델을 갈아끼워도 과거 비용이 틀어지지 않는다.
 */

import { WORLD_PATH, MAP_W, MAP_H, projectLonLat } from "./worldmap";

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
// 대시보드 렌더
// ─────────────────────────────────────────────────────────────
export function escapeHtml(s: string): string {
	return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

const ADMIN_CSS = `
:root{--bg:#f6f7fb;--panel:#fff;--ink:#1c1f23;--muted:#6b7280;--line:#e6e9ef;--accent:#925FF0;--g:#0a7d33;--r:#c0392b;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
 font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",Inter,sans-serif;line-height:1.5;}
.wrap{max-width:1120px;margin:0 auto;padding:22px 18px 70px;}
h1{font-size:20px;margin:0 0 4px;}h2{font-size:14px;margin:26px 0 9px;color:var(--muted);}
.sub{color:var(--muted);font-size:13px;margin:0 0 16px;}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;}
.tab{font-size:13px;font-weight:700;padding:7px 13px;border-radius:999px;border:1px solid var(--line);
 background:var(--panel);color:var(--ink);text-decoration:none;}
.tab.on{background:var(--accent);border-color:var(--accent);color:#fff;}
.tab.alt{background:#f0eaff;border-color:#ddd0fb;color:#5E3A9E;}
/* ── 요약 지표: 큰 카드 3 + 작은 카드 6 (줄바꿈이 어정쩡하게 남지 않도록 열 수를 고정) */
.kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.k1{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 18px 14px;
 display:flex;flex-direction:column;min-height:132px;}
.k1 .l{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.2px;}
.k1 .v{font-size:32px;font-weight:800;letter-spacing:-1px;line-height:1.15;margin-top:3px;font-variant-numeric:tabular-nums;}
.k1 .v .u{font-size:15px;font-weight:700;color:var(--muted);margin-left:3px;letter-spacing:0;}
.k1 .s{font-size:12.5px;color:var(--muted);margin-top:3px;}
.k1 .s2{font-size:11.5px;color:var(--muted);margin-top:5px;}
.k1 .spark{margin-top:auto;padding-top:10px;height:30px;}
.k1 .spark svg{width:100%;height:24px;display:block;}
.k1 .spark rect{fill:#d9c9fb;}
.k1 .meter{margin-top:auto;height:7px;border-radius:4px;background:#efe9fb;overflow:hidden;}
.k1 .meter span{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,var(--accent),#C85A95);}
.k1 .meter.lat span{background:linear-gradient(90deg,#35A7FF,var(--accent));}
.kpi2{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:10px;}
.m{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:11px 13px;}
.m .l{font-size:11.5px;color:var(--muted);font-weight:700;}
.m .v{font-size:19px;font-weight:800;margin-top:1px;font-variant-numeric:tabular-nums;}
@media(max-width:900px){.kpi{grid-template-columns:1fr}.kpi2{grid-template-columns:repeat(3,1fr)}}
@media(max-width:520px){.kpi2{grid-template-columns:repeat(2,1fr)}}

/* ── 차트 */
.chart{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 12px 8px;}
.chart svg{width:100%;height:auto;aspect-ratio:1000/240;min-height:168px;display:block;overflow:visible;}
.chart .gl{stroke:var(--line);stroke-width:1;}
.chart .ax{font-size:10px;fill:var(--muted);font-weight:600;}
.chart .ax.end{text-anchor:end;}.chart .ax.mid{text-anchor:middle;}.chart .ax.cst{fill:#C85A95;}
.chart .b-ok{fill:var(--accent);}
.chart .b-er{fill:#e2686b;}
.chart .hit{fill:transparent;}
.chart .bg:hover .b-ok{fill:#7a45dd;}
.chart .bg:hover .hit{fill:rgba(146,95,240,.07);}
.chart .cl{fill:none;stroke:#C85A95;stroke-width:2;stroke-linejoin:round;stroke-linecap:round;}
.chart .cd{fill:#fff;stroke:#C85A95;stroke-width:1.6;}
.chart .lg{display:flex;gap:14px;justify-content:center;padding:6px 0 4px;font-size:11.5px;color:var(--muted);font-weight:600;}
.chart .lg .k{display:inline-flex;align-items:center;gap:5px;}
.chart .lg i{width:9px;height:9px;border-radius:3px;display:block;}
.chart .lg .s-ok{background:var(--accent);}.chart .lg .s-er{background:#e2686b;}
.chart .lg .s-ct{background:#C85A95;border-radius:50%;}
.empty{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:26px;
 text-align:center;color:var(--muted);font-size:13px;}

/* ── 지도 */
.mapwrap{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:14px;
 padding:10px;overflow:hidden;}
.mapwrap svg{width:100%;height:auto;display:block;border-radius:9px;}
.mapwrap .sea{fill:#f2f5fb;}
.mapwrap .land{fill:#dfe4ee;stroke:#cfd6e4;stroke-width:.5;}
.mapwrap .bo{fill:rgba(146,95,240,.28);stroke:var(--accent);stroke-width:1.2;}
.mapwrap .bi{fill:var(--accent);}
.mapwrap .bub{cursor:default;}
.mapwrap .bub:hover .bo{fill:rgba(200,90,149,.34);stroke:#C85A95;}
.mapwrap .bub:hover .bi{fill:#C85A95;}
.mapempty{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted);font-size:13px;
 background:rgba(255,255,255,.72);}

/* ── 비중 막대 */
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
@media(max-width:860px){.two{grid-template-columns:1fr}}
.two h2{margin-top:26px;}
.shares{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;}
.sh{margin-bottom:12px;}.sh:last-child{margin-bottom:0;}
.sh-t{display:flex;justify-content:space-between;gap:10px;font-size:13px;font-weight:700;align-items:baseline;}
.sh-v{color:var(--muted);font-weight:600;font-size:12px;font-variant-numeric:tabular-nums;}
.sh-v b{color:var(--ink);}
.sh-b{height:9px;border-radius:5px;background:#f1f2f6;overflow:hidden;margin-top:5px;}
.sh-b span{display:block;height:100%;border-radius:5px;}
.sh-s{font-size:11px;color:var(--muted);margin-top:3px;}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);
 border-radius:14px;overflow:hidden;font-size:13px;}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;}
th{background:#fafbfc;font-weight:700;color:var(--muted);font-size:12px;}
tr:last-child td{border-bottom:none;}
.n{text-align:right;font-variant-numeric:tabular-nums;}
.g{color:var(--g);}.r{color:var(--r);}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}
td.bar{width:30%;}td.bar span{display:block;height:9px;background:var(--accent);border-radius:5px;min-width:2px;}
td.err{color:var(--muted);font-size:11px;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.foot{margin-top:22px;color:var(--muted);font-size:12px;}
.sm{font-size:11px;color:var(--muted);}
.chip{display:inline-block;background:#f0eaff;color:#5E3A9E;border-radius:6px;padding:1px 7px;font-size:11px;font-weight:700;}
form.inline{display:inline}
input,select,textarea{font:inherit;font-size:13px;padding:7px 9px;border:1px solid var(--line);border-radius:9px;background:#fff;width:100%;}
textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}
.btn{font-size:13px;font-weight:700;padding:8px 14px;border-radius:9px;border:1px solid var(--line);
 background:#fff;cursor:pointer;}
.btn.p{background:var(--accent);border-color:var(--accent);color:#fff;}
.btn.d{color:var(--r);border-color:#f2c7c2;}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.fld{margin-bottom:10px;}.fld label{display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px;}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;}
@media(max-width:700px){.grid2{grid-template-columns:1fr}}

/* ── 제목 + 실시간 시계
   시계는 제목보다 작게(제목이 주인공), 하나의 카드로 묶어 오른쪽에 고정한다.
   전에는 27px 숫자가 배경 없이 세로 3단으로 떠 있어 무게가 오른쪽으로 쏠렸다. */
.head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:13px;}
.head .ht{min-width:0;flex:1 1 auto;}
.head h1{margin:0 0 3px;}
.head .sub{margin:0;}
.clock{flex:0 0 auto;display:flex;align-items:center;gap:11px;
 background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:7px 8px 7px 13px;
 box-shadow:0 1px 2px rgba(20,25,40,.04);}
.clock .tw{line-height:1.15;text-align:right;}
.clock .t{font-size:18px;font-weight:800;letter-spacing:-.2px;
 font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
.clock .d{font-size:11px;color:var(--muted);margin-top:1px;white-space:nowrap;}
.live{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:11.5px;font-weight:700;
 color:var(--muted);background:#f7f8fb;border:1px solid var(--line);border-radius:999px;
 padding:5px 11px;cursor:pointer;width:auto;white-space:nowrap;
 transition:color .18s,border-color .18s,background .18s;}
.live i{width:7px;height:7px;border-radius:50%;background:#c7ccd6;display:block;flex:0 0 7px;}
.live.on{color:var(--g);border-color:#cfe8d4;background:#f2fbf4;}
.live.on i{background:#22c55e;animation:beat 1.9s ease-in-out infinite;}
.live.busy{color:#5E3A9E;border-color:#ddd0fb;background:#f0eaff;}
.live.busy i{background:var(--accent);animation:beat .7s ease-in-out infinite;}
@keyframes beat{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.75)}}
/* 탭 두 줄(기간·앱)은 한 덩어리로 보이게 간격을 좁힌다 */
.tabs + .tabs{margin-top:-6px;}
@media(max-width:760px){
  .head{flex-direction:column;align-items:stretch;gap:11px;}
  .clock{justify-content:space-between;}
  .clock .tw{text-align:left;}
}

/* ── 상단바 */
.topbar{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.88);backdrop-filter:blur(10px);
 border-bottom:1px solid var(--line);}
.topbar .in{max-width:1120px;margin:0 auto;padding:0 18px;height:54px;display:flex;align-items:center;gap:14px;}
.topbar .bd{font-weight:800;font-size:15px;letter-spacing:-.3px;display:flex;align-items:center;gap:8px;}
.topbar .bd i{width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#C85A95);display:block;}
.topbar nav{display:flex;gap:4px;margin-left:6px;}
.topbar nav a{font-size:13px;font-weight:700;color:var(--muted);padding:7px 11px;border-radius:9px;text-decoration:none;}
.topbar nav a:hover{background:#f2f3f7;color:var(--ink);}
.topbar nav a.on{background:#f0eaff;color:#5E3A9E;}
.topbar .sp{flex:1}
.topbar .who{font-size:12px;color:var(--muted);}

/* ── 토스트 */
.toasts{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:60;
 display:flex;flex-direction:column;gap:9px;align-items:center;pointer-events:none;width:min(420px,calc(100vw - 32px));}
.toast{pointer-events:auto;cursor:pointer;display:flex;align-items:flex-start;gap:10px;width:100%;
 background:#1f2430;color:#fff;border-radius:13px;padding:12px 15px;font-size:13.5px;font-weight:600;line-height:1.5;
 box-shadow:0 14px 34px rgba(20,25,40,.28);opacity:0;transform:translateY(14px) scale(.97);
 transition:opacity .24s cubic-bezier(.2,.8,.2,1),transform .24s cubic-bezier(.2,.8,.2,1);}
.toast.in{opacity:1;transform:none;}
.toast .tk{width:7px;height:7px;border-radius:50%;background:#6ee7a8;margin-top:6px;flex:0 0 7px;}
.toast.err{background:#3a2126;}.toast.err .tk{background:#ff8a92;}
.toast .tm{flex:1;word-break:break-all;}

/* ── 모달 */
.mask{position:fixed;inset:0;z-index:70;background:rgba(24,20,40,.44);backdrop-filter:blur(3px);
 display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .2s;}
.mask.in{opacity:1;}
.modal{width:min(420px,100%);background:var(--panel);border-radius:18px;padding:22px;
 box-shadow:0 26px 70px rgba(30,20,60,.3);transform:translateY(12px) scale(.96);transition:transform .22s cubic-bezier(.2,.8,.2,1);}
.mask.in .modal{transform:none;}
.modal h3{margin:0 0 8px;font-size:17px;font-weight:800;}
.modal p{margin:0;font-size:14px;color:var(--muted);line-height:1.65;word-break:break-all;}
.modal p.copybox{background:#f6f7fb;border:1px solid var(--line);border-radius:10px;padding:11px 12px;color:var(--ink);font-size:12.5px;}
.modal .mbtns{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;}
.modal .mbtns .btn{min-width:78px;}

/* ── 로그인 */
.login{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
.login .box{width:min(380px,100%);background:var(--panel);border:1px solid var(--line);border-radius:20px;
 padding:30px 26px;box-shadow:0 20px 60px rgba(40,30,80,.09);}
.login .mark{width:46px;height:46px;border-radius:14px;margin:0 auto 14px;
 background:linear-gradient(135deg,var(--accent),#C85A95);display:flex;align-items:center;justify-content:center;
 color:#fff;font-weight:900;font-size:18px;letter-spacing:-.5px;}
.login h1{font-size:19px;text-align:center;margin:0 0 4px;}
.login .sub{text-align:center;margin-bottom:20px;}
.login .btn{width:100%;padding:12px;margin-top:6px;}
.login .err{background:#fff1f1;border:1px solid #f6cfcf;color:#a9313a;border-radius:10px;
 padding:10px 12px;font-size:13px;font-weight:600;margin-bottom:14px;}
.login .foot{text-align:center;margin-top:16px;font-size:11.5px;}
.copy{margin-left:6px;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;border:1px solid var(--line);
 background:#fff;cursor:pointer;color:var(--muted);}
.copy:hover{color:var(--ink);border-color:#cfd4dd;}
`;

/**
 * 관리 화면 공통 스크립트 — 시스템 alert/confirm 대신 직접 만든 모달·토스트를 쓴다.
 * 서버는 결과를 #hz-flash 데이터 속성으로만 넘기고, 표시는 전부 여기서 한다.
 */
const ADMIN_JS = `
(function(){
  var host = document.createElement('div'); host.className = 'toasts'; document.body.appendChild(host);

  function toast(msg, kind){
    var t = document.createElement('div');
    t.className = 'toast' + (kind === 'err' ? ' err' : '');
    var k = document.createElement('span'); k.className = 'tk';
    var m = document.createElement('span'); m.className = 'tm'; m.textContent = msg;
    t.appendChild(k); t.appendChild(m); host.appendChild(t);
    requestAnimationFrame(function(){ t.classList.add('in'); });
    var kill = function(){ t.classList.remove('in'); setTimeout(function(){ if (t.parentNode) t.remove(); }, 280); };
    var timer = setTimeout(kill, 4200);
    t.addEventListener('click', function(){ clearTimeout(timer); kill(); });
  }
  window.hzToast = toast;

  function modal(opts){
    return new Promise(function(resolve){
      var mask = document.createElement('div'); mask.className = 'mask';
      var box = document.createElement('div'); box.className = 'modal';
      var h = document.createElement('h3'); h.textContent = opts.title || '확인';
      var p = document.createElement('p'); p.textContent = opts.body || '';
      if (opts.mono) p.className = 'mono copybox';
      var btns = document.createElement('div'); btns.className = 'mbtns';
      box.appendChild(h); box.appendChild(p); box.appendChild(btns);
      mask.appendChild(box); document.body.appendChild(mask);

      function close(){
        mask.classList.remove('in');
        document.removeEventListener('keydown', esc);
        setTimeout(function(){ if (mask.parentNode) mask.remove(); }, 220);
      }
      function esc(e){ if (e.key === 'Escape') { close(); resolve(null); } }

      (opts.buttons || []).forEach(function(b){
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'btn' + (b.style ? ' ' + b.style : '');
        el.textContent = b.label;
        el.addEventListener('click', function(){ close(); resolve(b.value); });
        btns.appendChild(el);
      });
      document.addEventListener('keydown', esc);
      mask.addEventListener('click', function(e){ if (e.target === mask) { close(); resolve(null); } });
      requestAnimationFrame(function(){
        mask.classList.add('in');
        var f = btns.querySelector('.btn.p, .btn.d') || btns.querySelector('.btn');
        if (f) f.focus();
      });
    });
  }
  window.hzModal = modal;

  // 되돌릴 수 없는 동작은 직접 만든 확인 모달을 거친다.
  document.addEventListener('submit', function(e){
    var f = e.target;
    if (!f || !f.matches || !f.matches('form[data-confirm]')) return;
    if (f.getAttribute('data-confirmed') === '1') return;
    e.preventDefault();
    modal({
      title: f.getAttribute('data-confirm-title') || '확인해 주세요',
      body: f.getAttribute('data-confirm'),
      buttons: [
        { label: '취소', value: false },
        { label: f.getAttribute('data-confirm-ok') || '확인', value: true, style: f.getAttribute('data-danger') === '1' ? 'd' : 'p' }
      ]
    }).then(function(ok){
      if (!ok) return;
      f.setAttribute('data-confirmed', '1');
      if (f.requestSubmit) f.requestSubmit(); else f.submit();
    });
  }, true);

  function copyText(v){
    var done = function(){ toast('복사했어요'); };
    var fallback = function(){
      var ta = document.createElement('textarea');
      ta.value = v; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (err) { toast('복사하지 못했어요', 'err'); }
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(v).then(done, fallback);
    else fallback();
  }
  document.addEventListener('click', function(e){
    var b = e.target && e.target.closest ? e.target.closest('[data-copy]') : null;
    if (!b) return;
    e.preventDefault();
    copyText(b.getAttribute('data-copy'));
  });

  // 서버가 넘긴 결과는 토스트로 띄우고, 주소창의 쿼리는 지운다.
  var flash = document.getElementById('hz-flash');
  if (flash) {
    var msg = flash.getAttribute('data-msg');
    var tok = flash.getAttribute('data-token');
    if (msg) toast(msg, flash.getAttribute('data-kind') || 'ok');
    if (tok) {
      modal({
        title: '토큰이 발급됐어요',
        body: tok,
        mono: true,
        buttons: [{ label: '닫기', value: null }, { label: '복사', value: 'copy', style: 'p' }]
      }).then(function(v){ if (v === 'copy') copyText(tok); });
    }
    if (window.history && history.replaceState) history.replaceState(null, '', location.pathname);
  }

  // ── 실시간 시계 (KST 고정 · 24시간제)
  // 브라우저·서버 시간대와 무관하게 늘 서울 시각을 보여준다.
  // hourCycle:'h23'이라야 자정이 24시가 아니라 00시로 나온다.
  var TF = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hourCycle: 'h23',
    hour: '2-digit', minute: '2-digit', second: '2-digit' });
  // 연도는 뺀다 — 늘 오늘이라 정보가 없고, 가로 배치에서 폭만 차지한다.
  var DF = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul',
    month: '2-digit', day: '2-digit', weekday: 'short' });

  // DOM이 통째로 갈릴 수 있어서 매번 다시 찾는다(참조를 들고 있으면 갱신 뒤 멈춘다).
  function tickClock(){
    var t = document.getElementById('hz-time');
    if (!t) return;
    var now = new Date();
    t.textContent = TF.format(now);
    var d = document.getElementById('hz-date');
    if (d) d.textContent = DF.format(now) + ' KST';
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ── 자동 갱신 — 새 호출이 들어오면 화면을 다시 그린다(대시보드에서만).
  // 매번 통계를 통째로 받아오면 무거우니, 가벼운 /admin/api/pulse로 변화만 감시하고
  // 값이 달라졌을 때만 페이지를 다시 받아 본문을 갈아끼운다.
  if (document.getElementById('hz-clock')) {
    var LIVE_KEY = 'hz_live';
    var live = localStorage.getItem(LIVE_KEY) !== '0';
    var sig = null, busy = false;

    function paintLive(state){
      var el = document.getElementById('hz-live');
      if (!el) return;
      el.className = 'live' + (live ? ' on' : '') + (state === 'busy' ? ' busy' : '');
      var t = document.getElementById('hz-live-t');
      if (t) t.textContent = state === 'busy' ? '불러오는 중' : (live ? '자동 갱신 켬' : '자동 갱신 끔');
    }

    function appQuery(){
      var c = document.getElementById('hz-clock');
      var a = c ? (c.getAttribute('data-app') || '') : '';
      return a ? '?app=' + encodeURIComponent(a) : '';
    }

    function refresh(){
      busy = true; paintLive('busy');
      fetch(location.href, { credentials: 'same-origin' })
        .then(function(r){ if (!r.ok) throw new Error('http'); return r.text(); })
        .then(function(html){
          var doc = new DOMParser().parseFromString(html, 'text/html');
          // 헤더(#hz-clock 포함)는 그대로 두고 데이터 영역만 갈아끼운다.
          // .wrap을 통째로 바꾸면 시계 DOM이 매번 새로 만들어져 값이 잠깐 비고 배치가 흔들린다.
          var neu = doc.querySelector('#hz-body') || doc.querySelector('.wrap');
          var cur = document.querySelector('#hz-body') || document.querySelector('.wrap');
          if (neu && cur) cur.innerHTML = neu.innerHTML;
        })
        .catch(function(){ /* 잠깐 실패해도 다음 주기에 다시 시도한다 */ })
        .then(function(){ busy = false; tickClock(); paintLive(); });
    }

    function poll(){
      if (!live || busy || document.hidden) return;
      fetch('/admin/api/pulse' + appQuery(), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function(r){
          if (r.status === 401 || r.status === 403) {
            live = false; paintLive();
            toast('로그인이 풀려서 자동 갱신을 멈췄어요. 새로고침해 주세요.', 'err');
            return null;
          }
          return r.ok ? r.json() : null;
        })
        .then(function(j){
          if (!j) return;
          var now = j.mx + '|' + j.ts;
          if (sig === null) { sig = now; return; }   // 첫 응답은 기준점만 잡는다
          if (now !== sig) { sig = now; refresh(); }
        })
        .catch(function(){});
    }

    document.addEventListener('click', function(e){
      var b = e.target && e.target.closest ? e.target.closest('#hz-live') : null;
      if (!b) return;
      live = !live;
      localStorage.setItem(LIVE_KEY, live ? '1' : '0');
      paintLive();
      if (live) poll();
    });
    // 다른 탭을 보다 돌아오면 바로 한 번 확인한다(백그라운드에선 폴링하지 않는다).
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) poll(); });

    paintLive();
    poll();
    setInterval(poll, 10000);
  }
})();
`;

export interface AdminOpts {
	/** 세션 로그인으로 들어온 화면인지(= 로그아웃 버튼 노출). Basic 인증 도메인은 false. */
	session?: boolean;
	/** 상단바에서 강조할 메뉴 — stats | apps */
	tab?: "stats" | "apps";
	/** 상단바·본문 여백 없이 그리는 화면(로그인 등) */
	bare?: boolean;
	/** 화면을 열자마자 토스트로 띄울 결과 메시지 */
	flash?: string | null;
	/** 화면을 열자마자 모달로 보여줄 발급 토큰 */
	token?: string | null;
}

function shellAdmin(title: string, body: string, opts: AdminOpts = {}): string {
	const nav = (href: string, label: string, key: string) =>
		`<a href="${href}"${opts.tab === key ? ' class="on"' : ""}>${label}</a>`;
	const topbar = opts.bare
		? ""
		: `<header class="topbar"><div class="in">
  <span class="bd"><i></i>AI 프록시</span>
  <nav>${nav("/admin", "통계", "stats")}${nav("/admin/apps", "앱 관리", "apps")}</nav>
  <span class="sp"></span>
  ${opts.session ? `<form method="post" action="/admin/logout"><button class="btn" type="submit">로그아웃</button></form>` : ""}
</div></header>`;
	const flash =
		opts.flash || opts.token
			? `<div id="hz-flash" hidden data-msg="${escapeHtml(opts.flash ?? "")}" data-token="${escapeHtml(opts.token ?? "")}"></div>`
			: "";
	return `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="robots" content="noindex,nofollow">
<style>${ADMIN_CSS}</style></head><body>${topbar}
${opts.bare ? body : `<div class="wrap">${body}</div>`}
${flash}<script>${ADMIN_JS}</script></body></html>`;
}

// ─────────────────────────────────────────────────────────────
// 로그인 화면 (세션 인증 도메인 전용)
// ─────────────────────────────────────────────────────────────
export function renderLogin(opts: { error?: string; user?: string; next?: string } = {}): string {
	return shellAdmin(
		"로그인",
		`<main class="login"><form class="box" method="post" action="/admin/login">
  <div class="mark">AI</div>
  <h1>AI 프록시 관리</h1>
  <p class="sub">호출 통계와 앱 토큰을 관리하는 화면이에요.</p>
  ${opts.error ? `<div class="err">${escapeHtml(opts.error)}</div>` : ""}
  <input type="hidden" name="next" value="${escapeHtml(opts.next ?? "/admin")}">
  <div class="fld"><label>아이디</label>
    <input name="user" value="${escapeHtml(opts.user ?? "")}" autocomplete="username" autocapitalize="none" autofocus required></div>
  <div class="fld"><label>비밀번호</label>
    <input name="pass" type="password" autocomplete="current-password" required></div>
  <button class="btn p" type="submit">로그인</button>
  <p class="foot">관리자 전용 화면이에요. 색인되지 않아요.</p>
</form></main>`,
		{ bare: true },
	);
}

const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`;
const kst = (ts: number) => new Date(ts + 9 * 3600_000).toISOString().replace("T", " ").slice(5, 19);

// ─────────────────────────────────────────────────────────────
// 차트 · 지도 (외부 라이브러리 없이 인라인 SVG)
// ─────────────────────────────────────────────────────────────

/** 축 눈금용 — 보기 좋은 상한값(1·2·5×10ⁿ)으로 올림. */
function niceMax(v: number): number {
	if (v <= 0) return 1;
	const exp = Math.pow(10, Math.floor(Math.log10(v)));
	const f = v / exp;
	return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

const shortNum = (v: number): string =>
	v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : String(v);

/**
 * 추이 차트 — 성공·실패 누적 막대 + 비용 꺾은선(오른쪽 축).
 * 값은 서버에서 좌표로 굳혀 보내고, 자세한 수치는 막대의 title(마우스 올리면 표시)로 준다.
 */
function svgTrend(buckets: StatsSummary["buckets"]): string {
	const data = buckets.slice(0, 30).slice().reverse();   // 최신이 앞이라 뒤집어 시간순으로
	if (!data.length) return `<div class="empty">이 기간에 호출이 없어요.</div>`;

	const W = 1000, H = 240, L = 46, R = 56, T = 14, B = 30;
	const iw = W - L - R, ih = H - T - B;
	const maxCall = niceMax(Math.max(...data.map((d) => d.total)));
	const maxCost = niceMax(Math.max(...data.map((d) => d.cost), 0.0001));
	const bw = Math.max(3, Math.min(46, (iw / data.length) * 0.62));
	const cx = (i: number) => L + (iw / data.length) * (i + 0.5);
	const yCall = (v: number) => T + ih - (v / maxCall) * ih;
	const yCost = (v: number) => T + ih - (v / maxCost) * ih;

	const grid = [0, 0.25, 0.5, 0.75, 1]
		.map((f) => {
			const y = T + ih - f * ih;
			return `<line x1="${L}" y1="${y.toFixed(1)}" x2="${L + iw}" y2="${y.toFixed(1)}" class="gl"/>` +
				`<text x="${L - 8}" y="${(y + 4).toFixed(1)}" class="ax end">${shortNum(Math.round(maxCall * f))}</text>` +
				`<text x="${L + iw + 8}" y="${(y + 4).toFixed(1)}" class="ax cst">$${(maxCost * f).toFixed(maxCost < 0.1 ? 4 : 2)}</text>`;
		})
		.join("");

	const bars = data
		.map((d, i) => {
			const x = cx(i) - bw / 2;
			const okH = ((d.ok / maxCall) * ih) || 0;
			const erH = ((d.error / maxCall) * ih) || 0;
			const okY = T + ih - okH;
			const erY = okY - erH;
			const title = `${d.b}\n호출 ${d.total.toLocaleString()} · 성공 ${d.ok.toLocaleString()} · 실패 ${d.error.toLocaleString()}\n토큰 ${d.tokens.toLocaleString()} · 비용 ${usd(d.cost)}`;
			return `<g class="bg"><title>${escapeHtml(title)}</title>` +
				`<rect x="${x.toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${ih}" class="hit"/>` +
				`<rect x="${x.toFixed(1)}" y="${okY.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(okH, d.ok ? 1.5 : 0).toFixed(1)}" rx="2" class="b-ok"/>` +
				(d.error ? `<rect x="${x.toFixed(1)}" y="${erY.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(erH, 1.5).toFixed(1)}" rx="2" class="b-er"/>` : "") +
				`</g>`;
		})
		.join("");

	const line = data.map((d, i) => `${cx(i).toFixed(1)},${yCost(d.cost).toFixed(1)}`).join(" ");
	const dots = data.map((d, i) => `<circle cx="${cx(i).toFixed(1)}" cy="${yCost(d.cost).toFixed(1)}" r="2.6" class="cd"/>`).join("");

	// x축 라벨 — 겹치지 않게 일정 간격으로만
	const step = Math.max(1, Math.ceil(data.length / 9));
	const xlab = data
		.map((d, i) => (i % step === 0 || i === data.length - 1
			? `<text x="${cx(i).toFixed(1)}" y="${H - 9}" class="ax mid">${escapeHtml(d.b.replace(/^\d{4}-/, ""))}</text>`
			: ""))
		.join("");

	return `<div class="chart">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="기간별 호출·비용 추이">
${grid}${bars}<polyline points="${line}" class="cl"/>${dots}${xlab}
</svg>
<div class="lg"><span class="k"><i class="s-ok"></i>성공</span><span class="k"><i class="s-er"></i>실패</span><span class="k"><i class="s-ct"></i>비용(오른쪽 축)</span></div>
</div>`;
}

/** 가로 비중 막대 — 앱·모델처럼 항목이 적은 분포에 쓴다. */
function svgShare(rows: { label: string; value: number; sub: string }[], unitLabel: string): string {
	if (!rows.length) return `<div class="empty">데이터 없어요.</div>`;
	const total = rows.reduce((a, b) => a + b.value, 0) || 1;
	return `<div class="shares">${rows
		.slice(0, 6)
		.map((r, i) => {
			const pct = (r.value / total) * 100;
			return `<div class="sh"><div class="sh-t"><span>${escapeHtml(r.label)}</span>` +
				`<span class="sh-v">${r.value.toLocaleString()}${unitLabel} <b>${pct.toFixed(pct < 10 ? 1 : 0)}%</b></span></div>` +
				`<div class="sh-b"><span style="width:${pct.toFixed(1)}%;background:${SHARE_COLORS[i % SHARE_COLORS.length]}"></span></div>` +
				(r.sub ? `<div class="sh-s">${escapeHtml(r.sub)}</div>` : "") +
				`</div>`;
		})
		.join("")}</div>`;
}
const SHARE_COLORS = ["#925FF0", "#C85A95", "#35A7FF", "#44AB42", "#F0A93B", "#7A7590"];

/** 세계 지도 — 육지 외곽선 위에 도시별 호출량을 원으로 얹는다. */
function svgMap(points: StatsSummary["points"], unknown: number): string {
	const max = Math.max(1, ...points.map((p) => p.total));
	const bubbles = points
		.map((p) => {
			const { x, y } = projectLonLat(p.lon, p.lat);
			const r = 4 + Math.sqrt(p.total / max) * 16;
			const title = `${countryName(p.country)}${p.city && p.city !== "-" ? ` · ${p.city}` : ""}\n호출 ${p.total.toLocaleString()} · 고유 IP ${p.ips.toLocaleString()} · 비용 ${usd(p.cost)}`;
			return `<g class="bub"><title>${escapeHtml(title)}</title>` +
				`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" class="bo"/>` +
				`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(1.8, r * 0.26).toFixed(1)}" class="bi"/></g>`;
		})
		.join("");
	return `<div class="mapwrap">
<svg viewBox="0 0 ${MAP_W} ${MAP_H}" role="img" aria-label="호출 지역 지도">
<rect width="${MAP_W}" height="${MAP_H}" class="sea"/>
<path d="${WORLD_PATH}" class="land"/>
${bubbles}
</svg>
${points.length ? "" : `<div class="mapempty">아직 좌표가 있는 호출이 없어요.</div>`}
</div>
<p class="sm" style="margin:8px 2px 0">원 크기는 호출량이에요. 마우스를 올리면 지역·호출 수를 볼 수 있어요.${unknown ? ` 좌표가 없는 호출 ${unknown.toLocaleString()}건은 지도에 표시되지 않아요(이전 기록·미상 지역).` : ""}</p>`;
}

export function renderDashboard(s: StatsSummary, opts: AdminOpts = {}): string {
	const okRate = s.total ? Math.round((s.ok / s.total) * 100) : 0;
	const maxB = Math.max(1, ...s.buckets.map((b) => b.total));
	const maxCountry = Math.max(1, ...s.byCountry.map((c) => c.total));
	const q = (p: string, a: string) => `/admin?period=${p}${a ? `&app=${encodeURIComponent(a)}` : ""}`;

	const periodTabs = Object.entries(PERIODS)
		.map(([k, v]) => `<a class="tab${k === s.period ? " on" : ""}" href="${q(k, s.appFilter)}">${v.label}</a>`)
		.join("");
	const appTabs =
		`<a class="tab${!s.appFilter ? " on" : ""}" href="${q(s.period, "")}">전체 앱</a>` +
		s.apps.map((a) => `<a class="tab${s.appFilter === a.id ? " on" : ""}" href="${q(s.period, a.id)}">${escapeHtml(a.name)}${a.active ? "" : " (중지)"}</a>`).join("");

	const mini = (l: string, v: string, tone = "") =>
		`<div class="m"><div class="l">${l}</div><div class="v ${tone}">${v}</div></div>`;

	const bucketLabel = PERIODS[s.period]?.bucket === "day" ? "일" : PERIODS[s.period]?.bucket === "week" ? "주" : "월";

	// 호출 수 카드 안 미니 그래프 — 축·라벨 없이 흐름만 보여준다.
	const sparkData = s.buckets.slice(0, 24).slice().reverse();
	const sparkMax = Math.max(1, ...sparkData.map((b) => b.total));
	const spark = sparkData.length
		? `<svg viewBox="0 0 100 24" preserveAspectRatio="none">` +
			sparkData
				.map((b, i) => {
					const w = 100 / sparkData.length;
					const h = Math.max(b.total ? 1.5 : 0, (b.total / sparkMax) * 22);
					return `<rect x="${(i * w + w * 0.15).toFixed(2)}" y="${(24 - h).toFixed(2)}" width="${(w * 0.7).toFixed(2)}" height="${h.toFixed(2)}" rx="0.8"/>`;
				})
				.join("") +
			`</svg>`
		: "";

	const countryCount = s.byCountry.filter((c) => c.key !== "(미상)").length;

	const appRows = s.byApp.length
		? s.byApp.map((r) =>
				`<tr><td>${escapeHtml(r.name)}<br><span class="mono">${escapeHtml(r.key)}</span></td>` +
				`<td class="n">${r.total.toLocaleString()}</td><td class="n g">${r.ok.toLocaleString()}</td><td class="n r">${r.error.toLocaleString()}</td>` +
				`<td class="n">${(r.inTok + r.outTok).toLocaleString()}</td><td class="n">${usd(r.cost)}</td>` +
				`<td class="n">${r.total ? Math.round(r.latency / r.total) : 0}ms</td>` +
				`<td class="n">${r.total ? usd(r.cost / r.total) : "-"}</td></tr>`,
			).join("")
		: `<tr><td colspan="8">데이터 없음</td></tr>`;

	const modelRows = s.byModel.length
		? s.byModel.map((r) =>
				`<tr><td class="mono">${escapeHtml(r.key)}${MODEL_PRICES[r.key] ? "" : " *"}</td>` +
				`<td class="n">${r.total.toLocaleString()}</td><td class="n">${r.inTok.toLocaleString()}</td>` +
				`<td class="n">${r.outTok.toLocaleString()}</td><td class="n">${usd(r.cost)}</td></tr>`,
			).join("")
		: `<tr><td colspan="5">데이터 없음</td></tr>`;

	const kindRows = s.byKind.length
		? s.byKind.map((r) =>
				`<tr><td>${escapeHtml(r.key)}</td><td class="n">${r.total.toLocaleString()}</td>` +
				`<td class="n g">${r.ok.toLocaleString()}</td><td class="n r">${r.error.toLocaleString()}</td>` +
				`<td class="n">${(r.inTok + r.outTok).toLocaleString()}</td><td class="n">${usd(r.cost)}</td></tr>`,
			).join("")
		: `<tr><td colspan="6">데이터 없음</td></tr>`;

	const bucketRows = s.buckets.length
		? s.buckets.map((b) =>
				`<tr><td>${b.b}</td><td class="bar"><span style="width:${Math.round((b.total / maxB) * 100)}%"></span></td>` +
				`<td class="n">${b.total.toLocaleString()}</td><td class="n g">${b.ok.toLocaleString()}</td>` +
				`<td class="n r">${b.error.toLocaleString()}</td><td class="n">${b.tokens.toLocaleString()}</td>` +
				`<td class="n">${usd(b.cost)}</td></tr>`,
			).join("")
		: `<tr><td colspan="7">데이터 없음</td></tr>`;

	const errRows = s.errors.length
		? s.errors.map((e) => `<tr><td class="n">${e.http ?? "-"}</td><td class="n">${e.count.toLocaleString()}</td><td class="err">${e.sample ? escapeHtml(e.sample) : ""}</td></tr>`).join("")
		: `<tr><td colspan="3">실패 없음</td></tr>`;

	const metaRows = s.metaKeys.length
		? s.metaKeys.map((m) =>
				`<tr><td class="mono">${escapeHtml(m.key)}</td><td class="n">${m.total.toLocaleString()}</td><td>` +
				m.values.map((v) => `<span class="chip">${escapeHtml(v.v)} ${Math.round((v.c / m.total) * 100)}%</span>`).join(" ") +
				`</td></tr>`,
			).join("")
		: `<tr><td colspan="3">앱이 보낸 메타 데이터가 아직 없어요</td></tr>`;

	const countryRows = s.byCountry.length
		? s.byCountry.map((r) =>
				`<tr><td>${escapeHtml(countryName(r.key))}</td><td class="n">${r.total.toLocaleString()}</td>` +
				`<td class="n g">${r.ok.toLocaleString()}</td><td class="n r">${r.error.toLocaleString()}</td>` +
				`<td class="n">${r.ips.toLocaleString()}</td>` +
				`<td class="n">${(r.inTok + r.outTok).toLocaleString()}</td><td class="n">${usd(r.cost)}</td>` +
				`<td class="n">${r.total ? Math.round(r.latency / r.total) : 0}ms</td>` +
				`<td class="bar"><span style="width:${Math.round((r.total / maxCountry) * 100)}%"></span></td></tr>`,
			).join("")
		: `<tr><td colspan="9">데이터 없음</td></tr>`;

	const regionRows = s.byRegion.length
		? s.byRegion.map((r) =>
				`<tr><td>${escapeHtml(countryName(r.country))}</td><td>${escapeHtml(r.region)}</td>` +
				`<td>${escapeHtml(r.city)}</td><td class="n">${r.total.toLocaleString()}</td>` +
				`<td class="n g">${r.ok.toLocaleString()}</td><td class="n r">${r.error.toLocaleString()}</td>` +
				`<td class="n">${r.ips.toLocaleString()}</td>` +
				`<td class="n">${r.tokens.toLocaleString()}</td><td class="n">${usd(r.cost)}</td></tr>`,
			).join("")
		: `<tr><td colspan="9">데이터 없음</td></tr>`;

	const recentRows = s.recent.length
		? s.recent.map((r) =>
				`<tr><td>${kst(r.ts)}</td><td>${escapeHtml(r.app)}</td><td>${escapeHtml(r.kind)}</td>` +
				`<td class="mono">${escapeHtml((r.model ?? "-").replace(/^[^/]+\//, ""))}</td>` +
				`<td class="${r.status === "ok" ? "g" : "r"}">${r.status}</td><td class="n">${r.http ?? "-"}</td>` +
				`<td class="n">${r.latency_ms}ms</td><td class="n">${r.tokens.toLocaleString()}</td><td class="n">${usd(r.cost)}</td>` +
				`<td>${escapeHtml(r.country)}${r.city ? `<br><span class="sm">${escapeHtml(r.city)}</span>` : r.region ? `<br><span class="sm">${escapeHtml(r.region)}</span>` : ""}</td>` +
				`<td class="err">${escapeHtml(r.err ?? r.meta ?? "")}</td></tr>`,
			).join("")
		: `<tr><td colspan="11">데이터 없음</td></tr>`;

	// kst()는 "MM-DD HH:MM:SS" — 날짜만 쓴다(8자로 자르면 "08-02 13"처럼 시각이 잘려 나온다).
	const sinceLabel = s.since ? `${kst(s.since).slice(0, 5)} 이후` : "전체 기간";

	return shellAdmin(
		"AI 호출 통계",
		`<div class="head">
  <div class="ht">
    <h1>AI 호출 통계</h1>
    <p class="sub">앱별 AI 프록시 사용량 · ${sinceLabel}</p>
  </div>
  <div class="clock" id="hz-clock" data-app="${escapeHtml(s.appFilter)}">
    <div class="tw">
      <div class="t" id="hz-time">--:--:--</div>
      <div class="d" id="hz-date">KST</div>
    </div>
    <button type="button" class="live" id="hz-live" title="끄면 화면을 자동으로 다시 그리지 않아요"><i></i><span id="hz-live-t">자동 갱신</span></button>
  </div>
</div>
<div id="hz-body">
<div class="tabs">${periodTabs}<span style="flex:1"></span><a class="tab alt" href="/admin/stats.json?period=${s.period}${s.appFilter ? `&app=${encodeURIComponent(s.appFilter)}` : ""}">JSON</a></div>
<div class="tabs">${appTabs}</div>
<div class="kpi">
  <div class="k1">
    <div class="l">호출 수</div>
    <div class="v">${s.total.toLocaleString()}<span class="u">건</span></div>
    <div class="s">${s.error ? `<b class="r">실패 ${s.error.toLocaleString()}건</b> · ` : ""}성공률 ${okRate}%</div>
    <div class="spark">${spark}</div>
  </div>
  <div class="k1">
    <div class="l">예상 비용</div>
    <div class="v">${usd(s.cost)}</div>
    <div class="s">${s.total ? `호출당 ${usd(s.cost / s.total)}` : "호출 없음"}</div>
    <div class="meter"><span style="width:${Math.min(100, Math.round((s.inTokens / Math.max(1, s.inTokens + s.outTokens)) * 100))}%"></span></div>
    <div class="s2">입력 ${shortNum(s.inTokens)} · 출력 ${shortNum(s.outTokens)} 토큰</div>
  </div>
  <div class="k1">
    <div class="l">평균 지연</div>
    <div class="v">${s.avgLatency.toLocaleString()}<span class="u">ms</span></div>
    <div class="s">p95 ${s.p95Latency.toLocaleString()}ms</div>
    <div class="meter lat"><span style="width:${Math.min(100, Math.round((s.avgLatency / Math.max(1, s.p95Latency)) * 100))}%"></span></div>
    <div class="s2">가장 느린 5%는 ${s.p95Latency.toLocaleString()}ms를 넘어요</div>
  </div>
</div>
<div class="kpi2">
${mini("성공", s.ok.toLocaleString(), "g")}
${mini("실패", s.error.toLocaleString(), s.error ? "r" : "")}
${mini("입력 토큰", s.inTokens.toLocaleString())}
${mini("출력 토큰", s.outTokens.toLocaleString())}
${mini("고유 IP", s.uniqueIPs.toLocaleString())}
${mini("국가 수", String(countryCount), countryCount ? countryName(s.byCountry[0].key) : "")}
</div>

<h2>추이 (${bucketLabel} 단위)</h2>
${svgTrend(s.buckets)}

<h2>호출 지역</h2>
${svgMap(s.points, s.geoUnknown)}

<div class="two">
  <section><h2>앱별 비중</h2>${svgShare(s.byApp.map((r) => ({ label: r.name, value: r.total, sub: `${usd(r.cost)} · ${(r.inTok + r.outTok).toLocaleString()} 토큰` })), "건")}</section>
  <section><h2>모델별 비중</h2>${svgShare(s.byModel.map((r) => ({ label: r.key.replace(/^[^/]+\//, ""), value: r.total, sub: `${usd(r.cost)} · ${(r.inTok + r.outTok).toLocaleString()} 토큰` })), "건")}</section>
</div>
<h2>앱별</h2>
<table><tr><th>앱</th><th class="n">호출</th><th class="n">성공</th><th class="n">실패</th><th class="n">토큰</th><th class="n">비용</th><th class="n">평균 지연</th><th class="n">호출당 비용</th></tr>${appRows}</table>
<h2>모델별</h2>
<table><tr><th>모델</th><th class="n">호출</th><th class="n">입력 토큰</th><th class="n">출력 토큰</th><th class="n">비용</th></tr>${modelRows}</table>
<h2>용도별</h2>
<table><tr><th>용도</th><th class="n">호출</th><th class="n">성공</th><th class="n">실패</th><th class="n">토큰</th><th class="n">비용</th></tr>${kindRows}</table>
<h2>추이 상세</h2>
<table><tr><th>구간</th><th>비중</th><th class="n">호출</th><th class="n">성공</th><th class="n">실패</th><th class="n">토큰</th><th class="n">비용</th></tr>${bucketRows}</table>
<h2>국가별</h2>
<table><tr><th>국가</th><th class="n">호출</th><th class="n">성공</th><th class="n">실패</th><th class="n">고유 IP</th><th class="n">토큰</th><th class="n">비용</th><th class="n">평균 지연</th><th>비중</th></tr>${countryRows}</table>
<h2>지역 · 도시별 (상위 20)</h2>
<table><tr><th>국가</th><th>지역</th><th>도시</th><th class="n">호출</th><th class="n">성공</th><th class="n">실패</th><th class="n">고유 IP</th><th class="n">토큰</th><th class="n">비용</th></tr>${regionRows}</table>
<h2>실패 분석</h2>
<table><tr><th class="n">HTTP</th><th class="n">건수</th><th>대표 메시지</th></tr>${errRows}</table>
<h2>앱이 보낸 메타 데이터 (최근 500건)</h2>
<table><tr><th>키</th><th class="n">건수</th><th>상위 값</th></tr>${metaRows}</table>
<h2>최근 호출 (50건)</h2>
<table><tr><th>시각</th><th>앱</th><th>용도</th><th>모델</th><th>상태</th><th class="n">HTTP</th><th class="n">지연</th><th class="n">토큰</th><th class="n">비용</th><th>지역</th><th>오류 · 메타</th></tr>${recentRows}</table>
<p class="foot">국가·지역은 Cloudflare가 요청에 붙여주는 값이라 외부 조회 없이 기록돼요. VPN·통신사 경로에 따라 실제와 다를 수 있어요.<br>비용은 실제 호출한 모델의 단가로 추정한 값이에요(* = 단가 미등록 모델, 기본 단가로 추정). 최종 청구액은 OpenRouter 대시보드가 기준이에요.<br>이 페이지는 색인되지 않아요. 로그인한 관리자만 볼 수 있어요.</p>
</div>`,
		{ ...opts, tab: "stats" },
	);
}

// ─────────────────────────────────────────────────────────────
// 앱 관리 화면
// ─────────────────────────────────────────────────────────────
export function renderApps(apps: AppConfig[], opts: AdminOpts = {}): string {
	const rows = apps.length
		? apps.map((a) => `
<tr>
  <td><b>${escapeHtml(a.name)}</b><br><span class="mono">${escapeHtml(a.id)}</span>
      ${a.active ? "" : '<br><span class="chip" style="background:#ffecec;color:#c0392b">중지됨</span>'}
      ${a.note ? `<br><span style="font-size:11px;color:#6b7280">${escapeHtml(a.note)}</span>` : ""}</td>
  <td class="mono" style="word-break:break-all;max-width:230px">${escapeHtml(a.token)}<button type="button" class="copy" data-copy="${escapeHtml(a.token)}">복사</button></td>
  <td class="mono" style="max-width:260px;word-break:break-all">${escapeHtml(JSON.stringify(a.models))}</td>
  <td class="n">${a.perMin} / ${a.perDay}</td>
  <td>
    <form class="inline" method="post" action="/admin/apps">
      <input type="hidden" name="action" value="toggle"><input type="hidden" name="id" value="${escapeHtml(a.id)}">
      <button class="btn" type="submit">${a.active ? "중지" : "재개"}</button>
    </form>
    <form class="inline" method="post" action="/admin/apps"
          data-confirm-title="${escapeHtml(a.name)} 토큰을 새로 발급할까요?"
          data-confirm="지금 토큰은 즉시 막혀요. 앱에 새 토큰을 넣기 전까지 호출이 실패해요."
          data-confirm-ok="재발급" data-danger="1">
      <input type="hidden" name="action" value="regen"><input type="hidden" name="id" value="${escapeHtml(a.id)}">
      <button class="btn" type="submit">토큰 재발급</button>
    </form>
    <form class="inline" method="post" action="/admin/apps"
          data-confirm-title="${escapeHtml(a.name)} 앱을 삭제할까요?"
          data-confirm="토큰이 즉시 무효가 되고 이 앱은 더 이상 호출할 수 없어요. 지난 호출 기록은 통계에 그대로 남아요."
          data-confirm-ok="삭제" data-danger="1">
      <input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${escapeHtml(a.id)}">
      <button class="btn d" type="submit">삭제</button>
    </form>
  </td>
</tr>
<tr><td colspan="5" style="background:#fafbfc">
  <form method="post" action="/admin/apps">
    <input type="hidden" name="action" value="save"><input type="hidden" name="id" value="${escapeHtml(a.id)}">
    <div class="grid2">
      <div class="fld"><label>이름</label><input name="name" value="${escapeHtml(a.name)}"></div>
      <div class="fld"><label>메모</label><input name="note" value="${escapeHtml(a.note ?? "")}"></div>
    </div>
    <div class="fld"><label>용도별 모델 (JSON) — 키는 앱이 보내는 X-Ai-Kind 값, default는 기본값</label>
      <textarea name="models" rows="3">${escapeHtml(JSON.stringify(a.models, null, 0))}</textarea></div>
    <div class="grid2">
      <div class="fld"><label>분당 상한 (IP 기준)</label><input class="n" name="per_min" value="${a.perMin}"></div>
      <div class="fld"><label>일일 상한 (IP 기준)</label><input class="n" name="per_day" value="${a.perDay}"></div>
    </div>
    <button class="btn p" type="submit">저장</button>
  </form>
</td></tr>`).join("")
		: `<tr><td colspan="5">등록된 앱이 없어요. 아래에서 추가하세요.</td></tr>`;

	const known = Object.keys(MODEL_PRICES).map((m) => `<span class="chip">${escapeHtml(m)}</span>`).join(" ");

	return shellAdmin(
		"앱 관리",
		`<h1>앱 관리</h1>
<p class="sub">앱 1개 = 토큰 1개. 앱은 이 토큰으로 <span class="mono">POST /v1/ai</span>를 호출하고, 통계는 자동으로 앱별로 쌓여요.<br>새로 추가하거나 재발급한 토큰은 몇 초 뒤부터 동작해요.</p>
<table><tr><th>앱</th><th>토큰</th><th>모델 맵</th><th class="n">분/일 상한</th><th>동작</th></tr>${rows}</table>

<h2>새 앱 추가</h2>
<div class="panel">
  <form method="post" action="/admin/apps">
    <input type="hidden" name="action" value="create">
    <div class="grid2">
      <div class="fld"><label>앱 id (영문·숫자·하이픈)</label><input name="id" placeholder="my-app" required></div>
      <div class="fld"><label>이름</label><input name="name" placeholder="내 앱" required></div>
    </div>
    <div class="fld"><label>용도별 모델 (JSON)</label>
      <textarea name="models" rows="3">{"default":"${DEFAULT_MODEL}"}</textarea></div>
    <div class="grid2">
      <div class="fld"><label>분당 상한</label><input class="n" name="per_min" value="20"></div>
      <div class="fld"><label>일일 상한</label><input class="n" name="per_day" value="300"></div>
    </div>
    <div class="fld"><label>메모</label><input name="note" placeholder="용도·비고"></div>
    <button class="btn p" type="submit">추가 (토큰 자동 발급)</button>
  </form>
</div>

<h2>앱이 호출하는 방법</h2>
<div class="panel mono" style="font-size:12px;white-space:pre-wrap;line-height:1.7">POST https://ai.zerolive.co.kr/v1/ai          ← 채팅 · 비전 · 웹검색
POST https://ai.zerolive.co.kr/v1/embeddings  ← 임베딩(엔드포인트가 다름)

Authorization: Bearer &lt;앱 토큰&gt;
X-Ai-Kind: weight            ← 위 모델 맵의 키 (없으면 default)
Content-Type: application/json

{
  "messages": [ ... ],       ← OpenAI 형식. Gemini 형식(contents)도 그대로 받아요.
  "model": "google/gemini-2.5-pro",        ← 선택. 모델 제한 없음(카탈로그 전체)
  "plugins": [{"id":"web"}],               ← 선택. 웹검색(모델명 :online 과 같음)
  "meta": { "ver":"1.2.0", "screen":"scan" }   ← 선택. 통계에 그대로 쌓여요.
}</div>
<p class="foot">모델은 제한하지 않아요 — <a href="https://openrouter.ai/models" target="_blank" rel="noopener">OpenRouter 카탈로그</a>의 이름을 그대로 쓰면 돼요(목록: <span class="mono">GET /admin/api/models</span>).<br>비용은 OpenRouter가 응답에 실어주는 실제 청구액(웹검색 요금 포함)으로 기록해요. 값이 없는 과거 기록만 단가표로 추정해요: ${known}</p>`,
		{ ...opts, tab: "apps" },
	);
}
