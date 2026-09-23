/**
 * 앱 수익 — App Store 판매·다운로드와 AdMob 광고 수익을 하루 한 번 받아 둔다.
 *
 * 왜 받아 두나. 두 곳 다 "지금 이 순간"을 주지 않는다. Apple 은 하루가 끝난 뒤
 * 보고서를 만들고, AdMob 은 네 시간쯤 늦는다. 화면을 열 때마다 물으면 느리고,
 * 남의 서비스가 멎으면 우리 화면까지 안 열린다. 그래서 하루 한 번 끌어와 D1 에 두고
 * 화면은 우리 표만 읽는다(이상탐지·트래픽과 같은 방식이다).
 *
 * 받는 곳
 *   App Store Connect  GET /v1/salesReports   (JWT ES256 · gzip TSV · 하루치씩)
 *   AdMob              POST networkReport:generate (OAuth 사람 계정 · 기간 통째로)
 *
 * 시간대가 서로 다르다. Apple 보고서의 하루는 미국 태평양시고, AdMob 계정은
 * Asia/Seoul 로 맞춰져 있다. 날짜 문자열을 그대로 키로 쓰되 화면에 그 사실을 적는다.
 */

import type { D1Database } from "@cloudflare/workers-types";

export interface RevenueEnv {
	DB: D1Database;
	/** App Store Connect API — 사용자 및 액세스 → 통합 에서 받는다. */
	ASC_ISSUER_ID?: string;
	ASC_KEY_ID?: string;
	/** .p8 개인키. PEM 통째로 넣어도 되고 본문(base64)만 넣어도 된다. */
	ASC_P8?: string;
	/** 결제 및 재무 보고서 화면의 벤더 번호(8자리). */
	ASC_VENDOR?: string;
	/** AdMob 게시자 id — pub-0000000000000000 */
	ADMOB_PUB_ID?: string;
	ADMOB_CLIENT_ID?: string;
	ADMOB_CLIENT_SECRET?: string;
	/** 사람 계정 동의로 한 번 받아 둔 값. AdMob API 는 서비스 계정을 받지 않는다. */
	ADMOB_REFRESH_TOKEN?: string;
}

// ─────────────────────────────────────────────────────────────
// 앱 목록
//
// 한 앱이 세 곳에서 다른 이름으로 불린다. App Store 는 숫자(Apple Identifier),
// AdMob 은 ca-app-pub-…~… 꼴의 id, 우리 대시보드는 사람이 읽는 키다.
// 이름으로 맞추면 안 된다 — 실제로 '햄찌 다이어트'가 App Store 에서 제목 두 개로
// 갈려 있었고(이름을 바꾼 흔적), AdMob 에는 긴 쪽 이름만 있다.
// 그래서 바뀌지 않는 번호로 묶는다.
//
// 새 앱을 내면 여기 한 줄을 더한다. 빠뜨리면 화면 맨 아래 '아직 묶지 않은 앱'에
// 그대로 뜨므로 숫자가 사라지지는 않는다.
// ─────────────────────────────────────────────────────────────
export interface RevenueApp {
	/** 화면·주소에 쓰는 키 */
	key: string;
	name: string;
	/** Apple Identifier. 없으면 App Store 에 없는 앱이다. */
	store: string | null;
	/**
	 * App Store 의 SKU. 인앱 결제를 부모 앱에 붙이는 데만 쓴다 —
	 * 인앱 항목은 자기 Apple Identifier 를 따로 갖고, 부모는 번호가 아니라 SKU 로 가리킨다.
	 */
	sku: string | null;
	/** AdMob 앱 id. 광고를 안 붙인 앱은 null. */
	admob: string | null;
	/** 짝이 되는 트래픽 서비스(SITES). 랜딩이 없는 앱은 null. */
	site: string | null;
	platform: "iOS" | "macOS";
}

export const REVENUE_APPS: RevenueApp[] = [
	{ key: "hamzzi-diet", name: "햄찌 다이어트", store: "6806743562", sku: "hamzzi-diet", admob: "ca-app-pub-4410880415888380~9055404492", site: "hamzzi-diet", platform: "iOS" },
	{ key: "wander", name: "Wandery", store: "6759185541", sku: "Wander", admob: "ca-app-pub-4410880415888380~3969474369", site: "wander", platform: "iOS" },
	{ key: "golf", name: "라운드온", store: "6776994717", sku: "kr.zerolive.golf.roundon", admob: "ca-app-pub-4410880415888380~3919343525", site: "golf", platform: "iOS" },
	{ key: "lnhud", name: "LnHud", store: "6762333462", sku: "LnHud", admob: null, site: "lnhud", platform: "macOS" },
	{ key: "md-editor", name: "MarkChartEditor", store: "6756916654", sku: "com.zerolive.MarkdownEditor", admob: null, site: "md-editor", platform: "macOS" },
	{ key: "zero-player", name: "zeroPlayer", store: "1610259595", sku: "cloudRadio", admob: null, site: null, platform: "iOS" },
	{ key: "mini-calendar", name: "CalendarMiniBar", store: "6756901223", sku: "com.zerolive.MiniCalendar", admob: null, site: null, platform: "macOS" },
	{ key: "secret-rotto", name: "SimpleSecretRotto", store: "6740446215", sku: "com.zerolive.SimpleSecretRotto", admob: null, site: null, platform: "iOS" },
];

