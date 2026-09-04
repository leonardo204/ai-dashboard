/**
 * AI 프록시 · 관리 대시보드 Worker
 *
 * OpenRouter 앞단에 서서, 내가 가진 앱들의 LLM 호출을 한곳에서 중계하고 집계한다.
 *  - 앱에는 앱 전용 토큰만 둔다(실제 OpenRouter 키는 서버 시크릿).
 *  - 앱 1개 = 토큰 1개. 호출은 앱·모델·용도·지역별로 자동 집계된다.
 *  - 모델은 제한하지 않는다. 앱이 보낸 이름을 그대로 OpenRouter에 넘긴다.
 *
 * 라우트:
 *  POST /v1/ai            채팅·비전·웹검색
 *  POST /v1/embeddings    임베딩
 *  POST /v1/hit           다른 서비스가 보내는 방문 기록 (TRAFFIC_TOKEN)
 *  GET  /admin            요약 대시보드 (세션 로그인)
 *  GET  /admin/usage      앱·모델·용도별 사용량
 *  GET  /admin/trend      기간별 추이 · 요일×시각 히트맵
 *  GET  /admin/geo        국가·도시별 호출 분포
 *  GET  /admin/logs       호출 로그 검색 (/admin/logs.csv 내려받기)
 *  GET  /admin/apps       앱 관리 화면
 *  GET  /admin/guide      연결 가이드 (원문: /admin/guide.md)
 *       /admin/api/*      앱 관리·통계·모델 카탈로그 API
 *  GET  /admin/api/export 호출 로그 증분 내보내기(이상탐지 서버 수집용)
 *  GET  /admin/api/export/hits 방문 기록 증분 내보내기(트래픽 이상탐지용)
 *  POST /admin/api/anomaly 이상탐지 결과·모델·서버 상태 받기
 *       /admin/api/passkey/*   관리자 패스키 등록·로그인 (WebAuthn)
 *  GET  /admin/anomaly    이상탐지 현황
 *  GET  /admin/traffic    서비스 방문(트래픽) 현황 — SEO·AEO
 *
 * 도메인: ai.zerolive.co.kr   ·   문서: docs/PROXY-API.md
 */

import { handleChat, handleEmbeddings, type ProxyEnv } from "./proxy";
import { renderGuide, GUIDE_MD, GUIDE_FILENAME } from "./guide";
import {
	collectStats, collectSummary, collectUsage, collectTrend, collectGeo, queryLogs, logsCsv,
	listApps, getApp, upsertApp, deleteApp, newToken, pulse, exportCalls, PERIODS, LOG_PAGE,
	collectAnomaly, pushAnomaly, listPasskeys, passkeyCount, deletePasskey,
	collectTraffic,
	type AppConfig, type LogFilter,
} from "./stats";
import { handlePasskey, type PasskeyEnv } from "./passkey";
import { handleHit, exportHits, SITES, type TrafficEnv } from "./traffic";
import { renderLogin } from "./ui";
import {
	renderSummary, renderUsage, renderTrend, renderGeo, renderAnomaly, renderTraffic, renderLogs, renderApps,
} from "./views";

interface Env extends ProxyEnv, PasskeyEnv, TrafficEnv {
	// ProxyEnv: DB(D1) · OPENROUTER_API_KEY(secret)
	// 통계 대시보드(/admin) 로그인 — HTTP Basic 인증(secret)
	ADMIN_USER: string;
	ADMIN_PASS: string;
	// 앱 관리 API(/admin/api/*) 전용 키(secret). 없으면 API는 세션·Basic 로그인으로만 쓸 수 있다.
	ADMIN_API_KEY?: string;
}

// ─────────────────────────────────────────────────────────────
// 세션 로그인 (ai.zerolive.co.kr 등 신규 도메인)
//  - 브라우저 기본 로그인 창(Basic) 대신 직접 만든 /admin/login 화면을 쓴다.
//  - 쿠키에는 "사용자|만료시각"과 그 HMAC 서명만 담는다(서버 저장소 불필요).
//  - 서명 키는 ADMIN_PASS라 비밀번호를 바꾸면 기존 세션이 한 번에 무효가 된다.
// ─────────────────────────────────────────────────────────────

