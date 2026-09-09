/**
 * "달라진 것" 세 줄.
 *
 * 상황판 맨 위에서 숫자를 보고 나면 다음 질문은 늘 같다 — "그래서 뭐가 달라졌나".
 * 그 답을 규칙으로 만든다. LLM은 쓰지 않는다. 잘못된 문장이 첫 화면 맨 위에 뜨면
 * 화면 전체를 못 믿게 되므로, 문턱을 넘는 것만 말하고 넘지 못하면 아무 말도 하지 않는다.
 *
 * 값은 모두 collectBoard()가 이미 가져온 이번 기간·직전 기간 집계에서 나온다.
 * 조회를 더 하지 않는다.
 */

import type { BoardData } from "./stats";
import { countryName } from "./stats";

/** 문턱값 — 한곳에 모아 둔다. 나중에 관리 화면으로 뺄 수 있게. */
export const CHANGE_RULES = {
	/** 비용이 이 아래면 몇 배가 뛰어도 말하지 않는다(달러 단위 잡음) */
	costFloor: 1,
	costUp: 0.3,
	/** 실패가 이 건수를 넘고 한 코드가 이 비율 이상일 때 */
	failMin: 10,
	failShare: 0.6,
	/** 지연은 호출이 이만큼 있을 때만 */
	latMinCalls: 20,
	latUp: 0.5,
	/** 직전 기간에 없던 앱·모델이 이만큼 불렸을 때 */
	newMin: 5,
	/** 직전 기간에 없던 나라에서 이만큼 들어왔을 때 */
	newCountryMin: 3,
	/** 직전에 이만큼 부르던 앱이 이번에 0건일 때 */
	quietMin: 50,
	/** 늘어난 몫의 이 비율 이상을 한 앱이 차지하면 이름을 붙인다 */
	blameShare: 0.6,
	/** 최대 몇 줄까지 */
	max: 3,
};

/** 급한 순서. 같은 종류끼리는 점수(증감률·건수)로 겨룬다. */
const KIND_ORDER = ["fail", "cost", "latency", "quiet", "new", "geo"];

export interface Change {
	kind: string;
	/** 화면에 그대로 넣는 문장. 굵게 표시가 필요한 곳에만 <b>를 쓴다. */
	text: string;
	href: string;
	score: number;
}

