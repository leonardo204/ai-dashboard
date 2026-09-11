/**
 * 상황판 브리핑 — "내가 안 보는 사이에 무슨 일이 있었나".
 *
 * 예전 '달라진 것' 세 줄은 기간 탭(7일·30일)을 그대로 따라갔다. 그래서 30일을 보는 동안
 * 같은 세 줄이 한 달 내내 떠 있었고, "처음 썼어요"가 12일 전 일을 가리켰다.
 * 직전 30일에 데이터가 없으면 그 기간의 모든 앱·모델·나라가 '처음'으로 잡혔기 때문이다.
 *
 * 그래서 두 가지를 갈랐다.
 *   - 지표 카드는 기간 탭을 따른다(30일 합계는 30일 합계다).
 *   - 브리핑은 '마지막으로 본 뒤'를 따른다. 아침에 열면 밤사이, 월요일에 열면 주말 사이다.
 *
 * '처음'은 전체 기록에서 처음일 때만 말한다(seen_key 표). 창 안에서 처음 나타난 것이
 * 새 소식이고, 그전에도 있던 신호는 새 소식 셈에서 빼고 아래 흐린 줄에 따로 적는다.
 * 말할 것이 없으면 아무 말도 지어내지 않고 "별다른 일 없었어요"로 끝낸다.
 *
 * LLM은 쓰지 않는다. 첫 화면 맨 위에 틀린 문장이 뜨면 화면 전체를 못 믿게 된다.
 */

const KST = 9 * 3600_000;
const HOUR = 3600_000;
const DAY = 86_400_000;

/** 창을 고르는 탭. auto는 마지막으로 본 때를 따른다. */
export type BriefKey = "auto" | "day" | "d3" | "w1" | "m1";

export const BRIEF_TABS: { key: BriefKey; label: string; days: number }[] = [
	{ key: "day", label: "하루", days: 1 },
	{ key: "d3", label: "3일", days: 3 },
	{ key: "w1", label: "일주일", days: 7 },
	{ key: "m1", label: "한 달", days: 30 },
];

export interface BriefWindow {
	key: BriefKey;
	/** 창 시작(epoch ms) */
	from: number;
	/** 견줄 직전 같은 길이의 시작 */
	prevFrom: number;
	/** "밤사이" · "주말 사이" · "지난 3일" */
	label: string;
	/** "어제 18:20 이후" 같은 부연 */
	sub: string;
	/** 마지막으로 본 때를 따라 저절로 정해졌나 */
	auto: boolean;
	/** 창을 정한 시각. 문장에서 "며칠 전"을 셀 때 쓴다(시계를 직접 보지 않는다). */
	now: number;
}

/** 같은 세션으로 볼 간격. 이 안에 다시 열면 창을 그대로 둔다. */
export const SESSION_GAP = 3 * HOUR;
/** 자동 창의 최대 길이. 오래 자리를 비워도 한 달까지만 거슬러 올라간다. */
const AUTO_MAX = 30 * DAY;
/** 자동 창의 최소 길이. 연달아 새로고침해도 창이 0으로 쪼그라들지 않게 한다. */
const AUTO_MIN = 20 * 60_000;

interface KstParts { y: number; m: number; d: number; h: number; dow: number; dayNo: number }

