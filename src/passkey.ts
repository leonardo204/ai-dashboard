/**
 * 관리자 패스키 로그인 (WebAuthn) — 외부 라이브러리 없이 Workers 런타임만 쓴다.
 *
 * 서버가 보관하는 건 공개키뿐이다. 개인키는 기기(아이폰·맥·윈도우 헬로)에 남고 밖으로 나오지 않는다.
 * 그래서 이 표가 통째로 새어도 그것만으로는 로그인할 수 없다.
 *
 * 등록은 이미 비밀번호로 로그인한 상태에서만 되므로, 브라우저가 주는 SPKI 공개키
 * (getPublicKey())를 그대로 받는다. attestationObject를 CBOR로 풀 필요가 없어진다.
 *
 * 흐름
 *   등록  POST /admin/api/passkey/register/options → 브라우저 create() → /register/verify
 *   로그인 POST /admin/api/passkey/login/options   → 브라우저 get()    → /login/verify
 *
 * 챌린지는 저장소 없이 서명한 임시 쿠키(2분)에 담는다. 세션 쿠키와 같은 방식이다.
 */

import {
	addPasskey, deletePasskey, getPasskey, listPasskeys, touchPasskey, type StatsEnv,
} from "./stats";

export interface PasskeyEnv extends StatsEnv {
	ADMIN_USER: string;
	ADMIN_PASS: string;
}

const CHALLENGE_COOKIE = "hz_wa";
const CHALLENGE_TTL = 120_000;      // 2분. 사람이 지문·얼굴을 대는 시간이면 충분하다.
const RP_NAME = "AI Service";

