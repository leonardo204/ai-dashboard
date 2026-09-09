/**
 * 관리 화면 본문 — 화면 6개.
 *
 *   요약   /admin        한눈에 보는 지표·차트. 긴 표를 두지 않는다.
 *   사용량 /admin/usage  앱·모델·용도별 표
 *   추이   /admin/trend  기간별 흐름 + 요일×시각 히트맵
 *   지역   /admin/geo    지도 + 국가·도시별 표
 *   이상   /admin/anomaly 이상 신호 현황 · 모델 정보 · 탐지 서버 상태
 *   로그   /admin/logs   호출 1건씩 검색
 *   앱관리 /admin/apps   토큰·모델 맵·상한
 *
 * 데이터 조회는 stats.ts, 공통 틀·차트는 ui.ts에 있다.
 */

import {
	PERIODS, MODEL_PRICES, DEFAULT_MODEL, countryName, LOG_PAGE, SUMMARY_RECENT, MAIL_PAGE,
	type AppConfig, type GroupRow, type PasskeyRow,
	type SummaryData, type UsageData, type TrendData, type GeoData, type LogsData, type LogFilter,
	type MailsData, type MailRow,
	type AnomalyBoardData, type AnomalyRowWithMail, ANOMALY_PAGE,
	type AnomalyBrief,
	type AnomalyData, type AnomalyRow,
	type TrafficData, type TrafficBrief,
} from "./stats";
import {
	escapeHtml, usd, kst, shortNum, shellAdmin, pageHead, filterTabs, sectionHead, delta,
	svgTrend, svgMap, svgShare, svgDonut, svgHeat, svgLevels, svgF1, svgTraffic, type AdminOpts,
} from "./ui";
import { SITES, siteName, siteUrl, THREAT_LABEL } from "./traffic";

