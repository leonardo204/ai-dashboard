/**
 * 서비스 방문 기록 — SEO·AEO 효과를 보려고 모은다.
 *
 * 각 서비스(Worker·Next.js)가 응답을 보낸 뒤 이 대시보드로 방문 한 건을 보낸다.
 * 사람이 온 건지, 검색 크롤러가 온 건지, AI 크롤러가 온 건지를 여기서 가른다.
 * 분류를 서버에 두는 이유는 간단하다 — 서비스마다 붙는 코드를 짧게 유지하고,
 * 크롤러 이름이 늘어날 때 이 파일 한 곳만 고치면 되기 때문이다.
 *
 * 받는 곳: POST /v1/hit   (Authorization: Bearer <TRAFFIC_TOKEN>)
 *   { site, path, status, ms, ua, ref, country, region, city, ip, method }
 *   여러 건은 { hits: [ ... ] } 로도 받는다.
 */

export interface TrafficEnv {
	DB: D1Database;
	/** 서비스가 방문 기록을 보낼 때 쓰는 공용 토큰(secret). */
	TRAFFIC_TOKEN?: string;
	/** IP를 가리는 데 쓰는 소금. 없으면 ADMIN_PASS를 쓴다. */
	ADMIN_PASS?: string;
}

/** 대시보드에 모으는 서비스 — 화면에 쓸 이름과 주소. */
export const SITES: Record<string, { name: string; host: string }> = {
	"md-editor": { name: "마크다운 에디터", host: "md-editor.zerolive.co.kr" },
	wander: { name: "Wandery", host: "wander.zerolive.co.kr" },
	golf: { name: "라운드온", host: "golf.zerolive.co.kr" },
	me: { name: "포트폴리오", host: "me.zerolive.co.kr" },
	"live-translate": { name: "라이브 번역", host: "live-translate.zerolive.co.kr" },
};
export const siteName = (k: string) => SITES[k]?.name ?? k;

// ─────────────────────────────────────────────────────────────
// 크롤러 가리기
//   ai     — 학습·검색 색인을 위해 AI 회사가 보내는 크롤러 (AEO 효과의 척도)
//   search — 검색엔진 크롤러 (SEO 효과의 척도)
//   bot    — 그 밖의 자동 요청. 사람 수에 섞이면 안 되니 따로 센다.
// UA 문자열은 소문자로 맞춰 비교한다. 순서가 중요하다 — 위에서 먼저 걸린 이름을 쓴다.
// ─────────────────────────────────────────────────────────────
const AI_BOTS: [string, string][] = [
	["gptbot", "GPTBot"],
	["oai-searchbot", "OAI-SearchBot"],
	["chatgpt-user", "ChatGPT-User"],
	["claudebot", "ClaudeBot"],
	["claude-searchbot", "Claude-SearchBot"],
	["claude-user", "Claude-User"],
	["anthropic-ai", "anthropic-ai"],
	["perplexitybot", "PerplexityBot"],
	["perplexity-user", "Perplexity-User"],
	["google-extended", "Google-Extended"],
	["applebot-extended", "Applebot-Extended"],
	["meta-externalagent", "Meta-ExternalAgent"],
	["meta-externalfetcher", "Meta-ExternalFetcher"],
	["bytespider", "Bytespider"],
	["ccbot", "CCBot"],
	["amazonbot", "Amazonbot"],
	["youbot", "YouBot"],
	["duckassistbot", "DuckAssistBot"],
	["cohere-ai", "cohere-ai"],
	["diffbot", "Diffbot"],
	["imagesiftbot", "ImagesiftBot"],
	["timpibot", "Timpibot"],
	["omgili", "Omgili"],
	["mistralai-user", "MistralAI-User"],
];
const SEARCH_BOTS: [string, string][] = [
	["googlebot", "Googlebot"],
	["google-inspectiontool", "Google-InspectionTool"],
	["adsbot-google", "AdsBot-Google"],
	["bingbot", "Bingbot"],
	["bingpreview", "BingPreview"],
	["yeti", "네이버 Yeti"],
	["naver.me", "네이버"],
	["daum", "다음"],
	["duckduckbot", "DuckDuckBot"],
	["applebot", "Applebot"],
	["slurp", "Yahoo Slurp"],
	["baiduspider", "Baiduspider"],
	["yandexbot", "YandexBot"],
	["sogou", "Sogou"],
	["seznambot", "SeznamBot"],
	["petalbot", "PetalBot"],
	["ahrefsbot", "AhrefsBot"],
	["semrushbot", "SemrushBot"],
	["mj12bot", "MJ12bot"],
	["dotbot", "DotBot"],
];
/** 미리보기 카드를 만드는 메신저·SNS 봇 — 공유가 퍼진 흔적이라 따로 이름을 남긴다. */
const SOCIAL_BOTS: [string, string][] = [
	["twitterbot", "Twitterbot"],
	["facebookexternalhit", "Facebook"],
	["facebookbot", "Facebook"],
	["linkedinbot", "LinkedIn"],
	["discordbot", "Discord"],
	["slackbot", "Slack"],
	["telegrambot", "Telegram"],
	["whatsapp", "WhatsApp"],
	["pinterest", "Pinterest"],
	["kakaotalk-scrap", "카카오톡"],
	["redditbot", "Reddit"],
];
const GENERIC_BOT = /(bot\b|crawler|spider|crawl|headless|phantomjs|puppeteer|playwright|curl\/|wget\/|python-requests|python-httpx|go-http-client|java\/|okhttp|axios\/|node-fetch|libwww|scrapy|monitor|uptime|pingdom|checkly|lighthouse)/;