const byStore = new Map(REVENUE_APPS.filter((a) => a.store).map((a) => [a.store as string, a]));
const byAdmob = new Map(REVENUE_APPS.filter((a) => a.admob).map((a) => [a.admob as string, a]));
const bySku = new Map(REVENUE_APPS.filter((a) => a.sku).map((a) => [a.sku as string, a]));
export const revenueApp = (key: string): RevenueApp | undefined => REVENUE_APPS.find((a) => a.key === key);

/**
 * 내려받기 종류 — Apple 이 한 칸에 코드로 적어 준다.
 *
 *   1 · 1F · 1T · 1E… · F1   처음 받은 것      (첫 설치)
 *   3 · 3F · 3T · F3         다시 받은 것      (같은 사람이 기기를 바꾸거나 지웠다 재설치)
 *   7 · F7                   업데이트          (이미 쓰던 사람)
 *
 * 앞 글자만 보면 갈린다. F 로 시작하면 맥이고 그다음 숫자가 종류다.
 * 인앱 결제(IA…·FI…)는 설치가 아니라 매출이라 셋 중 어디에도 넣지 않는다.
 */
export function unitKind(pt: string): "install" | "redownload" | "update" | "" {
	const t = (pt || "").trim().toUpperCase();
	if (!t) return "";
	const n = t.startsWith("F") ? t.slice(1, 2) : t.slice(0, 1);
	if (t.startsWith("IA") || t.startsWith("FI")) return "";
	if (n === "1") return "install";
	if (n === "3") return "redownload";
	if (n === "7") return "update";
	return "";
}

// ─────────────────────────────────────────────────────────────
// App Store Connect — JWT ES256
// ─────────────────────────────────────────────────────────────

const b64url = (buf: ArrayBuffer | Uint8Array): string => {
	const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let bin = "";
	for (const b of u8) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** PEM 이든 본문만이든 받아 pkcs8 바이트로 만든다. */
function pkcs8Of(p8: string): Uint8Array {
	const body = p8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
	return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/**
 * Apple 이 요구하는 토큰. 20분짜리로 만들어 그 자리에서 쓰고 버린다.
 * WebCrypto 의 ECDSA 서명은 r‖s 64바이트로 나오는데 JWT ES256 이 쓰는 형식과 같아서
 * 따로 바꿀 것이 없다(패스키 쪽은 반대로 DER 로 와서 변환이 필요했다).
 */
async function ascToken(env: RevenueEnv): Promise<string> {
	const key = await crypto.subtle.importKey(
		"pkcs8",
		pkcs8Of(env.ASC_P8 ?? "") as unknown as BufferSource,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	);
	const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: env.ASC_KEY_ID, typ: "JWT" })));
	const body = b64url(
		new TextEncoder().encode(
			JSON.stringify({ iss: env.ASC_ISSUER_ID, exp: Math.floor(Date.now() / 1000) + 1200, aud: "appstoreconnect-v1" }),
		),
	);
	const signed = `${head}.${body}`;
	const sig = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		new TextEncoder().encode(signed) as unknown as BufferSource,
	);
	return `${signed}.${b64url(sig)}`;
}

/** 응답이 gzip 이면 풀고 아니면 그대로 읽는다. Apple 은 헤더 없이 압축본을 준다. */
async function readMaybeGzip(resp: Response): Promise<string> {
	const buf = new Uint8Array(await resp.arrayBuffer());
	if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
		const ds = new DecompressionStream("gzip");
		const w = ds.writable.getWriter();
		void w.write(buf as unknown as BufferSource);
		void w.close();
		return await new Response(ds.readable as unknown as ReadableStream).text();
	}
	return new TextDecoder().decode(buf);
}

export interface StoreRow {
	d: string; appId: string; country: string;
	installs: number; redownloads: number; updates: number;
	proceeds: number; currency: string;
}

/**
 * 하루치 판매 보고서. 그날 아무 일도 없었으면 Apple 이 404 를 준다 — 오류가 아니다.
 * 한 행이 (앱 · 나라 · 종류 · 통화) 하나라서 여기서 날짜·앱·나라·통화로 접는다.
 *
 * 금액은 통화를 섞지 않는다. Developer Proceeds 는 그 나라 통화로 오고
 * (실제로 원화·즈워티·달러 셋이 함께 들어왔다), 환율을 지어내 합치면
 * 화면의 숫자가 어느 것도 아닌 값이 된다.
 */