/** 상단바 메뉴가 기간·앱 조건을 그대로 물고 가도록 붙이는 질의 문자열. */
function navQuery(period: string, appFilter: string): string {
	return `?period=${period}${appFilter ? `&app=${encodeURIComponent(appFilter)}` : ""}`;
}
const shortModel = (m: string) => m.replace(/^[^/]+\//, "");
const sinceLabel = (since: number) => (since ? `${kst(since).slice(0, 5)} 이후` : "전체 기간");
const avgLat = (r: GroupRow) => (r.total ? Math.round(r.latency / r.total) : 0);

/** 표 위에 붙는 검색칸 — 줄이 많은 표에서 쓴다. */
/**
 * 폭을 못박은 표의 칸 정의.
 * "88" 처럼 쓰면 그 폭으로 고정하고, ""이면 남는 폭을 나눠 갖는다.
 * "70:o1"처럼 뒤에 붙이면 화면이 좁아질 때 접히는 칸이 된다(o1이 먼저, o2가 나중).
 */
function cols(...list: string[]): string {
	return `<colgroup>${list
		.map((c) => {
			const [w, o] = c.split(":");
			return `<col${o ? ` class="${o}"` : ""}${w ? ` style="width:${w}px"` : ""}>`;
		})
		.join("")}</colgroup>`;
}

function tableFilter(tableId: string, placeholder: string): string {
	return `<input data-filter="${tableId}" placeholder="${escapeHtml(placeholder)}" style="max-width:240px">`;
}

const FOOT_GEO =
	"국가·지역은 Cloudflare가 요청에 붙여주는 값이라 외부 조회 없이 기록돼요. VPN·통신사 경로에 따라 실제와 다를 수 있어요.";
const FOOT_COST =
	"비용은 OpenRouter가 응답에 실어주는 실제 청구액이에요. 내 키를 붙여 쓰는(BYOK) 호출은 " +
	"OpenRouter 크레딧이 줄지 않아 청구액이 0으로 오는데, 그때는 모델 회사가 알려준 금액을 쓰고 " +
	"그것도 없으면 단가표로 추정해요(* = 단가 미등록 모델). 최종 청구액은 OpenRouter와 모델 회사 대시보드가 기준이에요.";

// ═════════════════════════════════════════════════════════════
// 요약 (/admin)
// ═════════════════════════════════════════════════════════════

export function renderSummary(s: SummaryData, opts: AdminOpts = {}): string {
	const q = navQuery(s.period, s.appFilter);
	const okRate = s.total ? Math.round((s.ok / s.total) * 100) : 0;
	const errRate = s.total ? (s.error / s.total) * 100 : 0;

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

	// 눈여겨볼 것만 앱 탭 줄 오른쪽에. 평소에는 아무것도 뜨지 않는다.
	const alerts: string[] = [];
	if (s.error && errRate >= 5) {
		alerts.push(
			`<a class="al" href="/admin/logs${q}&status=error" style="text-decoration:none">실패율 <b>${errRate.toFixed(1)}%</b> · ${s.error.toLocaleString()}건 — 로그 보기 →</a>`,
		);
	}
	if (s.prev && s.prev.cost > 0 && s.cost > s.prev.cost * 1.5) {
		alerts.push(
			`<div class="al">비용이 직전 같은 기간보다 <b>${Math.round(((s.cost - s.prev.cost) / s.prev.cost) * 100)}%</b> 늘었어요 (${usd(s.prev.cost)} → ${usd(s.cost)})</div>`,
		);
	}
	if (s.anomaly.critical) {
		alerts.push(
			`<a class="al" href="/admin/anomaly${q}" style="text-decoration:none">이상 신호 <b>심각 ${s.anomaly.critical.toLocaleString()}건</b> — 이상탐지에서 보기 →</a>`,
		);
	}
	if (s.p95Latency >= 10_000) {
		alerts.push(
			`<a class="al" href="/admin/logs${q}&slow=10000" style="text-decoration:none">가장 느린 5%가 <b>${(s.p95Latency / 1000).toFixed(1)}초</b>를 넘어요 — 느린 호출 보기 →</a>`,
		);
	}

	const mini = (l: string, v: string, tone = "", extra = "") =>
		`<div class="m"><div class="l">${l}</div><div class="v ${tone}">${v}${extra}</div></div>`;

	const appDonut = svgDonut(
		s.byApp.map((r) => ({
			label: r.name,
			value: r.total,
			sub: `비용 ${usd(r.cost)}`,
			href: `/admin/usage?period=${s.period}&app=${encodeURIComponent(r.key)}`,
		})),
		"건",
	);
	const modelDonut = svgDonut(
		s.byModel.map((r) => ({
			label: shortModel(r.key),
			value: r.total,
			sub: `비용 ${usd(r.cost)}`,
			href: `/admin/logs${q}&model=${encodeURIComponent(r.key)}`,
		})),
		"건",
	);

	const errRows = s.errors.length
		? s.errors
				.map(
					(e) =>
						`<tr><td class="n">${e.http ?? "-"}</td><td class="n">${e.count.toLocaleString()}</td><td class="err">${e.sample ? escapeHtml(e.sample) : ""}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="3">이 기간에 실패한 호출이 없어요.</td></tr>`;

	const geoShare = svgShare(
		s.countries.map((c) => ({ label: countryName(c.key), value: c.total, sub: "" })),
		"건",
	);

	// 최근 호출 — 지표 카드 바로 아래에 둔다. 자동 갱신에 같이 실려서 새 호출이 들어오면 바로 바뀐다.
	// 자세히 보는 건 로그 화면 몫이라 여기서는 줄을 펼치지 않는다.
	const recentRows = s.recent.length
		? s.recent
				.map((r) => {
					const geo = r.city && r.city !== "-" ? r.city : r.region && r.region !== "-" ? r.region : r.country;
					return (
						`<tr><td class="mono">${kst(r.ts)}</td><td data-tip="${escapeHtml(r.app)}">${escapeHtml(r.app)}</td>` +
						`<td>${escapeHtml(r.kind)}</td>` +
						`<td class="mono" data-tip="${escapeHtml(r.model ?? "-")}">${escapeHtml(shortModel(r.model ?? "-"))}</td>` +
						`<td><span class="pill ${r.status === "ok" ? "g" : "r"}">${escapeHtml(r.status)}</span></td>` +
						`<td class="n">${r.http ?? "-"}</td><td class="n">${r.latency_ms.toLocaleString()}ms</td>` +
						`<td class="n">${(r.inTok + r.outTok).toLocaleString()}</td><td class="n">${usd(r.cost)}</td>` +
						`<td class="geo">${escapeHtml(geo || "-")}</td>` +
						`<td class="err"${(r.err ?? r.meta) ? ` data-tip="${escapeHtml(String(r.err ?? r.meta))}"` : ""}>${escapeHtml(r.err ?? r.meta ?? "")}</td></tr>`
					);
				})
				.join("")
		: `<tr><td colspan="11">아직 호출이 없어요.</td></tr>`;

	return shellAdmin(
		"AI 호출 요약",
		pageHead("AI 호출 요약", `앱별 AI 프록시 사용량 · ${sinceLabel(s.since)}`, s.appFilter) +
			`<div id="hz-body">
${filterTabs(
	"/admin",
	s.period,
	s.appFilter,
	s.apps,
	PERIODS,
	`<a class="tab alt" href="/admin/stats.json${q}">JSON</a>`,
	alerts.length ? `<div class="alerts">${alerts.join("")}</div>` : "",
)}
<div class="kpi">
  <div class="k1">
    <div class="l">호출 수</div>
    <div class="v">${s.total.toLocaleString()}<span class="u">건</span>${s.prev ? delta(s.total, s.prev.total) : ""}</div>
    <div class="s">${s.error ? `<b class="r">실패 ${s.error.toLocaleString()}건</b> · ` : ""}성공률 ${okRate}%</div>
    <div class="spark">${spark}</div>
  </div>
  <div class="k1">
    <div class="l">비용</div>
    <div class="v">${usd(s.cost)}${s.prev ? delta(s.cost, s.prev.cost, true) : ""}</div>
    <div class="s">${s.total ? `호출당 ${usd(s.cost / s.total)}` : "호출 없음"}</div>
    <div class="meter"><span style="width:${Math.min(100, Math.round((s.inTokens / Math.max(1, s.inTokens + s.outTokens)) * 100))}%"></span></div>
    <div class="s2">입력 ${shortNum(s.inTokens)} · 출력 ${shortNum(s.outTokens)} 토큰</div>
  </div>
  <div class="k1">
    <div class="l">평균 지연</div>
    <div class="v">${s.avgLatency.toLocaleString()}<span class="u">ms</span>${s.prev ? delta(s.avgLatency, s.prev.avgLatency, true) : ""}</div>
    <div class="s">p95 ${s.p95Latency.toLocaleString()}ms</div>
    <div class="meter lat"><span style="width:${Math.min(100, Math.round((s.avgLatency / Math.max(1, s.p95Latency)) * 100))}%"></span></div>
    <div class="s2">가장 느린 5%는 ${s.p95Latency.toLocaleString()}ms를 넘어요</div>
  </div>
</div>
<div class="kpi2">
${mini("성공", s.ok.toLocaleString(), "g")}
${mini("실패", s.error.toLocaleString(), s.error ? "r" : "")}
${mini("입력 토큰", shortNum(s.inTokens))}
${mini("출력 토큰", shortNum(s.outTokens))}
${mini("고유 IP", s.uniqueIPs.toLocaleString())}
${mini("사용 모델", `${s.modelCount}종`)}
</div>

${sectionHead("월별 비용", {
	note: s.monthly.length
		? `최근 ${s.monthly.length}개월 · 합계 ${usd(s.monthly.reduce((n, r) => n + r.cost, 0))}${s.appFilter ? ` · ${escapeHtml(s.apps.find((a) => a.id === s.appFilter)?.name ?? s.appFilter)}만` : ""}`
		: "기록 없음",
})}
${monthlyCostPanel(s)}

${sectionHead("이상탐지", { href: `/admin/anomaly${q}`, linkLabel: "이상탐지에서 보기 →" })}
${anomalyBand(s.anomaly, `/admin/anomaly${q}`)}

${sectionHead("트래픽", { href: `/admin/traffic?period=${s.period}`, linkLabel: "트래픽에서 보기 →" })}
${trafficBand(s.traffic, `/admin/traffic?period=${s.period}`)}

${sectionHead(`최근 호출 (${SUMMARY_RECENT}건)`, { href: `/admin/logs${q}`, linkLabel: "로그에서 더 보기 →" })}
<table class="recent calls lite"><colgroup><col class="c-ts"><col class="c-app"><col class="c-kind"><col class="c-model"><col class="c-st"><col class="c-http"><col class="c-lat"><col class="c-tok"><col class="c-cost"><col class="c-geo"><col class="c-err"></colgroup><tr><th>시각</th><th>앱</th><th>용도</th><th>모델</th><th>상태</th><th class="n">HTTP</th><th class="n">지연</th><th class="n">토큰</th><th class="n">비용</th><th>지역</th><th>오류 · 메타</th></tr>${recentRows}</table>

${sectionHead(`추이 (${s.bucketLabel} 단위)`, { href: `/admin/trend${q}` })}
${svgTrend(s.buckets)}

<div class="two">
  <section>${sectionHead("앱별 비중", { href: `/admin/usage${q}` })}${appDonut}</section>
  <section>${sectionHead("모델별 비중", { href: `/admin/usage${q}#model` })}${modelDonut}</section>
</div>

<div class="two">
  <section>${sectionHead("실패 상위", { href: `/admin/logs${q}&status=error`, linkLabel: "로그에서 보기 →" })}
    <table><tr><th class="n">HTTP</th><th class="n">건수</th><th>대표 메시지</th></tr>${errRows}</table>
  </section>
  <section>${sectionHead(`호출 지역 (${s.countryCount}개국)`, { href: `/admin/geo${q}` })}${geoShare}</section>
</div>

<p class="foot">추이 막대는 아래가 서비스, 흐린 위쪽이 내부 도구 몫이에요. 비용 꺾은선은 진한 선이 전체, 점선이 서비스 몫이라 두 선의 간격이 내부 도구가 쓴 돈이에요. 성공·실패 건수는 막대에 마우스를 올리면 나와요.<br>
월별 비용은 기간 탭과 상관없이 늘 최근 열두 달을 보여줘요. 청구가 달 단위로 오니까요. 막대의 흐린 윗부분은 이상탐지·메일 도구처럼 <b>내부용</b>으로 표시한 앱이 쓴 몫이에요. 달은 한국 시간(KST) 기준으로 끊는데 실제 청구는 UTC 기준이라 월말·월초에 조금 다를 수 있어요.<br>
최근 호출은 자동 갱신이 켜져 있으면 새 호출이 들어올 때마다 다시 그려져요.<br>숫자 옆 ▲▼는 직전 같은 기간과 비교한 값이에요.<br>${FOOT_COST}<br>${FOOT_GEO}</p>
</div>`,
		{ ...opts, tab: "summary" },
	);
}

// ═════════════════════════════════════════════════════════════
// 사용량 (/admin/usage)
// ═════════════════════════════════════════════════════════════

export function renderUsage(u: UsageData, opts: AdminOpts = {}): string {
	const q = navQuery(u.period, u.appFilter);

	const appRows = u.byApp.length
		? u.byApp
				.map(
					(r) =>
						`<tr><td><a href="/admin/usage?period=${u.period}&app=${encodeURIComponent(r.key)}">${escapeHtml(r.name)}</a><br><span class="mono">${escapeHtml(r.key)}</span></td>` +
						`<td class="n">${r.total.toLocaleString()}${u.hasPrev ? delta(r.total, u.prevApp[r.key] ?? 0) : ""}</td>` +
						`<td class="n g o1">${r.ok.toLocaleString()}</td><td class="n r">${r.error.toLocaleString()}</td>` +
						`<td class="n o1">${(r.inTok + r.outTok).toLocaleString()}</td><td class="n">${usd(r.cost)}</td>` +
						`<td class="n o2">${avgLat(r)}ms</td>` +
						`<td class="n o2">${r.total ? usd(r.cost / r.total) : "-"}</td>` +
						`<td><a href="/admin/logs?period=${u.period}&app=${encodeURIComponent(r.key)}">로그 →</a></td></tr>`,
				)
				.join("")
		: `<tr><td colspan="9">데이터 없음</td></tr>`;

	const modelRows = u.byModel.length
		? u.byModel
				.map(
					(r) =>
						`<tr><td class="mono">${escapeHtml(r.key)}${MODEL_PRICES[r.key] ? "" : " *"}</td>` +
						`<td class="n">${r.total.toLocaleString()}${u.hasPrev ? delta(r.total, u.prevModel[r.key] ?? 0) : ""}</td>` +
						`<td class="n r">${r.error.toLocaleString()}</td>` +
						`<td class="n o1">${r.inTok.toLocaleString()}</td><td class="n o1">${r.outTok.toLocaleString()}</td>` +
						`<td class="n">${usd(r.cost)}</td><td class="n o2">${avgLat(r)}ms</td>` +
						`<td><a href="/admin/logs${q}&model=${encodeURIComponent(r.key)}">로그 →</a></td></tr>`,
				)
				.join("")
		: `<tr><td colspan="8">데이터 없음</td></tr>`;

	const kindRows = u.byKind.length
		? u.byKind
				.map(
					(r) =>
						`<tr><td>${escapeHtml(r.key)}</td><td class="n">${r.total.toLocaleString()}</td>` +
						`<td class="n g o1">${r.ok.toLocaleString()}</td><td class="n r">${r.error.toLocaleString()}</td>` +
						`<td class="n o1">${(r.inTok + r.outTok).toLocaleString()}</td><td class="n">${usd(r.cost)}</td>` +
						`<td class="n o2">${avgLat(r)}ms</td>` +
						`<td><a href="/admin/logs${q}&kind=${encodeURIComponent(r.key)}">로그 →</a></td></tr>`,
				)
				.join("")
		: `<tr><td colspan="8">데이터 없음</td></tr>`;

	return shellAdmin(
		"사용량",
		pageHead("사용량", `앱 · 모델 · 용도별 집계 · ${sinceLabel(u.since)}`, u.appFilter) +
			`<div id="hz-body">
${filterTabs("/admin/usage", u.period, u.appFilter, u.apps, PERIODS)}
<div class="kpi2" style="margin-bottom:4px">
  <div class="m"><div class="l">호출</div><div class="v">${u.total.toLocaleString()}</div></div>
  <div class="m"><div class="l">비용</div><div class="v">${usd(u.cost)}</div></div>
  <div class="m"><div class="l">앱</div><div class="v">${u.byApp.length}</div></div>
  <div class="m"><div class="l">모델</div><div class="v">${u.byModel.length}</div></div>
  <div class="m"><div class="l">용도</div><div class="v">${u.byKind.length}</div></div>
  <div class="m"><div class="l">호출당 비용</div><div class="v">${u.total ? usd(u.cost / u.total) : "-"}</div></div>
</div>

${sectionHead("앱별", { count: `${u.byApp.length}개` })}
<div class="cap"><table class="fx" id="tb-app">${cols("", "96", "74:o1", "74", "84:o1", "84", "86:o2", "92:o2", "58")}<thead><tr><th>앱</th><th class="n">호출</th><th class="n o1">성공</th><th class="n">실패</th><th class="n o1">토큰</th><th class="n">비용</th><th class="n o2">평균 지연</th><th class="n o2">호출당 비용</th><th></th></tr></thead><tbody>${appRows}</tbody></table></div>

${sectionHead("모델별", { id: "model", count: `<span id="tb-model-cnt">${u.byModel.length}개</span>`, right: tableFilter("tb-model", "모델 이름으로 걸러보기") })}
<div class="cap"><table class="fx" id="tb-model">${cols("", "96", "74", "90:o1", "90:o1", "84", "86:o2", "58")}<thead><tr><th>모델</th><th class="n">호출</th><th class="n">실패</th><th class="n o1">입력 토큰</th><th class="n o1">출력 토큰</th><th class="n">비용</th><th class="n o2">평균 지연</th><th></th></tr></thead><tbody>${modelRows}</tbody></table></div>

${sectionHead("용도별", { count: `${u.byKind.length}개` })}
<div class="cap"><table class="fx" id="tb-kind">${cols("", "96", "74:o1", "74", "84:o1", "84", "86:o2", "58")}<thead><tr><th>용도</th><th class="n">호출</th><th class="n o1">성공</th><th class="n">실패</th><th class="n o1">토큰</th><th class="n">비용</th><th class="n o2">평균 지연</th><th></th></tr></thead><tbody>${kindRows}</tbody></table></div>

<p class="foot">용도는 앱이 보낸 <span class="mono">X-Ai-Kind</span> 값이에요.<br>${FOOT_COST}</p>
</div>`,
		{ ...opts, tab: "usage" },
	);
}

// ═════════════════════════════════════════════════════════════
// 추이 (/admin/trend)
// ═════════════════════════════════════════════════════════════

export function renderTrend(t: TrendData, opts: AdminOpts = {}): string {
	const q = navQuery(t.period, t.appFilter);
	const maxB = Math.max(1, ...t.buckets.map((b) => b.total));

	const rows = t.buckets.length
		? t.buckets
				.map((b) => {
					const innPct = b.total ? Math.round((b.internal / b.total) * 100) : 0;
					return `<tr><td>${escapeHtml(b.b)}</td><td class="bar" data-tip="${escapeHtml(
						`서비스 ${(b.total - b.internal).toLocaleString()}건 · 내부 도구 ${b.internal.toLocaleString()}건`,
					)}"><span style="width:${Math.round((b.total / maxB) * 100)}%">${
						innPct ? `<i style="width:${innPct}%"></i>` : ""
					}</span></td>` +
						`<td class="n">${b.total.toLocaleString()}</td>` +
						`<td class="n">${(b.total - b.internal).toLocaleString()}</td>` +
						`<td class="n dim">${b.internal.toLocaleString()}</td>` +
						`<td class="n g">${b.ok.toLocaleString()}</td>` +
						`<td class="n r">${b.error.toLocaleString()}</td><td class="n">${b.tokens.toLocaleString()}</td>` +
						`<td class="n">${usd(b.cost)}</td>` +
						`<td class="n dim">${usd(b.internalCost)}</td></tr>`;
				})
				.join("")
		: `<tr><td colspan="10">데이터 없음</td></tr>`;

	const peak = t.heat.reduce((a, b) => (b.n > (a?.n ?? 0) ? b : a), t.heat[0]);
	const WD = ["일", "월", "화", "수", "목", "금", "토"];

	return shellAdmin(
		"추이",
		pageHead("추이", `기간별 호출·비용 흐름 · ${sinceLabel(t.since)}`, t.appFilter) +
			`<div id="hz-body">
${filterTabs("/admin/trend", t.period, t.appFilter, t.apps, PERIODS)}
${sectionHead(`${t.bucketLabel} 단위 호출·비용`, {
		note: t.total
			? `서비스 ${(t.total - t.internal).toLocaleString()}건 · 내부 도구 ${t.internal.toLocaleString()}건 (${
					t.total ? Math.round((t.internal / t.total) * 100) : 0
				}%)`
			: "기록 없음",
	})}
${svgTrend(t.buckets)}

${sectionHead("언제 몰리나 (요일 × 시각, KST)", { note: peak ? `가장 많은 때: ${WD[peak.w]}요일 ${peak.h}시 · ${peak.n.toLocaleString()}건` : "" })}
${svgHeat(t.heat)}

${sectionHead("구간별 상세", {
		note: `전체 ${t.total.toLocaleString()}건 · ${usd(t.cost)}${
			t.internal ? ` · 내부 도구 ${t.internal.toLocaleString()}건 · ${usd(t.internalCost)}` : ""
		}`,
	})}
<div class="scroll cap"><table id="tb-bucket"><thead><tr><th>구간</th><th>비중</th><th class="n">호출</th><th class="n">서비스</th><th class="n">내부 도구</th><th class="n">성공</th><th class="n">실패</th><th class="n">토큰</th><th class="n">비용</th><th class="n">내부 도구 비용</th></tr></thead><tbody>${rows}</tbody></table></div>

<p class="foot">막대의 흐린 윗부분과 표의 '내부 도구' 칸은 이상탐지·메일 도구처럼 <b>내부용</b>으로 표시한 앱이 낸 몫이에요. 비용 꺾은선은 진한 선이 전체, 점선이 서비스 몫이라 두 선의 간격이 내부 도구가 쓴 돈이에요.<br>구간은 한국 시간(KST) 기준으로 끊어요.<br>${FOOT_COST}</p>
</div>`,
		{ ...opts, tab: "trend" },
	);
}

// ═════════════════════════════════════════════════════════════
// 지역 (/admin/geo)
// ═════════════════════════════════════════════════════════════

export function renderGeo(g: GeoData, opts: AdminOpts = {}): string {
	const q = navQuery(g.period, g.appFilter);
	const maxCountry = Math.max(1, ...g.byCountry.map((c) => c.total));

	const countryRows = g.byCountry.length
		? g.byCountry
				.map(
					(r) =>
						`<tr><td>${escapeHtml(countryName(r.key))}</td><td class="n">${r.total.toLocaleString()}</td>` +
						`<td class="n g o1">${r.ok.toLocaleString()}</td><td class="n r">${r.error.toLocaleString()}</td>` +
						`<td class="n">${r.ips.toLocaleString()}</td>` +
						`<td class="n o1">${(r.inTok + r.outTok).toLocaleString()}</td><td class="n">${usd(r.cost)}</td>` +
						`<td class="n o2">${avgLat(r)}ms</td>` +
						`<td class="bar o2"><span style="width:${Math.round((r.total / maxCountry) * 100)}%"></span></td>` +
						`<td class="lk">${r.key === "(미상)" ? "" : `<a href="/admin/logs${q}&country=${encodeURIComponent(r.key)}">로그 →</a>`}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="10">데이터 없음</td></tr>`;

	const regionRows = g.byRegion.length
		? g.byRegion
				.map(
					(r) =>
						`<tr><td>${escapeHtml(countryName(r.country))}</td><td>${escapeHtml(r.region)}</td>` +
						`<td>${escapeHtml(r.city)}</td><td class="n">${r.total.toLocaleString()}</td>` +
						`<td class="n g o1">${r.ok.toLocaleString()}</td><td class="n r">${r.error.toLocaleString()}</td>` +
						`<td class="n o1">${r.ips.toLocaleString()}</td>` +
						`<td class="n o2">${r.tokens.toLocaleString()}</td><td class="n">${usd(r.cost)}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="9">데이터 없음</td></tr>`;

	// 서비스 방문 지역 — 앱을 하나 골라 본 화면에서는 내보내지 않는다(앱과 무관한 기록이라서).
	const maxHit = Math.max(1, ...g.hitCountries.map((c) => c.total));
	const hitRows = g.hitCountries.length
		? g.hitCountries
				.map(
					(r) =>
						`<tr><td>${escapeHtml(countryName(r.key))}</td>` +
						`<td class="n">${r.total.toLocaleString()}</td>` +
						`<td class="n">${r.human.toLocaleString()}</td>` +
						`<td class="n o1">${r.ips.toLocaleString()}</td>` +
						`<td class="n o1">${r.ai.toLocaleString()}</td>` +
						`<td class="n o1">${r.search.toLocaleString()}</td>` +
						`<td class="bar hit o2"><span style="width:${Math.round((r.total / maxHit) * 100)}%"></span></td>` +
						`<td class="lk">${r.key === "(미상)" ? "" : `<a href="/admin/traffic?period=${g.period}${g.hitSite ? `&site=${encodeURIComponent(g.hitSite)}` : ""}">트래픽 →</a>`}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="8">아직 들어온 방문 기록이 없어요.</td></tr>`;

	// 앱을 골랐는데 짝인 서비스를 지정하지 않았으면 방문 계층을 그릴 수 없다.
	// 아무 서비스나 얹으면 걸러진 호출 옆에 걸러지지 않은 방문이 나란히 놓여 잘못 읽힌다.
	const hitTitle = g.hitSite ? `${siteName(g.hitSite)} 방문 지역` : "서비스 방문 지역";
	const trafficHref = `/admin/traffic?period=${g.period}${g.hitSite ? `&site=${encodeURIComponent(g.hitSite)}` : ""}`;
	const hitSection = g.hitUnlinked
		? `<p class="sm" style="margin:18px 2px 0">이 앱에는 짝이 되는 서비스가 지정되어 있지 않아 방문 지역을 함께 보여주지 못해요. ` +
			`<a href="/admin/apps">앱 관리에서 연결하기 →</a> · <a href="/admin/geo?period=${g.period}">전체 앱으로 보기 →</a></p>`
		: `${sectionHead(hitTitle, { href: trafficHref, linkLabel: "트래픽에서 보기 →" })}
<div class="cap"><table class="fx" id="tb-hitgeo">${cols("160", "78", "72", "84:o1", "82:o1", "88:o1", ":o2", "78")}<thead><tr><th>국가</th><th class="n">방문</th><th class="n">사람</th><th class="n o1">고유 방문자</th><th class="n o1">AI 크롤러</th><th class="n o1">검색 크롤러</th><th class="o2">비중</th><th></th></tr></thead><tbody>${hitRows}</tbody></table></div>`;

	return shellAdmin(
		"지역",
		pageHead("호출 지역", `국가 · 도시별 호출·방문 분포 · ${sinceLabel(g.since)}`, g.appFilter) +
			`<div id="hz-body">
${filterTabs("/admin/geo", g.period, g.appFilter, g.apps, PERIODS)}
${svgMap(g.points, g.geoUnknown, g.hitPoints, g.hitUnknown, g.hitSite ? siteName(g.hitSite) : "")}

${sectionHead("국가별 AI 호출", { count: `${g.byCountry.filter((c) => c.key !== "(미상)").length}개국` })}
<div class="cap"><table class="fx" id="tb-country">${cols("160", "88", "70:o1", "70", "78", "84:o1", "84", "86:o2", ":o2", "66")}<thead><tr><th>국가</th><th class="n">호출</th><th class="n o1">성공</th><th class="n">실패</th><th class="n">고유 IP</th><th class="n o1">토큰</th><th class="n">비용</th><th class="n o2">평균 지연</th><th class="o2">비중</th><th></th></tr></thead><tbody>${countryRows}</tbody></table></div>

${hitSection}

${sectionHead(`지역 · 도시별 (상위 ${g.byRegion.length})`, { right: tableFilter("tb-region", "도시·지역 이름으로 걸러보기") })}
<div class="cap"><table class="fx" id="tb-region">${cols("92", "", "", "84", "70:o1", "70", "78:o1", "84:o2", "84")}<thead><tr><th>국가</th><th>지역</th><th>도시</th><th class="n">호출</th><th class="n o1">성공</th><th class="n">실패</th><th class="n o1">고유 IP</th><th class="n o2">토큰</th><th class="n">비용</th></tr></thead><tbody>${regionRows}</tbody></table></div>

<p class="foot">${FOOT_GEO}<br>
지도의 <b>보라색</b>은 AI 호출, <b>분홍색</b>은 서비스 방문이에요. 방문은 도시 좌표가 없어 나라 가운데에 모아 찍고, 자세한 내용은 트래픽 탭에서 봐요.<br>
앱을 고르면 그 앱의 호출과, 앱 관리에서 짝지어 둔 서비스의 방문만 함께 보여요.</p>
</div>`,
		{ ...opts, tab: "geo" },
	);
}

// ═════════════════════════════════════════════════════════════
// 이상탐지 (/admin/anomaly)
//   판정은 바깥 이상탐지 서버가 하고, 이 화면은 프록시 DB에 쌓인 결과만 읽는다.
//   그래서 서버가 멈춰도 화면은 열리고, 멈춘 사실이 맨 위 상태줄에 드러난다.
// ═════════════════════════════════════════════════════════════

const SEV_LABEL: Record<string, string> = { critical: "심각", warn: "주의", info: "참고" };
const sevTag = (sev: string) => `<span class="sev ${escapeHtml(sev)}">${SEV_LABEL[sev] ?? escapeHtml(sev)}</span>`;

/** 얼마나 지났는지 — 방금 / 3분 전 / 2시간 전 / 4일 전 */
function ago(ms: number | null): string {
	if (ms === null) return "기록 없음";
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return "방금";
	if (s < 3600) return `${Math.floor(s / 60)}분 전`;
	if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
	return `${Math.floor(s / 86400)}일 전`;
}

/** 관측값은 지표마다 단위가 달라 화면에서 맞춰 준다. */
function anomValue(v: number | null, metric: string): string {
	if (v === null || v === undefined) return "-";
	if (metric === "err_rate") return `${(v * 100).toFixed(1)}%`;
	if (metric === "cost") return usd(v);
	if (metric === "latency_p95" || metric === "latency_avg") return `${(v / 1000).toFixed(1)}초`;
	return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function anomDetail(r: { detail: string | null; label: string | null; signal: string }): { metric: string; label: string; ratio: number | null; kind: string } {
	let d: Record<string, unknown> = {};
	try {
		d = r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : {};
	} catch {
		d = {};
	}
	return {
		metric: String(d.metric ?? ""),
		label: r.label || String(d.label ?? r.signal),
		ratio: typeof d.ratio === "number" ? d.ratio : null,
		kind: String(d.baseline_kind ?? ""),
	};
}


/** 이상탐지 서버가 state로 밀어 넣은 JSON 한 덩이를 꺼낸다. 형식이 달라지면 빈 값으로 둔다. */
function anomState<T>(a: AnomalyData, key: string): T | null {
	const row = a.state.find((s) => s.key === key);
	if (!row) return null;
	try {
		return JSON.parse(row.value) as T;
	} catch {
		return null;
	}
}

/** 이상탐지 에이전트 판정 — 여섯 가지 라벨을 화면에서 읽히는 말로 옮긴다. */
const VERDICT_LABEL: Record<string, { text: string; cls: string }> = {
	confirmed: { text: "정탐", cls: "hit" },
	rule_only: { text: "정탐(규칙만)", cls: "hit" },
	model_gain: { text: "정탐(모델만)", cls: "hit" },
	rule_fp: { text: "오탐(규칙)", cls: "miss" },
	model_fp: { text: "오탐(모델)", cls: "miss" },
	both_fp: { text: "오탐", cls: "miss" },
	pending: { text: "판단 보류", cls: "wait" },
};

function verdictTag(v: string | null, reason: string | null): string {
	if (!v) return `<span class="sm">검증 전</span>`;
	const m = VERDICT_LABEL[v] ?? { text: v, cls: "wait" };
	const tip = reason ? `${m.text}\n${reason}` : m.text;
	return `<span class="vd ${m.cls}" data-tip="${escapeHtml(tip)}">${escapeHtml(m.text)}</span>`;
}

/** 신호 이름 — 이력 표에 아직 안 나온 신호도 화면에서는 한국어로 보이게 한다. */
const SIGNAL_LABEL: Record<string, string> = {
	call_spike: "호출량 급증",
	error_rate: "오류율 급증",
	cost_spike: "비용 급증",
	latency_slow: "응답 지연",
	ip_surge: "접속 IP 급증",
	new_country: "새 국가에서 호출",
	new_ip_burst: "새 IP 다수 등장",
	rate_limited: "호출 상한 초과(429)",
	model_anomaly: "모델 이상 판정",
	// 트래픽(서비스 방문)
	traffic_drop: "방문 급감",
	traffic_spike: "방문 급증",
	search_bot_drop: "검색 크롤러 발길 끊김",
	ai_bot_spike: "AI 크롤러 급증",
	http_5xx: "서버 오류(5xx) 발생",
	http_404: "없는 주소 요청(404) 급증",
	new_bot: "새 크롤러 등장",
};

/** 학습을 다시 돌린 계기 — 화면에 읽히는 말로. */
const TRIGGER_LABEL: Record<string, string> = {
	interval: "정기 점검",
	"first-run": "첫 학습",
	"first-real": "실데이터 전환",
	"new-labels": "새 판정 누적",
	growth: "학습 구간 증가",
	"low-precision": "정탐률 하락",
	manual: "직접 실행",
	auto: "자동 조건 충족",
};

const pct1 = (v: number | null | undefined) => (v === null || v === undefined ? "-" : `${(v * 100).toFixed(1)}%`);

/** 지표 이름 — 설명 문장에 그대로 넣는다. */
const METRIC_LABEL: Record<string, string> = {
	calls: "호출 수", err_rate: "실패 비율", cost: "비용", latency_p95: "응답 지연",
	uniq_ips: "접속 IP 수", new_ips: "처음 보는 IP", new_countries: "처음 보는 나라",
	rate_limited: "상한에 걸린 호출",
	visits: "방문 수", humans: "사람 방문", ai_bots: "AI 크롤러 방문",
	search_bots: "검색 크롤러 방문", other_bots: "기타 봇 방문", uniq_visitors: "고유 방문자",
	err_5xx: "서버 오류(5xx)", err_404: "없는 주소 요청(404)", bot_ratio: "봇 비중",
	new_bots: "처음 보는 크롤러",
};

/**
 * 신호마다 "그래서 무엇을 열어 봐야 하나".
 * 이상탐지 에이전트가 판단을 붙이기 전에도 화면이 할 말이 있어야 해서 미리 적어 둔다.
 * 에이전트 설명이 도착하면 그쪽을 먼저 보여주고 이 문구는 뒤로 물러난다.
 */
const SIGNAL_GUIDE: Record<string, { todo: string; link?: (q: { period: string; app: string }) => [string, string] }> = {
	call_spike: {
		todo: "어느 IP가 몰아서 불렀는지, 앱이 되풀이해 호출한 건 아닌지 로그에서 봐 주세요.",
		link: (q) => [`/admin/logs?period=${q.period}${q.app ? `&app=${encodeURIComponent(q.app)}` : ""}`, "로그에서 보기 →"],
	},
	error_rate: {
		todo: "실패한 호출의 오류 메시지를 열어 같은 원인인지 확인해 주세요.",
		link: (q) => [`/admin/logs?period=${q.period}&status=error${q.app ? `&app=${encodeURIComponent(q.app)}` : ""}`, "실패 호출 보기 →"],
	},
	cost_spike: {
		todo: "어떤 모델이 비용을 끌어올렸는지, 비싼 모델로 바뀐 건 아닌지 사용량에서 봐 주세요.",
		link: (q) => [`/admin/usage?period=${q.period}${q.app ? `&app=${encodeURIComponent(q.app)}` : ""}`, "사용량에서 보기 →"],
	},
	ip_surge: {
		todo: "새로 들어온 IP가 실제 사용자인지, 한곳에서 흩뿌린 건 아닌지 봐 주세요.",
		link: (q) => [`/admin/logs?period=${q.period}${q.app ? `&app=${encodeURIComponent(q.app)}` : ""}`, "로그에서 보기 →"],
	},
	new_ip_burst: {
		todo: "처음 보는 IP가 한꺼번에 들어왔어요. 토큰이 새어 나간 건 아닌지 확인해 주세요.",
		link: (q) => [`/admin/logs?period=${q.period}${q.app ? `&app=${encodeURIComponent(q.app)}` : ""}`, "로그에서 보기 →"],
	},
	new_country: {
		todo: "낯선 나라에서 들어온 호출이에요. 쓰는 지역이 맞는지 확인해 주세요.",
		link: (q) => [`/admin/geo?period=${q.period}${q.app ? `&app=${encodeURIComponent(q.app)}` : ""}`, "지역에서 보기 →"],
	},
	rate_limited: {
		todo: "상한에 걸려 거절된 호출이에요. 상한을 올릴지, 부르는 쪽을 줄일지 정해 주세요.",
		link: () => ["/admin/apps", "앱 상한 보기 →"],
	},
	model_anomaly: {
		todo: "지표 여러 개가 함께 어긋난 구간이에요. 그 시각 호출을 훑어봐 주세요.",
		link: (q) => [`/admin/logs?period=${q.period}${q.app ? `&app=${encodeURIComponent(q.app)}` : ""}`, "로그에서 보기 →"],
	},
	latency_slow: {
		todo: "느려진 구간이에요. 어느 모델·용도에서 오래 걸렸는지 확인해 주세요.",
		link: (q) => [`/admin/logs?period=${q.period}&slow=10000${q.app ? `&app=${encodeURIComponent(q.app)}` : ""}`, "느린 호출 보기 →"],
	},
	traffic_drop: {
		todo: "서비스가 살아 있는지, robots.txt와 사이트맵이 그대로인지 먼저 열어 봐 주세요.",
		link: (q) => [`/admin/traffic?period=${q.period}${q.app ? `&site=${encodeURIComponent(q.app)}` : ""}`, "트래픽에서 보기 →"],
	},
	search_bot_drop: {
		todo: "검색 크롤러가 막힌 건 아닌지 robots.txt와 색인 상태를 확인해 주세요.",
		link: (q) => [`/admin/traffic?period=${q.period}${q.app ? `&site=${encodeURIComponent(q.app)}` : ""}`, "트래픽에서 보기 →"],
	},
	http_5xx: {
		todo: "그 시각 서비스가 오류를 냈어요. 배포한 게 있는지, 어느 주소에서 났는지 확인해 주세요.",
		link: (q) => [`/admin/traffic?period=${q.period}${q.app ? `&site=${encodeURIComponent(q.app)}` : ""}`, "트래픽에서 보기 →"],
	},
	http_404: {
		todo: "없는 주소로 들어온 요청이 늘었어요. 끊긴 링크가 있는지 경로 목록에서 확인해 주세요.",
		link: (q) => [`/admin/traffic?period=${q.period}${q.app ? `&site=${encodeURIComponent(q.app)}` : ""}`, "트래픽에서 보기 →"],
	},
	traffic_spike: {
		todo: "어디서 들어왔는지 유입 경로를 봐 주세요. 사람이 아니라 봇일 수도 있어요.",
		link: (q) => [`/admin/traffic?period=${q.period}${q.app ? `&site=${encodeURIComponent(q.app)}` : ""}`, "트래픽에서 보기 →"],
	},
	ai_bot_spike: {
		todo: "어떤 AI 크롤러가 늘었는지, 어떤 글을 읽어 갔는지 확인해 주세요.",
		link: (q) => [`/admin/traffic?period=${q.period}${q.app ? `&site=${encodeURIComponent(q.app)}` : ""}`, "트래픽에서 보기 →"],
	},
	new_bot: {
		todo: "처음 보는 크롤러예요. 어디에서 온 무엇인지 확인해 주세요.",
		link: (q) => [`/admin/traffic?period=${q.period}${q.app ? `&site=${encodeURIComponent(q.app)}` : ""}`, "트래픽에서 보기 →"],
	},
};

/**
 * 한 건이 무슨 일인지 한 문장으로 옮긴다.
 * 이상탐지 에이전트가 아직 안 봤어도 화면이 설명할 수 있어야 해서, 판정에 딸린
 * 값만으로 문장을 만든다(메일에 쓰는 문장과 같은 결로 맞췄다).
 */
function anomalyLead(r: AnomalyRow, who: string): string {
	const d = anomDetail(r);
	const metric = METRIC_LABEL[d.metric] || d.label;
	const where = r.app === "*" ? `전체 ${who}` : `${r.app} ${who}`;
	const when = bucketAt(r.bucket);
	const obs = anomValue(r.observed, d.metric);
	const base = anomValue(r.baseline, d.metric);

	if (r.detector === "model") {
		const top = anomTopMetrics(r);
		return `${where}의 ${when} 구간을 학습한 모델이 평소와 다르다고 봤어요.` +
			(top ? ` 특히 ${top} 쪽이 평소와 벌어졌어요.` : "");
	}
	if (d.kind === "absolute") {
		return `${where}에서 ${when}에 ${metric}이(가) ${obs} 나왔어요. 기준으로 둔 값은 ${base}예요.`;
	}
	if (d.ratio && d.ratio < 1) {
		const cut = Math.round((1 - d.ratio) * 100);
		return `${where}의 ${metric}이(가) ${when}에 ${obs}로 떨어졌어요. 평소 이 시간대는 ${base} 수준이라 ${cut}% 줄어든 값이에요.`;
	}
	return `${where}의 ${metric}이(가) ${when}에 ${obs}까지 올랐어요.` +
		(d.ratio ? ` 평소 이 시간대는 ${base} 수준이라 ${d.ratio}배예요.` : ` 평소 이 시간대는 ${base} 수준이에요.`);
}

/** 모델 판정에 딸린 "가장 많이 어긋난 지표" 이름들. */
function anomTopMetrics(r: AnomalyRow): string {
	try {
		const d = r.detail ? (JSON.parse(r.detail) as { top?: { label?: string }[] }) : {};
		return (d.top ?? []).map((t) => t.label).filter(Boolean).slice(0, 3).join(", ");
	} catch {
		return "";
	}
}

/**
 * 판정 한 건 풀어 쓰기 — "심각 3건"만으로는 무엇을 봐야 할지 알 수 없다.
 * 무슨 일인지·이상탐지 에이전트가 어떻게 봤는지·무엇을 열어 볼지를 적고,
 * 그 건이 메일로 나갔으면 그 메일까지 이어 준다.
 * 상세 게시판에서 줄을 펼치면 이 내용이 나온다.
 */
function anomalyExplain(r: AnomalyRowWithMail, period: string, traffic: boolean): string {
	const who = traffic ? "서비스" : "앱";
	const d = anomDetail(r);
	const guide = SIGNAL_GUIDE[r.signal];
	const link = guide?.link?.({ period, app: r.app === "*" ? "" : r.app });
	const fp = r.verdict === "rule_fp" || r.verdict === "model_fp" || r.verdict === "both_fp";

	const verdictLine = r.verdict
		? `<div class="ln ${fp ? "fp" : "hit"}"><b>검증 결과</b>` +
			`<span>${verdictTag(r.verdict, null)} ${escapeHtml(r.verdict_reason || "")}` +
			`${r.verdict_confidence ? ` <span class="sm">(확신 ${Math.round(r.verdict_confidence * 100)}%)</span>` : ""}</span></div>`
		: `<div class="ln wait"><b>검증 결과</b><span>이상탐지 에이전트가 아직 보지 않았어요. 15분 안에 판단이 붙어요.</span></div>`;

	const todo = r.verdict_action || guide?.todo || "그 시각 기록을 열어 확인해 주세요.";
	const todoLine = fp
		? `<div class="ln"><b>할 일</b><span>검증에서 오탐으로 봤어요. 급하게 볼 것은 없지만 근거는 확인해 주세요.</span></div>`
		: `<div class="ln"><b>확인할 일</b><span>${escapeHtml(todo)}</span></div>`;

	const mail = r.mailId
		? `<a class="lk mail" href="/admin/anomaly?period=${period}&scope=mail#m-${r.mailId}">메일 «${escapeHtml(String(r.mailSubject ?? "").replace(/^\[AI Service\]\s*/, ""))}» 보기 →</a>`
		: r.suppressed_reason
			? `<span class="sm">메일은 보내지 않았어요 — ${escapeHtml(r.suppressed_reason)}</span>`
			: r.detector === "model"
				? `<span class="sm">모델이 뒤에서 매긴 판정이라 메일로는 나가지 않아요.</span>`
				: `<span class="sm">아직 메일로 나가지 않았어요.</span>`;

	const numbers =
		`<div class="ln"><b>수치</b><span>이번 값 ${escapeHtml(anomValue(r.observed, d.metric))}` +
		` · 평소 값 ${escapeHtml(anomValue(r.baseline, d.metric))}` +
		`${d.ratio ? ` (${d.ratio}배)` : ""} · 이상 점수 ${r.score === null ? "-" : r.score.toFixed(1)}` +
		` · 판정 ${r.detector === "model" ? `모델 ${escapeHtml(r.model_version ?? "")}` : "규칙"}</span></div>`;

	return `<div class="cb${fp ? " fp" : ""}">
  <p class="lead">${escapeHtml(anomalyLead(r, who))}</p>
  ${verdictLine}
  ${todoLine}
  ${numbers}
  <div class="acts">${link ? `<a class="lk" href="${link[0]}">${link[1]}</a>` : ""}${mail}</div>
</div>`;
}


/**
 * 이상탐지 에이전트 브리핑 — 무슨 일을 하는 자리이고, 실제로 무엇을 했나.
 *
 * 화면에는 "검증된 판정 23건" 같은 숫자만 있고 그 판정을 누가 왜 붙였는지는 안 보였다.
 * 지금 설정(어떤 모델로 몇 표를 던지고 무엇을 대상으로 삼는지)과 한 일(며칠간 몇 건,
 * 어떻게 갈랐는지, 최근 무엇을 봤는지)을 한자리에 모은다.
 */
interface AgentBrief {
	enabled?: boolean;
	model?: string; votes?: number; targets?: string;
	interval_min?: number; batch?: number; gates_mail?: boolean;
	total?: number; acted?: number; day1?: number; day7?: number;
	hit?: number; miss?: number; pending?: number;
	confidence?: number | null; last_at?: number | null;
	daily?: { d: string; n: number }[];
	by_signal?: { scope: string; signal: string; n: number; miss: number }[];
	recent?: {
		at: number; bucket: number; verdict: string; confidence: number | null;
		reason: string; action: string; votes: number;
		scope: string; app: string; signal: string; severity: string;
		detector: string; label: string | null;
	}[];
}

/** 검증 대상 범위 — 설정값을 사람이 읽는 말로. */
const AGENT_TARGET_LABEL: Record<string, string> = {
	notified: "메일로 나간 판정과 심각 신호",
	all: "주의·심각 판정 전부",
	critical: "심각 신호만",
};

/** 하루에 몇 건씩 봤나 — 작은 막대. 값이 없으면 빈 문자열. */
function agentSpark(daily: { d: string; n: number }[]): string {
	if (!daily.length) return "";
	const max = Math.max(1, ...daily.map((r) => r.n));
	const bars = daily
		.map((r, i) => {
			const h = Math.max(2, (r.n / max) * 34);
			return `<rect x="${(i * 15 + 2).toFixed(1)}" y="${(36 - h).toFixed(1)}" width="11" height="${h.toFixed(1)}" rx="2"` +
				` data-tip="${escapeHtml(`${r.d} · ${r.n.toLocaleString()}건 검증`)}"/>`;
		})
		.join("");
	return `<div class="agsp"><svg viewBox="0 0 ${daily.length * 15 + 4} 40" role="img" aria-label="날짜별 검증 건수">${bars}</svg>` +
		`<div class="lb"><span>${escapeHtml(daily[0].d)}</span><span>${escapeHtml(daily[daily.length - 1].d)}</span></div></div>`;
}

function agentBrief(a: AnomalyData): string {
	const g = anomState<AgentBrief>(a, "agent");
	if (!g) {
		return `<div class="empty">이상탐지 에이전트 기록이 아직 없어요. 서버가 다음 신호를 보내면 채워져요.</div>`;
	}

	const off = g.enabled === false;
	const target = AGENT_TARGET_LABEL[g.targets ?? ""] ?? (g.targets || "-");
	const hit = g.hit ?? 0;
	const miss = g.miss ?? 0;
	const rate = hit + miss ? hit / (hit + miss) : null;

	// 무슨 일을 하는 자리인지 — 숫자보다 이 문장이 먼저다.
	const what =
		`<div class="agwhat">
  <p><b>규칙과 모델이 잡은 판정을 한 건씩 다시 읽고, 진짜 이상인지 아닌지를 가려요.</b>
  그 구간의 지표와 같은 요일·시각의 평소값, 직전 구간 흐름, 오류 메시지, 다른 탐지기의 같은 구간 판정을 함께 넣어 물어봐요.
  같은 건을 온도를 바꿔 ${g.votes ?? 3}번까지 물어보고 과반이 나온 답만 씁니다. 표가 갈리면 판단 보류로 남겨 사람 몫으로 둬요.</p>
  <p>정탐으로 보면 <b>확인할 일</b>을 한 줄로 적어요 — 어느 로그를 열어 무엇을 봐야 하는지예요.
  오탐으로 보면 왜 아닌지를 남겨요. 그 문장이 위 이상 신호 이력의 ‘검증’ 칸과 화면 곳곳에 그대로 쓰여요.</p>
  <p class="sm">${g.gates_mail
			? "지금은 이 판정이 메일 발송 여부까지 정해요."
			: "메일 발송 여부는 규칙이 정하고, 에이전트는 설명만 맡아요. 오탐으로 봐도 메일을 막지 않아요."}</p>
</div>`;

	const chips = [
		["쓰는 모델", g.model ?? "-"],
		["투표", `${g.votes ?? "-"}표 중 과반`],
		["검증 대상", target],
		["주기", `${g.interval_min ?? "-"}분마다 최대 ${g.batch ?? "-"}건`],
	]
		.map(([k, v]) => `<span class="agc"><i>${escapeHtml(String(k))}</i>${escapeHtml(String(v))}</span>`)
		.join("");

	const card = (l: string, v: string, tone = "", extra = "") =>
		`<div class="m"><div class="l">${l}</div><div class="v ${tone}">${v}${extra}</div></div>`;

	const sigRows = (g.by_signal ?? []).length
		? (g.by_signal ?? [])
				.map((r) => {
					const name = SIGNAL_LABEL[r.signal] ?? r.signal;
					const pct = r.n ? (r.miss / r.n) * 100 : 0;
					return `<tr><td>${escapeHtml(name)}</td>` +
						`<td>${r.scope === "traffic" ? "트래픽" : "AI 호출"}</td>` +
						`<td class="n">${r.n.toLocaleString()}</td>` +
						`<td class="n${pct >= 50 ? " r" : ""}">${r.miss.toLocaleString()}<span class="sm"> ${pct.toFixed(0)}%</span></td></tr>`;
				})
				.join("")
		: `<tr><td colspan="4">아직 본 판정이 없어요.</td></tr>`;

	const recentRows = (g.recent ?? []).length
		? (g.recent ?? [])
				.map((r) => {
					const m = VERDICT_LABEL[r.verdict] ?? { text: r.verdict, cls: "wait" };
					const fp = m.cls === "miss";
					const who = r.app === "*" ? "전체" : r.scope === "traffic" ? siteName(r.app) : r.app;
					const say = fp ? r.reason : r.action || r.reason;
					return `<div class="agr${fp ? " fp" : ""}">
  <div class="hd"><span class="vd ${m.cls}">${escapeHtml(m.text)}</span>
    <b>${escapeHtml(r.label || SIGNAL_LABEL[r.signal] || r.signal)}</b>
    <span class="sm">${escapeHtml(who)} · ${bucketAt(r.bucket)} 구간 · ${r.detector === "model" ? "모델" : "규칙"} 판정</span>
    <span class="sm rt">${ago(Date.now() - r.at)}${r.confidence ? ` · 확신 ${Math.round(r.confidence * 100)}%` : ""}${r.votes ? ` · ${r.votes}표` : ""}</span></div>
  <p>${escapeHtml(say || "(설명이 없어요)")}</p>
</div>`;
				})
				.join("")
		: `<div class="empty">아직 본 판정이 없어요.</div>`;

	return `${what}
<div class="agchips">${off ? `<span class="agc off"><i>상태</i>꺼져 있어요</span>` : `<span class="agc on"><i>상태</i>돌고 있어요</span>`}${chips}</div>

<div class="kpi2" style="margin-bottom:4px">
  ${card("본 판정", (g.total ?? 0).toLocaleString(), "", `<span class="sm"> · 24시간 ${(g.day1 ?? 0).toLocaleString()}</span>`)}
  ${card("정탐으로 봄", hit.toLocaleString())}
  ${card("오탐으로 봄", miss.toLocaleString())}
  ${card("정탐률", rate === null ? "-" : pct1(rate))}
  ${card("확인할 일 적음", (g.acted ?? 0).toLocaleString())}
  ${card("마지막 판정", g.last_at ? ago(Date.now() - g.last_at) : "-")}
</div>

<div class="two">
  <section>${sectionHead("날짜별 검증 건수")}
    <div class="panel">${agentSpark(g.daily ?? []) || `<span class="sm">아직 기록이 없어요.</span>`}
      <p class="sm" style="margin:8px 0 0">최근 14일이에요. 판정이 늘면 검증도 함께 늘어요.</p></div>
  </section>
  <section>${sectionHead("많이 본 신호")}
    <div class="cap"><table class="fx">${cols("", "82", "62", "96")}<thead><tr><th>신호</th><th>갈래</th><th class="n">본 건</th><th class="n">오탐으로 봄</th></tr></thead><tbody>${sigRows}</tbody></table></div>
  </section>
</div>

${sectionHead("최근에 본 판정")}
<div class="agrs">${recentRows}</div>`;
}

/** 구간 시각 — 표에서는 초까지 필요 없다. */
const bucketAt = (ts: number) => kst(ts).slice(0, 11);

/** 판정 단위 이름 — 화면에서는 5m·1h 대신 우리말로 쓴다. */
const GRAIN_LABEL: Record<string, string> = { "5m": "5분", "1h": "1시간", "1d": "하루" };

interface Readiness {
	ready?: boolean;
	grains?: Record<string, { have?: number; need?: number; ready?: boolean; eta?: number | null }>;
}

/**
 * 아직 판정을 시작하지 못했을 때 그 사실을 알린다.
 *
 * "이상 신호 없음"만 보이면 조용한 건지 못 보고 있는 건지 구분이 안 된다.
 * 평소 값을 만들 구간이 모자라면 판정 자체를 건너뛰므로, 몇 구간이 더 필요하고
 * 언제쯤부터 보기 시작하는지를 함께 적는다.
 */
function warmupNotice(a: AnomalyData): string {
	const r = anomState<Record<string, Readiness>>(a, "readiness")?.[a.scope];
	if (!r || r.ready) return "";
	const grains = Object.entries(r.grains ?? {});
	if (!grains.length) return "";

	const parts = grains
		.map(([g, v]) => {
			const name = GRAIN_LABEL[g] ?? g;
			if (v.ready) return `${name} 단위는 판정 중`;
			const when = v.eta ? ` · ${bucketAt(v.eta)}쯤 시작` : "";
			return `${name} 단위 ${v.have ?? 0}/${v.need ?? 0}구간${when}`;
		})
		.join(" · ");
	const need = grains[0]?.[1]?.need ?? 5;

	return `<div class="warm">
  <b>아직 판정을 시작하지 않았어요.</b>
  <span>평소 값을 만들려면 같은 자리의 지난 구간이 ${need}개는 있어야 하는데 아직 모자라요. 그때까지는 기록만 쌓아요.</span>
  <span class="sm">${escapeHtml(parts)}</span>
</div>`;
}


/** 모델 상태 — 등록 표에 영문이 그대로 나오지 않게 옮긴다. */
const MODEL_STATUS: Record<string, { text: string; cls: string }> = {
	active: { text: "쓰는 중", cls: "up" },
	candidate: { text: "후보", cls: "hold" },
	retired: { text: "물러남", cls: "off" },
};

/**
 * 모델 평가값 한 줄 — metrics는 {rule:{...}, model:{...}} 꼴이라
 * 그대로 문자열로 만들면 [object Object]가 된다. 필요한 수치만 뽑아 쓴다.
 */
function modelMetrics(raw: string | null): string {
	if (!raw) return "-";
	let m: Record<string, unknown>;
	try {
		m = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return "-";
	}
	const f1 = (k: string) => {
		const o = m[k] as { f1?: number } | undefined;
		return o && typeof o.f1 === "number" ? pct1(o.f1) : null;
	};
	const parts = [
		f1("rule") ? `규칙 F1 ${f1("rule")}` : "",
		f1("model") ? `모델 F1 ${f1("model")}` : "",
	].filter(Boolean);
	return parts.length ? parts.join(" · ") : "-";
}

/** 심각도 비중 도넛 — 요약 칸 왼쪽에 들어가는 작은 판. 가운데에 전체 건수를 적는다. */
const SEV_COLOR: Record<string, string> = { critical: "var(--bad)", warn: "var(--warn)", info: "var(--info)" };

function sevDonut(a: { critical: number; warn: number; info: number; total: number }): string {
	return smallDonut(
		[
			{ label: "심각", v: a.critical, color: SEV_COLOR.critical },
			{ label: "주의", v: a.warn, color: SEV_COLOR.warn },
			{ label: "참고", v: a.info, color: SEV_COLOR.info },
		],
		a.total,
		"심각도 비중",
	);
}

/**
 * 작은 도넛 + 범례 — 요약 화면 칸에서 쓴다.
 * 값이 0인 항목은 아예 그리지 않는다. 조각이 하나뿐이면 원형 링으로 그린다.
 */
function smallDonut(rows: { label: string; v: number; color: string }[], total: number, aria: string): string {
	const parts = rows.filter((r) => r.v > 0);
	const sum = parts.reduce((x, y) => x + y.v, 0) || 1;

	// 고리를 얇게 잡아 가운데 구멍을 넓힌다. 숫자가 다섯 자리를 넘어도 좌우에 여백이 남는다.
	const C = 48, R = 44, r = 32;
	const pt = (ang: number, rad: number) =>
		`${(C + rad * Math.cos(ang)).toFixed(2)},${(C + rad * Math.sin(ang)).toFixed(2)}`;

	let acc = -Math.PI / 2;
	const arcs =
		parts.length === 1
			? `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" style="stroke:${parts[0].color}" stroke-width="${R - r}" data-tip="${escapeHtml(`${parts[0].label} ${parts[0].v.toLocaleString()}건 (100%)`)}"/>`
			: parts
					.map((s) => {
						const ang = (s.v / sum) * Math.PI * 2;
						const a0 = acc;
						const a1 = acc + ang;
						acc = a1;
						const large = ang > Math.PI ? 1 : 0;
						const d = `M ${pt(a0, R)} A ${R} ${R} 0 ${large} 1 ${pt(a1, R)} L ${pt(a1, r)} A ${r} ${r} 0 ${large} 0 ${pt(a0, r)} Z`;
						const tip = `${s.label} ${s.v.toLocaleString()}건 (${((s.v / sum) * 100).toFixed(0)}%)`;
						return `<path d="${d}" style="fill:${s.color}" data-tip="${escapeHtml(tip)}"/>`;
					})
					.join("");

	// 방문 수는 몇십만까지 커진다. 도넛 가운데는 자리가 좁아서 다섯 자리가 넘으면
	// 줄여 쓰고(12.3k · 1.2M) 글자도 한 단계씩 줄인다. 정확한 값은 마우스를 올리면 나온다.
	const center = donutNum(total);
	const cvSize = center.length <= 4 ? 18 : center.length <= 5 ? 16 : center.length <= 6 ? 14 : 12;

	const legend = parts
		.map(
			(s) =>
				`<div class="lg" data-tip="${escapeHtml(`${s.label} ${s.v.toLocaleString()}건 (${((s.v / sum) * 100).toFixed(0)}%)`)}">` +
				`<i style="background:${s.color}"></i>` +
				`<span class="nm">${s.label}</span><b>${escapeHtml(donutNum(s.v))}</b></div>`,
		)
		.join("");

	return `<div class="sevd">
  <svg viewBox="0 0 ${C * 2} ${C * 2}" role="img" aria-label="${escapeHtml(aria)}" data-tip="${escapeHtml(`전체 ${total.toLocaleString()}건`)}">
    ${arcs}
    <text x="${C}" y="${C - 2}" class="cv" style="font-size:${cvSize}px">${escapeHtml(center)}</text>
    <text x="${C}" y="${C + 12}" class="cl">건</text>
  </svg>
  <div class="lgs">${legend}</div>
</div>`;
}