/** KST 기준 날짜 조각. dayNo는 1970-01-01부터 센 날짜라 날짜 차이를 바로 뺄 수 있다. */
function kstOf(ts: number): KstParts {
	const k = new Date(ts + KST);
	return {
		y: k.getUTCFullYear(),
		m: k.getUTCMonth() + 1,
		d: k.getUTCDate(),
		h: k.getUTCHours(),
		dow: k.getUTCDay(),
		dayNo: Math.floor((ts + KST) / DAY),
	};
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * 창을 정한다.
 *
 * 고정 탭을 골랐으면 그대로 쓰고, auto면 마지막으로 본 때부터 지금까지로 잡는다.
 * 라벨은 그 구간이 실제로 어떤 구간인지 보고 붙인다 — 어젯밤부터면 "밤사이",
 * 금요일 저녁부터 월요일이면 "주말 사이". 사람이 부르는 이름과 맞아야 읽힌다.
 */
export function briefWindow(now: number, winFrom: number | null, key: BriefKey = "auto"): BriefWindow {
	const fixed = BRIEF_TABS.find((t) => t.key === key);
	if (fixed) {
		const from = now - fixed.days * DAY;
		return {
			key,
			from,
			prevFrom: from - fixed.days * DAY,
			// 자동 라벨과 같은 말을 쓴다. 탭 글자는 짧게 두고(하루·3일·일주일·한 달)
			// 머리말은 기간으로 읽히는 말로 바꾼다.
			label: FIXED_LABEL[key] ?? `지난 ${fixed.label}`,
			sub: `${fmtPoint(from, now)} 이후`,
			auto: false,
			now,
		};
	}

	// 기록이 없으면(처음 열었거나 표가 비었으면) 하루치를 본다.
	let from = winFrom ?? now - DAY;
	if (now - from > AUTO_MAX) from = now - AUTO_MAX;
	if (now - from < AUTO_MIN) from = now - AUTO_MIN;
	const span = now - from;

	return {
		key: "auto",
		from,
		prevFrom: from - span,
		label: autoLabel(from, now),
		sub: `${fmtPoint(from, now)} 이후`,
		auto: true,
		now,
	};
}

/** 창 시작을 사람이 읽는 시점으로. 오늘·어제는 날짜 대신 그렇게 부른다. */
function fmtPoint(from: number, now: number): string {
	const f = kstOf(from);
	const n = kstOf(now);
	const gap = n.dayNo - f.dayNo;
	const hm = `${two(f.h)}:${two(new Date(from + KST).getUTCMinutes())}`;
	if (gap === 0) return `오늘 ${hm}`;
	if (gap === 1) return `어제 ${hm}`;
	if (gap < 7) return `${WD[f.dow]}요일 ${hm}`;
	return `${f.m}월 ${f.d}일`;
}

const WD = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 자동 창의 이름.
 * 위에서부터 먼저 맞는 것 하나를 쓴다. 사람이 그 구간을 실제로 부르는 이름이 있으면
 * 그 이름이 "지난 15시간"보다 훨씬 빨리 읽힌다.
 */
function autoLabel(from: number, now: number): string {
	const f = kstOf(from);
	const n = kstOf(now);
	const gapDays = n.dayNo - f.dayNo;
	const h = (now - from) / HOUR;

	// 주말 사이 — 금요일 저녁 이후에 마지막으로 보고 월·화요일에 다시 열었을 때.
	if ((f.dow === 5 && f.h >= 16) || f.dow === 6 || f.dow === 0) {
		if ((n.dow === 1 || n.dow === 2) && gapDays >= 1 && gapDays <= 4) return "주말 사이";
	}
	// 밤사이 — 어제 저녁 이후에 보고 오늘 아침에 다시 열었을 때.
	if (gapDays === 1 && f.h >= 16 && n.h <= 13) return "밤사이";
	// 새벽에 보고 아침에 다시 연 경우도 밤으로 친다.
	if (gapDays === 0 && f.h <= 5 && n.h >= 5 && n.h <= 13) return "밤사이";

	if (h < 1.5) return "방금 사이";
	if (h < 12) return `지난 ${Math.round(h)}시간`;
	if (h < 30) return "하루 사이";

	// 여기서부터는 시간을 24로 나눠 반올림하지 않는다. 33시간이 "지난 1일"이 되어
	// 하루도 아니고 이틀도 아닌 이름이 붙었다. 날짜가 몇 번 넘어갔는지로 센다.
	// 이틀·사흘은 "어제부터"·"그제부터"가 더 정확하다 — 언제부터인지를 그대로 말한다.
	if (gapDays === 1) return "어제부터";
	if (gapDays === 2) return "그제부터";
	if (gapDays <= 6) return `${NAT_DAYS[gapDays]} 사이`;
	if (gapDays === 7) return "일주일 사이";
	// "지난 15일"은 날짜(15일)로도 읽힌다. "동안"을 붙여 기간임을 못박는다.
	if (gapDays <= 25) return `${gapDays}일 동안`;
	return "한 달 사이";
}

/** 고정 탭을 골랐을 때 머리말. 자동 라벨과 같은 말을 쓴다. */
const FIXED_LABEL: Record<string, string> = {
	day: "하루 사이", d3: "사흘 사이", w1: "일주일 사이", m1: "한 달 사이",
};

/** 날수를 세는 우리말 수사. 이레·여드레는 잘 쓰지 않아 여기까지만 둔다. */
const NAT_DAYS = ["", "하루", "이틀", "사흘", "나흘", "닷새", "엿새"];

// ─────────────────────────────────────────────────────────────
// 브리핑 문장
// ─────────────────────────────────────────────────────────────

/** 문턱값 — 한곳에 모아 둔다. 나중에 관리 화면으로 뺄 수 있게. */
export const BRIEF_RULES = {
	/** 실패를 말할 최소 건수. 창이 짧으면 한두 건도 말할 값이 있다. */
	failMin: 3,
	/** 한 HTTP 코드가 이 비율 이상이면 이름을 붙인다 */
	failShare: 0.5,
	/** 비용이 이 아래면 몇 배가 뛰어도 말하지 않는다 */
	costFloor: 0.5,
	costUp: 0.4,
	/** 새 앱·모델은 이만큼 불렸을 때 */
	newMin: 3,
	/** 새 나라는 이만큼 들어왔을 때 */
	newCountryMin: 3,
	/** 직전에 이만큼 부르던 앱이 창 안에 0건일 때 */
	quietMin: 20,
	/** 지연은 호출이 이만큼 있을 때만, 이 배수를 넘을 때 */
	latMinCalls: 20,
	latUp: 0.6,
	/** 늘어난 몫의 이 비율 이상을 한 앱이 차지하면 이름을 붙인다 */
	blameShare: 0.6,
	/** 새 소식은 몇 줄까지 */
	max: 4,
	/** 되풀이되는 신호는 몇 줄까지 */
	maxRepeat: 2,
	/** 새 소식과 되풀이 줄을 합쳐 몇 줄까지. 이 칸이 길어지면 첫 화면이 한눈에 안 들어온다. */
	maxLines: 5,
};

/** 급한 순서. 종류마다 점수의 단위가 달라(배수·건수) 한 줄로 세울 수 없어 순서를 정해 둔다. */
const KIND_ORDER = ["anomaly", "fail", "cost", "latency", "quiet", "new", "geo", "repeat"];

export interface BriefLine {
	kind: string;
	/** 화면에 그대로 넣는 문장. 굵게 할 곳에만 <b>를 쓴다. */
	text: string;
	href: string;
	/** 언제 일어난 일인가. 0이면 구간 전체에 걸친 일이다. */
	at: number;
	score: number;
}

export interface BriefAgg {
	total: number;
	ok: number;
	error: number;
	cost: number;
	latSum: number;
}

export interface BriefKeyRow {
	key: string;
	name: string;
	total: number;
	error: number;
	cost: number;
	/** 창 안에서 처음·마지막으로 본 시각 */
	firstTs: number;
	lastTs: number;
}

/** findBrief가 쓰는 것만 모은 좁은 입력. stats.ts를 되짚지 않으려고 따로 둔다. */
export interface BriefInput {
	win: BriefWindow;
	period: string;
	appFilter: string;
	cur: BriefAgg;
	prev: BriefAgg;
	byApp: BriefKeyRow[];
	byModel: BriefKeyRow[];
	byCountry: BriefKeyRow[];
	byHttp: { http: number; count: number }[];
	/** 창 직전 같은 길이의 앱별 호출 수 — 조용해짐을 판단한다 */
	prevApp: Record<string, number>;
	prevAppCost: Record<string, number>;
	/** 전체 기록 기준 처음 본 시각. "kind|key" → ts */
	firstSeen: Record<string, number>;
	/** 창 안에 처음 잡힌 신호(창 앞에는 없던 종류) */
	anomIn: { critical: number; warn: number; top: { label: string; app: string; bucket: number } | null };
	/**
	 * 창 앞에도 있었고 창 안에도 있는 신호 — 새 소식이 아니라 되풀이되는 일이다.
	 * n은 센 범위(창 직전 이레부터) 전체 건수, nin은 그중 창 안 건수, critical은 범위 안 심각 건수.
	 */
	anomRepeat: { label: string; n: number; nin: number; critical: number; firstb: number; lastin: number }[];
	/**
	 * 창보다 앞서 잡혔고 아직 결론이 안 난 신호(판정 전이거나 표가 갈린 것).
	 * count는 창 직전 이레 안에서만 센다. oldest는 그중 가장 오래된 구간 시각(없으면 0).
	 */
	/** 앱 id → 이름 */
	appName: Record<string, string>;
	countryName: (k: string) => string;
}

export interface Brief {
	/** 창 안에 새로 일어난 일 */
	fresh: BriefLine[];
	/** 창 앞에도 있던 신호 — 새 소식 셈에서 뺐다는 것을 밝히는 자리다 */
	repeat: BriefLine[];
	/** 새 소식이 없을 때 대신 적는 한 줄 */
	quiet: string;
}

export function findBrief(b: BriefInput): Brief {
	const R = BRIEF_RULES;
	const fresh: BriefLine[] = [];
	const repeat: BriefLine[] = [];
	const q = `?period=${b.period}${b.appFilter ? `&app=${encodeURIComponent(b.appFilter)}` : ""}`;
	const pct = (v: number) => `${Math.round(v * 100)}%`;
	const win = b.win;

	// ── 이상 신호가 새로 잡혔나.
	//    창 앞에도 있던 종류는 여기서 세지 않는다(아래 '또 잡힌 신호'가 맡는다).
	//    그러지 않으면 며칠째 같은 일이 나는 동안 "새로 잡혔어요"가 날마다 떴다.
	if (b.anomIn.critical || b.anomIn.warn) {
		const t = b.anomIn.top;
		const parts: string[] = [];
		if (b.anomIn.critical) parts.push(`심각 <b>${b.anomIn.critical}건</b>`);
		if (b.anomIn.warn) parts.push(`주의 ${b.anomIn.warn}건`);
		fresh.push({
			kind: "anomaly",
			text:
				`이상 신호가 새로 잡혔어요 (${parts.join(", ")}).` +
				(t ? ` <b>${esc(t.label)}</b>${josa(t.label, "이", "가")} ${esc(appLabel(b, t.app))}에서 나왔어요.` : ""),
			href: `/admin/anomaly${q}`,
			at: t?.bucket ?? 0,
			score: b.anomIn.critical * 100 + b.anomIn.warn,
		});
	}

	// ── 실패
	if (b.cur.error >= R.failMin) {
		const top = b.byHttp[0];
		const rate = b.cur.total ? (b.cur.error / b.cur.total) * 100 : 0;
		const worst = b.byApp.filter((a) => a.error > 0).sort((x, y) => y.error - x.error)[0];
		// 앱 이름을 앞에 두면 "어디서 났나"가 먼저 읽힌다. 코드는 그다음이다.
		const who = worst && b.byApp.length > 1 ? `<b>${esc(worst.name)}</b>에서 ` : "";
		const why =
			top && top.count / b.cur.error >= R.failShare
				? ` ${top.count >= b.cur.error ? "모두" : `대부분(${top.count.toLocaleString()}건)이`} ${httpWhy(top.http)} 때문이에요.`
				: "";
		fresh.push({
			kind: "fail",
			text:
				`${who}실패가 <b>${b.cur.error.toLocaleString()}건</b> 났어요.${why}` +
				(rate >= 5 ? ` 실패율 ${pct1(rate)}.` : ""),
			href: `/admin/calls/logs${q}&status=error${top?.http ? `&http=${top.http}` : ""}`,
			at: 0,
			score: b.cur.error,
		});
	}

	// ── 비용
	// 직전 구간에 호출 자체가 없으면 견줄 것이 없다. "쓴 돈이 없었다"와 "기록이 없다"는 다르다.
	if (b.cur.cost >= R.costFloor && b.prev.cost <= 0 && b.prev.total > 0) {
		fresh.push({
			kind: "cost",
			text: `바로 앞 같은 기간에는 쓴 돈이 없는데, 이번에는 <b>${usd(b.cur.cost)}</b> 썼어요.`,
			href: `/admin/calls/usage${q}`,
			at: 0,
			score: 10,
		});
	} else if (b.cur.cost >= R.costFloor && b.prev.cost > 0) {
		const up = (b.cur.cost - b.prev.cost) / b.prev.cost;
		if (up >= R.costUp) {
			const money = usd(b.cur.cost);
			// 금액 뒤에는 조사를 붙이지 않는다. "$1.20"을 "일 점 이"로 읽으면 받침이 없고
			// "이영"으로 읽으면 남아서, 로/으로 어느 쪽을 써도 걸리는 사람이 나온다.
			// 숫자를 괄호로 빼면 그 판단 자체가 없어진다.
			const gap = b.cur.cost - b.prev.cost;
			const grew = b.byApp
				.map((a) => ({ name: a.name, gap: a.cost - (b.prevAppCost[a.key] ?? 0) }))
				.filter((a) => a.gap > 0)
				.sort((x, y) => y.gap - x.gap)[0];
			// 다른 앱이 줄었으면 한 앱의 몫이 100%를 넘을 수 있다. 그럴 때도 "대부분"까지만 말한다.
			const share = gap > 0 && grew ? Math.min(1, grew.gap / gap) : 0;
			const blame =
				share >= 0.995
					? ` 늘어난 몫은 전부 <b>${esc(grew.name)}</b> 것이에요.`
					: share >= R.blameShare
						? ` 대부분(${pct(share)})은 <b>${esc(grew.name)}</b> 몫이에요.`
						: "";
			fresh.push({
				kind: "cost",
				text: `비용이 바로 앞 같은 기간보다 <b>${pct(up)}</b> 늘었어요 (${money}).${blame}`,
				href: `/admin/calls/usage${q}`,
				at: 0,
				score: up,
			});
		}
	}

	// ── 지연
	if (b.cur.total >= R.latMinCalls && b.prev.total >= R.latMinCalls) {
		const now = b.cur.total ? b.cur.latSum / b.cur.total : 0;
		const was = b.prev.total ? b.prev.latSum / b.prev.total : 0;
		if (was > 0 && (now - was) / was >= R.latUp) {
			fresh.push({
				kind: "latency",
				text: `평균 응답이 바로 앞 같은 기간의 <b>${(now / was).toFixed(1)}배</b>가 됐어요 (${(now / 1000).toFixed(1)}초).`,
				href: `/admin/calls/logs${q}&slow=${Math.round(was * 2)}`,
				at: 0,
				score: (now - was) / was,
			});
		}
	}

	// ── 처음 본 것 — 전체 기록에서 처음이어야 '처음'이라고 말한다.
	pushFirst(b, fresh, "model", b.byModel, R.newMin, (r) =>
		`<b>${esc(shortModel(r.key))}</b> 모델을 처음 썼어요 (${r.total.toLocaleString()}건).`, `/admin/calls/usage${q}#model`);
	pushFirst(b, fresh, "app", b.byApp, R.newMin, (r) =>
		`새 앱 <b>${esc(r.name)}</b>에서 ${r.total.toLocaleString()}건 들어왔어요.`, `/admin/calls/usage${q}`);
	pushFirst(b, fresh, "country", b.byCountry, R.newCountryMin, (r) =>
		`<b>${esc(b.countryName(r.key))}</b>에서 처음으로 ${r.total.toLocaleString()}건 들어왔어요.`, `/admin/calls/geo${q}`);

	// ── 조용해짐
	const nowApp = new Map(b.byApp.map((a) => [a.key, a.total]));
	const quiet = Object.entries(b.prevApp)
		.filter(([k, n]) => n >= R.quietMin && !nowApp.get(k))
		.sort((x, y) => y[1] - x[1])[0];
	if (quiet) {
		fresh.push({
			kind: "quiet",
			text: `<b>${esc(b.appName[quiet[0]] ?? quiet[0])}</b> 호출이 끊겼어요. 바로 앞 같은 기간에는 ${quiet[1].toLocaleString()}건이었어요.`,
			href: `/admin/calls/logs${q}&app=${encodeURIComponent(quiet[0])}`,
			at: 0,
			score: quiet[1],
		});
	}

	// ── 또 잡힌 신호 — 창 앞에도 있었고 창 안에도 있다. 새 소식이 아니라 되풀이되는 일이다.
	//
	//    문구에서 조심한 것 두 가지.
	//    "사흘째"나 "이어지고 있어요"라고 쓰지 않는다 — 날마다 빠짐없이 났는지는 확인하지 않으므로
	//    하루 건너 난 것을 연속으로 읽히게 만든다. 센 건수와 첫날만 적는다.
	//    "N일부터"가 아니라 "N일 이후로"를 쓴다 — 센 범위가 창 직전 이레까지라, 그보다 앞선 일이
	//    있었는지는 알 수 없다. '부터'는 그날이 처음이었다고 읽힌다.
	//    앱 이름은 붙이지 않는다 — 탐지기가 같은 일에 앱별 행과 전체('*') 행을 함께 남겨서
	//    한 앱을 지목하면 틀린 말이 된다. 어느 앱인지는 눌러서 이상탐지 화면에서 본다.
	for (const r of b.anomRepeat.slice().sort((x, y) => y.critical - x.critical || y.n - x.n).slice(0, R.maxRepeat)) {
		const f = kstOf(r.firstb);
		repeat.push({
			kind: "repeat",
			text:
				`<b>${esc(r.label)}</b>${josa(r.label, "은", "는")} 처음이 아니에요.` +
				` ${f.m}/${f.d} 이후로 ${r.n.toLocaleString()}번 잡혔어요.` +
				(r.critical ? ` 그중 ${r.critical.toLocaleString()}번이 심각이에요.` : ""),
			href: `/admin/anomaly${q}`,
			at: r.lastin,
			score: r.critical * 100 + r.n,
		});
	}

	const bySort = (x: BriefLine, y: BriefLine) => {
		const d = KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind);
		return d !== 0 ? d : y.score - x.score;
	};
	fresh.sort(bySort);
	repeat.sort(bySort);

	// 새 소식이 많은 날에는 되풀이 줄을 줄인다. 새로 벌어진 일이 먼저 읽혀야 한다.
	const head = fresh.slice(0, R.max);
	const room = Math.max(1, R.maxLines - head.length);
	return {
		fresh: head,
		repeat: repeat.slice(0, Math.min(R.maxRepeat, room)),
		quiet: quietLine(b, win),
	};
}