export async function fetchStoreDay(env: RevenueEnv, token: string, day: string): Promise<StoreRow[]> {
	const url =
		"https://api.appstoreconnect.apple.com/v1/salesReports?filter[reportType]=SALES" +
		`&filter[reportSubType]=SUMMARY&filter[frequency]=DAILY&filter[reportDate]=${day}` +
		`&filter[vendorNumber]=${encodeURIComponent(env.ASC_VENDOR ?? "")}&filter[version]=1_1`;
	const resp = await fetch(url, {
		headers: { Authorization: `Bearer ${token}`, Accept: "application/a-gzip" },
		signal: AbortSignal.timeout(30_000),
	});
	if (resp.status === 404) return [];       // 그날 판매 없음
	if (!resp.ok) throw new Error(`App Store ${day} ${resp.status} ${(await resp.text()).slice(0, 200)}`);

	const text = await readMaybeGzip(resp);
	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	if (lines.length < 2) return [];
	// 칸 순서가 바뀌어도 버티도록 이름으로 찾는다.
	const head = lines[0].split("\t").map((h) => h.trim());
	const at = (name: string) => head.indexOf(name);
	const iId = at("Apple Identifier"), iCc = at("Country Code"), iPt = at("Product Type Identifier");
	const iUn = at("Units"), iPr = at("Developer Proceeds"), iCu = at("Currency of Proceeds");
	const iPa = at("Parent Identifier");
	if (iId < 0 || iCc < 0 || iPt < 0 || iUn < 0) throw new Error(`App Store ${day} 보고서 형식을 모르겠어요.`);

	const acc = new Map<string, StoreRow>();
	for (const line of lines.slice(1)) {
		const c = line.split("\t");
		let appId = (c[iId] ?? "").trim();
		if (!appId) continue;
		// 인앱 결제는 자기 번호를 따로 갖는다(MarkChartEditor 의 'Quick Look Premium' 처럼).
		// 그대로 두면 앱 목록에 없는 낯선 번호로 뜨고 그 돈이 앱에 붙지 않는다.
		// 부모는 번호가 아니라 SKU 로 적혀 오므로 SKU 로 찾아 부모 번호에 얹는다.
		const parent = iPa >= 0 ? (c[iPa] ?? "").trim() : "";
		if (parent) {
			const pa = bySku.get(parent);
			if (pa?.store) appId = pa.store;
		}
		const units = Number(c[iUn] ?? 0) || 0;
		const per = Number(c[iPr] ?? 0) || 0;
		const cur = (c[iCu] ?? "").trim();
		const country = (c[iCc] ?? "").trim().toUpperCase() || "(미상)";
		// 돈이 0이면 통화 칸이 비어 온다. 빈 문자열을 그대로 키에 쓰면 무료 행이 통화별로
		// 쪼개지지 않고 한 줄로 모여서 오히려 깔끔하다.
		const key = `${appId}|${country}|${per > 0 ? cur : ""}`;
		const row = acc.get(key) ?? { d: day, appId, country, installs: 0, redownloads: 0, updates: 0, proceeds: 0, currency: per > 0 ? cur : "" };
		const kind = unitKind(c[iPt] ?? "");
		if (kind === "install") row.installs += units;
		else if (kind === "redownload") row.redownloads += units;
		else if (kind === "update") row.updates += units;
		row.proceeds += per * units;
		acc.set(key, row);
	}
	return Array.from(acc.values());
}

// ─────────────────────────────────────────────────────────────
// AdMob
// ─────────────────────────────────────────────────────────────

/** 사람 계정 토큰을 한 시간짜리 access token 으로 바꾼다. */
async function admobToken(env: RevenueEnv): Promise<string> {
	const resp = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.ADMOB_CLIENT_ID ?? "",
			client_secret: env.ADMOB_CLIENT_SECRET ?? "",
			refresh_token: env.ADMOB_REFRESH_TOKEN ?? "",
			grant_type: "refresh_token",
		}),
		signal: AbortSignal.timeout(20_000),
	});
	if (!resp.ok) throw new Error(`AdMob 토큰 ${resp.status} ${(await resp.text()).slice(0, 200)}`);
	const j = (await resp.json()) as { access_token?: string };
	if (!j.access_token) throw new Error("AdMob 토큰을 받지 못했어요.");
	return j.access_token;
}

export interface AdmobRow {
	d: string; appId: string; country: string;
	earnings: number; impressions: number; clicks: number; requests: number;
	/** 요청 가운데 광고가 실제로 내려온 수. 이 값과 요청 수의 비가 '채움 비율'이다. */
	matched: number;
}

const ymd = (s: string) => ({ year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)), day: Number(s.slice(8, 10)) });