// ── 인코딩 도우미 ───────────────────────────────────────────
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let bin = "";
	for (const b of u8) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
	const pad = s.replace(/-/g, "+").replace(/_/g, "/");
	return Uint8Array.from(atob(pad + "=".repeat((4 - (pad.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

async function hmac(secret: string, payload: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return b64urlEncode(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

// ── 챌린지 쿠키 ─────────────────────────────────────────────
async function makeChallenge(env: PasskeyEnv, purpose: string): Promise<{ challenge: string; cookie: string }> {
	const challenge = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
	const payload = `${purpose}|${challenge}|${Date.now() + CHALLENGE_TTL}`;
	const value = `${b64urlEncode(enc.encode(payload))}.${await hmac(env.ADMIN_PASS, payload)}`;
	return {
		challenge,
		cookie: `${CHALLENGE_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/admin; Max-Age=${CHALLENGE_TTL / 1000}`,
	};
}

/** 쿠키에서 챌린지를 꺼낸다. 서명·용도·만료가 하나라도 어긋나면 null. */
async function readChallenge(env: PasskeyEnv, request: Request, purpose: string): Promise<string | null> {
	const raw = (request.headers.get("Cookie") || "")
		.split(";")
		.map((c) => c.trim())
		.find((c) => c.startsWith(`${CHALLENGE_COOKIE}=`));
	if (!raw) return null;
	const value = raw.slice(CHALLENGE_COOKIE.length + 1);
	const dot = value.lastIndexOf(".");
	if (dot < 0) return null;
	let payload = "";
	try {
		payload = dec.decode(b64urlDecode(value.slice(0, dot)));
	} catch {
		return null;
	}
	if (!safeEqual(value.slice(dot + 1), await hmac(env.ADMIN_PASS, payload))) return null;
	const [p, challenge, expRaw] = payload.split("|");
	if (p !== purpose || Number(expRaw) < Date.now()) return null;
	return challenge;
}

const clearChallenge = `${CHALLENGE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/admin; Max-Age=0`;

// ── 서명 검증 ───────────────────────────────────────────────

/** ECDSA 서명은 DER(ASN.1)로 오는데 WebCrypto는 r‖s 64바이트를 받는다. 그 변환. */
function derToRaw(der: Uint8Array): Uint8Array {
	if (der[0] !== 0x30) throw new Error("서명 형식이 올바르지 않아요.");
	let off = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2;
	const out = new Uint8Array(64);
	for (const half of [0, 32]) {
		if (der[off++] !== 0x02) throw new Error("서명 형식이 올바르지 않아요.");
		let len = der[off++];
		let start = off;
		off = start + len;
		// 앞쪽 0 패딩을 걷어내고 32바이트 오른쪽 정렬로 옮긴다.
		while (len > 32) { start++; len--; }
		out.set(der.subarray(start, start + len), half + (32 - len));
	}
	return out;
}

async function verifySignature(
	alg: number, spki: Uint8Array, signature: Uint8Array, signed: Uint8Array,
): Promise<boolean> {
	if (alg === -257) {
		const key = await crypto.subtle.importKey(
			"spki", spki as unknown as BufferSource,
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
		);
		return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature as unknown as BufferSource, signed as unknown as BufferSource);
	}
	// 기본은 ES256(-7). 패스키는 사실상 전부 이 알고리즘을 쓴다.
	const key = await crypto.subtle.importKey(
		"spki", spki as unknown as BufferSource,
		{ name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
	);
	return crypto.subtle.verify(
		{ name: "ECDSA", hash: "SHA-256" }, key,
		derToRaw(signature) as unknown as BufferSource, signed as unknown as BufferSource,
	);
}

/** clientDataJSON 검사 — 어떤 의식이었는지, 어떤 챌린지였는지, 어느 사이트였는지. */
function checkClientData(json: string, wantType: string, wantChallenge: string, origin: string): string | null {
	let d: { type?: string; challenge?: string; origin?: string };
	try {
		d = JSON.parse(json) as typeof d;
	} catch {
		return "브라우저가 보낸 값을 읽지 못했어요.";
	}
	if (d.type !== wantType) return "요청 종류가 맞지 않아요.";
	if (!d.challenge || !safeEqual(d.challenge, wantChallenge)) return "인증 요청이 만료됐어요. 다시 시도해 주세요.";
	if (d.origin !== origin) return "다른 주소에서 온 요청이에요.";
	return null;
}

// ── 라우트 ──────────────────────────────────────────────────

const json = (obj: unknown, status = 200, extra: Record<string, string> = {}) =>
	new Response(JSON.stringify(obj), {
		status,
		headers: { "Content-Type": "application/json;charset=UTF-8", "Cache-Control": "no-store", ...extra },
	});
const fail = (status: number, message: string) => json({ error: message }, status);

export interface PasskeyCtx {
	/** 지금 요청이 관리자 세션인지 */
	hasSession: () => Promise<boolean>;
	/** 로그인 성공 뒤 심을 세션 쿠키 */
	sessionCookie: (user: string) => Promise<string>;
}

/**
 * /admin/api/passkey/* 처리. 담당이 아니면 null을 돌려준다.
 */
export async function handlePasskey(
	request: Request, env: PasskeyEnv, url: URL, ctx: PasskeyCtx,
): Promise<Response | null> {
	const rest = url.pathname.replace(/^\/admin\/api\/passkey\/?/, "").replace(/\/$/, "");
	if (!url.pathname.startsWith("/admin/api/passkey")) return null;
	if (request.method !== "POST") return fail(405, "POST로 불러 주세요.");
	if (!env.ADMIN_USER || !env.ADMIN_PASS) return fail(503, "관리자 계정이 설정되지 않았어요.");

	const rpId = url.hostname;
	const origin = `https://${rpId}`;

	// ── 등록: 준비 ── 이미 로그인한 사람만 새 기기를 등록할 수 있다.
	if (rest === "register/options") {
		if (!(await ctx.hasSession())) return fail(401, "로그인이 필요해요.");
		const { challenge, cookie } = await makeChallenge(env, "register");
		const existing = await listPasskeys(env);
		return json(
			{
				challenge,
				rp: { id: rpId, name: RP_NAME },
				user: { id: b64urlEncode(enc.encode(env.ADMIN_USER)), name: env.ADMIN_USER, displayName: env.ADMIN_USER },
				pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
				excludeCredentials: existing.map((p) => ({ type: "public-key", id: p.cred_id })),
				authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
			},
			200,
			{ "Set-Cookie": cookie },
		);
	}

	// ── 등록: 확인 ──
	if (rest === "register/verify") {
		if (!(await ctx.hasSession())) return fail(401, "로그인이 필요해요.");
		const want = await readChallenge(env, request, "register");
		if (!want) return fail(400, "등록 요청이 만료됐어요. 다시 시도해 주세요.");

		const b = (await request.json().catch(() => null)) as {
			id?: string; publicKey?: string; alg?: number; clientDataJSON?: string; label?: string;
		} | null;
		if (!b?.id || !b.publicKey || !b.clientDataJSON) {
			return fail(400, "이 브라우저는 패스키 등록에 필요한 정보를 주지 않아요. 최신 브라우저에서 시도해 주세요.");
		}

		let clientData = "";
		try {
			clientData = dec.decode(b64urlDecode(b.clientDataJSON));
		} catch {
			return fail(400, "브라우저가 보낸 값을 읽지 못했어요.");
		}
		const bad = checkClientData(clientData, "webauthn.create", want, origin);
		if (bad) return fail(400, bad);

		// 공개키가 정말 쓸 수 있는 형식인지 여기서 한 번 확인해 둔다.
		const alg = b.alg === -257 ? -257 : -7;
		try {
			const spki = b64urlDecode(b.publicKey);
			await crypto.subtle.importKey(
				"spki", spki as unknown as BufferSource,
				alg === -257 ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : { name: "ECDSA", namedCurve: "P-256" },
				false, ["verify"],
			);
		} catch {
			return fail(400, "이 기기의 공개키 형식을 다루지 못해요.");
		}

		const label = (b.label || "").trim().slice(0, 40) || null;
		await addPasskey(env, { credId: b.id.slice(0, 400), publicKey: b.publicKey, alg, label });
		return json({ ok: true, label }, 200, { "Set-Cookie": clearChallenge });
	}

	// ── 등록 해제 ──
	if (rest === "delete") {
		if (!(await ctx.hasSession())) return fail(401, "로그인이 필요해요.");
		const b = (await request.json().catch(() => null)) as { id?: string } | null;
		if (!b?.id) return fail(400, "지울 패스키를 알려 주세요.");
		await deletePasskey(env, b.id);
		return json({ ok: true });
	}

	// ── 로그인: 준비 ── 아이디를 묻지 않는다(기기가 어떤 계정인지 안다).
	if (rest === "login/options") {
		const { challenge, cookie } = await makeChallenge(env, "login");
		return json({ challenge, rpId, userVerification: "preferred" }, 200, { "Set-Cookie": cookie });
	}

	// ── 로그인: 확인 ──
	if (rest === "login/verify") {
		const want = await readChallenge(env, request, "login");
		if (!want) return fail(400, "인증 요청이 만료됐어요. 다시 시도해 주세요.");

		const b = (await request.json().catch(() => null)) as {
			id?: string; clientDataJSON?: string; authenticatorData?: string; signature?: string;
		} | null;
		if (!b?.id || !b.clientDataJSON || !b.authenticatorData || !b.signature) {
			return fail(400, "인증 정보가 모자라요.");
		}

		const cred = await getPasskey(env, b.id);
		if (!cred) return fail(401, "등록되지 않은 패스키예요.");

		let clientDataBytes: Uint8Array, authData: Uint8Array, signature: Uint8Array;
		try {
			clientDataBytes = b64urlDecode(b.clientDataJSON);
			authData = b64urlDecode(b.authenticatorData);
			signature = b64urlDecode(b.signature);
		} catch {
			return fail(400, "브라우저가 보낸 값을 읽지 못했어요.");
		}

		const bad = checkClientData(dec.decode(clientDataBytes), "webauthn.get", want, origin);
		if (bad) return fail(400, bad);

		if (authData.length < 37) return fail(400, "인증 데이터가 짧아요.");
		// 앞 32바이트는 이 사이트 주소의 해시다. 다른 사이트에서 받아온 서명을 막는다.
		const rpHash = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(rpId)));
		for (let i = 0; i < 32; i++) if (authData[i] !== rpHash[i]) return fail(400, "다른 주소의 인증이에요.");
		if (!(authData[32] & 0x01)) return fail(400, "기기에서 사용자 확인이 되지 않았어요.");

		const signed = new Uint8Array(authData.length + 32);
		signed.set(authData, 0);
		signed.set(new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataBytes as unknown as BufferSource)), authData.length);

		let ok = false;
		try {
			ok = await verifySignature(cred.alg, b64urlDecode(cred.public_key), signature, signed);
		} catch {
			ok = false;
		}
		if (!ok) {
			await new Promise((r) => setTimeout(r, 400));
			return fail(401, "패스키 확인에 실패했어요.");
		}

		// 서명 횟수 — 기기가 세는 값이다. 뒤로 돌아가면 복제된 기기일 수 있어 막는다.
		// 패스키는 대부분 0으로 고정이라, 둘 다 0보다 클 때만 따진다.
		const counter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);
		if (cred.counter > 0 && counter > 0 && counter <= cred.counter) {
			return fail(401, "패스키 상태가 이상해요. 이 기기를 지우고 다시 등록해 주세요.");
		}
		await touchPasskey(env, cred.cred_id, counter);

		const headers = new Headers({ "Content-Type": "application/json;charset=UTF-8", "Cache-Control": "no-store" });
		headers.append("Set-Cookie", await ctx.sessionCookie(env.ADMIN_USER));
		headers.append("Set-Cookie", clearChallenge);
		return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
	}

	return fail(404, "없는 경로예요.");
}
