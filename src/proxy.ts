/**
 * AI 인식 프록시 — 앱이 만든 요청을 받아 서버에만 있는 키를 주입해 모델로 전달한다.
 * 목적: AI API 키를 앱 번들에서 제거(키 유출·과금 남용 차단) + 앱별 사용량 추적.
 *
 * 경유: OpenRouter 한 곳(키 1개 관리 + 모델 교체 자유).
 *
 * 요청: POST /v1/ai          채팅·비전 (구버전 호환: POST /v1/recognize)
 *       POST /v1/embeddings  임베딩 (OpenRouter는 엔드포인트가 달라 라우트를 나눈다)
 *   헤더: Authorization: Bearer <앱 토큰>
 *         X-Ai-Kind: <용도>        ← 앱 설정의 모델 맵 키(예전 X-Hamzzi-Kind도 받는다).
 *   바디: OpenAI 형식 { messages, ... }  또는  Gemini 형식 { contents, generationConfig }
 *         선택: "model"   ← 모델명을 직접 지정(그대로 OpenRouter로 넘어간다). :online 접미사 가능.
 *         선택: "plugins" ← 웹검색 등. [{"id":"web"}]는 :online과 같다.
 *         선택: "meta"    ← 앱이 보내는 부가 정보. 모델에는 안 보내고 통계에만 쌓는다.
 * 응답: 보낸 형식 그대로 돌려준다(Gemini로 보내면 Gemini 형식). 401 인증 · 429 상한 · 502 상류 오류.
 *
 * 모델: 화이트리스트를 두지 않는다. 앱이 보낸 이름을 그대로 OpenRouter로 넘긴다
 *       (OpenRouter 카탈로그 전체 사용 가능). 비용은 단가표 추정이 아니라
 *       OpenRouter가 응답에 실어주는 usage.cost(웹검색 요금 포함)를 그대로 기록한다.
 *
 * 호환: 예전 경로(/v1/recognize)와 예전 헤더(X-Hamzzi-Kind)도 그대로 받는다.
 */

import {
	logCall, rateLimited, maybeCleanup, findAppByToken,
	DEFAULT_MODEL, type AppConfig, type StatsEnv,
} from "./stats";

const OR_CHAT = "https://openrouter.ai/api/v1/chat/completions";
const OR_EMBED = "https://openrouter.ai/api/v1/embeddings";
const MAX_BODY = 8 * 1024 * 1024; // 8MB (리사이즈된 이미지 base64 여유)
const MAX_TOKENS = 2000;          // 미지정 시 OpenRouter가 잔액 기준으로 거절한다.
const MAX_META = 2000;            // 메타는 통계용이라 넉넉히 2KB로 제한

export interface ProxyEnv extends StatsEnv {
	OPENROUTER_API_KEY: string;
}

function clientIP(req: Request): string {
	return req.headers.get("CF-Connecting-IP") || "unknown";
}

/**
 * 요청의 지리 정보 — Cloudflare가 request.cf에 붙여주는 값이라 외부 조회·비용이 없다.
 * 값이 없거나 알 수 없는 코드(XX·T1=Tor)면 null로 둔다.
 */
function geoOf(req: Request): {
	country: string | null; region: string | null; city: string | null;
	lat: number | null; lon: number | null;
} {
	const cf = (req as { cf?: Record<string, unknown> }).cf;
	const clean = (v: unknown): string | null => {
		const t = typeof v === "string" ? v.trim() : "";
		if (!t || t === "XX" || t === "T1" || t === "Unknown") return null;
		return t.slice(0, 60);
	};
	// 좌표는 지도에 점을 찍는 용도라 소수 첫째 자리(약 11km)까지만 남긴다 — 필요 이상으로 정밀하게 두지 않는다.
	const coord = (v: unknown, max: number): number | null => {
		const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
		if (!Number.isFinite(n) || Math.abs(n) > max) return null;
		return Math.round(n * 10) / 10;
	};
	return {
		country: clean(cf?.country) ?? clean(req.headers.get("CF-IPCountry")),
		region: clean(cf?.region) ?? clean(cf?.regionCode),
		city: clean(cf?.city),
		lat: coord(cf?.latitude, 90),
		lon: coord(cf?.longitude, 180),
	};
}

function err(status: number, message: string): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}