/** 기간을 한 번에 받는다. 날짜·앱·나라로 갈라 준다. */
export async function fetchAdmob(env: RevenueEnv, from: string, to: string): Promise<AdmobRow[]> {
	const token = await admobToken(env);
	const resp = await fetch(
		`https://admob.googleapis.com/v1/accounts/${encodeURIComponent(env.ADMOB_PUB_ID ?? "")}/networkReport:generate`,
		{
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				reportSpec: {
					dateRange: { startDate: ymd(from), endDate: ymd(to) },
					dimensions: ["DATE", "APP", "COUNTRY"],
					metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "CLICKS", "AD_REQUESTS", "MATCHED_REQUESTS"],
				},
			}),
			signal: AbortSignal.timeout(60_000),
		},
	);
	if (!resp.ok) throw new Error(`AdMob 보고서 ${resp.status} ${(await resp.text()).slice(0, 200)}`);
	const list = (await resp.json()) as {
		row?: {
			dimensionValues: Record<string, { value?: string; displayLabel?: string }>;
			metricValues: Record<string, { microsValue?: string; integerValue?: string }>;
		};
	}[];
	const out: AdmobRow[] = [];
	for (const item of list ?? []) {
		const r = item.row;
		if (!r) continue;
		const d = r.dimensionValues.DATE?.value ?? "";
		if (d.length !== 8) continue;
		const m = r.metricValues;
		out.push({
			d: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
			appId: r.dimensionValues.APP?.value ?? "",
			country: (r.dimensionValues.COUNTRY?.value ?? "").toUpperCase() || "(미상)",
			// 수익은 백만분의 1 달러 단위로 온다.
			earnings: Number(m.ESTIMATED_EARNINGS?.microsValue ?? 0) / 1e6,
			impressions: Number(m.IMPRESSIONS?.integerValue ?? 0),
			clicks: Number(m.CLICKS?.integerValue ?? 0),
			requests: Number(m.AD_REQUESTS?.integerValue ?? 0),
			matched: Number(m.MATCHED_REQUESTS?.integerValue ?? 0),
		});
	}
	return out;
}

// ─────────────────────────────────────────────────────────────
// 저장
// ─────────────────────────────────────────────────────────────

export async function ensureRevenueTables(env: RevenueEnv): Promise<void> {
	for (const sql of [
		// 하루·앱·나라·통화 하나가 한 줄. 같은 날을 다시 받으면 덮어쓴다 —
		// Apple 이 며칠 뒤 숫자를 고치는 일이 있어서 최근 며칠은 늘 다시 받는다.
		"CREATE TABLE IF NOT EXISTS store_sales (d TEXT NOT NULL, app_id TEXT NOT NULL, country TEXT NOT NULL," +
			" currency TEXT NOT NULL DEFAULT '', installs INTEGER NOT NULL DEFAULT 0," +
			" redownloads INTEGER NOT NULL DEFAULT 0, updates INTEGER NOT NULL DEFAULT 0," +
			" proceeds REAL NOT NULL DEFAULT 0, PRIMARY KEY (d, app_id, country, currency))",
		"CREATE TABLE IF NOT EXISTS admob_daily (d TEXT NOT NULL, app_id TEXT NOT NULL, country TEXT NOT NULL," +
			" earnings REAL NOT NULL DEFAULT 0, impressions INTEGER NOT NULL DEFAULT 0," +
			" clicks INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0," +
			" matched INTEGER NOT NULL DEFAULT 0," +
			" PRIMARY KEY (d, app_id, country))",
		// 광고를 달라고 한 요청 가운데 실제로 광고가 내려온 수.
		// 이미 표가 있는 환경에는 칼럼만 더한다(D1 에는 ADD COLUMN IF NOT EXISTS 가 없어 조용히 실패한다).
		//
		// 왜 따로 담나. 요청 수와 노출 수만 있으면 "수익이 적다"까지만 보이고 어디가 막혔는지 모른다.
		// 이 값이 있으면 셋으로 갈린다 —
		//   요청 → 채움(matched/requests): 낮으면 광고가 안 내려온다(단위 설정·크기·재시도 폭주)
		//   채움 → 노출(impressions/matched): 낮으면 받아 놓고 안 보여준다(도달 경로가 막힘)
		// 실제로 한 앱은 채움 9.5%, 다른 앱은 받아 놓고 노출 0 이었는데 화면으로는 둘 다 그냥 '수익 적음'이었다.
		"ALTER TABLE admob_daily ADD COLUMN matched INTEGER NOT NULL DEFAULT 0",
		// 언제 무엇을 어디까지 받았나. 화면 아래에 그대로 적어 준다.
		"CREATE TABLE IF NOT EXISTS revenue_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
		"CREATE INDEX IF NOT EXISTS idx_store_sales_d ON store_sales(d)",
		"CREATE INDEX IF NOT EXISTS idx_admob_d ON admob_daily(d)",
	]) {
		try {
			await env.DB.prepare(sql).run();
		} catch {
			/* 이미 있음 */
		}
	}
}

/** D1 batch 는 한 번에 너무 많이 보내면 거절한다. 나눠 보낸다. */
async function runChunked(env: RevenueEnv, stmts: D1PreparedStatement[]): Promise<void> {
	for (let i = 0; i < stmts.length; i += 80) {
		await env.DB.batch(stmts.slice(i, i + 80));
	}
}

export interface SyncReport {
	ok: boolean;
	days: number;
	from: string;
	to: string;
	store: { rows: number; days: number; error: string | null };
	admob: { rows: number; error: string | null };
	ms: number;
}

const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * 최근 며칠을 다시 받아 덮어쓴다.
 *
 * 왜 하루치만 받지 않나. Apple 은 하루가 지난 뒤에도 숫자를 손보고(환불·정산),
 * AdMob 은 추정치라 며칠 뒤 확정값으로 바뀐다. 겹쳐 받아 덮어쓰면 그 보정이 따라온다.
 * 처음 채울 때만 days 를 크게 준다(수동 호출).
 */