/** 좁은 자리에 넣을 숫자 — 다섯 자리까지는 그대로, 그보다 크면 줄여 쓴다. */
const donutNum = (v: number) => (v < 100_000 ? v.toLocaleString() : shortNum(v));

/** 달 표시 — 해가 바뀌는 자리에서만 연도를 붙인다. */
function monthLabel(m: string, prev?: string): string {
	const [y, mo] = m.split("-");
	return !prev || prev.slice(0, 4) !== y ? `${y.slice(2)}년 ${Number(mo)}월` : `${Number(mo)}월`;
}
const monthTitle = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
const kstMonthKey = (ts: number) => new Date(ts + 9 * 3600_000).toISOString().slice(0, 7);

/** 달 비용은 대개 1달러를 넘는다. 막대 위에 얹을 짧은 표기. */
const usdMonth = (v: number) => (v <= 0 ? "$0" : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);

/**
 * 달별 비용 — 기간 탭과 무관하게 늘 최근 열두 달을 본다.
 *
 * 기간을 따라가게 두면 '주'를 보고 있을 때 막대가 하나만 남아 아무것도 알 수 없다.
 * 청구서가 달 단위로 오므로 대조하려면 달 추이는 늘 같은 자리에 있어야 한다.
 * 막대의 흐린 윗부분은 내부용 앱(이상탐지·메일 도구)이 쓴 몫이다 — 실제 청구에는
 * 포함되지만 "서비스가 쓴 돈"과는 갈라 봐야 한다.
 */