const SESSION_COOKIE = "hz_admin";
const SESSION_TTL = 12 * 3600_000; // 12시간

function b64url(bytes: ArrayBuffer): string {
	let bin = "";
	for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(secret: string, payload: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

/** 길이·내용이 같은지 상수 시간 비교(타이밍 공격 방지). */
function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

async function makeSession(env: Env, user: string): Promise<string> {
	const payload = `${user}|${Date.now() + SESSION_TTL}`;
	return `${b64url(new TextEncoder().encode(payload).buffer as ArrayBuffer)}.${await sign(env.ADMIN_PASS, payload)}`;
}

async function validSession(env: Env, request: Request): Promise<boolean> {
	if (!env.ADMIN_USER || !env.ADMIN_PASS) return false;
	const raw = (request.headers.get("Cookie") || "")
		.split(";")
		.map((c) => c.trim())
		.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
	if (!raw) return false;
	const value = raw.slice(SESSION_COOKIE.length + 1);
	const dot = value.lastIndexOf(".");
	if (dot < 0) return false;
	const [encoded, sig] = [value.slice(0, dot), value.slice(dot + 1)];
	let payload = "";
	try {
		payload = new TextDecoder().decode(
			Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
		);
	} catch {
		return false;
	}
	if (!safeEqual(sig, await sign(env.ADMIN_PASS, payload))) return false;
	const [user, expRaw] = payload.split("|");
	return user === env.ADMIN_USER && Number(expRaw) > Date.now();
}

function sessionCookie(value: string, maxAge: number): string {
	return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

/** 로그인 뒤 돌아갈 주소 — 외부로 튕기지 않도록 /admin 하위만 허용한다. */
function safeNext(raw: string | null): string {
	return raw && /^\/admin(\/[\w./-]*)?(\?[^"'<>]*)?$/.test(raw) ? raw : "/admin";
}

/**
 * /admin 접근 가드. 쿠키가 없으면 로그인 화면으로 보낸다(303).
 * 통과하면 null.
 */
async function requireAdmin(request: Request, env: Env, url: URL): Promise<Response | null> {
	if (await validSession(env, request)) return null;
	const next = encodeURIComponent(url.pathname + url.search);
	return new Response(null, {
		status: 303,
		headers: { Location: `/admin/login?next=${next}`, "Cache-Control": "no-store" },
	});
}

/** 로그인 화면·폼 처리. */
async function handleLogin(request: Request, env: Env, url: URL): Promise<Response> {
	if (request.method === "POST") {
		const f = await request.formData();
		const user = String(f.get("user") ?? "").trim();
		const pass = String(f.get("pass") ?? "");
		const next = safeNext(String(f.get("next") ?? "/admin"));
		const ok =
			!!env.ADMIN_USER && !!env.ADMIN_PASS && safeEqual(user, env.ADMIN_USER) && safeEqual(pass, env.ADMIN_PASS);
		if (!ok) {
			// 자동 대입 공격을 조금이라도 늦추려고 실패 응답만 살짝 지연시킨다.
			await new Promise((r) => setTimeout(r, 400));
			return html(renderLogin({ error: "아이디나 비밀번호가 맞지 않아요.", user, next }), { status: 401, cache: false });
		}
		return new Response(null, {
			status: 303,
			headers: {
				Location: next,
				"Set-Cookie": sessionCookie(await makeSession(env, user), Math.floor(SESSION_TTL / 1000)),
				"Cache-Control": "no-store",
			},
		});
	}
	if (await validSession(env, request)) {
		return new Response(null, { status: 303, headers: { Location: safeNext(url.searchParams.get("next")) } });
	}
	return html(
		renderLogin({ next: safeNext(url.searchParams.get("next")), passkey: (await passkeyCount(env)) > 0 }),
		{ cache: false },
	);
}

/** 앱 관리 화면(/admin/apps)의 폼 처리 — 추가·저장·토큰 재발급·중지/재개·삭제. */
async function handleAppsPost(request: Request, env: Env): Promise<Response> {
	const f = await request.formData();
	const get = (k: string) => String(f.get(k) ?? "").trim();
	const action = get("action");
	const id = get("id");
	const back = (msg: string) => Response.redirect(new URL(`/admin/apps?msg=${encodeURIComponent(msg)}`, request.url).toString(), 303);

	if (action === "passkey-delete") {
		const cred = get("cred");
		if (!cred) return back("지울 패스키를 알려 주세요.");
		await deletePasskey(env, cred);
		return back("패스키를 지웠어요.");
	}

	if (!id) return back("앱 id가 필요해요.");
	if (!/^[a-z0-9][a-z0-9-]{1,40}$/i.test(id)) return back("앱 id는 영문·숫자·하이픈만 쓸 수 있어요.");

	const existing = await getApp(env, id);

	if (action === "delete") {
		await deleteApp(env, id);
		return back(`${id} 앱을 삭제했어요. 호출 기록은 통계에 그대로 남아요.`);
	}
	if (action === "toggle") {
		if (!existing) return back("없는 앱이에요.");
		await upsertApp(env, { ...existing, models: JSON.stringify(existing.models), active: !existing.active });
		return back(`${id} 앱을 ${existing.active ? "중지" : "재개"}했어요.`);
	}
	if (action === "regen") {
		if (!existing) return back("없는 앱이에요.");
		const t = newToken();
		await upsertApp(env, { ...existing, models: JSON.stringify(existing.models), token: t });
		return Response.redirect(
			new URL(`/admin/apps?msg=${encodeURIComponent(`${id} 토큰을 새로 발급했어요.`)}&token=${encodeURIComponent(t)}`, request.url).toString(),
			303,
		);
	}

	// create · save 공통 — 모델 맵 JSON 검증
	const modelsRaw = get("models") || "{}";
	let models: Record<string, string>;
	try {
		const parsed = JSON.parse(modelsRaw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("obj");
		models = parsed as Record<string, string>;
	} catch {
		return back("모델 맵이 올바른 JSON이 아니에요. 예: {\"default\":\"google/gemini-3.6-flash\"}");
	}
	const perMin = Math.max(1, parseInt(get("per_min") || "20", 10) || 20);
	const perDay = Math.max(1, parseInt(get("per_day") || "300", 10) || 300);
	const name = get("name") || id;
	const note = get("note") || null;

	if (action === "create") {
		if (existing) return back("이미 있는 앱 id예요.");
		const token = newToken();
		await upsertApp(env, { id, name, token, models: JSON.stringify(models), perMin, perDay, active: true, note });
		return Response.redirect(
			new URL(`/admin/apps?msg=${encodeURIComponent(`${name} 앱을 추가했어요.`)}&token=${encodeURIComponent(token)}`, request.url).toString(),
			303,
		);
	}
	if (action === "save") {
		if (!existing) return back("없는 앱이에요.");
		await upsertApp(env, { id, name, token: existing.token, models: JSON.stringify(models), perMin, perDay, active: existing.active, note });
		return back(`${name} 앱 설정을 저장했어요.`);
	}
	return back("알 수 없는 동작이에요.");
}


// ─────────────────────────────────────────────────────────────
// 앱 관리 API (/admin/api/apps) — 화면 없이 스크립트로 앱을 등록·수정할 때 쓴다.
//   인증: Authorization: Bearer <ADMIN_API_KEY>   (또는 관리자 세션·Basic 로그인)
// ─────────────────────────────────────────────────────────────

const DEFAULT_MODELS = { default: "google/gemini-3.6-flash" };

function apiJson(obj: unknown, status = 200): Response {
	return new Response(JSON.stringify(obj, null, 2), {
		status,
		headers: { "Content-Type": "application/json;charset=UTF-8", "Cache-Control": "no-store" },
	});
}
const apiErr = (status: number, message: string) => apiJson({ error: message }, status);

// ─────────────────────────────────────────────────────────────
// 통계 화면 — 기간·앱 조건 읽기, 화면별 조회·렌더 짝
// ─────────────────────────────────────────────────────────────

/** 주소에서 기간·앱 조건을 읽는다. 모르는 값은 기본값(월·전체 앱)으로 떨어진다. */
function statScope(url: URL): { period: string; appFilter: string } {
	const raw = url.searchParams.get("period") || "month";
	return {
		period: PERIODS[raw] ? raw : "month",
		appFilter: url.searchParams.get("app") || "",
	};
}

/**
 * 경로 → (조회 + 렌더). 화면마다 자기 집계만 돈다.
 * 예전에는 /admin 한 장이 12개 집계를 전부 돌려, 보지도 않는 표 때문에 느렸다.
 */
const STAT_PAGES: Record<string, (env: Env, period: string, app: string) => Promise<string>> = {
	"/admin": async (e, p, a) => renderSummary(await collectSummary(e, p, a), { session: true }),
	"/admin/": async (e, p, a) => renderSummary(await collectSummary(e, p, a), { session: true }),
	"/admin/usage": async (e, p, a) => renderUsage(await collectUsage(e, p, a), { session: true }),
	"/admin/trend": async (e, p, a) => renderTrend(await collectTrend(e, p, a), { session: true }),
	"/admin/geo": async (e, p, a) => renderGeo(await collectGeo(e, p, a), { session: true }),

};

/** 주소에서 로그 검색 조건을 읽는다. */
function logFilterOf(url: URL): LogFilter {
	const g = (k: string) => (url.searchParams.get(k) || "").trim();
	const n = (k: string) => {
		const v = Number(g(k));
		return isFinite(v) && v > 0 ? Math.floor(v) : 0;
	};
	const raw = g("period") || "month";
	return {
		period: PERIODS[raw] ? raw : "month",
		app: g("app"),
		model: g("model"),
		kind: g("kind"),
		status: g("status"),
		http: g("http"),
		country: g("country").toUpperCase().slice(0, 2),
		ip: g("ip"),
		q: g("q").slice(0, 80),
		from: g("from"),
		to: g("to"),
		slow: n("slow"),
		before: n("before"),
		limit: n("limit") || LOG_PAGE,
	};
}

/** API 키 또는 관리자 로그인 중 하나면 통과. */
async function apiAuthorized(request: Request, env: Env, url: URL): Promise<boolean> {
	const auth = request.headers.get("Authorization") || "";
	if (auth.startsWith("Bearer ")) {
		const key = auth.slice(7).trim();
		if (env.ADMIN_API_KEY && safeEqual(key, env.ADMIN_API_KEY)) return true;
	}
	// 브라우저에서 로그인한 채로도 바로 쓸 수 있게 한다.
	return (await requireAdmin(request, env, url)) === null;
}

/** 앱 입력값 검증 — 잘못되면 메시지 문자열을 반환한다. */
function validateAppInput(b: Record<string, unknown>, forCreate: boolean): string | null {
	if (forCreate) {
		const id = String(b.id ?? "");
		if (!/^[a-z0-9][a-z0-9-]{1,40}$/i.test(id)) return "앱 id는 영문·숫자·하이픈만 쓸 수 있어요(2~41자).";
		if (!String(b.name ?? "").trim()) return "앱 이름이 필요해요.";
	}
	if (b.models !== undefined) {
		const m = b.models;
		if (!m || typeof m !== "object" || Array.isArray(m)) return "models는 JSON 객체여야 해요. 예: {\"default\":\"google/gemini-3.6-flash\"}";
		for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
			if (typeof v !== "string" || !v.trim()) return `models.${k} 값이 모델 이름(문자열)이 아니에요.`;
		}
	}
	for (const k of ["perMin", "perDay"] as const) {
		if (b[k] !== undefined && (!Number.isFinite(Number(b[k])) || Number(b[k]) < 1)) return `${k}는 1 이상의 숫자여야 해요.`;
	}
	return null;
}

function appJson(a: AppConfig) {
	return {
		id: a.id, name: a.name, token: a.token, models: a.models,
		perMin: a.perMin, perDay: a.perDay, active: a.active, note: a.note,
	};
}

async function handleAppsApi(request: Request, env: Env, url: URL): Promise<Response> {
	if (!(await apiAuthorized(request, env, url))) {
		return apiErr(401, "인증이 필요해요. Authorization: Bearer <ADMIN_API_KEY> 헤더를 넣어 주세요.");
	}

	// /admin/api/apps            → 목록·생성
	// /admin/api/apps/<id>       → 조회·수정·삭제
	// /admin/api/apps/<id>/token → 토큰 재발급
	const rest = url.pathname.replace(/^\/admin\/api\/apps\/?/, "").replace(/\/$/, "");
	const [rawId, sub] = rest ? rest.split("/") : ["", ""];
	const id = decodeURIComponent(rawId || "");
	const method = request.method.toUpperCase();

	const readBody = async (): Promise<Record<string, unknown> | null> => {
		try {
			const t = await request.text();
			if (!t.trim()) return {};
			const o = JSON.parse(t);
			return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
		} catch {
			return null;
		}
	};

	// ── 목록 · 생성
	if (!id) {
		if (method === "GET") {
			const apps = await listApps(env);
			return apiJson({ apps: apps.map(appJson) });
		}
		if (method === "POST") {
			const b = await readBody();
			if (!b) return apiErr(400, "요청 본문이 JSON 객체가 아니에요.");
			const bad = validateAppInput(b, true);
			if (bad) return apiErr(400, bad);
			const newId = String(b.id);
			if (await getApp(env, newId)) return apiErr(409, "이미 있는 앱 id예요.");
			const token = newToken();
			await upsertApp(env, {
				id: newId,
				name: String(b.name).trim(),
				token,
				models: JSON.stringify(b.models ?? DEFAULT_MODELS),
				perMin: Number(b.perMin ?? 20),
				perDay: Number(b.perDay ?? 300),
				active: b.active === undefined ? true : !!b.active,
				note: b.note === undefined || b.note === null ? null : String(b.note),
			});
			const created = await getApp(env, newId);
			return apiJson({ app: created ? appJson(created) : null }, 201);
		}
		return apiErr(405, "GET 또는 POST만 돼요.");
	}

	const app = await getApp(env, id);
	if (!app) return apiErr(404, "없는 앱이에요.");

	// ── 토큰 재발급
	if (sub === "token") {
		if (method !== "POST") return apiErr(405, "POST만 돼요.");
		const token = newToken();
		await upsertApp(env, { ...app, models: JSON.stringify(app.models), token });
		return apiJson({ app: { ...appJson(app), token }, note: "앱에 새 토큰을 넣어야 호출이 다시 돼요. 몇 초 뒤부터 적용돼요." });
	}
	if (sub) return apiErr(404, "없는 경로예요.");

	if (method === "GET") return apiJson({ app: appJson(app) });

	if (method === "PATCH" || method === "PUT") {
		const b = await readBody();
		if (!b) return apiErr(400, "요청 본문이 JSON 객체가 아니에요.");
		const bad = validateAppInput(b, false);
		if (bad) return apiErr(400, bad);
		await upsertApp(env, {
			id: app.id,
			name: b.name === undefined ? app.name : String(b.name).trim() || app.name,
			token: app.token,
			models: JSON.stringify(b.models === undefined ? app.models : b.models),
			perMin: b.perMin === undefined ? app.perMin : Number(b.perMin),
			perDay: b.perDay === undefined ? app.perDay : Number(b.perDay),
			active: b.active === undefined ? app.active : !!b.active,
			note: b.note === undefined ? app.note : b.note === null ? null : String(b.note),
		});
		const after = await getApp(env, app.id);
		return apiJson({ app: after ? appJson(after) : null });
	}

	if (method === "DELETE") {
		await deleteApp(env, app.id);
		return apiJson({ deleted: app.id, note: "호출 기록은 통계에 그대로 남아요." });
	}
	return apiErr(405, "GET · PATCH · DELETE만 돼요.");
}

/** 실제 라우팅. HTTPS 강제·HSTS는 아래 fetch 래퍼가 담당한다. */
async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// ── AI 프록시 (앱 전용) — 실제 AI 키는 서버에만 둔다.
		if (path === "/v1/ai") {
			return handleChat(request, env, ctx);
		}
		// ── 임베딩 프록시 — OpenRouter는 엔드포인트가 달라 라우트를 나눈다.
		if (path === "/v1/embeddings") {
			return handleEmbeddings(request, env, ctx);
		}

		// ── 서비스 방문 기록 받기 — 다른 서비스들이 응답을 보낸 뒤 한 건씩 보낸다.
		//    사람이 온 건지 크롤러가 온 건지는 이쪽에서 가른다(서비스에 붙는 코드를 짧게 두려고).
		if (path === "/v1/hit") {
			return handleHit(request, env, ctx);
		}

		// ── 관리자 로그인 (세션 도메인 전용 · 직접 만든 화면)
		if ((path === "/admin/login" || path === "/admin/login/")) {
			return handleLogin(request, env, url);
		}
		if ((path === "/admin/logout" || path === "/admin/logout/")) {
			return new Response(null, {
				status: 303,
				headers: { Location: "/admin/login", "Set-Cookie": sessionCookie("", 0), "Cache-Control": "no-store" },
			});
		}

		// ── 자동 갱신 신호 (/admin/api/pulse) — 대시보드가 몇 초마다 부른다.
		//    집계 없이 최신 호출 id·시각만 돌려줘서, 화면은 값이 바뀔 때만 다시 그린다.
		if (path === "/admin/api/pulse") {
			if (!(await apiAuthorized(request, env, url))) return apiErr(401, "인증이 필요해요.");
			return apiJson(await pulse(env, url.searchParams.get("app") || ""));
		}

		// ── 모델 카탈로그 (/admin/api/models) — OpenRouter 목록을 그대로 중계한다.
		//    프록시는 모델 화이트리스트를 두지 않으므로, 여기 보이는 모델은 모두 호출할 수 있다.
		//    ?q= 로 이름 검색, ?vision=1 로 이미지 입력 가능 모델만.
		if (path === "/admin/api/models") {
			if (!(await apiAuthorized(request, env, url))) {
				return apiErr(401, "인증이 필요해요. Authorization: Bearer <ADMIN_API_KEY> 헤더를 넣어 주세요.");
			}
			const q = (url.searchParams.get("q") || "").toLowerCase().trim();
			const visionOnly = url.searchParams.get("vision") === "1";
			let list: unknown[] = [];
			try {
				const r = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000) });
				list = ((await r.json()) as { data?: unknown[] }).data ?? [];
			} catch {
				return apiErr(502, "OpenRouter 모델 목록을 가져오지 못했어요.");
			}
			const rows = list
				.map((m) => m as { id?: string; name?: string; context_length?: number; pricing?: Record<string, string>; architecture?: { input_modalities?: string[] } })
				.filter((m) => !!m.id)
				.filter((m) => !q || (m.id as string).toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q))
				.filter((m) => !visionOnly || (m.architecture?.input_modalities ?? []).includes("image"))
				.map((m) => ({
					id: m.id,
					name: m.name,
					context: m.context_length,
					// OpenRouter는 토큰당 단가로 준다 → 100만 토큰 기준으로 환산
					inPerM: m.pricing?.prompt ? Number(m.pricing.prompt) * 1e6 : null,
					outPerM: m.pricing?.completion ? Number(m.pricing.completion) * 1e6 : null,
					webSearchPerCall: m.pricing?.web_search ? Number(m.pricing.web_search) : null,
					inputModalities: m.architecture?.input_modalities ?? [],
				}))
				.sort((a, b) => String(a.id).localeCompare(String(b.id)));
			return apiJson({
				count: rows.length,
				note: "프록시는 모델을 제한하지 않아요. 여기 id를 body.model 또는 앱 models 맵에 그대로 쓰면 돼요. 임베딩 모델은 이 목록에 없지만 POST /v1/embeddings로 호출돼요.",
				models: rows,
			});
		}

		// ── 증분 내보내기 (/admin/api/export) — 이상탐지 서버가 1분마다 끌어간다.
		//    프록시가 밀어 넣지 않고 받아가게 두는 이유: 수집 서버가 꺼져 있어도 호출 경로가 멀쩡하고,
		//    복구되면 마지막 id 다음부터 밀린 만큼 따라잡을 수 있다.
		if (path === "/admin/api/export" || path === "/admin/api/export/hits") {
			if (!(await apiAuthorized(request, env, url))) {
				return apiErr(401, "인증이 필요해요. Authorization: Bearer <ADMIN_API_KEY> 헤더를 넣어 주세요.");
			}
			const afterId = Math.max(0, Number(url.searchParams.get("after_id") || 0) || 0);
			const limit = Number(url.searchParams.get("limit") || 1000) || 1000;
			return apiJson(
				path.endsWith("/hits")
					? await exportHits(env, afterId, limit)
					: await exportCalls(env, afterId, limit),
			);
		}

		// ── 이상탐지 결과 받기 (/admin/api/anomaly) — 이상탐지 서버가 밀어 넣는다.
		//    반대로 화면이 볼 때마다 그 서버를 부르면, 서버가 꺼진 순간 탭 전체가 안 열린다.
		//    받아서 D1에 두면 서버가 멈춰도 화면은 열리고, 멈춘 사실만 상태줄에 드러난다.
		if (path === "/admin/api/anomaly") {
			if (!(await apiAuthorized(request, env, url))) {
				return apiErr(401, "인증이 필요해요. Authorization: Bearer <ADMIN_API_KEY> 헤더를 넣어 주세요.");
			}
			if (request.method !== "POST") return apiErr(405, "POST로 보내주세요.");
			let body: Record<string, unknown>;
			try {
				body = (await request.json()) as Record<string, unknown>;
			} catch {
				return apiErr(400, "JSON 형식이 아니에요.");
			}
			return apiJson(await pushAnomaly(env, body as Parameters<typeof pushAnomaly>[1]));
		}

		// ── 패스키 (/admin/api/passkey/*) — 등록은 로그인 상태에서만, 로그인 확인은 누구나 부를 수 있다.
		if (path.startsWith("/admin/api/passkey")) {
			const res = await handlePasskey(request, env, url, {
				hasSession: () => validSession(env, request),
				sessionCookie: async (user) => sessionCookie(await makeSession(env, user), Math.floor(SESSION_TTL / 1000)),
			});
			if (res) return res;
		}

		// ── 앱 관리 API (/admin/api/apps) — 화면 없이 스크립트로
		if (path === "/admin/api/apps" || path.startsWith("/admin/api/apps/")) {
			return handleAppsApi(request, env, url);
		}

		// ── 연결 가이드 (/admin/guide) · 원문 내려받기 (/admin/guide.md)
		//    다른 프로젝트에 건네줄 문서다. 관리자용 내용은 담지 않는다.
		if (path === "/admin/guide" || path === "/admin/guide/" || path === "/admin/guide.md") {
			const unauth = await requireAdmin(request, env, url);
			if (unauth) return unauth;
			if (path === "/admin/guide.md") {
				return new Response(GUIDE_MD, {
					headers: {
						"Content-Type": "text/markdown;charset=UTF-8",
						"Content-Disposition": `attachment; filename="${GUIDE_FILENAME}"`,
						"Cache-Control": "no-store",
					},
				});
			}
			return html(renderGuide({ session: true }), { cache: false });
		}

		// ── 앱 관리 (/admin/apps) — 등록·모델 맵·상한·토큰 재발급
		if (path === "/admin/apps" || path === "/admin/apps/") {
			const unauth = await requireAdmin(request, env, url);
			if (unauth) return unauth;
			if (request.method === "POST") return handleAppsPost(request, env);
			return html(
				renderApps(await listApps(env), await listPasskeys(env), {
					session: true,
					flash: url.searchParams.get("msg"),
					token: url.searchParams.get("token"),
				}),
				{ cache: false },
			);
		}

		// ── 통계 화면 (요약·사용량·추이·지역, 색인 제외)
		//    화면마다 필요한 집계만 돈다. 예전처럼 한 장에서 전부 계산하지 않는다.
		// ── 이상탐지 (/admin/anomaly) — 갈래(ai · traffic)를 함께 고른다.
		if (path === "/admin/anomaly" || path === "/admin/anomaly/") {
			const unauth = await requireAdmin(request, env, url);
			if (unauth) return unauth;
			const { period, appFilter } = statScope(url);
			const scope = url.searchParams.get("scope") === "traffic" ? "traffic" : "ai";
			return html(
				renderAnomaly(await collectAnomaly(env, period, appFilter, scope), { session: true }),
				{ cache: false },
			);
		}

		if (STAT_PAGES[path]) {
			const unauth = await requireAdmin(request, env, url);
			if (unauth) return unauth;
			const { period, appFilter } = statScope(url);
			return html(await STAT_PAGES[path](env, period, appFilter), { cache: false });
		}

		// ── 트래픽 (/admin/traffic) — 서비스 방문 기록. 기간과 서비스로 좁혀 본다.
		if (path === "/admin/traffic" || path === "/admin/traffic/") {
			const unauth = await requireAdmin(request, env, url);
			if (unauth) return unauth;
			const { period } = statScope(url);
			const raw = url.searchParams.get("site") || "";
			const site = SITES[raw] ? raw : "";
			return html(renderTraffic(await collectTraffic(env, period, site), { session: true }), { cache: false });
		}

		// ── 호출 로그 (/admin/logs · /admin/logs.csv)
		if (path === "/admin/logs" || path === "/admin/logs/" || path === "/admin/logs.csv") {
			const unauth = await requireAdmin(request, env, url);
			if (unauth) return unauth;
			const filter = logFilterOf(url);
			if (path === "/admin/logs.csv") {
				const csv = await logsCsv(env, filter);
				return new Response(csv, {
					headers: {
						"Content-Type": "text/csv;charset=UTF-8",
						"Content-Disposition": `attachment; filename="ai-calls-${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}.csv"`,
						"Cache-Control": "no-store",
					},
				});
			}
			return html(renderLogs(await queryLogs(env, filter), { session: true }), { cache: false });
		}

		// ── 통계 JSON (/admin/stats.json) — 스크립트·CI용. 예전 응답 형태를 그대로 둔다.
		if (path === "/admin/stats.json") {
			if (!(await apiAuthorized(request, env, url))) {
				return apiErr(401, "인증이 필요해요. Authorization: Bearer <ADMIN_API_KEY> 헤더를 넣어 주세요.");
			}
			const { period, appFilter } = statScope(url);
			return new Response(JSON.stringify(await collectStats(env, period, appFilter), null, 2), {
				headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
			});
		}

		// 공개 페이지가 없는 서버라 색인을 전부 막는다.
		if (path === "/robots.txt") {
			return new Response("User-agent: *\nDisallow: /\n", {
				headers: { "Content-Type": "text/plain;charset=UTF-8" },
			});
		}

		// 루트로 들어오면 대시보드로 보낸다.
		if (path === "/" || path === "/index.html") {
			return new Response(null, { status: 302, headers: { Location: "/admin" } });
		}

		return apiErr(404, "없는 경로예요.");
}