export async function syncRevenue(env: RevenueEnv, days = 5, skip = 0): Promise<SyncReport> {
	const t0 = Date.now();
	const n = Math.max(1, Math.min(60, Math.floor(days) || 5));
	// skip 은 "며칠 전부터 거슬러 세나". 처음 한 해치를 채울 때 30일씩 열두 번 나눠 부른다 —
	// 하루치가 요청 한 번이라 한꺼번에 365번을 돌리면 응답을 기다리다 끊긴다.
	const back = Math.max(0, Math.min(730, Math.floor(skip) || 0));
	await ensureRevenueTables(env);

	// 어제까지 받는다. 오늘 것은 어느 쪽도 아직 완성되지 않았다.
	const to = dayStr(Date.now() - (back + 1) * 86_400_000);
	const from = dayStr(Date.now() - (back + n) * 86_400_000);
	const rep: SyncReport = {
		ok: true, days: n, from, to,
		store: { rows: 0, days: 0, error: null },
		admob: { rows: 0, error: null },
		ms: 0,
	};

	// ── App Store: 하루치씩
	if (env.ASC_ISSUER_ID && env.ASC_KEY_ID && env.ASC_P8 && env.ASC_VENDOR) {
		try {
			const token = await ascToken(env);
			const stmts: D1PreparedStatement[] = [];
			for (let i = back + n; i >= back + 1; i--) {
				const day = dayStr(Date.now() - i * 86_400_000);
				const rows = await fetchStoreDay(env, token, day);
				if (!rows.length) continue;
				rep.store.days++;
				// 그날 것을 통째로 갈아 끼운다. 줄 수가 줄었을 때 옛 줄이 남지 않게.
				stmts.push(env.DB.prepare("DELETE FROM store_sales WHERE d = ?1").bind(day));
				for (const r of rows) {
					stmts.push(
						env.DB.prepare(
							"INSERT OR REPLACE INTO store_sales (d, app_id, country, currency, installs, redownloads, updates, proceeds)" +
								" VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
						).bind(r.d, r.appId, r.country, r.currency, r.installs, r.redownloads, r.updates, r.proceeds),
					);
					rep.store.rows++;
				}
			}
			await runChunked(env, stmts);
		} catch (e) {
			rep.ok = false;
			rep.store.error = String(e instanceof Error ? e.message : e).slice(0, 300);
		}
	} else {
		rep.store.error = "App Store Connect 값이 설정되지 않았어요.";
	}

	// ── AdMob: 기간 통째로
	if (env.ADMOB_PUB_ID && env.ADMOB_CLIENT_ID && env.ADMOB_CLIENT_SECRET && env.ADMOB_REFRESH_TOKEN) {
		try {
			const rows = await fetchAdmob(env, from, to);
			const stmts: D1PreparedStatement[] = [
				env.DB.prepare("DELETE FROM admob_daily WHERE d >= ?1 AND d <= ?2").bind(from, to),
			];
			for (const r of rows) {
				stmts.push(
					env.DB.prepare(
						"INSERT OR REPLACE INTO admob_daily (d, app_id, country, earnings, impressions, clicks, requests, matched)" +
							" VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
					).bind(r.d, r.appId, r.country, r.earnings, r.impressions, r.clicks, r.requests, r.matched),
				);
				rep.admob.rows++;
			}
			await runChunked(env, stmts);
		} catch (e) {
			rep.ok = false;
			rep.admob.error = String(e instanceof Error ? e.message : e).slice(0, 300);
		}
	} else {
		rep.admob.error = "AdMob 값이 설정되지 않았어요.";
	}

	rep.ms = Date.now() - t0;
	await env.DB.prepare(
		"INSERT INTO revenue_state (key, value, updated_at) VALUES ('last_sync', ?1, ?2)" +
			" ON CONFLICT(key) DO UPDATE SET value=?1, updated_at=?2",
	)
		.bind(JSON.stringify(rep), Date.now())
		.run()
		.catch(() => {});
	return rep;
}

export { byStore as revenueByStore, byAdmob as revenueByAdmob };

// ─────────────────────────────────────────────────────────────
// 집계 — 화면이 읽는 것
//
// 바깥에 다시 묻지 않는다. 우리 표만 읽으므로 Apple·구글이 멎어도 화면은 열리고,
// 멎은 사실은 맨 아래 '마지막으로 받은 때'에만 드러난다.
// ─────────────────────────────────────────────────────────────

export interface RevenueMoney {
	currency: string;
	amount: number;
}

export interface RevenueAppRow {
	key: string;
	name: string;
	platform: string;
	site: string | null;
	installs: number;
	redownloads: number;
	updates: number;
	prevInstalls: number;
	/** 광고 수익(USD). AdMob 은 계정 통화 하나로만 준다. */
	ad: number;
	prevAd: number;
	impressions: number;
	clicks: number;
	requests: number;
	/** 요청 가운데 광고가 내려온 수. requests 와 견주면 '채움 비율'이 나온다. */
	matched: number;
	/** 앱 판매·인앱 수익. 나라 통화 그대로라 여러 줄이 될 수 있다. */
	sales: RevenueMoney[];
	countries: number;
}

export interface RevenueCountry {
	code: string;
	installs: number;
	redownloads: number;
	ad: number;
	impressions: number;
}

export interface RevenueBucket {
	d: string;
	installs: number;
	redownloads: number;
	updates: number;
	ad: number;
}