/**
 * "처음 썼어요"는 전체 기록에서 처음일 때만 말한다.
 * 창 안에서 처음 보였더라도 그전에 쓴 적이 있으면 새 소식이 아니다. 그때는 아무 말도 하지 않는다.
 */
function pushFirst(
	b: BriefInput,
	fresh: BriefLine[],
	kind: string,
	rows: BriefKeyRow[],
	min: number,
	say: (r: BriefKeyRow) => string,
	href: string,
): void {
	// 기록이 아직 없으면 '모른다'이지 '처음'이 아니다. 여기서 창 안 첫 등장으로 갈음하면
	// 바로 예전 버그로 돌아간다 — 늘 쓰던 모델과 한국이 날마다 '처음'으로 떴다.
	if (!Object.keys(b.firstSeen).length) return;
	const cand = rows
		.filter((r) => r.total >= min && r.key !== "(미상)")
		.map((r) => ({ r, seen: b.firstSeen[`${kind}|${r.key}`] ?? 0 }))
		.filter((x) => x.seen > 0 && x.seen >= b.win.from)
		.sort((x, y) => y.r.total - x.r.total)[0];
	if (!cand) return;
	fresh.push({
		kind: kind === "country" ? "geo" : "new",
		text: say(cand.r),
		href,
		at: cand.seen,
		score: cand.r.total,
	});
}

