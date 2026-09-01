/**
 * 연결 가이드 화면 (/admin/guide) · 원문 내려받기 (/admin/guide.md)
 *
 * 다른 프로젝트에 건네주는 문서라 관리자용 내용(앱 등록·토큰 발급·통계 조회·앱 관리 API·
 * 서버 구성)은 담지 않는다. 원본은 docs/PROXY-CLIENT-GUIDE.md 하나뿐이고,
 * scripts/gen-guide.mjs가 그걸 src/guide-md.ts로 옮겨 적는다.
 * 화면은 그 원문을 그대로 그리므로 보이는 것과 내려받는 것이 항상 같다.
 */

import { escapeHtml, shellAdmin, type AdminOpts } from "./ui";
import { GUIDE_MD, GUIDE_FILENAME } from "./guide-md";

export { GUIDE_MD, GUIDE_FILENAME };

// ─────────────────────────────────────────────────────────────
// 마크다운 → HTML
// 우리가 쓴 문법(제목·표·코드·인용·목록·링크)만 다룬다. 외부 라이브러리는 쓰지 않는다.
// ─────────────────────────────────────────────────────────────

/** 코드 조각을 잠시 빼둘 때 쓰는 표시. 문서 본문에 나올 수 없는 문자라야 한다. */
const SLOT = String.fromCharCode(1);

/** 한 줄 안의 표시 문법 — 코드 조각을 먼저 빼두고 나머지를 변환한다. */
function inline(s: string): string {
	const codes: string[] = [];
	let t = s.replace(/`([^`]+)`/g, (_m, c: string) => {
		codes.push(c);
		return SLOT + (codes.length - 1) + SLOT;
	});
	t = escapeHtml(t);
	t = t.replace(
		/\[([^\]]+)\]\(([^)\s]+)\)/g,
		(_m, label: string, href: string) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`,
	);
	t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
	t = t.replace(
		new RegExp(SLOT + "(\\d+)" + SLOT, "g"),
		(_m, n: string) => `<code>${escapeHtml(codes[Number(n)])}</code>`,
	);
	return t;
}

function tableHtml(rows: string[]): string {
	const cells = (line: string) =>
		line
			.replace(/^\s*\|/, "")
			.replace(/\|\s*$/, "")
			.split("|")
			.map((c) => c.trim());
	const head = cells(rows[0]);
	const body = rows.slice(2).map(cells);   // 두 번째 줄은 --- 구분선이라 건너뛴다
	const th = head.map((c) => `<th>${inline(c)}</th>`).join("");
	const tr = body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
	return `<div class="scroll"><table><tr>${th}</tr>${tr}</table></div>`;
}

export function mdToHtml(md: string): string {
	const lines = md.replace(/\r\n/g, "\n").split("\n");
	const out: string[] = [];
	let i = 0;

	const isBlockStart = (l: string) =>
		/^```/.test(l) || /^#{1,6}\s/.test(l) || /^\s*\|/.test(l) || /^>\s?/.test(l) ||
		/^[-*]\s/.test(l) || /^\d+\.\s/.test(l) || /^-{3,}\s*$/.test(l) || l.trim() === "";

	while (i < lines.length) {
		const line = lines[i];

		if (line.trim() === "") { i++; continue; }

		// 코드 블록
		if (/^```/.test(line)) {
			const lang = line.slice(3).trim();
			const buf: string[] = [];
			i++;
			while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
			i++;   // 닫는 줄
			out.push(
				`<pre class="cb"${lang ? ` data-lang="${escapeHtml(lang)}"` : ""}><code>${escapeHtml(buf.join("\n"))}</code></pre>`,
			);
			continue;
		}

		// 제목
		const h = line.match(/^(#{1,6})\s+(.*)$/);
		if (h) {
			const lv = Math.min(6, h[1].length);
			out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
			i++;
			continue;
		}

		// 구분선
		if (/^-{3,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

		// 표
		if (/^\s*\|/.test(line)) {
			const buf: string[] = [];
			while (i < lines.length && /^\s*\|/.test(lines[i])) buf.push(lines[i++]);
			out.push(buf.length >= 2 ? tableHtml(buf) : `<p>${inline(buf.join(" "))}</p>`);
			continue;
		}

		// 인용
		if (/^>\s?/.test(line)) {
			const buf: string[] = [];
			while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
			const paras = buf
				.join("\n")
				.split(/\n\s*\n/)
				.filter((p) => p.trim())
				.map((p) => `<p>${inline(p.trim()).replace(/\n/g, "<br>")}</p>`)
				.join("");
			out.push(`<blockquote>${paras}</blockquote>`);
			continue;
		}

		// 목록
		if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) {
			const ordered = /^\d+\.\s/.test(line);
			const strip = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
			const head2 = ordered ? /^\d+\.\s/ : /^[-*]\s/;
			const items: string[] = [];
			while (i < lines.length && head2.test(lines[i])) {
				items.push(`<li>${inline(lines[i].replace(strip, ""))}</li>`);
				i++;
			}
			out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
			continue;
		}

		// 문단 — 이어지는 줄은 줄바꿈으로 붙인다
		const buf: string[] = [];
		while (i < lines.length && !isBlockStart(lines[i])) buf.push(lines[i++]);
		out.push(`<p>${buf.map(inline).join("<br>")}</p>`);
	}

	return out.join("\n");
}

// ─────────────────────────────────────────────────────────────
// 화면
// ─────────────────────────────────────────────────────────────

export function renderGuide(opts: AdminOpts = {}): string {
	return shellAdmin(
		"연결 가이드",
		`<div class="head">
  <div class="ht">
    <h1>연결 가이드</h1>
    <p class="sub">다른 프로젝트를 이 프록시에 붙일 때 건네주는 문서예요. 관리자용 내용은 들어 있지 않아요.</p>
  </div>
  <div class="gacts">
    <a class="btn p" href="/admin/guide.md" download="${GUIDE_FILENAME}">원문 내려받기 (.md)</a>
    <button type="button" class="btn" id="g-copy">전체 복사</button>
  </div>
</div>
<div class="gnote">받는 쪽에서는 <b>앱 id</b>와 <b>앱 토큰</b>만 있으면 연결됩니다. 두 값은 <a href="/admin/apps">앱 관리</a>에서 만들어 따로 전달하세요.</div>
<div class="mdx">${mdToHtml(GUIDE_MD.replace(/^#\s+.*\n+/, ""))}</div>
<textarea id="g-src" hidden>${escapeHtml(GUIDE_MD)}</textarea>`,
		{ ...opts, tab: "guide" },
	);
}
