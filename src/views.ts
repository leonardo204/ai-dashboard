/**
 * 관리 화면 본문 — 화면 6개.
 *
 *   요약   /admin        한눈에 보는 지표·차트. 긴 표를 두지 않는다.
 *   사용량 /admin/usage  앱·모델·용도별 표
 *   추이   /admin/trend  기간별 흐름 + 요일×시각 히트맵
 *   지역   /admin/geo    지도 + 국가·도시별 표
 *   로그   /admin/logs   호출 1건씩 검색
 *   앱관리 /admin/apps   토큰·모델 맵·상한
 *
 * 데이터 조회는 stats.ts, 공통 틀·차트는 ui.ts에 있다.
 */

import {
	PERIODS, MODEL_PRICES, DEFAULT_MODEL, countryName, LOG_PAGE,
	type AppConfig, type GroupRow,
	type SummaryData, type UsageData, type TrendData, type GeoData, type LogsData, type LogFilter,
} from "./stats";
import {
	escapeHtml, usd, kst, shortNum, shellAdmin, pageHead, filterTabs, sectionHead, delta,
	svgTrend, svgMap, svgShare, svgDonut, svgHeat, type AdminOpts,
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
			href: `/admin/usage?period=${s.period}&app=${encodeURIComponent(r.key)}`,
		})),
		"건",
	);
	const modelDonut = svgDonut(
		s.byModel.map((r) => ({
			label: shortModel(r.key),
			value: r.total,
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

<p class="foot">숫자 옆 ▲▼는 직전 같은 기간과 비교한 값이에요.<br>${FOOT_COST}<br>${FOOT_GEO}</p>
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
		pageHead("호출 로그", "조건을 걸어 호출 1건씩 살펴봐요. 줄을 누르면 상세가 펼쳐져요.", f.app, false) +
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

<p class="foot">이 화면은 자동으로 다시 그리지 않아요. 보던 목록이 바뀌면 읽기 어려워서예요.<br>CSV는 조건에 맞는 최근 5000건까지 내려받아요.<br>${FOOT_COST}</p>
</div>`,
		{ ...opts, tab: "logs" },
	);
}
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