/**
 * 평문 HTTP 차단 + HSTS.
 * Cloudflare 뒤에서는 원 요청 스킴이 CF-Visitor 헤더에 담긴다(없으면 URL 스킴으로 판단).
 *  - 페이지: 301로 https 로 되돌린다.
 *  - API·관리자: 이미 평문으로 토큰·비밀번호가 나간 요청이라 리다이렉트하지 않고 거부한다.
 * HSTS는 includeSubDomains 없이 이 호스트에만 건다(zerolive.co.kr 의 다른 서브도메인 보호).
 */
function isInsecure(request: Request, url: URL): boolean {
	const cfv = request.headers.get("CF-Visitor");
	if (cfv) {
		try {
			const scheme = (JSON.parse(cfv) as { scheme?: string }).scheme;
			if (scheme) return scheme !== "https";
		} catch {
			/* 형식이 바뀌면 아래 URL 스킴으로 판단 */
		}
	}
	return url.protocol === "http:";
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (isInsecure(request, url)) {
			const p = url.pathname;
			if (p.startsWith("/v1/") || p.startsWith("/admin")) {
				return new Response(JSON.stringify({ error: "https로만 접속할 수 있어요." }), {
					status: 403,
					headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
				});
			}
			url.protocol = "https:";
			return Response.redirect(url.toString(), 301);
		}

		const resp = await route(request, env, ctx);
		const out = new Response(resp.body, resp);
		out.headers.set("Strict-Transport-Security", "max-age=31536000");
		return out;
	},
} satisfies ExportedHandler<Env>;

/** 관리 화면은 캐시하지 않는다(cache:false). */
function html(body: string, opts: { status?: number; cache?: boolean } = {}): Response {
	return new Response(body, {
		status: opts.status ?? 200,
		headers: {
			"Content-Type": "text/html;charset=UTF-8",
			"Cache-Control": opts.cache === false ? "no-store" : "public, max-age=300",
		},
	});
}