/**
 * 새 소식이 없을 때 대신 적는 한 줄. 숫자를 보여 주고 끝낸다.
 *
 * 되풀이되는 신호가 있으면 "별다른 일 없었어요"라고 쓰지 않는다. 그 신호는 창 안에도 났으므로
 * 아무 일도 없었다는 말이 되어 바로 아래 줄과 어긋난다. 그때는 "새로 생긴 일은 없어요"로
 * 범위를 좁혀 적는다 — 없는 것은 '새 소식'이지 '일' 자체가 아니다.
 */
function quietLine(b: BriefInput, win: BriefWindow): string {
	if (!b.cur.total) return `${win.label} 호출이 없었어요.`;
	const head = b.anomRepeat.length ? `${win.label} 새로 생긴 일은 없어요.` : `${win.label} 별다른 일 없었어요.`;
	const calls = `호출 ${b.cur.total.toLocaleString()}건`;
	const fail = b.cur.error
		? `${calls} 가운데 실패 ${b.cur.error.toLocaleString()}건`
		: `${calls}에 실패는 없고`;
	return `${head} ${fail}, 비용은 ${usd(b.cur.cost)} 나왔어요.`;
}

const appLabel = (b: BriefInput, app: string) => (app === "*" ? "전체" : b.appName[app] ?? app);