export interface Classified {
	kind: "human" | "ai" | "search" | "social" | "bot";
	bot: string | null;
}

/** UA 한 줄로 방문자 종류를 가른다. */
export function classifyUA(uaRaw: string): Classified {
	const ua = (uaRaw || "").toLowerCase();
	if (!ua) return { kind: "bot", bot: "(UA 없음)" };
	for (const [k, name] of AI_BOTS) if (ua.includes(k)) return { kind: "ai", bot: name };
	for (const [k, name] of SEARCH_BOTS) if (ua.includes(k)) return { kind: "search", bot: name };
	for (const [k, name] of SOCIAL_BOTS) if (ua.includes(k)) return { kind: "social", bot: name };
	if (GENERIC_BOT.test(ua)) return { kind: "bot", bot: "기타 봇" };
	return { kind: "human", bot: null };
}

// ─────────────────────────────────────────────────────────────
// 어디를 거쳐 왔나
//   ai     — AI 답변 화면에서 넘어온 방문. AEO의 실제 성과다.
//   search — 검색 결과에서 넘어온 방문
// ─────────────────────────────────────────────────────────────
const AI_REFS: [RegExp, string][] = [
	[/(^|\.)chatgpt\.com$/, "ChatGPT"],
	[/(^|\.)chat\.openai\.com$/, "ChatGPT"],
	[/(^|\.)openai\.com$/, "OpenAI"],
	[/(^|\.)perplexity\.ai$/, "Perplexity"],
	[/(^|\.)claude\.ai$/, "Claude"],
	[/(^|\.)copilot\.microsoft\.com$/, "Copilot"],
	[/(^|\.)gemini\.google\.com$/, "Gemini"],
	[/(^|\.)you\.com$/, "You.com"],
	[/(^|\.)poe\.com$/, "Poe"],
	[/(^|\.)phind\.com$/, "Phind"],
	[/(^|\.)grok\.com$/, "Grok"],
	[/(^|\.)x\.ai$/, "Grok"],
	[/(^|\.)mistral\.ai$/, "Mistral"],
	[/(^|\.)deepseek\.com$/, "DeepSeek"],
	[/(^|\.)clova-?x\.naver\.com$/, "CLOVA X"],
];
const SEARCH_REFS: [RegExp, string][] = [
	[/(^|\.)google\.[a-z.]+$/, "구글"],
	[/(^|\.)naver\.com$/, "네이버"],
	[/(^|\.)bing\.com$/, "Bing"],
	[/(^|\.)daum\.net$/, "다음"],
	[/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
	[/(^|\.)yandex\.[a-z.]+$/, "Yandex"],
	[/(^|\.)baidu\.com$/, "Baidu"],
	[/(^|\.)ecosia\.org$/, "Ecosia"],
	[/(^|\.)brave\.com$/, "Brave"],
	[/(^|\.)search\.marcia\.com$/, "기타 검색"],
];
const SOCIAL_REFS: [RegExp, string][] = [
	[/(^|\.)x\.com$/, "X"],
	[/(^|\.)twitter\.com$/, "X"],
	[/(^|\.)facebook\.com$/, "페이스북"],
	[/(^|\.)instagram\.com$/, "인스타그램"],
	[/(^|\.)threads\.(net|com)$/, "스레드"],
	[/(^|\.)linkedin\.com$/, "링크드인"],
	[/(^|\.)reddit\.com$/, "레딧"],
	[/(^|\.)youtube\.com$/, "유튜브"],
	[/(^|\.)github\.com$/, "GitHub"],
	[/(^|\.)news\.ycombinator\.com$/, "Hacker News"],
	[/(^|\.)velog\.io$/, "velog"],
	[/(^|\.)tistory\.com$/, "티스토리"],
	[/(^|\.)brunch\.co\.kr$/, "브런치"],
	[/(^|\.)disquiet\.io$/, "디스콰이엇"],
];

export interface RefInfo {
	/** ai | search | social | referral | internal | direct */
	group: string;
	source: string;
	host: string | null;
}

export function classifyRef(refRaw: string, selfHost: string): RefInfo {
	const ref = (refRaw || "").trim();
	if (!ref) return { group: "direct", source: "직접 방문", host: null };
	let host = "";
	try {
		host = new URL(ref).hostname.toLowerCase();
	} catch {
		return { group: "referral", source: "알 수 없음", host: null };
	}
	if (!host) return { group: "direct", source: "직접 방문", host: null };
	if (host === selfHost.toLowerCase() || host.endsWith(".zerolive.co.kr") || host === "zerolive.co.kr") {
		return { group: "internal", source: "내부 이동", host };
	}
	for (const [re, name] of AI_REFS) if (re.test(host)) return { group: "ai", source: name, host };
	for (const [re, name] of SEARCH_REFS) if (re.test(host)) return { group: "search", source: name, host };
	for (const [re, name] of SOCIAL_REFS) if (re.test(host)) return { group: "social", source: name, host };
	return { group: "referral", source: host, host };
}

/** 화면·통계에 담지 않는 요청 — 정적 파일과 브라우저가 자동으로 부르는 것들. */
const SKIP_PATH = /\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wasm)$/i;
export function isAsset(path: string): boolean {
	const p = (path || "").split("?")[0];
	if (p === "/favicon.ico" || p.startsWith("/_next/static") || p.startsWith("/assets/")) return true;
	// robots.txt · sitemap.xml · llms.txt 는 크롤러가 다녀간 증거라 그대로 남긴다.
	return SKIP_PATH.test(p);
}