function monthlyCostPanel(s: SummaryData): string {
	const rows = s.monthly;
	if (!rows.length) return `<div class="empty">아직 비용 기록이 없어요.</div>`;

	const nowKey = kstMonthKey(Date.now());
	const max = Math.max(...rows.map((r) => r.cost), 0.0001);
	const BAR = 68;

	const bars = rows
		.map((r, i) => {
			const isNow = r.m === nowKey;
			const h = Math.max(3, Math.round((r.cost / max) * BAR));
			const innPct = r.cost > 0 ? Math.min(100, Math.round((r.internalCost / r.cost) * 100)) : 0;
			const tip =
				`${monthTitle(r.m)}\n전체 ${usd(r.cost)} · ${r.total.toLocaleString()}건` +
				(r.internalCost > 0
					? `\n서비스 ${usd(r.cost - r.internalCost)} · 내부 도구 ${usd(r.internalCost)}`
					: "") +
				(isNow ? "\n(이번 달 · 아직 진행 중이에요)" : "");
			return (
				`<div class="b${isNow ? " now" : ""}" data-tip="${escapeHtml(tip)}">` +
				`<span class="v">${usdMonth(r.cost)}</span>` +
				`<span class="bar" style="height:${h}px">${innPct ? `<i style="height:${innPct}%"></i>` : ""}</span>` +
				`<span class="lb">${escapeHtml(monthLabel(r.m, rows[i - 1]?.m))}</span></div>`
			);
		})
		.join("");

	const cur = rows[rows.length - 1]?.m === nowKey ? rows[rows.length - 1] : null;
	const parts: string[] = [];
	if (cur) {
		parts.push(`이번 달 <b>${usd(cur.cost)}</b>`);
		// 달 초에는 몇 시간치로 한 달을 점치게 되어 숫자가 널뛴다. 15%는 지나야 적는다.
		if (s.monthProgress >= 0.15) {
			parts.push(`이대로면 <b>${usd(cur.cost / s.monthProgress)}</b> 예상`);
		}
		if (cur.internalCost > 0) {
			const pct = Math.round((cur.internalCost / cur.cost) * 100);
			parts.push(`내부 도구 몫 ${usd(cur.internalCost)}<span class="sm"> (${pct}%)</span>`);
		}
	}

	return `<div class="mcost">
  <div class="bars">${bars}</div>
  ${parts.length ? `<div class="sum">${parts.join('<span class="dot">·</span>')}</div>` : ""}
</div>`;
}

/**
 * 요약 화면에 얹는 이상탐지 칸.
 * 훑어보는 화면이라 "지금 이상이 있나 · 무엇이 · 탐지기는 살아 있나" 셋만 담고,
 * 나머지는 이상탐지 탭 몫으로 넘긴다. 이상이 없으면 한 줄로 접는다.
 */
function anomalyBand(a: AnomalyBrief, href: string): string {
	const age = a.heartbeatAge;
	const cls = age === null || age > 15 * 60_000 ? "down" : age > 5 * 60_000 ? "stale" : "";
	const stateText =
		age === null
			? "이상탐지 서버에서 아직 신호가 오지 않았어요"
			: cls === "down"
				? "이상탐지 서버 신호가 끊겼어요"
				: cls === "stale"
					? "이상탐지 서버 신호가 늦어지고 있어요"
					: "이상탐지 서버 정상";
	const dot = `<span class="st${cls ? ` ${cls}` : ""}"><span class="dot"></span>${escapeHtml(stateText)}</span>`;

	if (!a.total) {
		return `<div class="anb quiet">${dot}<span class="t">이 기간에 잡힌 이상 신호가 없어요.</span>` +
			`<span class="sm">마지막 신호 ${ago(age)}</span></div>`;
	}

	const rows = a.recent
		.map((r) => {
			const d = anomDetail(r);
			const amount = d.ratio ? `평소의 ${d.ratio}배` : anomValue(r.observed, d.metric);
			const tip = r.verdict_reason ? `${kst(r.bucket)}\n${r.verdict_reason}` : kst(r.bucket);
			return `<tr><td class="mono" data-tip="${escapeHtml(tip)}">${kst(r.bucket).slice(0, 11)}</td>` +
				`<td>${sevTag(r.severity)}</td>` +
				`<td>${escapeHtml(d.label || SIGNAL_LABEL[r.signal] || r.signal)}</td>` +
				`<td>${r.app === "*" ? "전체" : escapeHtml(r.app)}</td>` +
				`<td class="n">${escapeHtml(amount)}</td>` +
				`<td>${verdictTag(r.verdict, r.verdict_reason)}</td></tr>`;
		})
		.join("");

	return `<div class="anb">
  <div class="anb-l">
    ${dot}
    ${sevDonut(a)}
    <div class="sub">전체 ${a.total.toLocaleString()}건${delta(a.total, a.prevTotal, true)}${a.hitRate === null ? "" : ` · 정탐률 ${pct1(a.hitRate)}`}<br>마지막 탐지 ${a.lastDetected ? ago(Date.now() - a.lastDetected) : "-"}</div>
  </div>
  <div class="anb-r"><div class="scroll"><table class="mini"><tr><th>구간</th><th>등급</th><th>신호</th><th>앱</th><th class="n">관측</th><th>검증</th></tr>${rows}</table></div>
    <div class="sub"><a href="${href}">이상 신호 ${a.total.toLocaleString()}건 모두 보기 →</a></div>
  </div>
</div>`;
}

/** 이상탐지 서버 상태줄 — heartbeat가 끊긴 것 자체가 알림이다. */
function serverBar(a: AnomalyData): string {
	return serverBarOf(a.state, a.heartbeatAge);
}

function serverBarOf(state: { key: string; value: string; updated_at: number }[], age: number | null): string {
	const cls = age === null ? "down" : age > 15 * 60_000 ? "down" : age > 5 * 60_000 ? "stale" : "";
	const msg =
		age === null
			? "이상탐지 서버에서 아직 신호가 오지 않았어요."
			: cls === "down"
				? "이상탐지 서버 신호가 끊겼어요. 서버 점검이 필요해요."
				: cls === "stale"
					? "이상탐지 서버 신호가 늦어지고 있어요."
					: "이상탐지 서버가 정상 동작 중이에요.";

	// 작업 뱃지는 정상인 것을 한 덩이로 접는다. 열두 개를 영문 이름 그대로 늘어놓으면
	// 첫 화면에서 판정보다 먼저 눈에 들어오는데, 정작 보는 사람은 "다 도는가"만 알면 된다.
	const jobRows = state
		.filter((s) => s.key.startsWith("job:"))
		.map((s) => {
			let v: { ok?: boolean; error?: string; result?: unknown } = {};
			try {
				v = JSON.parse(s.value);
			} catch {
				/* 형식이 달라지면 이름만 보여준다 */
			}
			const name = s.key.slice(4);
			const when = `${ago(Date.now() - s.updated_at)} 실행`;
			return { name, ok: v.ok !== false, tip: v.ok === false ? `${name} · 실패: ${v.error ?? ""}` : `${name} · ${when}` };
		});
	const okJobs = jobRows.filter((j) => j.ok);
	const jobs =
		(okJobs.length
			? `<span class="job ok" data-tip="${escapeHtml(okJobs.map((j) => j.tip).join("\n"))}">작업 ${okJobs.length}개 정상</span>`
			: "") +
		jobRows.filter((j) => !j.ok).map((j) => `<span class="job bad" data-tip="${escapeHtml(j.tip)}">${escapeHtml(j.name)} 실패</span>`).join("");

	return `<div class="srv ${cls}"><span class="dot"></span>
  <span class="t">${msg}</span>
  <span class="sm">마지막 신호 ${ago(age)}</span>
  <span class="jobs">${jobs}</span>
</div>`;
}

/**
 * 이상탐지 탭 — 줄을 둘로만 쓴다.
 *   줄1  무엇을 보나(AI 호출 · 트래픽 · 메일 발송) + 오른쪽에 기간
 *   줄2  어떻게 보나(요약 · 판정 상세) + 오른쪽에 화면별 곁가지(등급·종류)
 * 예전에는 갈래 줄과 기간 줄에 같은 이름이 두 번 나와 헷갈렸다.
 */
export interface AnomalyNav {
	/** ai · traffic (메일 화면에서도 직전 갈래를 기억한다) */
	scope: string;
	/** summary · detail · mail */
	view: string;
	period: string;
	app?: string;
	sev?: string;
	kind?: string;
}