export function findChanges(b: BoardData): Change[] {
	const R = CHANGE_RULES;
	const out: Change[] = [];
	const prev = b.prev;
	// 전체 기간을 보는 중이면 견줄 대상이 없다.
	if (!prev) return out;

	const q = `?period=${b.period}${b.appFilter ? `&app=${encodeURIComponent(b.appFilter)}` : ""}`;
	const pct = (v: number) => `${Math.round(v * 100)}%`;

	// ── 비용 급증
	if (b.cost >= R.costFloor && prev.cost > 0) {
		const up = (b.cost - prev.cost) / prev.cost;
		if (up >= R.costUp) {
			// 늘어난 돈의 대부분을 한 앱이 냈으면 이름을 붙인다.
			const grew = b.byApp
				.map((a) => ({ name: a.name, gap: a.cost - (prev.byAppCost[a.key] ?? 0) }))
				.filter((a) => a.gap > 0)
				.sort((x, y) => y.gap - x.gap);
			const gap = b.cost - prev.cost;
			const top = grew[0];
			// 다른 앱이 줄었으면 한 앱의 몫이 100%를 넘을 수 있다. 그럴 때도 "대부분"까지만 말한다.
			const share = gap > 0 && top ? Math.min(1, top.gap / gap) : 0;
			const blame = share >= R.blameShare ? ` 대부분(${pct(share)})은 <b>${top.name}</b> 몫이에요.` : "";
			out.push({
				kind: "cost",
				text: `비용이 직전 같은 기간보다 <b>${pct(up)}</b> 늘었어요.${blame}`,
				href: `/admin/calls/usage${q}`,
				score: up,
			});
		}
	}

	// ── 실패가 한 코드에 몰림
	if (b.error >= R.failMin && b.byHttp.length) {
		const top = b.byHttp[0];
		if (top.count / b.error >= R.failShare) {
			out.push({
				kind: "fail",
				text: `실패 ${b.error.toLocaleString()}건 가운데 <b>${top.count.toLocaleString()}건</b>이 ${
					HTTP_WHY[top.http] ? `${HTTP_WHY[top.http]}(${top.http})` : `HTTP ${top.http || "코드 없음"}`
				}에서 났어요.`,
				href: `/admin/calls/logs${q}&status=error${top.http ? `&http=${top.http}` : ""}`,
				score: b.error,
			});
		}
	}

	// ── 지연 악화
	if (b.total >= R.latMinCalls && prev.p95Latency > 0) {
		const up = (b.p95Latency - prev.p95Latency) / prev.p95Latency;
		if (up >= R.latUp) {
			out.push({
				kind: "latency",
				text: `p95 지연이 <b>${(b.p95Latency / 1000).toFixed(1)}초</b>로 직전의 ${(b.p95Latency / prev.p95Latency).toFixed(1)}배가 됐어요.`,
				href: `/admin/calls/logs${q}&slow=${Math.round(prev.p95Latency)}`,
				score: up,
			});
		}
	}

	// ── 새 앱 · 새 모델
	const newApp = b.byApp
		.filter((a) => !prev.byApp[a.key] && a.total >= R.newMin)
		.sort((x, y) => y.total - x.total)[0];
	if (newApp) {
		out.push({
			kind: "new",
			text: `새 앱 <b>${newApp.name}</b>에서 ${newApp.total.toLocaleString()}건 들어왔어요.`,
			href: `/admin/calls/usage${q}`,
			score: newApp.total,
		});
	}
	const newModel = b.byModel
		.filter((m) => !prev.byModel[m.key] && m.total >= R.newMin && m.key !== "(미상)")
		.sort((x, y) => y.total - x.total)[0];
	if (newModel) {
		out.push({
			kind: "new",
			text: `<b>${short(newModel.key)}</b> 모델을 처음 썼어요 (${newModel.total.toLocaleString()}건).`,
			href: `/admin/calls/usage${q}#model`,
			score: newModel.total,
		});
	}

	// ── 새 지역
	const newCountry = b.byCountry
		.filter((c) => c.key !== "(미상)" && !prev.byCountry[c.key] && c.total >= R.newCountryMin)
		.sort((x, y) => y.total - x.total)[0];
	if (newCountry) {
		out.push({
			kind: "geo",
			text: `<b>${countryName(newCountry.key)}</b>에서 처음으로 ${newCountry.total.toLocaleString()}건 들어왔어요.`,
			href: `/admin/calls/geo${q}`,
			score: newCountry.total,
		});
	}

	// ── 조용해짐
	const nowApp = new Map(b.byApp.map((a) => [a.key, a.total]));
	const appName = new Map(b.apps.map((a) => [a.id, a.name]));
	const quiet = Object.entries(prev.byApp)
		.filter(([k, n]) => n >= R.quietMin && !nowApp.get(k))
		.sort((x, y) => y[1] - x[1])[0];
	if (quiet) {
		out.push({
			kind: "quiet",
			text: `<b>${appName.get(quiet[0]) ?? quiet[0]}</b> 호출이 끊겼어요 (직전 ${quiet[1].toLocaleString()}건 → 0건).`,
			href: `/admin/calls/logs${q}&app=${encodeURIComponent(quiet[0])}`,
			score: quiet[1],
		});
	}

	// 급한 종류를 먼저, 같은 종류끼리는 점수가 큰 것을 먼저.
	// 종류마다 점수의 단위가 달라(배수 · 건수) 한 줄로 세울 수 없어서 순서를 정해 둔다.
	out.sort((x, y) => {
		const d = KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind);
		return d !== 0 ? d : y.score - x.score;
	});
	return out.slice(0, R.max);
}

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

const short = (m: string) => m.replace(/^[^/]+\//, "");