/** IP는 그대로 두지 않는다 — 방문자 수를 세는 데만 쓰므로 짧은 해시로 바꿔 담는다. */
async function hashIP(ip: string, salt: string): Promise<string | null> {
	if (!ip) return null;
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${ip}`));
	return Array.from(new Uint8Array(buf).slice(0, 8))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

const trim = (v: unknown, n: number): string | null => {
	const s = typeof v === "string" ? v.trim() : "";
	return s ? s.slice(0, n) : null;
};
const num = (v: unknown): number | null => {
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? Math.trunc(n) : null;
};

export interface HitIn {
	site?: string; path?: string; status?: number; ms?: number; ua?: string; ref?: string;
	country?: string; region?: string; city?: string; ip?: string; method?: string; ts?: number;
	/** 이미 남긴 기록의 상태 코드만 고쳐 쓸 때. Next.js 404·오류 화면이 쓴다. */
	fix?: boolean; latency_ms?: number;
}

/** hits 표가 아직 없을 때만 한 번 만들고 다시 시도한다. */
async function withHits<T>(env: TrafficEnv, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (!/no such table|no such column/i.test(String(e))) throw e;
		await ensureHitsTable(env);
		return await fn();
	}
}

// ─────────────────────────────────────────────────────────────
// 없는 주소 요청(404) 가려내기
//
// 실제 기록을 보니 404의 대부분은 사람이 주소를 잘못 친 것이 아니라 자동 스캐너다.
// WordPress 취약점, .env·.git 같은 비밀 파일, 관리 도구 로그인 화면을 차례로 두드려 보고
// 하나라도 열리면 파고든다. 우리 서비스에는 WordPress도 PHP도 없어서 전부 404로 막히지만,
// "없는 주소 요청 54건"이라고만 보이면 무슨 일인지 알 수 없다. 그래서 종류를 나눠 둔다.
//
//   wordpress  워드프레스 취약점 훑기        (/wp-login.php · /wordpress/ · xmlrpc.php)
//   secret     비밀 파일 노리기              (.env · .git/config · id_rsa · backup.zip)
//   admin      관리 도구 로그인 화면 찾기     (phpmyadmin · /manager/html · cpanel)
//   probe      서버 정보·설정 엿보기         (server-status · phpinfo · /actuator/env)
//   exploit    알려진 침투 시도              (eval-stdin.php · ProxyShell · /@vite/env)
//   broken     우리 쪽 깨진 링크             (우리 사이트에서 넘어온 요청)
//   other      그 밖
// ─────────────────────────────────────────────────────────────
const THREAT_RULES: [string, RegExp][] = [
	["wordpress", /(^|\/)(wp-login|wp-admin|wp-content|wp-includes|wp-json|xmlrpc\.php|wlwmanifest)|(^|\/)(wp|wordpress)(\/|$)|(^|\/)(blog|cms|site|news|shop|test|web|new|old)\/(wp-|index\.php|wordpress)/i],
	["secret", /(^|\/)\.(env|git|aws|ssh|npmrc|netrc|htpasswd|DS_Store|vscode|idea|svn)|(^|\/)(id_rsa|credentials|secrets?|dump\.sql|backup|db|database)(\.|\/|$)|\.(sql|bak|old|zip|tar\.gz|pem|key|log)$|sftp\.json|config\.(json|php|yml|yaml)$/i],
	["admin", /(^|\/)(phpmyadmin|pma|myadmin|adminer|manager\/html|cpanel|whm|webmail|solr|jenkins|kibana|grafana|rundeck|zabbix)|login\.action|(^|\/)admin(\.php|\/login|\/config)?$/i],
	["probe", /(^|\/)(server-status|server-info|phpinfo|info\.php|trace\.axd|elmah\.axd|metrics|healthz|debug)|(^|\/)actuator|telescope\/requests|_catalog|_profiler|\/console\/?$|\/server\/?$/i],
	["exploit", /eval-stdin|vendor\/phpunit|@vite\/env|cgi-bin|shell|cmd\.exe|\/bin\/|ediscovery|autodiscover|owa\/auth|struts|hudson|\.\.[\/\\]|%2e%2e|___proxy_subdomain/i],
	// PHP도 GraphQL도 쓰지 않는다. 그런 주소를 찾는 요청은 사람이 아니라 훑어보는 쪽이다.
	["probe", /\.php($|\?|\/)|(^|\/)(graphql|gql)(\/|$)/i],
];

/** 없는 주소 요청 한 건의 종류. 404가 아니면 아무것도 붙이지 않는다. */
export function classifyThreat(path: string, status: number | null, refGroup: string): string | null {
	if (status !== 404) return null;
	for (const [kind, re] of THREAT_RULES) {
		if (re.test(path)) return kind;
	}
	// 우리 사이트 안에서 넘어온 요청이면 스캔이 아니라 우리 쪽 깨진 링크다.
	// 다만 첫 화면(/)은 빼 둔다 — 스캐너가 대상 주소를 그대로 referer에 넣는 일이 흔해서,
	// 그걸 깨진 링크로 세면 고칠 것이 없는데 있다고 나온다.
	if (refGroup === "internal" && path !== "/") return "broken";
	return "other";
}

/** 화면에 쓰는 이름과 한 줄 설명. */
export const THREAT_LABEL: Record<string, { text: string; desc: string }> = {
	wordpress: { text: "워드프레스 훑기", desc: "워드프레스 취약점을 차례로 두드려 보는 자동 스캔이에요. 우리 서비스에는 워드프레스가 없어요." },
	secret: { text: "비밀 파일 노림", desc: ".env·.git처럼 열쇠가 들어 있을 만한 파일을 찾는 요청이에요. 그런 파일을 두지 않아 열리지 않아요." },
	admin: { text: "관리 도구 찾기", desc: "phpMyAdmin·cPanel 같은 관리 화면을 찾는 요청이에요. 그런 도구를 쓰지 않아요." },
	probe: { text: "서버 정보 엿보기", desc: "서버 설정·상태를 그대로 내주는 주소를 찾는 요청이에요. 그런 주소를 열어 두지 않았어요." },
	exploit: { text: "침투 시도", desc: "알려진 취약점을 그대로 찔러 보는 요청이에요. 해당하는 소프트웨어를 쓰지 않아요." },
	broken: { text: "우리 쪽 깨진 링크", desc: "우리 사이트 안에서 넘어온 요청이에요. 링크를 고치거나 옮긴 주소를 이어 주면 좋아요." },
	other: { text: "그 밖", desc: "패턴에 맞지 않는 요청이에요. 주소 오타이거나 예전 주소일 수 있어요." },
};

/** 방문 기록 받기 — 응답은 바로 돌려주고, 쓰기는 waitUntil로 뒤에서 처리한다. */
export async function handleHit(request: Request, env: TrafficEnv, ctx: ExecutionContext): Promise<Response> {
	const ok = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
		});

	if (request.method !== "POST") return ok({ error: "POST로 보내 주세요." }, 405);
	const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
	if (!env.TRAFFIC_TOKEN || token !== env.TRAFFIC_TOKEN) return ok({ error: "인증이 필요해요." }, 401);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return ok({ error: "JSON 형식이 아니에요." }, 400);
	}
	// ── 상태 코드 보정 (fix:true)
	// Next.js 미들웨어는 응답을 만들기 전 단계라 최종 코드를 모른다. 그래서 통과 요청을 200으로
	// 남겨 두고, 404·오류 화면이 그려지면 이쪽으로 다시 알려 온다. 같은 방문자의 최근 기록을
	// 찾아 코드만 고쳐 쓴다 — 새 줄을 만들면 방문 수가 두 배로 잡힌다.
	if ((body as HitIn)?.fix === true) {
		const h = body as HitIn;
		const site = trim(h.site, 40);
		const status = num(h.status);
		if (!site || !status) return ok({ error: "site와 status가 필요해요." }, 400);
		const ipHash = await hashIP(trim(h.ip, 60) || "", env.ADMIN_PASS || "hit");
		const since = Date.now() - 120_000;
		// 경로가 오면 그 경로의 줄만 고친다. 경로 없이 "같은 방문자의 마지막 줄"을 고치면,
		// 그 사이에 다른 요청이 들어왔을 때 멀쩡한 줄이 404로 바뀐다(실제로 그렇게 됐다).
		const fixPath = (trim(h.path, 300) || "").split("?")[0];
		if (!fixPath) return ok({ ok: false, skipped: "경로를 알 수 없어 고치지 않았어요." });
		const upd = await withHits(env, () =>
			env.DB.prepare(
				"UPDATE hits SET status = ?1 WHERE id = (SELECT id FROM hits WHERE site = ?2" +
					" AND ts >= ?3 AND path = ?5 AND (?4 IS NULL OR ip_hash = ?4)" +
					" ORDER BY id DESC LIMIT 1)",
			)
				.bind(status, site, since, ipHash, fixPath)
				.run(),
		);
		const changed = upd.meta?.changes ?? 0;
		if (changed) return ok({ ok: true, fixed: changed });
		// 짝이 없으면(기록이 밀렸거나 미들웨어를 안 거친 요청) 새 줄로 남긴다.
	}

	const list = Array.isArray((body as { hits?: unknown[] })?.hits)
		? ((body as { hits: HitIn[] }).hits ?? []).slice(0, 100)
		: [body as HitIn];

	const now = Date.now();
	const salt = env.ADMIN_PASS || "hit";
	const rows: unknown[][] = [];
	for (const h of list) {
		const site = trim(h?.site, 40);
		if (!site) continue;
		const path = (trim(h?.path, 300) || "/").split("?")[0];
		if (isAsset(path)) continue;
		const ua = trim(h?.ua, 400) || "";
		const c = classifyUA(ua);
		const r = classifyRef(trim(h?.ref, 400) || "", SITES[site]?.host ?? "");
		const ts = num(h?.ts);
		rows.push([
			ts && ts > 1_600_000_000_000 && ts < now + 300_000 ? ts : now,
			site, path, num(h?.status), num(h?.ms) ?? num(h?.latency_ms),
			c.kind, c.bot, r.group, r.source, r.host,
			trim(h?.country, 8), trim(h?.region, 60), trim(h?.city, 60),
			ua.slice(0, 300), await hashIP(trim(h?.ip, 60) || "", salt), trim(h?.method, 10) || "GET",
			classifyThreat(path, num(h?.status), r.group),
		]);
	}
	if (!rows.length) return ok({ ok: true, saved: 0 });

	const stmts = rows.map((v) =>
		env.DB.prepare(
			"INSERT INTO hits (ts, site, path, status, latency_ms, kind, bot, ref_group, ref_source," +
				" ref_host, country, region, city, ua, ip_hash, method, threat)" +
				" VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
		).bind(...(v as [number, string, string, number | null, number | null, string, string | null, string, string, string | null, string | null, string | null, string | null, string, string | null, string])),
	);
	ctx.waitUntil(
		env.DB.batch(stmts).catch(async () => {
			// 표가 아직 없을 때만 한 번 만들고 다시 시도한다.
			await ensureHitsTable(env);
			await env.DB.batch(stmts).catch(() => {});
		}),
	);
	return ok({ ok: true, saved: rows.length });
}

/** hits 표는 여기서만 만든다(스키마 복구 경로에서도 부른다). */
export async function ensureHitsTable(env: TrafficEnv): Promise<void> {
	for (const sql of [
		"CREATE TABLE IF NOT EXISTS hits (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL," +
			" site TEXT NOT NULL, path TEXT, status INTEGER, latency_ms INTEGER, kind TEXT NOT NULL," +
			" bot TEXT, ref_group TEXT, ref_source TEXT, ref_host TEXT, country TEXT, region TEXT," +
			" city TEXT, ua TEXT, ip_hash TEXT, method TEXT)",
		// 없는 주소 요청(404)의 종류. 이미 있으면 조용히 실패한다.
		"ALTER TABLE hits ADD COLUMN threat TEXT",
		"CREATE INDEX IF NOT EXISTS idx_hits_ts ON hits(ts)",
		"CREATE INDEX IF NOT EXISTS idx_hits_site_ts ON hits(site, ts)",
		"CREATE INDEX IF NOT EXISTS idx_hits_kind_ts ON hits(kind, ts)",
		"CREATE INDEX IF NOT EXISTS idx_hits_threat ON hits(threat, ts)",
	]) {
		try {
			await env.DB.prepare(sql).run();
		} catch {
			/* 이미 있음 */
		}
	}
}

/**
 * 방문 기록 증분 내보내기 — 이상탐지 서버가 끌어간다.
 * 호출 로그(/admin/api/export)와 같은 방식이다. id 기준이라 서버가 며칠 꺼져 있어도
 * 복구되면 마지막 id 다음부터 밀린 만큼 따라잡는다.
 */
export async function exportHits(
	env: TrafficEnv,
	afterId: number,
	limit: number,
): Promise<{ rows: Record<string, unknown>[]; lastId: number; maxId: number; remaining: number }> {
	const n = Math.max(1, Math.min(5000, limit || 1000));
	const [rs, tail] = await withHits(env, () =>
		Promise.all([
			env.DB.prepare(
				"SELECT id, ts, site, path, status, latency_ms, kind, bot, ref_group, ref_source," +
					" ref_host, country, region, city, ip_hash, method FROM hits WHERE id > ?1" +
					" ORDER BY id ASC LIMIT ?2",
			)
				.bind(afterId, n)
				.all<Record<string, unknown>>(),
			env.DB.prepare("SELECT MAX(id) AS mx, COUNT(*) AS n FROM hits WHERE id > ?1")
				.bind(afterId)
				.first<{ mx: number | null; n: number | null }>(),
		]),
	);
	const rows = rs.results ?? [];
	const lastId = rows.length ? Number(rows[rows.length - 1].id) : afterId;
	return {
		rows,
		lastId,
		maxId: tail?.mx ?? afterId,
		remaining: Math.max(0, (tail?.n ?? 0) - rows.length),
	};
}