function anomalyHref(v: AnomalyNav): string {
	const p = new URLSearchParams();
	p.set("period", v.period);
	if (v.view === "mail") {
		p.set("scope", "mail");
		if (v.kind) p.set("kind", v.kind);
	} else if (v.view === "detail") {
		p.set("scope", "detail");
		p.set("for", v.scope);
		if (v.sev) p.set("sev", v.sev);
		if (v.app) p.set("app", v.app);
	} else {
		p.set("scope", v.scope);
		if (v.app) p.set("app", v.app);
	}
	return `/admin/anomaly?${p.toString()}`;
}

const navTab = (label: string, on: boolean, href: string) =>
	`<a class="tab${on ? " on" : ""}" href="${href}">${label}</a>`;

/** 줄1 — 갈래 + 기간 */
function anomalyNavRow(cur: AnomalyNav): string {
	const view = cur.view === "mail" ? "summary" : cur.view;
	const left =
		navTab("AI 호출", cur.view !== "mail" && cur.scope === "ai", anomalyHref({ ...cur, view, scope: "ai", app: "" })) +
		navTab("트래픽", cur.view !== "mail" && cur.scope === "traffic", anomalyHref({ ...cur, view, scope: "traffic", app: "" })) +
		navTab("메일 발송", cur.view === "mail", anomalyHref({ ...cur, view: "mail" }));
	const periods = Object.entries(PERIODS)
		.map(([k, v]) => navTab(v.label, k === cur.period, anomalyHref({ ...cur, period: k })))
		.join("");
	return `<div class="tabs">${left}<span style="flex:1"></span>${periods}</div>`;
}

/** 줄2 — 보기 방식 + 오른쪽 곁가지 */
function anomalyViewRow(cur: AnomalyNav, right = ""): string {
	if (cur.view === "mail") return right ? `<div class="tabs">${right}</div>` : "";
	const left =
		navTab("요약", cur.view === "summary", anomalyHref({ ...cur, view: "summary" })) +
		navTab("판정 상세", cur.view === "detail", anomalyHref({ ...cur, view: "detail" }));
	return `<div class="tabs">${left}${right ? `<span style="flex:1"></span>${right}` : ""}</div>`;
}

/** 줄3 — 앱(서비스) 고르기. 항목이 많아 따로 둔다. */
function anomalyAppRow(cur: AnomalyNav, apps: { id: string; name: string }[], traffic: boolean): string {
	const t = (id: string, label: string) =>
		navTab(escapeHtml(label), (cur.app ?? "") === id, anomalyHref({ ...cur, app: id }));
	return `<div class="tabs">${t("", traffic ? "전체 서비스" : "전체 앱")}${apps.map((a) => t(a.id, a.name)).join("")}</div>`;
}

const SITE_TABS = Object.entries(SITES).map(([id, v]) => ({ id, name: v.name, active: true }));