/** Gemini contents[] → OpenAI messages[]. 텍스트와 인라인 이미지를 그대로 옮긴다. */
function toMessages(contents: unknown[]): unknown[] {
	const parts: unknown[] = [];
	for (const c of contents) {
		const ps = (c as { parts?: unknown[] })?.parts ?? [];
		for (const p of ps) {
			const part = p as { text?: string; inline_data?: { mime_type?: string; data?: string }; inlineData?: { mimeType?: string; data?: string } };
			const inline = part.inline_data ?? (part.inlineData ? { mime_type: part.inlineData.mimeType, data: part.inlineData.data } : undefined);
			if (typeof part.text === "string") {
				parts.push({ type: "text", text: part.text });
			} else if (inline?.data) {
				const mime = inline.mime_type || "image/jpeg";
				parts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${inline.data}` } });
			}
		}
	}
	return [{ role: "user", content: parts }];
}

/** OpenAI 응답 → Gemini 형식. 앱이 candidates[0].content.parts[0].text 를 그대로 읽게 한다. */
function toGeminiShape(text: string, inTok: number, outTok: number): string {
	return JSON.stringify({
		candidates: [{ content: { parts: [{ text }], role: "model" } }],
		usageMetadata: { promptTokenCount: inTok, candidatesTokenCount: outTok },
	});
}

/** 앱이 보낸 meta를 통계 저장용 문자열로 다듬는다(객체만 허용, 2KB 상한). */
function normalizeMeta(v: unknown): string | null {
	if (!v || typeof v !== "object" || Array.isArray(v)) return null;
	try {
		const s = JSON.stringify(v);
		return s.length > MAX_META ? s.slice(0, MAX_META) : s;
	} catch {
		return null;
	}
}

/**
 * 용도 → 모델.
 * 앱이 body.model로 직접 지정하면 그대로 쓴다(화이트리스트 없음 — OpenRouter 카탈로그 전체 사용 가능).
 * 없으면 앱 설정 맵의 kind → default → 전역 기본 순으로 고른다.
 * 오타·없는 모델은 OpenRouter가 400으로 알려주고, 그 응답을 그대로 앱에 전달한다.
 */
function pickModel(app: AppConfig, kind: string, requested: unknown): string {
	const m = typeof requested === "string" ? requested.trim() : "";
	if (m) return m.slice(0, 120);
	return app.models[kind] || app.models.default || DEFAULT_MODEL;
}

/** OpenRouter가 실어주는 실제 청구액. 없으면 null(호출부가 단가표로 추정). */
function costOfUsage(u: unknown): number | null {
	const c = (u as { cost?: unknown })?.cost;
	return typeof c === "number" && Number.isFinite(c) ? c : null;
}

/** OpenRouter 공통 헤더. */
function orHeaders(env: ProxyEnv, appName: string): Record<string, string> {
	return {
		Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
		"Content-Type": "application/json",
		"HTTP-Referer": "https://ai.zerolive.co.kr",
		"X-Title": appName,
	};
}

/** 인증·상한 통과 결과. Response면 그대로 반환하고 끝낸다. */
type Gate =
	| { ok: true; app: AppConfig; ip: string; kind: string; geo: ReturnType<typeof geoOf>; now: number }
	| { ok: false; res: Response };

/** 토큰 → 앱 확인 + 앱별 rate limit. 두 라우트(chat·embeddings)가 함께 쓴다. */
async function gate(request: Request, env: ProxyEnv, ctx: ExecutionContext): Promise<Gate> {
	const now = Date.now();
	if (request.method !== "POST") return { ok: false, res: err(405, "POST만 허용돼요.") };

	const auth = request.headers.get("Authorization") || "";
	const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
	if (!token) return { ok: false, res: err(401, "인증이 필요해요.") };

	const app = await findAppByToken(env, token);
	if (!app) return { ok: false, res: err(401, "인증이 필요해요.") };
	if (!app.active) return { ok: false, res: err(403, "이 앱은 현재 사용이 중지돼 있어요.") };
	if (!env.OPENROUTER_API_KEY) return { ok: false, res: err(500, "서버 AI 키가 설정되지 않았어요.") };

	const ip = clientIP(request);
	const geo = geoOf(request);
	const kind = (request.headers.get("X-Ai-Kind") || request.headers.get("X-Hamzzi-Kind") || "default")
		.toLowerCase()
		.slice(0, 32);

	if (await rateLimited(env, app.id, ip, now, app.perMin, app.perDay)) {
		ctx.waitUntil(logCall(env, { ts: now, app: app.id, kind, model: null, status: "error", http: 429, latency_ms: 0, ip, in_tokens: 0, out_tokens: 0, cost: null, err: "rate_limited", meta: null, ...geo }));
		return { ok: false, res: err(429, "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.") };
	}
	return { ok: true, app, ip, kind, geo, now };
}

export async function handleRecognize(request: Request, env: ProxyEnv, ctx: ExecutionContext): Promise<Response> {
	const g = await gate(request, env, ctx);
	if (!g.ok) return g.res;
	const { app, ip, kind, geo, now } = g;

	// 바디 검증 — OpenAI 형식(messages)과 Gemini 형식(contents) 둘 다 받는다.
	const raw = await request.text();
	if (raw.length > MAX_BODY) return err(413, "요청이 너무 커요.");
	let payload: unknown;
	try {
		payload = JSON.parse(raw);
	} catch {
		return err(400, "요청 형식이 올바르지 않아요.");
	}
	const body = payload as {
		messages?: unknown[];
		contents?: unknown[];
		model?: unknown;
		meta?: unknown;
		plugins?: unknown;
		generationConfig?: { temperature?: number };
		temperature?: number;
		max_tokens?: number;
		response_format?: unknown;
		reasoning_effort?: unknown;
		tools?: unknown;
		tool_choice?: unknown;
		stop?: unknown;
		top_p?: unknown;
	};
	const geminiStyle = Array.isArray(body?.contents);
	const messages = geminiStyle ? toMessages(body.contents as unknown[]) : body?.messages;
	if (!Array.isArray(messages) || messages.length === 0) {
		return err(400, "요청 본문이 올바르지 않아요. messages 또는 contents가 필요해요.");
	}

	const meta = normalizeMeta(body.meta);
	const model = pickModel(app, kind, body.model);

	// OpenRouter 호출 (키는 서버에서만 주입)
	const req: Record<string, unknown> = {
		model,
		messages,
		response_format: body.response_format ?? { type: "json_object" },
		max_tokens: typeof body.max_tokens === "number" ? Math.min(body.max_tokens, 32000) : MAX_TOKENS,
	};
	// 웹검색 등 플러그인은 그대로 전달한다. [{"id":"web"}]는 모델명 :online 접미사와 같다.
	// (검색 요금은 토큰과 별도로 붙고, usage.cost에 합산돼 돌아온다.)
	if (Array.isArray(body.plugins)) req.plugins = body.plugins;
	// 도구 호출·샘플링 옵션도 준 대로 넘긴다.
	if (body.tools !== undefined) req.tools = body.tools;
	if (body.tool_choice !== undefined) req.tool_choice = body.tool_choice;
	if (body.stop !== undefined) req.stop = body.stop;
	if (typeof body.top_p === "number") req.top_p = body.top_p;
	// GPT-5 계열(추론 모델)은 temperature를 받지 않는다 → 모델별로 갈라서 넣는다.
	const temp = geminiStyle ? body.generationConfig?.temperature : body.temperature;
	if (model.startsWith("openai/")) req.reasoning_effort = body.reasoning_effort ?? "low";
	else if (typeof temp === "number") req.temperature = temp;

	const started = Date.now();
	let http = 0;
	let outText = "";
	try {
		const resp = await fetch(OR_CHAT, {
			method: "POST",
			headers: orHeaders(env, app.name),
			body: JSON.stringify(req),
			signal: AbortSignal.timeout(120_000),
		});
		http = resp.status;
		outText = await resp.text();
	} catch (e) {
		const latency = Date.now() - started;
		ctx.waitUntil(logCall(env, { ts: now, app: app.id, kind, model, status: "error", http: http || 0, latency_ms: latency, ip, in_tokens: 0, out_tokens: 0, cost: null, err: `upstream: ${String(e).slice(0, 80)}`, meta, ...geo }));
		return err(502, "AI 서버에 연결하지 못했어요.");
	}

	const latency = Date.now() - started;

	// 상류 오류는 사유를 그대로 전달한다(모델 오타·없는 모델을 앱이 바로 알 수 있게).
	if (http !== 200) {
		ctx.waitUntil(logCall(env, { ts: now, app: app.id, kind, model, status: "error", http, latency_ms: latency, ip, in_tokens: 0, out_tokens: 0, cost: null, err: outText.slice(0, 160), meta, ...geo }));
		return new Response(outText || JSON.stringify({ error: "인식에 실패했어요." }), {
			status: http,
			headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
		});
	}

	let parsed: {
		choices?: { message?: { content?: string } }[];
		usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
	};
	try {
		parsed = JSON.parse(outText);
	} catch {
		ctx.waitUntil(logCall(env, { ts: now, app: app.id, kind, model, status: "error", http: 502, latency_ms: latency, ip, in_tokens: 0, out_tokens: 0, cost: null, err: "parse", meta, ...geo }));
		return err(502, "인식 결과를 해석하지 못했어요.");
	}

	const inTok = parsed.usage?.prompt_tokens ?? 0;
	const outTok = parsed.usage?.completion_tokens ?? 0;
	ctx.waitUntil(logCall(env, { ts: now, app: app.id, kind, model, status: "ok", http: 200, latency_ms: latency, ip, in_tokens: inTok, out_tokens: outTok, cost: costOfUsage(parsed.usage), err: null, meta, ...geo }));
	if (Math.random() < 0.02) ctx.waitUntil(maybeCleanup(env, now));

	// 보낸 형식 그대로 돌려준다 — Gemini로 보낸 앱은 기존 파싱을 그대로 쓴다.
	const outBody = geminiStyle
		? toGeminiShape(parsed.choices?.[0]?.message?.content ?? "", inTok, outTok)
		: outText;

	return new Response(outBody, {
		status: 200,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}

/**
 * 임베딩 프록시 — POST /v1/embeddings
 * OpenRouter는 임베딩이 chat과 다른 엔드포인트라 라우트를 나눈다.
 * 바디는 OpenAI 임베딩 형식 { model, input, ... }을 그대로 받아 그대로 넘기고,
 * 응답(data[].embedding)도 손대지 않고 그대로 돌려준다.
 */
export async function handleEmbeddings(request: Request, env: ProxyEnv, ctx: ExecutionContext): Promise<Response> {
	const g = await gate(request, env, ctx);
	if (!g.ok) return g.res;
	const { app, ip, kind, geo, now } = g;

	const raw = await request.text();
	if (raw.length > MAX_BODY) return err(413, "요청이 너무 커요.");
	let payload: unknown;
	try {
		payload = JSON.parse(raw);
	} catch {
		return err(400, "요청 형식이 올바르지 않아요.");
	}
	const body = payload as { model?: unknown; input?: unknown; meta?: unknown; dimensions?: unknown; encoding_format?: unknown };
	const input = body?.input;
	const emptyInput =
		input === undefined || input === null || (typeof input === "string" && !input.trim()) || (Array.isArray(input) && input.length === 0);
	if (emptyInput) return err(400, "요청 본문이 올바르지 않아요. input(문자열 또는 배열)이 필요해요.");

	const meta = normalizeMeta(body.meta);
	const model = pickModel(app, kind, body.model);

	const req: Record<string, unknown> = { model, input };
	if (body.dimensions !== undefined) req.dimensions = body.dimensions;
	if (body.encoding_format !== undefined) req.encoding_format = body.encoding_format;

	const started = Date.now();
	let http = 0;
	let outText = "";
	try {
		const resp = await fetch(OR_EMBED, {
			method: "POST",
			headers: orHeaders(env, app.name),
			body: JSON.stringify(req),
			signal: AbortSignal.timeout(60_000),
		});
		http = resp.status;
		outText = await resp.text();
	} catch (e) {
		const latency = Date.now() - started;
		ctx.waitUntil(logCall(env, { ts: now, app: app.id, kind, model, status: "error", http: http || 0, latency_ms: latency, ip, in_tokens: 0, out_tokens: 0, cost: null, err: `upstream: ${String(e).slice(0, 80)}`, meta, ...geo }));
		return err(502, "AI 서버에 연결하지 못했어요.");
	}

	const latency = Date.now() - started;
	if (http !== 200) {
		ctx.waitUntil(logCall(env, { ts: now, app: app.id, kind, model, status: "error", http, latency_ms: latency, ip, in_tokens: 0, out_tokens: 0, cost: null, err: outText.slice(0, 160), meta, ...geo }));
		return new Response(outText || JSON.stringify({ error: "임베딩에 실패했어요." }), {
			status: http,
			headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
		});
	}

	// 임베딩은 출력 토큰이 없다(prompt_tokens만 청구).
	let inTok = 0;
	let cost: number | null = null;
	try {
		const o = JSON.parse(outText) as { usage?: { prompt_tokens?: number; total_tokens?: number; cost?: number } };
		inTok = o.usage?.prompt_tokens ?? o.usage?.total_tokens ?? 0;
		cost = costOfUsage(o.usage);
	} catch {
		/* 응답은 그대로 전달하고 통계만 0으로 둔다 */
	}
	ctx.waitUntil(logCall(env, { ts: now, app: app.id, kind, model, status: "ok", http: 200, latency_ms: latency, ip, in_tokens: inTok, out_tokens: 0, cost, err: null, meta, ...geo }));
	if (Math.random() < 0.02) ctx.waitUntil(maybeCleanup(env, now));

	return new Response(outText, {
		status: 200,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}