/**
 * 앞말 받침에 따라 조사를 고른다.
 *
 * 앱·모델·신호 이름이 무엇일지 미리 알 수 없어서 "급증이"와 "급증가"를 둘 다 만날 수 있다.
 * 한글은 유니코드로 종성을 바로 볼 수 있고, 숫자와 영문은 읽는 소리로 가른다
 * (영문은 l·m·n으로 끝날 때만 받침이 남는다 — '모델'은 있고 '에이전트'는 없다).
 */
const DIGIT_FINAL = new Set(["0", "1", "3", "6", "7", "8"]);
const ALPHA_FINAL = new Set(["l", "m", "n"]);
export function hasFinal(word: string): boolean {
	const c = String(word || "").trim().replace(/[)\]"'\u2019\u300d]+$/, "").slice(-1).toLowerCase();
	if (!c) return false;
	const code = c.charCodeAt(0);
	if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
	if (/[0-9]/.test(c)) return DIGIT_FINAL.has(c);
	if (/[a-z]/.test(c)) return ALPHA_FINAL.has(c);
	return false;
}
const josa = (w: string, withFinal: string, without: string) => (hasFinal(w) ? withFinal : without);

/** 자주 나오는 HTTP 코드는 뜻을 붙여 준다. 코드만 보고 아는 사람은 많지 않다. */
const HTTP_WHY: Record<number, string> = {
	400: "잘못된 요청",
	401: "인증 실패",
	403: "막힌 앱",
	404: "없는 주소",
	408: "시간 초과",
	429: "요청 한도",
	500: "서버 오류",
	502: "게이트웨이 오류",
	503: "서비스 불가",
	504: "응답 시간 초과",
};
const httpWhy = (h: number) => (HTTP_WHY[h] ? `${HTTP_WHY[h]}(${h})` : h ? `HTTP ${h}` : "코드 없는 실패");

/** 6.0% 대신 6%. 소수 한 자리는 10% 아래에서 뜻이 있을 때만 남긴다. */
const pct1 = (v: number) => {
	const s = v < 10 ? v.toFixed(1) : v.toFixed(0);
	return `${s.endsWith(".0") ? s.slice(0, -2) : s}%`;
};

const shortModel = (m: string) => m.replace(/^[^/]+\//, "");
/** 브리핑에서는 읽기 쉬운 자리까지만. 1센트가 안 되는 값만 네 자리로 편다. */
const usd = (v: number) => `$${v >= 0.01 ? v.toFixed(2) : v.toFixed(4)}`;
const esc = (s: string) =>
	String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