export function renderAnomaly(a: AnomalyData, opts: AdminOpts = {}): string {
	const traffic = a.scope === "traffic";
	const who = traffic ? "서비스" : "앱";
	const nameOf = (k: string) => (k === "*" ? "전체" : traffic ? siteName(k) : k);
	const q = `?period=${a.period}${a.appFilter ? `&app=${encodeURIComponent(a.appFilter)}` : ""}&scope=${a.scope}`;
	const nav: AnomalyNav = { scope: a.scope, view: "summary", period: a.period, app: a.appFilter };

	const card = (l: string, v: string, tone = "", extra = "") =>
		`<div class="m"><div class="l">${l}</div><div class="v ${tone}">${v}${extra}</div></div>`;

	const sevDonut = svgDonut(
		[
			{ label: "심각", value: a.critical },
			{ label: "주의", value: a.warn },
			{ label: "참고", value: a.info },
		].filter((r) => r.value > 0),
		"건",
	);

	const signalShare = svgShare(
		a.bySignal.map((r) => ({
			label: r.label,
			value: r.total,
			sub: r.critical ? `심각 ${r.critical}건` : "",
		})),
		"건",
	);

	const rows = a.recent.length
		? a.recent
				.map((r) => {
					const d = anomDetail(r);
					return (
						`<tr><td class="mono" data-tip="${escapeHtml(`${kst(r.bucket)} · ${r.grain} 단위`)}">${bucketAt(r.bucket)}</td>` +
						`<td>${sevTag(r.severity)}</td>` +
						`<td>${escapeHtml(d.label)}</td>` +
						`<td>${escapeHtml(nameOf(r.app))}</td>` +
						(r.detector === "model"
							// 모델 판정은 지표 하나를 짚은 게 아니라 구간 전체를 본 결과다.
							// 관측 자리에 구간 크기, 평소 자리에 벌어진 지표, 점수 자리에 "점수 / 기준"을 적는다.
							? `<td class="n" data-tip="이 구간의 ${traffic ? "방문" : "호출"} 수">${r.observed === null ? "-" : `${Math.round(r.observed).toLocaleString()}건`}</td>` +
								`<td class="sm" data-tip="평소와 가장 많이 벌어진 지표">${escapeHtml(anomTopMetrics(r) || "-")}</td>` +
								`<td class="n" data-tip="모델 이상 점수 / 판정 기준">${r.score === null ? "-" : `${r.score.toFixed(2)}<span class="sm"> / ${(r.baseline ?? 0).toFixed(2)}</span>`}</td>`
							: `<td class="n">${anomValue(r.observed, d.metric)}</td>` +
								`<td class="n">${anomValue(r.baseline, d.metric)}` +
								`${d.ratio ? ` <span class="sm">${d.ratio}배</span>` : ""}</td>` +
								`<td class="n">${r.score === null ? "-" : r.score.toFixed(1)}</td>`) +
						`<td>${r.detector === "model"
							? `<span data-tip="${escapeHtml(r.model_version ?? "")}">모델</span>`
							: "규칙"}</td>` +
						`<td>${verdictTag(r.verdict, r.verdict_reason)}</td>` +
						`<td>${r.mailId
							? `<a href="/admin/anomaly?period=${a.period}&scope=mail#m-${r.mailId}" data-tip="${escapeHtml(String(r.mailSubject ?? ""))}">메일 보기 →</a>`
							: r.notified_at
								? bucketAt(r.notified_at)
								: r.suppressed_reason
									? `<span class="sm" data-tip="${escapeHtml(r.suppressed_reason)}">보내지 않음</span>`
									: "-"}</td></tr>`
					);
				})
				.join("")
		: `<tr><td colspan="10">이 기간에 잡힌 이상 신호가 없어요.</td></tr>`;

	// 재학습이 6시간마다 돌아 후보가 쌓인다. 쓰는 모델과 최근 것만 보여주고 나머지는 접는다.
	const MODEL_SHOWN = 6;
	const modelList = [
		...a.models.filter((m) => m.status === "active"),
		...a.models.filter((m) => m.status !== "active"),
	].slice(0, MODEL_SHOWN);
	const modelRows = modelList.length
		? modelList
				.map((m) => {
					const st = MODEL_STATUS[m.status ?? ""] ?? { text: m.status ?? "-", cls: "off" };
					return (
						`<tr><td class="mono" data-tip="${escapeHtml(`${m.algo ?? ""}\n범위 ${m.scope === "*" ? "전체" : m.scope ?? "-"}`)}">${escapeHtml(m.version)}</td>` +
						`<td><span class="pm ${st.cls}">${escapeHtml(st.text)}</span></td>` +
						`<td class="mono">${m.trained_at ? bucketAt(m.trained_at) : "-"}</td>` +
						`<td class="n">${(m.train_rows ?? 0).toLocaleString()}</td>` +
						`<td>${escapeHtml(modelMetrics(m.metrics))}</td></tr>`
					);
				})
				.join("")
		: `<tr><td colspan="5">아직 학습된 모델이 없어요. 지금은 규칙·통계 기준으로 판정하고 있어요.</td></tr>`;

	// ── 이상탐지 에이전트 라벨 · 탐지기 성적 · 승격 심사 (이상탐지 서버가 함께 밀어 넣는다)
	type LabelState = {
		total?: number;
		by_verdict?: Record<string, number>;
		rule?: { hit: number; miss: number; rate: number | null };
		model?: { hit: number; miss: number; rate: number | null };
	};
	type EvalOne = {
		dataset?: string; version?: string | null; tp?: number; fp?: number; fn?: number;
		precision?: number; recall?: number; f1?: number; by_signal?: Record<string, number>;
	};
	// 라벨·채점 요약은 갈래별로 따로 받는다. 없으면 예전 형식(전체 합계)으로 물러선다.
	const labAll = anomState<Record<string, LabelState>>(a, "labels_by_scope");
	const evAll = anomState<Record<string, Record<string, EvalOne>>>(a, "eval_by_scope");
	const lab = (labAll?.[a.scope] as LabelState | undefined) ?? anomState<LabelState>(a, "labels");
	const ev = (evAll?.[a.scope] as Record<string, EvalOne> | undefined) ?? anomState<Record<string, EvalOne>>(a, "eval");
	const proms = (anomState<{ ran_at: string; version: string; baseline: string | null; decision: string; reason: string; scope?: string }[]>(a, "promotion") ?? [])
		.filter((p) => (p.scope ?? "ai") === a.scope);
	const alertState = anomState<{ suppressed?: number; sent?: number }>(a, "alerts");

	const verdictRows = lab?.by_verdict && Object.keys(lab.by_verdict).length
		? Object.entries(lab.by_verdict)
				.sort((x, y) => y[1] - x[1])
				.map(([k, n]) => {
					const m = VERDICT_LABEL[k] ?? { text: k, cls: "wait" };
					const share = lab.total ? (n / lab.total) * 100 : 0;
					return `<tr><td><span class="vd ${m.cls}">${escapeHtml(m.text)}</span></td>` +
						`<td class="n">${n.toLocaleString()}</td><td class="n">${share.toFixed(0)}%</td></tr>`;
				})
				.join("")
		: `<tr><td colspan="3">아직 검증된 판정이 없어요.</td></tr>`;

	// 규칙과 모델을 같은 검증셋으로 잰 표. 신호별 재현율까지 나란히 놓아 어느 쪽이 무엇에 강한지 본다.
	const sigKeys = Array.from(new Set([
		...Object.keys(ev?.rule?.by_signal ?? {}),
		...Object.keys(ev?.model?.by_signal ?? {}),
	])).sort();
	const sigLabel = (k: string) => a.bySignal.find((x) => x.key === k)?.label ?? SIGNAL_LABEL[k] ?? k;
	const compareRows = ev?.rule
		? [
				`<tr><td><b>전체</b></td>` +
					`<td class="n">${pct1(ev.rule.precision)}</td><td class="n">${pct1(ev.rule.recall)}</td>` +
					`<td class="n">${pct1(ev.model?.precision)}</td><td class="n">${pct1(ev.model?.recall)}</td></tr>`,
				...sigKeys.map((k) => {
					const r = ev.rule?.by_signal?.[k];
					const m = ev.model?.by_signal?.[k];
					const better = m !== undefined && r !== undefined && m > r;
					return `<tr><td>${escapeHtml(sigLabel(k))}</td><td class="n">-</td>` +
						`<td class="n${!better && r !== undefined ? " g" : ""}">${pct1(r)}</td>` +
						`<td class="n">-</td><td class="n${better ? " g" : ""}">${pct1(m)}</td></tr>`;
				}),
			].join("")
		: `<tr><td colspan="5">아직 채점 기록이 없어요.</td></tr>`;

	const promRows = proms.length
		? proms
				.map(
					(p) =>
						`<tr><td class="mono">${escapeHtml(String(p.ran_at).slice(5, 16))}</td>` +
						`<td class="mono">${escapeHtml(p.version)}</td>` +
						`<td><span class="pm ${p.decision === "promoted" ? "up" : "hold"}">${p.decision === "promoted" ? "승격" : "보류"}</span></td>` +
						`<td>${escapeHtml(p.reason)}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="4">아직 승격 심사 기록이 없어요.</td></tr>`;

	// 재학습 이력 — 언제 왜 다시 배웠고 성적이 어떻게 바뀌었나.
	const f1 = (v: number | null) => (v === null || v === undefined ? "-" : `${(v * 100).toFixed(1)}%`);
	const trainRows = a.trains.length
		? a.trains
				.map((t) => {
					const moved =
						t.f1_before !== null && t.f1_after !== null
							? `<span class="${t.f1_after >= t.f1_before ? "g" : "r"}">${f1(t.f1_before)} → ${f1(t.f1_after)}</span>`
							: f1(t.f1_after);
					const dec =
						t.status !== "ok"
							? `<span class="pm hold">${t.status === "skipped" ? "건너뜀" : "실패"}</span>`
							: t.decision === "promoted"
								? `<span class="pm up">승격</span>`
								: `<span class="pm hold">후보</span>`;
					const tip = [t.message, t.source ? `학습 데이터 ${t.source}` : ""].filter(Boolean).join("\n");
					return (
						`<tr><td class="mono" data-tip="${escapeHtml(tip)}">${kst(t.started_at).slice(0, 11)}</td>` +
						`<td>${escapeHtml(TRIGGER_LABEL[t.trigger ?? ""] ?? t.trigger ?? "-")}</td>` +
						`<td class="mono">${escapeHtml(t.version ?? "-")}</td>` +
						`<td class="n">${(t.train_rows ?? 0).toLocaleString()}</td>` +
						`<td class="n">${moved}</td>` +
						`<td>${dec}</td></tr>`
					);
				})
				.join("")
		: `<tr><td colspan="6">아직 학습 기록이 없어요.</td></tr>`;

	const appRows = a.byApp.length
		? a.byApp
				.map(
					(r) =>
						`<tr><td>${escapeHtml(traffic ? nameOf(r.key) : r.name)}</td><td class="n">${r.total.toLocaleString()}</td>` +
						`<td class="n r">${r.critical.toLocaleString()}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="3">기록이 없어요.</td></tr>`;

	return shellAdmin(
		"이상탐지",
		pageHead(
			"이상탐지",
			`${traffic ? "평소와 다른 방문 흐름" : "평소와 다른 호출 흐름"} · ${sinceLabel(a.since)}`,
			a.appFilter,
		) +
			`<div id="hz-body">
${anomalyNavRow(nav)}
${anomalyViewRow(nav)}
${anomalyAppRow(nav, traffic ? SITE_TABS : a.apps, traffic)}
${serverBar(a)}
${warmupNotice(a)}

<div class="noteline">
  <span class="sm">아래 숫자는 <b>${escapeHtml(sinceLabel(a.since))}</b> 쌓인 값이에요. 옆의 ‘24시간’은 그중 최근 하루에 잡힌 수예요.</span>
  <a href="/admin/anomaly?period=${a.period}&scope=detail&for=${a.scope}${a.appFilter ? `&app=${encodeURIComponent(a.appFilter)}` : ""}">${a.critical ? `심각 ${a.critical.toLocaleString()}건 ` : ""}자세히 보기 →</a>
</div>
<div class="kpi2" style="margin-bottom:4px">
  ${card("이상 신호", a.total.toLocaleString(), "", delta(a.total, a.prevTotal, true) + `<span class="sm"> · 24시간 ${a.recent24.toLocaleString()}</span>`)}
  ${card("심각", a.critical.toLocaleString(), a.critical ? "r" : "", `<span class="sm"> · 24시간 ${a.critical24.toLocaleString()}</span>`)}
  ${card("주의", a.warn.toLocaleString(), "", a.info ? `<span class="sm"> · 참고 ${a.info.toLocaleString()}</span>` : "")}
  ${card("메일 발송", a.notified.toLocaleString(), "", alertState?.suppressed ? `<span class="sm"> · 억제 ${alertState.suppressed}</span>` : "")}
  ${card("마지막 탐지", a.lastDetected ? ago(Date.now() - a.lastDetected) : "-")}
  ${card("쓰는 모델", escapeHtml(a.models.find((m) => m.status === "active")?.version ?? "규칙만"))}
</div>

${sectionHead(`${a.bucketLabel} 단위 이상 신호`)}
${svgLevels(a.buckets)}

<div class="two">
  <section>${sectionHead("심각도 비중")}${sevDonut}</section>
  <section>${sectionHead("신호별 분포")}${signalShare}</section>
</div>

${sectionHead("이상 신호 이력")}
<div class="scroll cap"><table class="recent"><tr><th>구간</th><th>등급</th><th>신호</th><th>앱</th><th class="n">관측</th><th class="n">평소 대비</th><th class="n">점수</th><th>탐지기</th><th>검증</th><th>메일</th></tr>${rows}</table></div>

${sectionHead("이상탐지 에이전트")}
${agentBrief(a)}

<div class="two">
  <section>${sectionHead("검증 결과 모음")}
    <table><tr><th>판정</th><th class="n">건수</th><th class="n">비중</th></tr>${verdictRows}</table>
  </section>
  <section>${sectionHead(`${who}별 이상 건수`)}
    <table><tr><th>${who}</th><th class="n">전체</th><th class="n">심각</th></tr>${appRows}</table>
  </section>
</div>

<div class="two">
  <section>${sectionHead("탐지기 성적 비교")}
    <div class="statline">검증된 판정 <b>${(lab?.total ?? 0).toLocaleString()}</b>건 · 정탐률 규칙 <b class="${(lab?.rule?.rate ?? 1) < 0.5 ? "r" : ""}">${pct1(lab?.rule?.rate)}</b> · 모델 <b class="${(lab?.model?.rate ?? 1) < 0.5 ? "r" : ""}">${pct1(lab?.model?.rate)}</b><br>검증셋 F1 규칙 <b>${pct1(ev?.rule?.f1)}</b> · 모델 <b>${pct1(ev?.model?.f1)}</b></div>
    <div class="scroll cap"><table class="tight"><tr><th>구분</th><th class="n">규칙 정밀도</th><th class="n">규칙 재현율</th><th class="n">모델 정밀도</th><th class="n">모델 재현율</th></tr>${compareRows}</table></div>
  </section>
  <section>${sectionHead("탐지 모델", { note: a.models.length > MODEL_SHOWN ? `최근 ${MODEL_SHOWN}개만 · 전체 ${a.models.length}개` : "" })}
    <div class="scroll cap"><table class="tight"><tr><th>버전</th><th>상태</th><th>학습 시각</th><th class="n">학습 행</th><th>평가</th></tr>${modelRows}</table></div>
  </section>
</div>

${sectionHead("성적 흐름 (F1)")}
${svgF1(a.evals)}

${sectionHead("재학습 이력")}
<div class="scroll cap"><table><tr><th>시각</th><th>계기</th><th>모델</th><th class="n">학습 구간</th><th class="n">F1 변화</th><th>결과</th></tr>${trainRows}</table></div>

${sectionHead("승격 심사")}
<div class="scroll cap"><table><tr><th>시각</th><th>후보</th><th>결과</th><th>근거</th></tr>${promRows}</table></div>

<p class="foot">판정은 이상탐지 서버(121.161.160.122)가 하고, 이 화면은 넘겨받은 결과만 보여줘요. 서버가 멈춰도 화면은 열리고 맨 위 상태줄에 표시돼요.<br>
${traffic
	? "트래픽에서는 <b>줄어드는 쪽</b>이 더 중요해요. 방문이 끊기면 서비스 장애이거나 색인 사고예요. 메일은 방문 급감 · 서버 오류(5xx) · 없는 주소(404)만 보내고, 급증이나 크롤러 변화는 화면에만 남겨요.<br>"
	: ""}
'평소'는 같은 요일·같은 시각의 과거 기록에서 뽑은 기준선이에요. 표본이 모자라면 최근 구간 전체로 대신하고, 그때는 등급을 한 단계 낮춰요.<br>
심각·주의 신호는 ${escapeHtml("zerolive7@gmail.com")}으로 메일이 나가요. 같은 신호가 이어지면 일정 시간 동안 묶어서 한 번만 보내요.<br>
메일은 규칙이 먼저 걸러요 — 구간이 너무 한산하면 판정하지 않고, 한 구간만 튄 신호는 다음 구간에도 이어질 때 보내며, 되풀이되는데 더 세지지 않는 신호는 넘겨요. 심각 신호는 이 기다림 없이 바로 보내요.<br>
'검증'은 나간 알림을 다시 읽어 정탐인지 오탐인지 가리고 확인할 일을 적어 주는 단계예요. 발송 여부를 정하지는 않아요.<br>
모델은 검증셋 성적과 실데이터 정탐률이 기준을 넘고 지금 쓰는 모델보다 나빠지지 않을 때만 승격돼요. 그전까지는 판정을 기록만 하고 메일에는 쓰지 않아요.</p>
</div>`,
		{ ...opts, tab: "anomaly" },
	);
}

// ═════════════════════════════════════════════════════════════
// 보낸 메일 (/admin/anomaly?scope=mail)
//   메일함을 열지 않고도 무엇이 언제 나갔는지 여기서 본다. 줄을 누르면 본문이 펼쳐지고,
//   '받은 그대로 보기'는 실제로 보낸 HTML을 새 창에 그대로 띄운다.
// ═════════════════════════════════════════════════════════════

const MAIL_KIND: Record<string, { text: string; cls: string }> = {
	anomaly: { text: "이상 알림", cls: "k-an" },
	train: { text: "학습 결과", cls: "k-tr" },
	test: { text: "점검", cls: "k-ts" },
};
const MAIL_SCOPE: Record<string, string> = { ai: "AI 호출", traffic: "트래픽", both: "AI 호출 · 트래픽" };

function mailRow(m: MailRow): string {
	const k = MAIL_KIND[m.kind] ?? { text: m.kind, cls: "k-ts" };
	let signals: string[] = [];
	try {
		signals = JSON.parse(m.signals || "[]") as string[];
	} catch {
		signals = [];
	}
	const sigText = signals
		.map((v) => v.split("|").slice(-1)[0])
		.filter((v, i, arr) => arr.indexOf(v) === i)
		.map((v) => SIGNAL_LABEL[v] ?? v)
		.join(" · ");

	const head =
		`<tr id="m-${m.src_id}" data-det="m${m.src_id}">` +
		`<td class="mono">${bucketAt(m.sent_at)}</td>` +
		`<td><span class="kind ${k.cls}">${escapeHtml(k.text)}</span></td>` +
		`<td>${escapeHtml(MAIL_SCOPE[m.scope ?? "ai"] ?? m.scope ?? "-")}</td>` +
		`<td>${m.kind === "anomaly" ? sevTag(m.severity ?? "info") : "-"}</td>` +
		`<td class="w"><b>${escapeHtml(m.subject.replace(/^\[AI Service\]\s*/, ""))}</b>` +
		(m.lead ? `<div class="sm">${escapeHtml(m.lead)}</div>` : "") +
		`</td>` +
		`<td class="n">${m.ok ? `<span class="pill g">보냄</span>` : `<span class="pill r">실패</span>`}</td></tr>`;

	const detail =
		`<tr class="det" id="det-m${m.src_id}" hidden><td colspan="6">` +
		(m.error ? `<div class="al" style="margin-bottom:10px">보내지 못했어요 — ${escapeHtml(m.error)}</div>` : "") +
		`<div class="sm" style="margin-bottom:8px">받는 사람 ${escapeHtml(m.recipient ?? "-")}` +
		(sigText ? ` · 신호 ${escapeHtml(sigText)}` : "") +
		`</div>` +
		`<pre class="mailbody">${escapeHtml(m.body ?? "(본문이 남아 있지 않아요)")}</pre>` +
		(m.has_html
			? `<a class="btn" href="/admin/anomaly/mail/${m.src_id}" target="_blank" rel="noopener">받은 그대로 보기 →</a>`
			: "") +
		`</td></tr>`;

	return head + detail;
}

export function renderMails(d: MailsData, opts: AdminOpts = {}): string {
	const card = (l: string, v: string, tone = "") =>
		`<div class="m"><div class="l">${l}</div><div class="v ${tone}">${v}</div></div>`;

	const nav: AnomalyNav = { scope: "ai", view: "mail", period: d.period, kind: d.kind };
	const kindTab = (k: string, label: string, n?: number) =>
		navTab(`${label}${n === undefined ? "" : ` ${n}`}`, d.kind === k, anomalyHref({ ...nav, kind: k }));

	const rows = d.rows.length
		? d.rows.map(mailRow).join("")
		: `<tr><td colspan="6">이 기간에 보낸 메일이 없어요.</td></tr>`;

	return shellAdmin(
		"보낸 메일",
		pageHead("이상탐지", `보낸 알림 메일 · ${sinceLabel(d.since)}`, "") +
			`<div id="hz-body">
${anomalyNavRow(nav)}
${anomalyViewRow(nav, kindTab("", "전체", d.total) + kindTab("anomaly", "이상 알림", d.anomaly) + kindTab("train", "학습 결과", d.train) + kindTab("test", "점검", d.test))}
${serverBarOf(d.state, d.heartbeatAge)}

<div class="kpi2" style="margin-bottom:4px">
  ${card("보낸 메일", d.total.toLocaleString())}
  ${card("이상 알림", d.anomaly.toLocaleString())}
  ${card("학습 결과", d.train.toLocaleString())}
  ${card("점검", d.test.toLocaleString())}
  ${card("보내지 못함", d.failed.toLocaleString(), d.failed ? "r" : "")}
  ${card("마지막 발송", d.lastSent ? ago(Date.now() - d.lastSent) : "-")}
</div>

${sectionHead("보낸 메일 내역", { href: `/admin/anomaly?period=${d.period}`, linkLabel: "이상 신호 보기 →" })}
<div class="scroll cap"><table class="recent mail"><tr><th>보낸 시각</th><th>종류</th><th>갈래</th><th>등급</th><th>제목</th><th class="n">결과</th></tr>${rows}</table></div>

<p class="foot">줄을 누르면 실제로 보낸 본문이 펼쳐져요. ‘받은 그대로 보기’는 메일함에서 보이는 모습 그대로 새 창에 띄워요.<br>
같은 신호가 이어지면 정해진 시간 동안 묶어서 한 번만 보내요. 검증에서 잘못 잡은 것으로 판정된 신호는 아예 보내지 않고, 이상탐지 화면에 ‘보내지 않음’으로 남아요.<br>
트래픽에서는 방문 급감·서버 오류(5xx)·없는 주소 요청(404)만 메일로 보내고, 나머지는 화면에만 남겨요.<br>
최근 ${MAIL_PAGE}건까지 보여줘요.</p>
</div>`,
		{ ...opts, tab: "anomaly" },
	);
}

// ═════════════════════════════════════════════════════════════
// 이상탐지 상세 (/admin/anomaly?scope=detail)
//   요약 화면에 건마다 카드를 쌓으면 화면이 한없이 길어지고 다른 칸이 밀린다.
//   그래서 풀어 쓴 설명은 이 게시판으로 옮겼다. 줄을 누르면 그 자리에서 펼쳐진다.
// ═════════════════════════════════════════════════════════════

/** 게시판 한 줄 — 접힌 머리줄과 펼쳐지는 설명 줄. */
function anomalyBoardRow(r: AnomalyRowWithMail, period: string, traffic: boolean): string {
	const d = anomDetail(r);
	const fp = r.verdict === "rule_fp" || r.verdict === "model_fp" || r.verdict === "both_fp";
	const who = r.app === "*" ? "전체" : traffic ? siteName(r.app) : r.app;

	const head =
		`<tr id="a-${r.id}" data-det="a${r.id}"${fp ? ' class="fp"' : ""}>` +
		`<td class="mono" data-tip="${escapeHtml(`${kst(r.bucket)} · ${r.grain} 단위`)}">${bucketAt(r.bucket)}</td>` +
		`<td>${sevTag(r.severity)}</td>` +
		`<td>${escapeHtml(d.label)}</td>` +
		`<td>${escapeHtml(who)}</td>` +
		`<td class="w"><b>${escapeHtml(anomalyLead(r, traffic ? "서비스" : "앱"))}</b>` +
		(r.verdict_action && !fp ? `<div class="sm">확인할 일 · ${escapeHtml(r.verdict_action)}</div>` : "") +
		`</td>` +
		`<td>${verdictTag(r.verdict, null)}</td>` +
		`<td class="n">${r.mailId
			? `<a href="/admin/anomaly?period=${period}&scope=mail#m-${r.mailId}">메일 →</a>`
			: `<span class="sm">-</span>`}</td></tr>`;

	const detail =
		`<tr class="det" id="det-a${r.id}" hidden><td colspan="7">` +
		anomalyExplain(r, period, traffic) +
		`</td></tr>`;

	return head + detail;
}

export function renderAnomalyDetail(d: AnomalyBoardData, opts: AdminOpts = {}): string {
	const traffic = d.forScope === "traffic";
	const card = (l: string, v: string, tone = "") =>
		`<div class="m"><div class="l">${l}</div><div class="v ${tone}">${v}</div></div>`;

	const nav: AnomalyNav = {
		scope: d.forScope, view: "detail", period: d.period, app: d.appFilter, sev: d.sev,
	};
	const sevTab = (k: string, label: string, n: number) =>
		navTab(`${label} ${n.toLocaleString()}`, d.sev === k, anomalyHref({ ...nav, sev: k }));
	const sevTabs =
		sevTab("", "전체", d.total) + sevTab("critical", "심각", d.critical) +
		sevTab("warn", "주의", d.warn) + sevTab("info", "참고", d.info);

	const apps = traffic ? SITE_TABS : d.apps;
	const rows = d.rows.length
		? d.rows.map((r) => anomalyBoardRow(r, d.period, traffic)).join("")
		: `<tr><td colspan="7">${d.sev ? "이 조건에 맞는 판정이 없어요." : "이 기간에 잡힌 이상 신호가 없어요."}</td></tr>`;

	return shellAdmin(
		"이상탐지 상세",
		pageHead(
			"이상탐지",
			`${traffic ? "서비스 방문" : "AI 호출"} 판정 상세 · ${sinceLabel(d.since)}`,
			d.appFilter,
		) +
			`<div id="hz-body">
${anomalyNavRow(nav)}
${anomalyViewRow(nav, sevTabs)}
${anomalyAppRow(nav, apps, traffic)}
${serverBarOf(d.state, d.heartbeatAge)}

${sectionHead("판정 상세", { count: `${d.rows.length.toLocaleString()}건${d.total > d.rows.length ? ` / ${d.total.toLocaleString()}건` : ""}${d.critical24 ? ` · 최근 24시간 심각 <b class="r">${d.critical24.toLocaleString()}</b>건` : ""}`, href: `/admin/anomaly?period=${d.period}&scope=${d.forScope}`, linkLabel: "요약으로 돌아가기 →" })}
<div class="cap tall"><table class="anb2">
<colgroup><col class="c-when"><col class="c-sev"><col class="c-sig"><col class="c-app"><col><col class="c-vd"><col class="c-ml"></colgroup>
<tr><th>구간</th><th>등급</th><th>신호</th><th>${traffic ? "서비스" : "앱"}</th><th>무슨 일인가</th><th>검증</th><th class="n">메일</th></tr>${rows}</table></div>

<p class="foot">줄을 누르면 이상탐지 에이전트의 판단과 확인할 일, 수치가 펼쳐져요.<br>
검증에서 잘못 잡은 것으로 본 줄은 흐리게 보이고 아래로 밀려요. 급하게 볼 것은 없지만 근거는 남겨 둬요.<br>
메일 발송은 규칙이 정하고, 검증은 나간 알림에 설명과 확인할 일을 붙여요. ‘메일 →’를 누르면 그 메일이 펼쳐진 채로 열려요.<br>
한 번에 ${ANOMALY_PAGE}건까지 보여줘요.</p>
</div>`,
		{ ...opts, tab: "anomaly" },
	);
}

// ═════════════════════════════════════════════════════════════
// 로그 (/admin/logs)
// ═════════════════════════════════════════════════════════════

/** 지금 검색 조건을 주소로 되돌린다. over로 일부만 바꿔 링크를 만든다. */
export function logQuery(f: LogFilter, over: Partial<LogFilter> = {}): string {
	const m = { ...f, ...over };
	const p = new URLSearchParams();
	p.set("period", m.period);
	const put = (k: string, v: string | number) => {
		if (v !== "" && v !== 0 && v != null) p.set(k, String(v));
	};
	put("app", m.app); put("model", m.model); put("kind", m.kind); put("status", m.status);
	put("http", m.http); put("country", m.country); put("ip", m.ip); put("q", m.q);
	put("from", m.from); put("to", m.to); put("slow", m.slow); put("before", m.before);
	put("own", m.own);
	if (m.limit && m.limit !== LOG_PAGE) put("limit", m.limit);
	return `?${p.toString()}`;
}

const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export function renderLogs(l: LogsData, opts: AdminOpts = {}): string {
	const f = l.filter;
	const sel = (v: string, cur: string, label: string) =>
		`<option value="${escapeHtml(v)}"${v === cur ? " selected" : ""}>${escapeHtml(label)}</option>`;

	const quick = [
		{ label: "전체", href: logQuery(f, { status: "", slow: 0, before: 0 }), on: !f.status && !f.slow },
		{ label: "실패만", href: logQuery(f, { status: "error", before: 0 }), on: f.status === "error" },
		{ label: "성공만", href: logQuery(f, { status: "ok", before: 0 }), on: f.status === "ok" },
		{ label: "3초 이상", href: logQuery(f, { slow: 3000, before: 0 }), on: f.slow === 3000 },
		{ label: "10초 이상", href: logQuery(f, { slow: 10_000, before: 0 }), on: f.slow === 10_000 },
		{ label: "오늘", href: logQuery(f, { from: todayKst(), to: todayKst(), before: 0 }), on: f.from === todayKst() },
	]
		.map((b) => `<a class="${b.on ? "on" : ""}" href="/admin/logs${b.href}">${b.label}</a>`)
		.join("");

	// 내부용 앱(검증·메일 에이전트) 범위. 요약 화면은 이미 빼고 세는데 로그만 섞여 나오면
	// 두 화면의 수가 어긋나 보인다. 기본은 빼고, 필요할 때 눌러서 함께 보거나 그것만 본다.
	// 앱을 하나 고른 화면에서는 이 조건이 걸리지 않으므로 칩도 감춘다.
	const ownChips = f.app
		? ""
		: `<span class="sep"></span>` +
			[
				{ v: "", label: "내부용 제외" },
				{ v: "all", label: "모두" },
				{ v: "only", label: "내부용만" },
			]
				.map(
					(b) =>
						`<a class="${f.own === b.v ? "on" : ""}" href="/admin/logs${logQuery(f, { own: b.v, before: 0 })}">${b.label}</a>`,
				)
				.join("");

	const rows = l.rows.length
		? l.rows
				.map((r) => {
					const geo = r.city && r.city !== "-" ? r.city : r.region && r.region !== "-" ? r.region : r.country;
					const brief = r.err ?? r.meta ?? "";
					return (
						`<tr data-det="${r.id}"><td>${kst(r.ts)}</td><td data-tip="${escapeHtml(r.app)}">${escapeHtml(r.app)}</td>` +
						`<td>${escapeHtml(r.kind)}</td>` +
						`<td class="mono" data-tip="${escapeHtml(r.model ?? "-")}">${escapeHtml(shortModel(r.model ?? "-"))}</td>` +
						`<td class="${r.status === "ok" ? "g" : "r"}">${escapeHtml(r.status)}</td>` +
						`<td class="n">${r.http ?? "-"}</td><td class="n">${r.latency_ms.toLocaleString()}ms</td>` +
						`<td class="n">${(r.inTok + r.outTok).toLocaleString()}</td><td class="n">${usd(r.cost)}</td>` +
						`<td class="geo">${escapeHtml(r.country)}${geo && geo !== r.country ? ` <span class="sm">${escapeHtml(geo)}</span>` : ""}</td>` +
						`<td class="err"${brief ? ` data-tip="${escapeHtml(brief)}"` : ""}>${escapeHtml(brief)}</td></tr>` +
						`<tr class="det" id="det-${r.id}" hidden><td colspan="11"><dl class="kv">` +
						`<dt>id</dt><dd>${r.id}</dd>` +
						`<dt>시각</dt><dd>${kst(r.ts)} KST</dd>` +
						`<dt>모델</dt><dd>${escapeHtml(r.model ?? "-")}</dd>` +
						`<dt>토큰</dt><dd>입력 ${r.inTok.toLocaleString()} · 출력 ${r.outTok.toLocaleString()}</dd>` +
						`<dt>IP</dt><dd>${escapeHtml(r.ip ?? "-")}</dd>` +
						`<dt>지역</dt><dd>${escapeHtml([countryName(r.country || "(미상)"), r.region, r.city].filter((x) => x && x !== "-").join(" · "))}</dd>` +
						(r.err ? `<dt>오류</dt><dd>${escapeHtml(r.err)}</dd>` : "") +
						(r.meta ? `<dt>메타</dt><dd>${escapeHtml(r.meta)}</dd>` : "") +
						`</dl></td></tr>`
					);
				})
				.join("")
		: `<tr><td colspan="11">조건에 맞는 호출이 없어요.</td></tr>`;

	const lastId = l.rows.length ? l.rows[l.rows.length - 1].id : 0;

	return shellAdmin(
		"호출 로그",
		pageHead("호출 로그", "조건을 걸어 호출 1건씩 살펴봐요. 줄을 누르면 상세가 펼쳐져요.", f.app) +
			`<div id="hz-body">
<form class="flt" method="get" action="/admin/logs">
  <input type="hidden" name="period" value="${escapeHtml(f.period)}">
  <div class="row">
    <div class="fld"><label>시작 날짜 (KST)</label><input type="date" name="from" value="${escapeHtml(f.from)}"></div>
    <div class="fld"><label>끝 날짜</label><input type="date" name="to" value="${escapeHtml(f.to)}"></div>
    <div class="fld"><label>앱</label><select name="app">${sel("", f.app, "전체")}${l.apps.map((a) => sel(a.id, f.app, a.internal ? `${a.name} (내부용)` : a.name)).join("")}</select></div>
    <div class="fld"><label>용도</label><select name="kind">${sel("", f.kind, "전체")}${l.kinds.map((k) => sel(k, f.kind, k)).join("")}</select></div>
  </div>
  <div class="row" style="margin-top:10px">
    <div class="fld"><label>모델</label><select name="model">${sel("", f.model, "전체")}${l.models.map((m) => sel(m, f.model, m)).join("")}</select></div>
    <div class="fld"><label>상태</label><select name="status">${sel("", f.status, "전체")}${sel("ok", f.status, "성공")}${sel("error", f.status, "실패")}</select></div>
    <div class="fld"><label>HTTP 코드</label><input name="http" value="${escapeHtml(f.http)}" placeholder="429"></div>
    <div class="fld"><label>최소 지연 (ms)</label><input class="n" name="slow" value="${f.slow || ""}" placeholder="3000"></div>
  </div>
  <div class="row r2" style="margin-top:10px">
    <div class="fld"><label>국가 코드</label><input name="country" value="${escapeHtml(f.country)}" placeholder="KR"></div>
    <div class="fld"><label>IP</label><input name="ip" value="${escapeHtml(f.ip)}" placeholder="1.2.3.4"></div>
    <div class="fld"><label>찾을 말 (오류 · 메타 · 모델)</label><input name="q" value="${escapeHtml(f.q)}" placeholder="rate limit"></div>
    <div class="acts"><button class="btn p" type="submit">검색</button><a class="btn" href="/admin/logs?period=${escapeHtml(f.period)}">초기화</a></div>
  </div>
  <div class="quick">${quick}${ownChips}</div>
</form>

<div class="pg" style="margin:0 0 10px">
  <span class="cnt">조건에 맞는 호출 <b>${l.count.toLocaleString()}</b>건 · ${l.rows.length.toLocaleString()}건 보는 중${
		f.app
			? ""
			: f.own === "only"
				? ` <span class="sm">· 내부용 앱만</span>`
				: f.own === "all"
					? ` <span class="sm">· 내부용 앱 포함</span>`
					: ` <span class="sm">· 내부용 앱은 빼고 세요</span>`
	}</span>
  <span class="nav"><a class="btn" href="/admin/logs.csv${logQuery(f, { before: 0 })}">CSV 내려받기</a></span>
</div>

<div class="cap tall"><table class="log calls" id="tb-log"><colgroup><col class="c-ts"><col class="c-app"><col class="c-kind"><col class="c-model"><col class="c-st"><col class="c-http"><col class="c-lat"><col class="c-tok"><col class="c-cost"><col class="c-geo"><col class="c-err"></colgroup><thead><tr><th>시각</th><th>앱</th><th>용도</th><th>모델</th><th>상태</th><th class="n">HTTP</th><th class="n">지연</th><th class="n">토큰</th><th class="n">비용</th><th>지역</th><th>오류 · 메타</th></tr></thead><tbody>${rows}</tbody></table></div>

<div class="pg">
  <span class="cnt">${f.before ? "이어서 보는 중" : "가장 최근부터"}</span>
  <span class="nav">
    <a class="btn${f.before ? "" : " off"}" href="/admin/logs${logQuery(f, { before: 0 })}">처음으로</a>
    <a class="btn${l.hasMore ? "" : " off"}" href="/admin/logs${logQuery(f, { before: lastId })}">다음 ${f.limit}건 →</a>
  </span>
</div>

<p class="foot">이상탐지 에이전트·메일 도구처럼 <b>내부용</b>으로 표시한 앱의 호출은 기본으로 빼고 보여줘요. 요약 화면과 같은 기준이에요. 위 <b>모두</b>·<b>내부용만</b>을 누르면 범위를 바꿀 수 있고, 앱을 하나 고르면 그 앱만 그대로 보여줘요. 어떤 앱을 내부용으로 둘지는 앱 관리에서 정해요.<br>첫 쪽을 보는 동안에는 새 호출이 들어오면 목록이 다시 그려져요. 다음 쪽으로 넘어갔거나, 줄을 펼쳐 뒀거나, 검색칸에 입력하는 중에는 건드리지 않아요.<br>CSV는 조건에 맞는 최근 5000건까지 내려받아요.<br>${FOOT_COST}</p>
</div>`,
		{ ...opts, tab: "logs" },
	);
}
/** 토큰 가운데를 가린다. 어깨너머로 보이는 것도 막고 줄바꿈도 줄어든다. */
const maskToken = (t: string) => (t.length > 16 ? `${t.slice(0, 8)}······${t.slice(-4)}` : t);

/** 모델 맵 — JSON 원문 대신 "용도 → 모델" 칩으로 보여준다. */
function modelChips(models: Record<string, string>): string {
	const keys = Object.keys(models);
	if (!keys.length) return `<span class="sm">비어 있어요. 기본 모델로 호출돼요.</span>`;
	return keys
		.map(
			(k) =>
				`<span class="mc" title="${escapeHtml(models[k])}"><i>${escapeHtml(k)}</i>${escapeHtml(shortModel(models[k]))}</span>`,
		)
		.join("");
}

/** 앱 1개 카드 — 평소엔 요약만 보여주고, 편집은 눌렀을 때만 펼친다. */
/**
 * 앱과 짝지을 서비스 고르기.
 *
 * 앱(AI 호출)과 서비스(방문 기록)는 이름이 서로 달라서(portfoliolive ↔ me) 규칙으로 맞출 수 없다.
 * 그래서 코드에 박아 두지 않고 여기서 골라 저장한다. 지역 탭에서 앱을 고르면 이 짝을 따라간다.
 */
function siteSelect(cur: string | null): string {
	const opt = (v: string, label: string) =>
		`<option value="${escapeHtml(v)}"${v === (cur ?? "") ? " selected" : ""}>${escapeHtml(label)}</option>`;
	return `<select name="site">${opt("", "연결 안 함")}` +
		Object.entries(SITES).map(([k, v]) => opt(k, v.name)).join("") +
		`</select>`;
}

function appCard(a: AppConfig): string {
	const ed = `ed-${a.id}`;
	const post = (action: string) =>
		`<input type="hidden" name="action" value="${action}"><input type="hidden" name="id" value="${escapeHtml(a.id)}">`;

	return `<div class="app${a.active ? "" : " off"}">
  <div class="ah">
    <div class="nm"><b>${escapeHtml(a.name)}</b><span class="st ${a.active ? "on" : "off"}">${a.active ? "사용 중" : "중지됨"}</span>${a.internal ? `<span class="st in" data-tip="내부용 앱 — 앱 탭에서 뒤로 물리고 요약의 최근 호출에서 빼요">내부용</span>` : ""}
      <div class="id mono">${escapeHtml(a.id)}</div></div>
    <div class="acts">
      <button type="button" class="btn" data-toggle="${escapeHtml(ed)}" data-on="편집 닫기" data-off="편집">편집</button>
      <form class="inline" method="post" action="/admin/apps">${post("toggle")}
        <button class="btn" type="submit">${a.active ? "중지" : "재개"}</button></form>
      <form class="inline" method="post" action="/admin/apps"
            data-confirm-title="${escapeHtml(a.name)} 토큰을 새로 발급할까요?"
            data-confirm="지금 토큰은 즉시 막혀요. 앱에 새 토큰을 넣기 전까지 호출이 실패해요."
            data-confirm-ok="재발급" data-danger="1">${post("regen")}
        <button class="btn" type="submit">토큰 재발급</button></form>
      <form class="inline" method="post" action="/admin/apps"
            data-confirm-title="${escapeHtml(a.name)} 앱을 삭제할까요?"
            data-confirm="토큰이 즉시 무효가 되고 이 앱은 더 이상 호출할 수 없어요. 지난 호출 기록은 통계에 그대로 남아요."
            data-confirm-ok="삭제" data-danger="1">${post("delete")}
        <button class="btn d" type="submit">삭제</button></form>
    </div>
  </div>
  <div class="ab">
    <div class="af"><div class="k">토큰</div>
      <div class="v tok"><span class="mono hid">${escapeHtml(maskToken(a.token))}</span><span class="mono full">${escapeHtml(a.token)}</span>
        <button type="button" class="copy" data-reveal="1">보기</button><button type="button" class="copy" data-copy="${escapeHtml(a.token)}">복사</button></div></div>
    <div class="af"><div class="k">호출 상한 (IP 기준)</div>
      <div class="v">분당 <b>${a.perMin.toLocaleString()}</b>회 · 하루 <b>${a.perDay.toLocaleString()}</b>회</div></div>
    <div class="af wide"><div class="k">용도별 모델</div><div class="v">${modelChips(a.models)}</div></div>
    <div class="af"><div class="k">짝이 되는 서비스</div>
      <div class="v">${a.site
		? `<a href="/admin/geo?period=month&app=${encodeURIComponent(a.id)}">${escapeHtml(siteName(a.site))}</a>`
		: `<span class="sm">연결 안 함</span>`}</div></div>
    ${a.note ? `<div class="af wide"><div class="k">메모</div><div class="v">${escapeHtml(a.note)}</div></div>` : ""}
  </div>
  <div class="aedit" id="${escapeHtml(ed)}" hidden>
    <form method="post" action="/admin/apps">${post("save")}
      <div class="grid2">
        <div class="fld"><label>이름</label><input name="name" value="${escapeHtml(a.name)}"></div>
        <div class="fld"><label>메모</label><input name="note" value="${escapeHtml(a.note ?? "")}"></div>
      </div>
      <div class="fld"><label>용도별 모델 (JSON) — 키는 앱이 보내는 X-Ai-Kind 값, default는 기본값</label>
        <textarea name="models" rows="3">${escapeHtml(JSON.stringify(a.models))}</textarea></div>
      <div class="grid2">
        <div class="fld"><label>분당 상한 (IP 기준)</label><input class="n" name="per_min" value="${a.perMin}"></div>
        <div class="fld"><label>일일 상한 (IP 기준)</label><input class="n" name="per_day" value="${a.perDay}"></div>
      </div>
      <div class="fld"><label>짝이 되는 서비스 — 지역 탭에서 이 앱을 고르면 이 서비스의 방문도 함께 보여요</label>
        ${siteSelect(a.site)}</div>
      <label class="chk"><input type="checkbox" name="internal" value="1"${a.internal ? " checked" : ""}> 내부용 앱 — 이상탐지·메일 도구처럼 우리 쪽 서버가 부르는 앱이에요. IP 기준 상한을 걸지 않고(한 곳에서 몰아 부르는 것이 정상이라서), 앱 탭에서 뒤로 물리고 요약의 최근 호출에서는 빼요.</label>
      <div class="eacts"><button class="btn p" type="submit">저장</button>
        <button type="button" class="btn" data-toggle="${escapeHtml(ed)}">취소</button></div>
    </form>
  </div>
</div>`;
}

/** 등록된 패스키 한 줄 — 이름·등록 시각·마지막 사용, 그리고 해제 버튼. */
function passkeyRow(p: PasskeyRow): string {
	return `<div class="pk1">
  <div>
    <div class="nm">${escapeHtml(p.label || "이름 없는 기기")}</div>
    <div class="sm">등록 ${kst(p.created_at)} · ${p.last_used_at ? `마지막 사용 ${kst(p.last_used_at)}` : "아직 쓰지 않음"}</div>
  </div>
  <form method="post" action="/admin/apps" class="sm" onsubmit="return confirm('이 패스키를 지울까요? 그 기기로는 더 이상 로그인할 수 없어요.')">
    <input type="hidden" name="action" value="passkey-delete">
    <input type="hidden" name="cred" value="${escapeHtml(p.cred_id)}">
    <button class="btn" type="submit">해제</button>
  </form>
</div>`;
}

export function renderApps(apps: AppConfig[], passkeys: PasskeyRow[] = [], opts: AdminOpts = {}): string {
	const activeN = apps.filter((a) => a.active).length;
	const list = apps.length
		? `<div class="apps">${apps.map(appCard).join("")}</div>`
		: `<div class="empty">등록된 앱이 없어요. 위 <b>새 앱 추가</b>를 눌러 만드세요.</div>`;
	const known = Object.keys(MODEL_PRICES)
		.map((m) => `<span class="chip">${escapeHtml(m)}</span>`)
		.join(" ");

	return shellAdmin(
		"앱 관리",
		`<h1>앱 관리</h1>
<p class="sub">앱 1개 = 토큰 1개. 앱은 이 토큰으로 <span class="mono">POST /v1/ai</span>를 호출하고, 통계는 앱별로 자동으로 쌓여요.<br>새로 추가하거나 재발급한 토큰은 몇 초 뒤부터 동작해요.</p>

<div class="lh">
  <div class="t">등록된 앱 <b>${apps.length}</b>개<span class="sm"> · 사용 중 ${activeN}개</span></div>
  <button type="button" class="btn p" data-toggle="new-app" data-on="닫기" data-off="새 앱 추가">새 앱 추가</button>
</div>

<div class="panel" id="new-app" hidden>
  <form method="post" action="/admin/apps">
    <input type="hidden" name="action" value="create">
    <div class="grid2">
      <div class="fld"><label>앱 id (영문·숫자·하이픈)</label><input name="id" placeholder="my-app" required></div>
      <div class="fld"><label>이름</label><input name="name" placeholder="내 앱" required></div>
    </div>
    <div class="fld"><label>용도별 모델 (JSON)</label>
      <textarea name="models" rows="2">{"default":"${DEFAULT_MODEL}"}</textarea></div>
    <div class="grid2">
      <div class="fld"><label>분당 상한</label><input class="n" name="per_min" value="20"></div>
      <div class="fld"><label>일일 상한</label><input class="n" name="per_day" value="300"></div>
    </div>
    <div class="grid2">
      <div class="fld"><label>메모</label><input name="note" placeholder="용도·비고"></div>
      <div class="fld"><label>짝이 되는 서비스 (선택)</label>${siteSelect("")}</div>
    </div>
    <label class="chk"><input type="checkbox" name="internal" value="1"> 내부용 앱(우리 쪽 서버가 부르는 앱 — IP 상한을 걸지 않아요)</label>
    <div class="eacts"><button class="btn p" type="submit">추가 (토큰 자동 발급)</button>
      <button type="button" class="btn" data-toggle="new-app" data-on="닫기" data-off="새 앱 추가">취소</button></div>
  </form>
</div>

${list}

<div class="lh" style="margin-top:26px">
  <div class="t">패스키 <b>${passkeys.length}</b>개<span class="sm"> · 이 기기의 지문·얼굴·PIN으로 로그인해요</span></div>
  <button type="button" class="btn p" id="pk-add">이 기기 등록</button>
</div>
<div class="err" id="pk-err" hidden style="margin-bottom:10px"></div>
${passkeys.length
	? `<div class="pks">${passkeys.map(passkeyRow).join("")}</div>`
	: `<div class="empty">등록된 패스키가 없어요. <b>이 기기 등록</b>을 누르면 지금 쓰는 기기로 로그인할 수 있어요.</div>`}
<p class="sm" style="margin:9px 2px 0">패스키는 기기마다 따로 등록해요. 비밀번호 로그인은 그대로 남아 있어서, 기기를 잃어도 들어올 수 있어요.</p>

<div class="dt"><button type="button" class="dth" data-toggle="dt-howto">앱이 호출하는 방법</button>
<div class="in code" id="dt-howto" hidden>POST https://ai.zerolive.co.kr/v1/ai          ← 채팅 · 비전 · 웹검색
POST https://ai.zerolive.co.kr/v1/embeddings  ← 임베딩(엔드포인트가 다름)

Authorization: Bearer &lt;앱 토큰&gt;
X-Ai-Kind: weight            ← 위 모델 맵의 키 (없으면 default)
Content-Type: application/json

{
  "messages": [ ... ],       ← OpenAI 형식. Gemini 형식(contents)도 그대로 받아요.
  "model": "google/gemini-2.5-pro",        ← 선택. 모델 제한 없음(카탈로그 전체)
  "plugins": [{"id":"web"}],               ← 선택. 웹검색(모델명 :online 과 같음)
  "meta": { "ver":"1.2.0", "screen":"scan" }   ← 선택. 통계에 그대로 쌓여요.
}</div></div>

<div class="dt"><button type="button" class="dth" data-toggle="dt-price">단가를 등록해 둔 모델 ${Object.keys(MODEL_PRICES).length}개</button>
<div class="in" id="dt-price" hidden>${known}
<p class="sm" style="margin:9px 0 0">비용은 OpenRouter가 응답에 실어주는 실제 청구액(웹검색 요금 포함)으로 기록해요. 이 단가표는 청구액이 없는 과거 기록을 추정할 때만 써요.</p></div></div>

<p class="foot">모델은 제한하지 않아요 — <a href="https://openrouter.ai/models" target="_blank" rel="noopener">OpenRouter 카탈로그</a>의 이름을 그대로 쓰면 돼요(목록: <span class="mono">GET /admin/api/models</span>).</p>`,
		{ ...opts, tab: "apps" },
	);
}

// ═════════════════════════════════════════════════════════════
// 트래픽 (/admin/traffic)
//   내가 만든 서비스들이 밖에서 얼마나 읽히는지 본다.
//   보는 순서를 그대로 화면 순서로 뒀다 —
//   얼마나 들어왔나 → 사람인가 크롤러인가 → AI·검색 크롤러가 다녀갔나 → 어디를 거쳐 왔나.
// ═════════════════════════════════════════════════════════════

/** 방문 종류 색 — 화면 어디서나 같은 뜻으로 쓴다(차트 범례와 맞춘다). */
const KIND_COLOR: Record<string, string> = {
	human: "var(--accent)", ai: "var(--accent-2)", search: "var(--info)", social: "var(--ok)", other: "var(--int)",
};
const KIND_LABEL: Record<string, string> = {
	human: "사람", ai: "AI 크롤러", search: "검색 크롤러", social: "SNS 미리보기", bot: "기타 봇", other: "기타 봇",
};
/** 유입 경로 묶음 이름. */
const REF_GROUP: Record<string, string> = {
	ai: "AI 답변", search: "검색", social: "SNS", referral: "외부 링크", internal: "내부 이동", direct: "직접 방문",
};

const trafficQuery = (period: string, site: string) =>
	`?period=${period}${site ? `&site=${encodeURIComponent(site)}` : ""}`;

/** 경로가 길면 가운데를 줄인다 — 표가 옆으로 늘어나면 다른 칸이 밀린다. */
function shortPath(p: string, n = 42): string {
	const v = p || "/";
	return v.length <= n ? v : `${v.slice(0, n - 12)}…${v.slice(-10)}`;
}

function trafficDonut(t: { human: number; ai: number; search: number; social: number; bot: number; total: number }): string {
	return smallDonut(
		[
			{ label: "사람", v: t.human, color: KIND_COLOR.human },
			{ label: "AI 크롤러", v: t.ai, color: KIND_COLOR.ai },
			{ label: "검색 크롤러", v: t.search, color: KIND_COLOR.search },
			{ label: "SNS", v: t.social, color: KIND_COLOR.social },
			{ label: "기타 봇", v: t.bot, color: KIND_COLOR.other },
		],
		t.total,
		"방문 종류 비중",
	);
}

/** 크롤러 표 한 벌 — AEO(AI)와 SEO(검색)에서 같은 모양을 쓴다. */
function botTable(rows: { bot: string; n: number; last: number; paths: number }[], empty: string): string {
	const body = rows.length
		? rows
				.map(
					(r) =>
						`<tr><td>${escapeHtml(r.bot)}</td><td class="n">${r.n.toLocaleString()}</td>` +
						`<td class="n">${r.paths.toLocaleString()}</td>` +
						`<td class="mono">${r.last ? kst(r.last).slice(0, 11) : "-"}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="4">${escapeHtml(empty)}</td></tr>`;
	return `<div class="cap"><table><thead><tr><th>크롤러</th><th class="n">방문</th><th class="n">읽은 경로</th><th>마지막 방문</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/**
 * 없는 주소 요청(404) 한 판.
 *
 * "404 급증 54건"만 보이면 서비스가 고장 난 것처럼 읽힌다. 실제로는 대부분 자동 스캐너가
 * 워드프레스·.env 같은 주소를 차례로 두드려 본 것이고, 우리 서비스에는 그런 게 없어서
 * 전부 404로 막힌다. 그래서 종류를 나눠 보여 주고, 사람이 손볼 것이 있는지를 먼저 적는다.
 */
function notFoundPanel(t: TrafficData): string {
	const nf = t.notFound;
	if (!nf.total) {
		return `<div class="empty">이 기간에 없는 주소 요청이 없어요.</div>`;
	}

	const broken = nf.byKind.find((r) => r.kind === "broken")?.n ?? 0;
	const rest = nf.total - broken;
	const verdict = broken
		? `<div class="nfv warn"><b>${broken.toLocaleString()}건은 우리 쪽 깨진 링크예요.</b>` +
			`<span>우리 사이트 안에서 넘어온 요청이라 링크를 고치거나 옮긴 주소로 이어 주면 좋아요. ` +
			`나머지 ${rest.toLocaleString()}건은 자동 스캔이거나 주소 오타예요. 모두 404로 막혔어요.</span></div>`
		: `<div class="nfv ok"><b>손볼 것은 없어요.</b>` +
			`<span>${nf.total.toLocaleString()}건 모두 없는 주소라 404로 막혔어요. ` +
			`대부분 자동 스캐너가 워드프레스·비밀 파일 같은 주소를 차례로 두드려 본 것인데, ` +
			`우리 서비스에는 그런 게 없어서 통하지 않아요.</span></div>`;

	const kindRows = nf.byKind
		.map((r) => {
			const m = THREAT_LABEL[r.kind] ?? { text: r.kind, desc: "" };
			const pct = nf.total ? (r.n / nf.total) * 100 : 0;
			return `<tr><td><span class="th t-${escapeHtml(r.kind)}">${escapeHtml(m.text)}</span></td>` +
				`<td class="n">${r.n.toLocaleString()}<span class="sm"> ${pct.toFixed(0)}%</span></td>` +
				`<td class="n o1">${r.paths.toLocaleString()}</td>` +
				`<td class="n o1">${r.ips.toLocaleString()}</td>` +
				`<td class="w"><span class="sm">${escapeHtml(m.desc)}</span></td></tr>`;
		})
		.join("");

	const topRows = nf.top
		.map((r) => {
			const m = THREAT_LABEL[r.kind ?? "other"] ?? { text: r.kind ?? "-", desc: "" };
			return `<tr><td class="mono w" data-tip="${escapeHtml(r.path)}">${escapeHtml(r.path)}</td>` +
				`<td class="o1">${escapeHtml(siteName(r.site))}</td>` +
				`<td><span class="th t-${escapeHtml(r.kind ?? "other")}">${escapeHtml(m.text)}</span></td>` +
				`<td class="n">${r.n.toLocaleString()}</td>` +
				`<td class="n o2">${r.ips.toLocaleString()}</td>` +
				`<td class="o2"><span class="pill g">막힘</span></td></tr>`;
		})
		.join("");

	return `${verdict}
<div class="two">
  <section>${sectionHead("어떤 요청이었나")}
    <table class="fx"><colgroup><col style="width:132px"><col style="width:88px"><col class="o1" style="width:64px"><col class="o1" style="width:64px"><col></colgroup>
    <tr><th>종류</th><th class="n">건수</th><th class="n o1">주소</th><th class="n o1">보낸 곳</th><th>무슨 요청인가</th></tr>${kindRows}</table>
  </section>
  <section>${sectionHead("많이 두드려 본 주소")}
    <div class="cap"><table class="fx"><colgroup><col><col class="o1" style="width:96px"><col style="width:110px"><col style="width:62px"><col class="o2" style="width:62px"><col class="o2" style="width:64px"></colgroup>
    <tr><th>주소</th><th class="o1">서비스</th><th>종류</th><th class="n">건수</th><th class="n o2">보낸 곳</th><th class="o2">결과</th></tr>${topRows}</table></div>
  </section>
</div>`;
}

export function renderTraffic(t: TrafficData, opts: AdminOpts = {}): string {
	const q = trafficQuery(t.period, t.siteFilter);
	const card = (l: string, v: string, tone = "", extra = "") =>
		`<div class="m"><div class="l">${l}</div><div class="v ${tone}">${v}${extra}</div></div>`;

	const siteShare = svgShare(
		t.bySite.map((r) => ({
			label: r.name,
			value: r.total,
			sub: `사람 ${r.human.toLocaleString()} · AI 크롤러 ${r.ai.toLocaleString()} · 검색 크롤러 ${r.search.toLocaleString()}`,
		})),
		"건",
	);

	const refRows = t.refs.length
		? t.refs
				.map(
					(r) =>
						`<tr><td><span class="rg ${escapeHtml(r.group)}">${escapeHtml(REF_GROUP[r.group] ?? r.group)}</span></td>` +
						`<td>${escapeHtml(r.source)}</td><td class="n">${r.n.toLocaleString()}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="3">아직 사람 방문 기록이 없어요.</td></tr>`;

	const pathRows = t.topPaths.length
		? t.topPaths
				.map(
					(r) =>
						`<tr><td class="mono" data-tip="${escapeHtml(r.path)}">${escapeHtml(shortPath(r.path))}</td>` +
						`<td class="n">${r.total.toLocaleString()}</td><td class="n">${r.human.toLocaleString()}</td>` +
						`<td class="n">${r.bot.toLocaleString()}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="4">기록이 없어요.</td></tr>`;

	const siteRows = t.bySite.length
		? t.bySite
				.map(
					(r) =>
						`<tr><td><a href="/admin/traffic${trafficQuery(t.period, r.key)}">${escapeHtml(r.name)}</a></td>` +
						`<td class="n">${r.total.toLocaleString()}${delta(r.total, r.prev)}</td>` +
						`<td class="n">${r.human.toLocaleString()}</td><td class="n">${r.uniq.toLocaleString()}</td>` +
						`<td class="n">${r.ai.toLocaleString()}</td><td class="n">${r.search.toLocaleString()}</td>` +
						`<td class="n">${siteUrl(r.key)
							? `<a class="go" href="${siteUrl(r.key)}" target="_blank" rel="noopener" data-tip="${escapeHtml(SITES[r.key]?.host ?? "")}">열기 ↗</a>`
							: "-"}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="7">아직 들어온 방문 기록이 없어요.</td></tr>`;

	const botPathRows = t.botPaths.length
		? t.botPaths
				.map(
					(r) =>
						`<tr><td class="mono" data-tip="${escapeHtml(r.path)}">${escapeHtml(shortPath(r.path))}</td>` +
						`<td class="n">${r.n.toLocaleString()}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="2">아직 AI 크롤러가 읽어간 경로가 없어요.</td></tr>`;

	const recentRows = t.recentBots.length
		? t.recentBots
				.map(
					(r) =>
						`<tr><td class="mono">${kst(r.ts).slice(0, 11)}</td><td>${escapeHtml(r.site)}</td>` +
						`<td><span class="kd ${escapeHtml(r.kind)}">${escapeHtml(KIND_LABEL[r.kind] ?? r.kind)}</span></td>` +
						`<td>${escapeHtml(r.bot)}</td>` +
						`<td class="mono" data-tip="${escapeHtml(r.path)}">${escapeHtml(shortPath(r.path, 52))}</td>` +
						`<td class="n">${r.status ?? "-"}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="6">이 기간에 크롤러가 다녀간 기록이 없어요.</td></tr>`;

	const aiRefs = t.refs.filter((r) => r.group === "ai").reduce((a, b) => a + b.n, 0);
	const searchRefs = t.refs.filter((r) => r.group === "search").reduce((a, b) => a + b.n, 0);

	return shellAdmin(
		"트래픽",
		pageHead("트래픽", `서비스 방문 · ${sinceLabel(t.since)}`, t.siteFilter) +
			`<div id="hz-body">
${filterTabs("/admin/traffic", t.period, t.siteFilter, t.sites, PERIODS, "",
	t.siteFilter && siteUrl(t.siteFilter)
		? `<a class="tab alt" href="${siteUrl(t.siteFilter)}" target="_blank" rel="noopener">${escapeHtml(siteName(t.siteFilter))} 열기 ↗</a>`
		: "",
	{ key: "site", allLabel: "전체 서비스" },
)}

<div class="kpi2" style="margin-bottom:4px">
  ${card("방문", t.total.toLocaleString(), "", delta(t.total, t.prevTotal))}
  ${card("사람", t.human.toLocaleString(), "", delta(t.human, t.prevHuman))}
  ${card("고유 방문자", t.uniq.toLocaleString())}
  ${card("AI 크롤러", t.ai.toLocaleString(), "", delta(t.ai, t.prevAI))}
  ${card("검색 크롤러", t.search.toLocaleString())}
  ${card("마지막 기록", t.lastTs ? ago(Date.now() - t.lastTs) : "-")}
</div>

${sectionHead(`${t.bucketLabel} 단위 방문`)}
${svgTraffic(t.buckets)}

<div class="two">
  <section>${sectionHead("방문 종류 비중")}
    <div class="panel">${trafficDonut(t)}</div>
  </section>
  <section>${sectionHead("서비스별 방문")}${siteShare}</section>
</div>

<div class="two">
  <section>${sectionHead("AI 크롤러 (AEO)")}${botTable(t.aiBots, "아직 AI 크롤러가 다녀간 기록이 없어요.")}</section>
  <section>${sectionHead("검색·SNS 크롤러 (SEO)")}${botTable(t.searchBots, "아직 검색 크롤러가 다녀간 기록이 없어요.")}</section>
</div>

<div class="two">
  <section>${sectionHead("사람이 들어온 경로", { note: `AI 답변 ${aiRefs.toLocaleString()}건 · 검색 ${searchRefs.toLocaleString()}건` })}
    <div class="cap"><table><thead><tr><th>구분</th><th>출처</th><th class="n">방문</th></tr></thead><tbody>${refRows}</tbody></table></div>
  </section>
  <section>${sectionHead("AI 크롤러가 읽어간 경로")}
    <div class="cap"><table><thead><tr><th>경로</th><th class="n">방문</th></tr></thead><tbody>${botPathRows}</tbody></table></div>
  </section>
</div>

<div class="two">
  <section>${sectionHead("서비스별 요약")}
    <div class="scroll cap"><table><thead><tr><th>서비스</th><th class="n">방문</th><th class="n">사람</th><th class="n">고유</th><th class="n">AI</th><th class="n">검색</th><th class="n">바로가기</th></tr></thead><tbody>${siteRows}</tbody></table></div>
  </section>
  <section>${sectionHead("많이 열린 경로")}
    <div class="scroll cap"><table><thead><tr><th>경로</th><th class="n">전체</th><th class="n">사람</th><th class="n">크롤러</th></tr></thead><tbody>${pathRows}</tbody></table></div>
  </section>
</div>

${sectionHead(`없는 주소 요청 (404) · ${t.notFound.total.toLocaleString()}건`)}
${notFoundPanel(t)}

${sectionHead("최근 크롤러 방문")}
<div class="scroll cap"><table class="recent"><tr><th>시각</th><th>서비스</th><th>종류</th><th>크롤러</th><th>경로</th><th class="n">응답</th></tr>${recentRows}</table></div>

<p class="foot">없는 주소 요청은 대부분 자동 스캐너예요. 워드프레스·PHP·관리 도구처럼 흔히 뚫리는 것을 차례로 두드려 보고 하나라도 열리면 파고들어요. 우리 서비스는 Cloudflare Workers와 Next.js로만 돌아가고 그런 소프트웨어가 없어서 전부 없는 주소로 끝나요.<br>
막는 설정을 따로 넣지 않아도 돼요 — 없는 주소는 이미 404로 끝나고, 스캐너를 막아도 IP만 바꿔 다시 와요. ‘우리 쪽 깨진 링크’로 잡힌 것만 고쳐 주면 충분해요.<br>
같은 주소에 200이 찍히면 그때는 실제로 열린 것이니 바로 살펴봐야 해요.<br>
<p class="foot">각 서비스가 응답을 보낸 뒤 방문 한 건씩을 이 대시보드로 보내요. 사람인지 크롤러인지는 브라우저가 밝힌 이름(User-Agent)으로 갈라요.<br>
AI 크롤러는 ChatGPT·Claude·Perplexity 같은 서비스가 문서를 읽어가는 기록이에요. 여기 방문이 늘면 AI 답변에 실릴 바탕이 쌓이고 있다는 뜻이에요.<br>
'사람이 들어온 경로'의 <b>AI 답변</b>은 AI 서비스 화면에서 링크를 눌러 실제로 넘어온 방문이에요. 크롤러 방문이 성과로 이어졌는지는 이 숫자로 봐요.<br>
고유 방문자는 IP를 그대로 두지 않고 가린 값으로 세요. 정적 파일(이미지·스타일 등) 요청은 세지 않아요.</p>
</div>`,
		{ ...opts, tab: "traffic" },
	);
}

/**
 * 요약 화면에 얹는 트래픽 칸.
 * 왼쪽은 사람·크롤러 비중, 오른쪽은 서비스별 방문. 자세히는 트래픽 탭 몫이다.
 */
function trafficBand(t: TrafficBrief, href: string): string {
	if (!t.total) {
		return `<div class="anb quiet"><span class="st down"><span class="dot"></span>방문 기록 없음</span>` +
			`<span class="t">이 기간에 들어온 서비스 방문 기록이 없어요.</span>` +
			`<span class="sm">서비스가 기록을 보내기 시작하면 여기에 쌓여요.</span></div>`;
	}

	const donut = smallDonut(
		[
			{ label: "사람", v: t.human, color: KIND_COLOR.human },
			{ label: "AI 크롤러", v: t.ai, color: KIND_COLOR.ai },
			{ label: "검색 크롤러", v: t.search, color: KIND_COLOR.search },
			{ label: "기타 봇", v: t.other, color: KIND_COLOR.other },
		],
		t.total,
		"방문 종류 비중",
	);

	const rows = t.sites
		.map(
			(r) =>
				`<tr><td>${escapeHtml(r.name)}</td>` +
				`<td class="n">${r.total.toLocaleString()}${delta(r.total, r.prev)}</td>` +
				`<td class="n">${r.ai.toLocaleString()}</td></tr>`,
		)
		.join("");

	return `<div class="anb">
  <div class="anb-l">
    ${donut}
    <div class="sub">고유 방문자 ${t.uniq.toLocaleString()}명 · 전체 ${t.total.toLocaleString()}건${delta(t.total, t.prevTotal)}<br>마지막 기록 ${t.lastTs ? ago(Date.now() - t.lastTs) : "-"}</div>
  </div>
  <div class="anb-r"><div class="scroll"><table class="mini"><tr><th>서비스</th><th class="n">방문</th><th class="n">AI 크롤러</th></tr>${rows}</table></div>
    <div class="sub"><a href="${href}">서비스별 자세히 보기 →</a>${
			t.anomalies
				? ` · <a href="/admin/anomaly?scope=traffic">이상 신호 ${t.anomalies.toLocaleString()}건${t.anomalyCritical ? ` (심각 ${t.anomalyCritical})` : ""} 보기 →</a>`
				: ""
		}</div>
  </div>
</div>`;
}