export interface RevenueData {
	period: string;
	appFilter: string;
	since: string;
	until: string;
	apps: RevenueAppRow[];
	/** 목록(REVENUE_APPS)에 없는 것 — 새 앱을 내고 줄을 안 더한 경우다. */
	unmatched: { kind: "appstore" | "admob"; id: string; installs: number; ad: number }[];
	buckets: RevenueBucket[];
	countries: RevenueCountry[];
	totals: {
		installs: number; prevInstalls: number;
		redownloads: number; prevRedownloads: number;
		updates: number;
		ad: number; prevAd: number;
		impressions: number; clicks: number; requests: number; matched: number;
		sales: RevenueMoney[];
		countries: number;
	};
	/**
	 * AdMob 평생 누적 — 기간 탭을 따르지 않는다.
	 *
	 * AdMob 은 잔액을 알려주는 API 가 없다(계정·앱·보고서뿐이다). 지급선 $100 을
	 * 언제 넘기는지 보려면 날짜별 수익을 우리가 처음부터 더하는 수밖에 없다.
	 * 한 번이라도 지급을 받으면 AdMob 쪽 잔액은 0 으로 돌아가는데 이 값은 계속 늘어난다.
	 * 그때부터는 '평생 번 돈'이지 '받을 돈'이 아니다 — 화면 설명에 그렇게 적어 둔다.
	 */
	adAll: { total: number; firstDay: string; lastDay: string };
	lastSync: SyncReport | null;
	lastSyncAt: number;
}

/** 기간 탭 → 시작 날짜 문자열. '전체'면 빈 문자열(모든 날짜가 크거나 같다). */
function sinceDay(days: number): string {
	return days ? dayStr(Date.now() - days * 86_400_000) : "";
}

const MONEY_ORDER = ["USD", "KRW", "EUR", "JPY", "GBP"];
function sortMoney(list: RevenueMoney[]): RevenueMoney[] {
	return list
		.filter((m) => Math.abs(m.amount) > 0.0000001)
		.sort((a, b) => {
			const ai = MONEY_ORDER.indexOf(a.currency), bi = MONEY_ORDER.indexOf(b.currency);
			if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
			return b.amount - a.amount;
		});
}

/**
 * 앱 수익 화면 한 장에 필요한 값.
 *
 * 기간은 날짜 문자열로 자른다. Apple 의 하루는 미국 태평양시, AdMob 의 하루는
 * 계정 시간대(서울)라 둘의 경계가 정확히 같지는 않다. 몇 시간 차이를 맞추려고
 * 원본 날짜를 손대면 어느 쪽 보고서와도 안 맞는 숫자가 되므로, 그대로 두고
 * 화면에 그 사실을 한 줄 적는다.
 */
export async function collectRevenue(env: RevenueEnv, period: string, appFilter: string, days: number): Promise<RevenueData> {
	try {
		return await collectRevenueInner(env, period, appFilter, days);
	} catch (e) {
		// 아직 한 번도 받지 않아 표가 없을 때다. 한 번 만들고 다시 센다(그러면 빈 화면이 열린다).
		if (!/no such table|no such column/i.test(String(e))) throw e;
		await ensureRevenueTables(env);
		return await collectRevenueInner(env, period, appFilter, days);
	}
}

