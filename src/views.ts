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
	PERIODS, MODEL_PRICES, DEFAULT_MODEL, countryName, LOG_PAGE, SUMMARY_RECENT,
	type AppConfig, type GroupRow,
	type SummaryData, type UsageData, type TrendData, type GeoData, type LogsData, type LogFilter,
	type AnomalyData, type AnomalyRow,
} from "./stats";
import {
	escapeHtml, usd, kst, shortNum, shellAdmin, pageHead, filterTabs, sectionHead, delta,
	svgTrend, svgMap, svgShare, svgDonut, svgHeat, svgLevels, type AdminOpts,
} from "./ui";

/** 상단바 메뉴가 기간·앱 조건을 그대로 물고 가도록 붙이는 질의 문자열. */
function navQuery(period: string, appFilter: string): string {
	return `?period=${period}${appFilter ? `&app=${encodeURIComponent(appFilter)}` : ""}`;
}
const shortModel = (m: string) => m.replace(/^[^/]+\//, "");
const sinceLabel = (since: number) => (since ? `${kst(since).slice(0, 5)} 이후` : "전체 기간");
const avgLat = (r: GroupRow) => (r.total ? Math.round(r.latency / r.total) : 0);

/** 표 위에 붙는 검색칸 — 줄이 많은 표에서 쓴다. */
function tableFilter(tableId: string, placeholder: string): string {
	return `<input data-filter="${tableId}" placeholder="${escapeHtml(placeholder)}" style="max-width:240px">`;
}

const FOOT_GEO =
	"국가·지역은 Cloudflare가 요청에 붙여주는 값이라 외부 조회 없이 기록돼요. VPN·통신사 경로에 따라 실제와 다를 수 있어요.";
const FOOT_COST =
	"비용은 OpenRouter가 응답에 실어주는 실제 청구액이에요(* = 단가 미등록 모델은 기본 단가로 추정한 과거 기록). 최종 청구액은 OpenRouter 대시보드가 기준이에요.";

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
						`<tr><td class="mono">${kst(r.ts)}</td><td>${escapeHtml(r.app)}</td><td>${escapeHtml(r.kind)}</td>` +
						`<td class="mono">${escapeHtml(shortModel(r.model ?? "-"))}</td>` +
						`<td><span class="pill ${r.status === "ok" ? "g" : "r"}">${escapeHtml(r.status)}</span></td>` +
						`<td class="n">${r.http ?? "-"}</td><td class="n">${r.latency_ms.toLocaleString()}ms</td>` +
						`<td class="n">${(r.inTok + r.outTok).toLocaleString()}</td><td class="n">${usd(r.cost)}</td>` +
						`<td>${escapeHtml(geo || "-")}</td>` +
						`<td class="err">${escapeHtml(r.err ?? r.meta ?? "")}</td></tr>`
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

${sectionHead(`최근 호출 (${SUMMARY_RECENT}건)`, `/admin/logs${q}`, "로그에서 더 보기 →")}
<div class="scroll"><table class="recent"><tr><th>시각</th><th>앱</th><th>용도</th><th>모델</th><th>상태</th><th class="n">HTTP</th><th class="n">지연</th><th class="n">토큰</th><th class="n">비용</th><th>지역</th><th>오류 · 메타</th></tr>${recentRows}</table></div>

${sectionHead(`추이 (${s.bucketLabel} 단위)`, `/admin/trend${q}`)}
${svgTrend(s.buckets)}

<div class="two">
  <section>${sectionHead("앱별 비중", `/admin/usage${q}`)}${appDonut}</section>
  <section>${sectionHead("모델별 비중", `/admin/usage${q}#model`)}${modelDonut}</section>
</div>

<div class="two">
  <section>${sectionHead("실패 상위", `/admin/logs${q}&status=error`, "로그에서 보기 →")}
    <table><tr><th class="n">HTTP</th><th class="n">건수</th><th>대표 메시지</th></tr>${errRows}</table>
  </section>
  <section>${sectionHead(`호출 지역 (${s.countryCount}개국)`, `/admin/geo${q}`)}${geoShare}</section>
</div>

<p class="foot">최근 호출은 자동 갱신이 켜져 있으면 새 호출이 들어올 때마다 다시 그려져요.<br>숫자 옆 ▲▼는 직전 같은 기간과 비교한 값이에요.<br>${FOOT_COST}<br>${FOOT_GEO}</p>
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
						`<td class="n g">${r.ok.toLocaleString()}</td><td class="n r">${r.error.toLocaleString()}</td>` +
						`<td class="n">${(r.inTok + r.outTok).toLocaleString()}</td><td class="n">${usd(r.cost)}</td>` +
						`<td class="n">${avgLat(r)}ms</td>` +
						`<td class="n">${r.total ? usd(r.cost / r.total) : "-"}</td>` +
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
						`<td class="n">${r.inTok.toLocaleString()}</td><td class="n">${r.outTok.toLocaleString()}</td>` +
						`<td class="n">${usd(r.cost)}</td><td class="n">${avgLat(r)}ms</td>` +
						`<td><a href="/admin/logs${q}&model=${encodeURIComponent(r.key)}">로그 →</a></td></tr>`,
				)
				.join("")
		: `<tr><td colspan="8">데이터 없음</td></tr>`;

	const kindRows = u.byKind.length
		? u.byKind
				.map(
					(r) =>
						`<tr><td>${escapeHtml(r.key)}</td><td class="n">${r.total.toLocaleString()}</td>` +
						`<td class="n g">${r.ok.toLocaleString()}</td><td class="n r">${r.error.toLocaleString()}</td>` +
						`<td class="n">${(r.inTok + r.outTok).toLocaleString()}</td><td class="n">${usd(r.cost)}</td>` +
						`<td class="n">${avgLat(r)}ms</td>` +
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

<div class="sh2"><h2>앱별</h2></div>
<div class="scroll"><table id="tb-app"><thead><tr><th>앱</th><th class="n">호출</th><th class="n">성공</th><th class="n">실패</th><th class="n">토큰</th><th class="n">비용</th><th class="n">평균 지연</th><th class="n">호출당 비용</th><th></th></tr></thead><tbody>${appRows}</tbody></table></div>

<div class="sh2" id="model"><h2>모델별 <span class="sm" id="tb-model-cnt">${u.byModel.length}개</span></h2>${tableFilter("tb-model", "모델 이름으로 걸러보기")}</div>
<div class="scroll"><table id="tb-model"><thead><tr><th>모델</th><th class="n">호출</th><th class="n">실패</th><th class="n">입력 토큰</th><th class="n">출력 토큰</th><th class="n">비용</th><th class="n">평균 지연</th><th></th></tr></thead><tbody>${modelRows}</tbody></table></div>

<div class="sh2"><h2>용도별</h2></div>
<div class="scroll"><table id="tb-kind"><thead><tr><th>용도</th><th class="n">호출</th><th class="n">성공</th><th class="n">실패</th><th class="n">토큰</th><th class="n">비용</th><th class="n">평균 지연</th><th></th></tr></thead><tbody>${kindRows}</tbody></table></div>

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
				.map(
					(b) =>
						`<tr><td>${escapeHtml(b.b)}</td><td class="bar"><span style="width:${Math.round((b.total / maxB) * 100)}%"></span></td>` +
						`<td class="n">${b.total.toLocaleString()}</td><td class="n g">${b.ok.toLocaleString()}</td>` +
						`<td class="n r">${b.error.toLocaleString()}</td><td class="n">${b.tokens.toLocaleString()}</td>` +
						`<td class="n">${usd(b.cost)}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="7">데이터 없음</td></tr>`;

	const peak = t.heat.reduce((a, b) => (b.n > (a?.n ?? 0) ? b : a), t.heat[0]);
	const WD = ["일", "월", "화", "수", "목", "금", "토"];

	return shellAdmin(
		"추이",
		pageHead("추이", `기간별 호출·비용 흐름 · ${sinceLabel(t.since)}`, t.appFilter) +
			`<div id="hz-body">
${filterTabs("/admin/trend", t.period, t.appFilter, t.apps, PERIODS)}
<div class="sh2"><h2>${t.bucketLabel} 단위 호출·비용</h2></div>
${svgTrend(t.buckets)}

<div class="sh2"><h2>언제 몰리나 (요일 × 시각, KST)</h2>${peak ? `<span class="sm">가장 많은 때: ${WD[peak.w]}요일 ${peak.h}시 · ${peak.n.toLocaleString()}건</span>` : ""}</div>
${svgHeat(t.heat)}

<div class="sh2"><h2>구간별 상세</h2><span class="sm">전체 ${t.total.toLocaleString()}건 · ${usd(t.cost)}</span></div>
<div class="scroll"><table id="tb-bucket"><thead><tr><th>구간</th><th>비중</th><th class="n">호출</th><th class="n">성공</th><th class="n">실패</th><th class="n">토큰</th><th class="n">비용</th></tr></thead><tbody>${rows}</tbody></table></div>

<p class="foot">구간은 한국 시간(KST) 기준으로 끊어요.<br>${FOOT_COST}</p>
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
						`<td class="n g">${r.ok.toLocaleString()}</td><td class="n r">${r.error.toLocaleString()}</td>` +
						`<td class="n">${r.ips.toLocaleString()}</td>` +
						`<td class="n">${(r.inTok + r.outTok).toLocaleString()}</td><td class="n">${usd(r.cost)}</td>` +
						`<td class="n">${avgLat(r)}ms</td>` +
						`<td class="bar"><span style="width:${Math.round((r.total / maxCountry) * 100)}%"></span></td>` +
						`<td>${r.key === "(미상)" ? "" : `<a href="/admin/logs${q}&country=${encodeURIComponent(r.key)}">로그 →</a>`}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="10">데이터 없음</td></tr>`;

	const regionRows = g.byRegion.length
		? g.byRegion
				.map(
					(r) =>
						`<tr><td>${escapeHtml(countryName(r.country))}</td><td>${escapeHtml(r.region)}</td>` +
						`<td>${escapeHtml(r.city)}</td><td class="n">${r.total.toLocaleString()}</td>` +
						`<td class="n g">${r.ok.toLocaleString()}</td><td class="n r">${r.error.toLocaleString()}</td>` +
						`<td class="n">${r.ips.toLocaleString()}</td>` +
						`<td class="n">${r.tokens.toLocaleString()}</td><td class="n">${usd(r.cost)}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="9">데이터 없음</td></tr>`;

	return shellAdmin(
		"지역",
		pageHead("호출 지역", `국가 · 도시별 호출 분포 · ${sinceLabel(g.since)}`, g.appFilter) +
			`<div id="hz-body">
${filterTabs("/admin/geo", g.period, g.appFilter, g.apps, PERIODS)}
${svgMap(g.points, g.geoUnknown)}

<div class="sh2"><h2>국가별</h2><span class="sm">${g.byCountry.filter((c) => c.key !== "(미상)").length}개국</span></div>
<div class="scroll"><table id="tb-country"><thead><tr><th>국가</th><th class="n">호출</th><th class="n">성공</th><th class="n">실패</th><th class="n">고유 IP</th><th class="n">토큰</th><th class="n">비용</th><th class="n">평균 지연</th><th>비중</th><th></th></tr></thead><tbody>${countryRows}</tbody></table></div>

<div class="sh2"><h2>지역 · 도시별 (상위 ${g.byRegion.length})</h2>${tableFilter("tb-region", "도시·지역 이름으로 걸러보기")}</div>
<div class="scroll"><table id="tb-region"><thead><tr><th>국가</th><th>지역</th><th>도시</th><th class="n">호출</th><th class="n">성공</th><th class="n">실패</th><th class="n">고유 IP</th><th class="n">토큰</th><th class="n">비용</th></tr></thead><tbody>${regionRows}</tbody></table></div>

<p class="foot">${FOOT_GEO}</p>
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

function anomDetail(r: AnomalyRow): { metric: string; label: string; ratio: number | null; kind: string } {
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

/** 검증 에이전트 판정 — 여섯 가지 라벨을 화면에서 읽히는 말로 옮긴다. */
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
};

const pct1 = (v: number | null | undefined) => (v === null || v === undefined ? "-" : `${(v * 100).toFixed(1)}%`);

/** 구간 시각 — 표에서는 초까지 필요 없다. */
const bucketAt = (ts: number) => kst(ts).slice(0, 11);

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

/** 이상탐지 서버 상태줄 — heartbeat가 끊긴 것 자체가 알림이다. */
function serverBar(a: AnomalyData): string {
	const age = a.heartbeatAge;
	const cls = age === null ? "down" : age > 15 * 60_000 ? "down" : age > 5 * 60_000 ? "stale" : "";
	const msg =
		age === null
			? "이상탐지 서버에서 아직 신호가 오지 않았어요."
			: cls === "down"
				? "이상탐지 서버 신호가 끊겼어요. 서버 점검이 필요해요."
				: cls === "stale"
					? "이상탐지 서버 신호가 늦어지고 있어요."
					: "이상탐지 서버가 정상 동작 중이에요.";

	const jobs = a.state
		.filter((s) => s.key.startsWith("job:"))
		.map((s) => {
			let v: { ok?: boolean; error?: string; result?: unknown } = {};
			try {
				v = JSON.parse(s.value);
			} catch {
				/* 형식이 달라지면 이름만 보여준다 */
			}
			const name = s.key.slice(4);
			const title = v.ok === false ? `실패: ${v.error ?? ""}` : `${ago(Date.now() - s.updated_at)} 실행`;
			return `<span class="job${v.ok === false ? " bad" : ""}" data-tip="${escapeHtml(`${name}\n${title}`)}">${escapeHtml(name)}</span>`;
		})
		.join("");

	return `<div class="srv ${cls}"><span class="dot"></span>
  <span class="t">${msg}</span>
  <span class="sm">마지막 신호 ${ago(age)}</span>
  <span class="jobs">${jobs}</span>
</div>`;
}

export function renderAnomaly(a: AnomalyData, opts: AdminOpts = {}): string {
	const q = navQuery(a.period, a.appFilter);

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
						`<td>${r.app === "*" ? "전체" : escapeHtml(r.app)}</td>` +
						`<td class="n">${anomValue(r.observed, d.metric)}</td>` +
						`<td class="n">${anomValue(r.baseline, d.metric)}` +
						`${d.ratio ? ` <span class="sm">${d.ratio}배</span>` : ""}</td>` +
						`<td class="n">${r.score === null ? "-" : r.score.toFixed(1)}</td>` +
						`<td>${r.detector === "model"
							? `<span data-tip="${escapeHtml(r.model_version ?? "")}">모델</span>`
							: "규칙"}</td>` +
						`<td>${verdictTag(r.verdict, r.verdict_reason)}</td>` +
						`<td>${r.notified_at ? bucketAt(r.notified_at) : r.suppressed_reason ? `<span class="sm" data-tip="${escapeHtml(r.suppressed_reason)}">보내지 않음</span>` : "-"}</td></tr>`
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

	// ── 검증 에이전트 라벨 · 탐지기 성적 · 승격 심사 (이상탐지 서버가 함께 밀어 넣는다)
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
	const lab = anomState<LabelState>(a, "labels");
	const ev = anomState<Record<string, EvalOne>>(a, "eval");
	const proms = anomState<{ ran_at: string; version: string; baseline: string | null; decision: string; reason: string }[]>(a, "promotion") ?? [];
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

	const appRows = a.byApp.length
		? a.byApp
				.map(
					(r) =>
						`<tr><td>${escapeHtml(r.name)}</td><td class="n">${r.total.toLocaleString()}</td>` +
						`<td class="n r">${r.critical.toLocaleString()}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="3">기록이 없어요.</td></tr>`;

	return shellAdmin(
		"이상탐지",
		pageHead("이상탐지", `평소와 다른 호출 흐름 · ${sinceLabel(a.since)}`, a.appFilter) +
			`<div id="hz-body">
${filterTabs("/admin/anomaly", a.period, a.appFilter, a.apps, PERIODS)}
${serverBar(a)}

<div class="kpi2" style="margin-bottom:4px">
  ${card("이상 신호", a.total.toLocaleString(), "", delta(a.total, a.prevTotal, true))}
  ${card("심각", a.critical.toLocaleString(), a.critical ? "r" : "")}
  ${card("주의", a.warn.toLocaleString())}
  ${card("참고", a.info.toLocaleString())}
  ${card("메일 발송", a.notified.toLocaleString(), "", alertState?.suppressed ? `<span class="sm"> · 억제 ${alertState.suppressed}</span>` : "")}
  ${card("마지막 탐지", a.lastDetected ? ago(Date.now() - a.lastDetected) : "-")}
</div>

<div class="kpi2" style="margin-bottom:4px">
  ${card("검증된 판정", (lab?.total ?? 0).toLocaleString())}
  ${card("규칙 정탐률", pct1(lab?.rule?.rate), (lab?.rule?.rate ?? 1) < 0.5 ? "r" : "")}
  ${card("모델 정탐률", pct1(lab?.model?.rate), (lab?.model?.rate ?? 1) < 0.5 ? "r" : "")}
  ${card("검증셋 규칙 F1", pct1(ev?.rule?.f1))}
  ${card("검증셋 모델 F1", pct1(ev?.model?.f1))}
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

<div class="two">
  <section>${sectionHead("검증 결과")}
    <table><tr><th>판정</th><th class="n">건수</th><th class="n">비중</th></tr>${verdictRows}</table>
  </section>
  <section>${sectionHead("앱별 이상 건수")}
    <table><tr><th>앱</th><th class="n">전체</th><th class="n">심각</th></tr>${appRows}</table>
  </section>
</div>

<div class="two">
  <section>${sectionHead("탐지기 성적 비교")}
    <div class="scroll cap"><table class="tight"><tr><th>구분</th><th class="n">규칙 정밀도</th><th class="n">규칙 재현율</th><th class="n">모델 정밀도</th><th class="n">모델 재현율</th></tr>${compareRows}</table></div>
  </section>
  <section><div class="sh2"><h2>탐지 모델</h2>${a.models.length > MODEL_SHOWN ? `<span class="sm">최근 ${MODEL_SHOWN}개만 · 전체 ${a.models.length}개</span>` : ""}</div>
    <div class="scroll cap"><table class="tight"><tr><th>버전</th><th>상태</th><th>학습 시각</th><th class="n">학습 행</th><th>평가</th></tr>${modelRows}</table></div>
  </section>
</div>

${sectionHead("승격 심사")}
<div class="scroll cap"><table><tr><th>시각</th><th>후보</th><th>결과</th><th>근거</th></tr>${promRows}</table></div>

<p class="foot">판정은 이상탐지 서버(121.161.160.122)가 하고, 이 화면은 넘겨받은 결과만 보여줘요. 서버가 멈춰도 화면은 열리고 맨 위 상태줄에 표시돼요.<br>
'평소'는 같은 요일·같은 시각의 과거 기록에서 뽑은 기준선이에요. 표본이 모자라면 최근 구간 전체로 대신하고, 그때는 등급을 한 단계 낮춰요.<br>
심각·주의 신호는 ${escapeHtml("zerolive7@gmail.com")}으로 메일이 나가요. 같은 신호가 이어지면 일정 시간 동안 묶어서 한 번만 보내요.<br>
'검증'은 판정 근거를 다시 읽고 정탐인지 오탐인지 가리는 단계예요. 오탐으로 판정되면 메일을 보내지 않아요. 심각 신호는 검증을 기다리지 않고 바로 보내요.<br>
모델은 검증셋 성적과 실데이터 정탐률이 기준을 넘고 지금 쓰는 모델보다 나빠지지 않을 때만 승격돼요. 그전까지는 판정을 기록만 하고 메일에는 쓰지 않아요.</p>
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

	const rows = l.rows.length
		? l.rows
				.map((r) => {
					const geo = r.city && r.city !== "-" ? r.city : r.region && r.region !== "-" ? r.region : r.country;
					const brief = r.err ?? r.meta ?? "";
					return (
						`<tr data-det="${r.id}"><td>${kst(r.ts)}</td><td>${escapeHtml(r.app)}</td><td>${escapeHtml(r.kind)}</td>` +
						`<td class="mono">${escapeHtml(shortModel(r.model ?? "-"))}</td>` +
						`<td class="${r.status === "ok" ? "g" : "r"}">${escapeHtml(r.status)}</td>` +
						`<td class="n">${r.http ?? "-"}</td><td class="n">${r.latency_ms.toLocaleString()}ms</td>` +
						`<td class="n">${(r.inTok + r.outTok).toLocaleString()}</td><td class="n">${usd(r.cost)}</td>` +
						`<td>${escapeHtml(r.country)}${geo && geo !== r.country ? `<br><span class="sm">${escapeHtml(geo)}</span>` : ""}</td>` +
						`<td class="err">${escapeHtml(brief)}</td></tr>` +
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
    <div class="fld"><label>앱</label><select name="app">${sel("", f.app, "전체")}${l.apps.map((a) => sel(a.id, f.app, a.name)).join("")}</select></div>
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
  <div class="quick">${quick}</div>
</form>

<div class="pg" style="margin:0 0 10px">
  <span class="cnt">조건에 맞는 호출 <b>${l.count.toLocaleString()}</b>건 · ${l.rows.length.toLocaleString()}건 보는 중</span>
  <span class="nav"><a class="btn" href="/admin/logs.csv${logQuery(f, { before: 0 })}">CSV 내려받기</a></span>
</div>

<div class="scroll"><table class="log" id="tb-log"><thead><tr><th>시각</th><th>앱</th><th>용도</th><th>모델</th><th>상태</th><th class="n">HTTP</th><th class="n">지연</th><th class="n">토큰</th><th class="n">비용</th><th>지역</th><th>오류 · 메타</th></tr></thead><tbody>${rows}</tbody></table></div>

<div class="pg">
  <span class="cnt">${f.before ? "이어서 보는 중" : "가장 최근부터"}</span>
  <span class="nav">
    <a class="btn${f.before ? "" : " off"}" href="/admin/logs${logQuery(f, { before: 0 })}">처음으로</a>
    <a class="btn${l.hasMore ? "" : " off"}" href="/admin/logs${logQuery(f, { before: lastId })}">다음 ${f.limit}건 →</a>
  </span>
</div>

<p class="foot">첫 쪽을 보는 동안에는 새 호출이 들어오면 목록이 다시 그려져요. 다음 쪽으로 넘어갔거나, 줄을 펼쳐 뒀거나, 검색칸에 입력하는 중에는 건드리지 않아요.<br>CSV는 조건에 맞는 최근 5000건까지 내려받아요.<br>${FOOT_COST}</p>
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
function appCard(a: AppConfig): string {
	const ed = `ed-${a.id}`;
	const post = (action: string) =>
		`<input type="hidden" name="action" value="${action}"><input type="hidden" name="id" value="${escapeHtml(a.id)}">`;

	return `<div class="app${a.active ? "" : " off"}">
  <div class="ah">
    <div class="nm"><b>${escapeHtml(a.name)}</b><span class="st ${a.active ? "on" : "off"}">${a.active ? "사용 중" : "중지됨"}</span>
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
      <div class="eacts"><button class="btn p" type="submit">저장</button>
        <button type="button" class="btn" data-toggle="${escapeHtml(ed)}">취소</button></div>
    </form>
  </div>
</div>`;
}

export function renderApps(apps: AppConfig[], opts: AdminOpts = {}): string {
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
    <div class="fld"><label>메모</label><input name="note" placeholder="용도·비고"></div>
    <div class="eacts"><button class="btn p" type="submit">추가 (토큰 자동 발급)</button>
      <button type="button" class="btn" data-toggle="new-app" data-on="닫기" data-off="새 앱 추가">취소</button></div>
  </form>
</div>

${list}

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