async function collectRevenueInner(env: RevenueEnv, period: string, appFilter: string, days: number): Promise<RevenueData> {
	const since = sinceDay(days);
	const prevSince = days ? dayStr(Date.now() - days * 2 * 86_400_000) : "";
	const until = dayStr(Date.now() - 86_400_000);

	const picked = appFilter ? revenueApp(appFilter) : undefined;
	const storeWhere = picked?.store ? " AND app_id = ?2" : "";
	const admobWhere = picked?.admob ? " AND app_id = ?2" : "";
	// 고른 앱이 그쪽에 없으면(광고를 안 붙였다면) 아예 걸러 0건이 되게 한다.
	const storeMiss = !!picked && !picked.store;
	const admobMiss = !!picked && !picked.admob;

	const sBind = (sql: string, a: string, b?: string) => {
		const st = env.DB.prepare(sql);
		return picked?.store ? (b === undefined ? st.bind(a, picked.store) : st.bind(a, picked.store, b)) : (b === undefined ? st.bind(a) : st.bind(a, b));
	};
	const aBind = (sql: string, a: string, b?: string) => {
		const st = env.DB.prepare(sql);
		return picked?.admob ? (b === undefined ? st.bind(a, picked.admob) : st.bind(a, picked.admob, b)) : (b === undefined ? st.bind(a) : st.bind(a, b));
	};
	const none = <T>() => Promise.resolve({ results: [] as T[] });

	const [sApp, sMoney, sPrev, aApp, aPrev, sDay, aDay, sCty, aCty, aAll, state] = await Promise.all([
		// ① 앱별 다운로드
		storeMiss ? none<{ app_id: string; i: number; r: number; u: number; c: number }>()
			: sBind(
					"SELECT app_id, SUM(installs) AS i, SUM(redownloads) AS r, SUM(updates) AS u," +
						" COUNT(DISTINCT country) AS c FROM store_sales WHERE d >= ?1" + storeWhere + " GROUP BY app_id",
					since,
				).all<{ app_id: string; i: number; r: number; u: number; c: number }>(),
		// ② 앱별·통화별 수익. 통화를 섞지 않으려고 따로 센다.
		storeMiss ? none<{ app_id: string; currency: string; p: number }>()
			: sBind(
					"SELECT app_id, currency, SUM(proceeds) AS p FROM store_sales WHERE d >= ?1" + storeWhere +
						" AND proceeds <> 0 GROUP BY app_id, currency",
					since,
				).all<{ app_id: string; currency: string; p: number }>(),
		// ③ 직전 같은 기간
		storeMiss || !days ? none<{ app_id: string; i: number; r: number }>()
			: sBind(
					"SELECT app_id, SUM(installs) AS i, SUM(redownloads) AS r FROM store_sales" +
						" WHERE d >= ?1 AND d < " + (picked?.store ? "?3" : "?2") + storeWhere + " GROUP BY app_id",
					prevSince,
					since,
				).all<{ app_id: string; i: number; r: number }>(),
		// ④ 앱별 광고
		admobMiss ? none<{ app_id: string; e: number; im: number; c: number; q: number; mq: number }>()
			: aBind(
					"SELECT app_id, SUM(earnings) AS e, SUM(impressions) AS im, SUM(clicks) AS c," +
						" SUM(requests) AS q, SUM(matched) AS mq FROM admob_daily WHERE d >= ?1" + admobWhere + " GROUP BY app_id",
					since,
				).all<{ app_id: string; e: number; im: number; c: number; q: number; mq: number }>(),
		admobMiss || !days ? none<{ app_id: string; e: number }>()
			: aBind(
					"SELECT app_id, SUM(earnings) AS e FROM admob_daily WHERE d >= ?1 AND d < " +
						(picked?.admob ? "?3" : "?2") + admobWhere + " GROUP BY app_id",
					prevSince,
					since,
				).all<{ app_id: string; e: number }>(),
		// ⑤ 날짜별 — 그래프
		storeMiss ? none<{ d: string; i: number; r: number; u: number }>()
			: sBind(
					"SELECT d, SUM(installs) AS i, SUM(redownloads) AS r, SUM(updates) AS u FROM store_sales" +
						" WHERE d >= ?1" + storeWhere + " GROUP BY d ORDER BY d",
					since,
				).all<{ d: string; i: number; r: number; u: number }>(),
		admobMiss ? none<{ d: string; e: number }>()
			: aBind(
					"SELECT d, SUM(earnings) AS e FROM admob_daily WHERE d >= ?1" + admobWhere + " GROUP BY d ORDER BY d",
					since,
				).all<{ d: string; e: number }>(),
		// ⑥ 나라별 — 지도와 표
		storeMiss ? none<{ country: string; i: number; r: number }>()
			: sBind(
					"SELECT country, SUM(installs) AS i, SUM(redownloads) AS r FROM store_sales" +
						" WHERE d >= ?1" + storeWhere + " GROUP BY country",
					since,
				).all<{ country: string; i: number; r: number }>(),
		admobMiss ? none<{ country: string; e: number; im: number }>()
			: aBind(
					"SELECT country, SUM(earnings) AS e, SUM(impressions) AS im FROM admob_daily" +
						" WHERE d >= ?1" + admobWhere + " GROUP BY country",
					since,
				).all<{ country: string; e: number; im: number }>(),
		// ⑦ 평생 누적 광고 수익 — 날짜를 걸지 않는다. 앱을 골랐으면 그 앱만.
		admobMiss
			? Promise.resolve(null)
			: (picked?.admob
					? env.DB.prepare("SELECT SUM(earnings) AS e, MIN(d) AS f, MAX(d) AS t FROM admob_daily WHERE app_id = ?1").bind(picked.admob)
					: env.DB.prepare("SELECT SUM(earnings) AS e, MIN(d) AS f, MAX(d) AS t FROM admob_daily")
				).first<{ e: number | null; f: string | null; t: string | null }>(),
		env.DB.prepare("SELECT value, updated_at FROM revenue_state WHERE key = 'last_sync'").first<{ value: string; updated_at: number }>(),
	]);

	// ── 앱별로 합치기
	const rows = new Map<string, RevenueAppRow>();
	const rowOf = (a: RevenueApp): RevenueAppRow => {
		const cur = rows.get(a.key);
		if (cur) return cur;
		const fresh: RevenueAppRow = {
			key: a.key, name: a.name, platform: a.platform, site: a.site,
			installs: 0, redownloads: 0, updates: 0, prevInstalls: 0,
			ad: 0, prevAd: 0, impressions: 0, clicks: 0, requests: 0, matched: 0,
			sales: [], countries: 0,
		};
		rows.set(a.key, fresh);
		return fresh;
	};
	const unmatched: RevenueData["unmatched"] = [];

	for (const r of sApp.results ?? []) {
		const a = byStore.get(r.app_id);
		if (!a) { unmatched.push({ kind: "appstore", id: r.app_id, installs: r.i ?? 0, ad: 0 }); continue; }
		const row = rowOf(a);
		row.installs += r.i ?? 0; row.redownloads += r.r ?? 0; row.updates += r.u ?? 0;
		row.countries = Math.max(row.countries, r.c ?? 0);
	}
	const moneyOf = new Map<string, Map<string, number>>();
	for (const r of sMoney.results ?? []) {
		const a = byStore.get(r.app_id);
		if (!a) continue;
		const m = moneyOf.get(a.key) ?? new Map<string, number>();
		m.set(r.currency || "USD", (m.get(r.currency || "USD") ?? 0) + (r.p ?? 0));
		moneyOf.set(a.key, m);
	}
	for (const [key, m] of moneyOf) {
		const row = rows.get(key);
		if (row) row.sales = sortMoney(Array.from(m.entries()).map(([currency, amount]) => ({ currency, amount })));
	}
	for (const r of sPrev.results ?? []) {
		const a = byStore.get(r.app_id);
		if (a) rowOf(a).prevInstalls += r.i ?? 0;
	}
	for (const r of aApp.results ?? []) {
		const a = byAdmob.get(r.app_id);
		if (!a) { unmatched.push({ kind: "admob", id: r.app_id, installs: 0, ad: r.e ?? 0 }); continue; }
		const row = rowOf(a);
		row.ad += r.e ?? 0; row.impressions += r.im ?? 0; row.clicks += r.c ?? 0;
		row.requests += r.q ?? 0; row.matched += r.mq ?? 0;
	}
	for (const r of aPrev.results ?? []) {
		const a = byAdmob.get(r.app_id);
		if (a) rowOf(a).prevAd += r.e ?? 0;
	}

	// 기록이 하나도 없는 앱도 줄은 남긴다 — "이 앱은 이 기간에 0건"과 "그런 앱이 없다"는 다르다.
	for (const a of REVENUE_APPS) {
		if (!appFilter || a.key === appFilter) rowOf(a);
	}
	const apps = Array.from(rows.values()).sort(
		(x, y) => y.installs - x.installs || y.ad - x.ad || x.name.localeCompare(y.name),
	);

	// ── 날짜별
	const bmap = new Map<string, RevenueBucket>();
	const bOf = (d: string) => {
		const cur = bmap.get(d) ?? { d, installs: 0, redownloads: 0, updates: 0, ad: 0 };
		bmap.set(d, cur);
		return cur;
	};
	for (const r of sDay.results ?? []) {
		const b = bOf(r.d);
		b.installs += r.i ?? 0; b.redownloads += r.r ?? 0; b.updates += r.u ?? 0;
	}
	for (const r of aDay.results ?? []) bOf(r.d).ad += r.e ?? 0;
	const buckets = Array.from(bmap.values()).sort((a, b) => a.d.localeCompare(b.d)).slice(-60);

	// ── 나라별
	const cmap = new Map<string, RevenueCountry>();
	const cOf = (code: string) => {
		const cur = cmap.get(code) ?? { code, installs: 0, redownloads: 0, ad: 0, impressions: 0 };
		cmap.set(code, cur);
		return cur;
	};
	for (const r of sCty.results ?? []) {
		const c = cOf(r.country);
		c.installs += r.i ?? 0; c.redownloads += r.r ?? 0;
	}
	for (const r of aCty.results ?? []) {
		const c = cOf(r.country);
		c.ad += r.e ?? 0; c.impressions += r.im ?? 0;
	}
	const countries = Array.from(cmap.values())
		.filter((c) => c.installs || c.redownloads || c.impressions)
		.sort((a, b) => b.installs - a.installs || b.impressions - a.impressions);

	// ── 합계
	const money = new Map<string, number>();
	for (const row of apps) for (const m of row.sales) money.set(m.currency, (money.get(m.currency) ?? 0) + m.amount);
	const sum = (f: (r: RevenueAppRow) => number) => apps.reduce((n, r) => n + f(r), 0);
	const prevRedown = (sPrev.results ?? []).reduce((n, r) => n + (r.r ?? 0), 0);

	let lastSync: SyncReport | null = null;
	try {
		lastSync = state?.value ? (JSON.parse(state.value) as SyncReport) : null;
	} catch {
		lastSync = null;
	}

	return {
		period, appFilter, since, until,
		apps,
		unmatched,
		buckets,
		countries,
		totals: {
			installs: sum((r) => r.installs), prevInstalls: sum((r) => r.prevInstalls),
			redownloads: sum((r) => r.redownloads), prevRedownloads: prevRedown,
			updates: sum((r) => r.updates),
			ad: sum((r) => r.ad), prevAd: sum((r) => r.prevAd),
			impressions: sum((r) => r.impressions), clicks: sum((r) => r.clicks),
			requests: sum((r) => r.requests), matched: sum((r) => r.matched),
			sales: sortMoney(Array.from(money.entries()).map(([currency, amount]) => ({ currency, amount }))),
			countries: countries.filter((c) => c.code !== "(미상)").length,
		},
		adAll: { total: aAll?.e ?? 0, firstDay: aAll?.f ?? "", lastDay: aAll?.t ?? "" },
		lastSync,
		lastSyncAt: state?.updated_at ?? 0,
	};
}
