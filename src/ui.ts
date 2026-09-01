/**
 * 관리 화면 공통 UI — 스타일·스크립트·바깥 틀·차트.
 *
 * 데이터 조회는 stats.ts, 화면별 본문은 views.ts에 있다.
 * 외부 라이브러리를 쓰지 않는다. 차트·지도 모두 서버에서 SVG 문자열로 만든다.
 */

import { WORLD_PATH, MAP_W, MAP_H, projectLonLat } from "./worldmap";
import { countryName, type StatsSummary } from "./stats";

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

const ADMIN_CSS = `
:root{--bg:#f6f7fb;--panel:#fff;--ink:#1c1f23;--muted:#6b7280;--line:#e6e9ef;--accent:#925FF0;--g:#0a7d33;--r:#c0392b;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
 font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",Inter,sans-serif;line-height:1.5;}
.wrap{max-width:1120px;margin:0 auto;padding:22px 18px 70px;}
h1{font-size:20px;margin:0 0 4px;}h2{font-size:14px;margin:26px 0 9px;color:var(--muted);}
.sub{color:var(--muted);font-size:13px;margin:0 0 16px;}
.tabs{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;}
.tab{font-size:13px;font-weight:700;padding:7px 13px;border-radius:999px;border:1px solid var(--line);
 background:var(--panel);color:var(--ink);text-decoration:none;}
.tab.on{background:var(--accent);border-color:var(--accent);color:#fff;}
.tab.alt{background:#f0eaff;border-color:#ddd0fb;color:#5E3A9E;}
/* ── 요약 지표: 큰 카드 3 + 작은 카드 6 (줄바꿈이 어정쩡하게 남지 않도록 열 수를 고정) */
.kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.k1{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 18px 14px;
 display:flex;flex-direction:column;min-height:132px;}
.k1 .l{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.2px;}
.k1 .v{font-size:32px;font-weight:800;letter-spacing:-1px;line-height:1.15;margin-top:3px;font-variant-numeric:tabular-nums;}
.k1 .v .u{font-size:15px;font-weight:700;color:var(--muted);margin-left:3px;letter-spacing:0;}
.k1 .s{font-size:12.5px;color:var(--muted);margin-top:3px;}
.k1 .s2{font-size:11.5px;color:var(--muted);margin-top:5px;}
.k1 .spark{margin-top:auto;padding-top:10px;height:30px;}
.k1 .spark svg{width:100%;height:24px;display:block;}
.k1 .spark rect{fill:#d9c9fb;}
.k1 .meter{margin-top:auto;height:7px;border-radius:4px;background:#efe9fb;overflow:hidden;}
.k1 .meter span{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,var(--accent),#C85A95);}
.k1 .meter.lat span{background:linear-gradient(90deg,#35A7FF,var(--accent));}
.kpi2{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:10px;}
.m{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:11px 13px;}
.m .l{font-size:11.5px;color:var(--muted);font-weight:700;}
.m .v{font-size:19px;font-weight:800;margin-top:1px;font-variant-numeric:tabular-nums;}
@media(max-width:900px){.kpi{grid-template-columns:1fr}.kpi2{grid-template-columns:repeat(3,1fr)}}
@media(max-width:520px){.kpi2{grid-template-columns:repeat(2,1fr)}}

/* ── 차트 */
.chart{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 12px 8px;}
.chart svg{width:100%;height:auto;aspect-ratio:1000/240;min-height:168px;display:block;overflow:visible;}
.chart .gl{stroke:var(--line);stroke-width:1;}
.chart .ax{font-size:10px;fill:var(--muted);font-weight:600;}
.chart .ax.end{text-anchor:end;}.chart .ax.mid{text-anchor:middle;}.chart .ax.cst{fill:#C85A95;}
.chart .b-ok{fill:var(--accent);}
.chart .b-er{fill:#e2686b;}
.chart .hit{fill:transparent;}
.chart .bg:hover .b-ok{fill:#7a45dd;}
.chart .bg:hover .hit{fill:rgba(146,95,240,.07);}
.chart .cl{fill:none;stroke:#C85A95;stroke-width:2;stroke-linejoin:round;stroke-linecap:round;}
.chart .cd{fill:#fff;stroke:#C85A95;stroke-width:1.6;}
.chart .lg{display:flex;gap:14px;justify-content:center;padding:6px 0 4px;font-size:11.5px;color:var(--muted);font-weight:600;}
.chart .lg .k{display:inline-flex;align-items:center;gap:5px;}
.chart .lg i{width:9px;height:9px;border-radius:3px;display:block;}
.chart .lg .s-ok{background:var(--accent);}.chart .lg .s-er{background:#e2686b;}
.chart .lg .s-ct{background:#C85A95;border-radius:50%;}
.empty{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:26px;
 text-align:center;color:var(--muted);font-size:13px;}

/* ── 지도 */
.mapwrap{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:14px;
 padding:10px;overflow:hidden;}
.mapwrap svg{width:100%;height:auto;display:block;border-radius:9px;}
.mapwrap .sea{fill:#f2f5fb;}
.mapwrap .land{fill:#dfe4ee;stroke:#cfd6e4;stroke-width:.5;}
.mapwrap .bo{fill:rgba(146,95,240,.28);stroke:var(--accent);stroke-width:1.2;}
.mapwrap .bi{fill:var(--accent);}
.mapwrap .bub{cursor:default;}
.mapwrap .bub:hover .bo{fill:rgba(200,90,149,.34);stroke:#C85A95;}
.mapwrap .bub:hover .bi{fill:#C85A95;}
.mapempty{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted);font-size:13px;
 background:rgba(255,255,255,.72);}

/* ── 비중 막대 */
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
@media(max-width:860px){.two{grid-template-columns:1fr}}
.two h2{margin-top:26px;}
.shares{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;}
.sh{margin-bottom:12px;}.sh:last-child{margin-bottom:0;}
.sh-t{display:flex;justify-content:space-between;gap:10px;font-size:13px;font-weight:700;align-items:baseline;}
.sh-v{color:var(--muted);font-weight:600;font-size:12px;font-variant-numeric:tabular-nums;}
.sh-v b{color:var(--ink);}
.sh-b{height:9px;border-radius:5px;background:#f1f2f6;overflow:hidden;margin-top:5px;}
.sh-b span{display:block;height:100%;border-radius:5px;}
.sh-s{font-size:11px;color:var(--muted);margin-top:3px;}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);
 border-radius:14px;overflow:hidden;font-size:13px;}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;}
th{background:#fafbfc;font-weight:700;color:var(--muted);font-size:12px;}
tr:last-child td{border-bottom:none;}
.n{text-align:right;font-variant-numeric:tabular-nums;}
.g{color:var(--g);}.r{color:var(--r);}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}
td.bar{width:30%;}td.bar span{display:block;height:9px;background:var(--accent);border-radius:5px;min-width:2px;}
td.err{color:var(--muted);font-size:11px;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.foot{margin-top:22px;color:var(--muted);font-size:12px;}
.sm{font-size:11px;color:var(--muted);}
.chip{display:inline-block;background:#f0eaff;color:#5E3A9E;border-radius:6px;padding:1px 7px;font-size:11px;font-weight:700;}
form.inline{display:inline}
input,select,textarea{font:inherit;font-size:13px;padding:7px 9px;border:1px solid var(--line);border-radius:9px;background:#fff;width:100%;}
textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}
.btn{font-size:13px;font-weight:700;padding:8px 14px;border-radius:9px;border:1px solid var(--line);
 background:#fff;cursor:pointer;}
.btn.p{background:var(--accent);border-color:var(--accent);color:#fff;}
.btn.d{color:var(--r);border-color:#f2c7c2;}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.fld{margin-bottom:10px;}.fld label{display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px;}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;}
@media(max-width:700px){.grid2{grid-template-columns:1fr}}

/* ── 제목 + 실시간 시계
   시계는 제목보다 작게(제목이 주인공), 하나의 카드로 묶어 오른쪽에 고정한다.
   전에는 27px 숫자가 배경 없이 세로 3단으로 떠 있어 무게가 오른쪽으로 쏠렸다. */
.head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:13px;}
.head .ht{min-width:0;flex:1 1 auto;}
.head h1{margin:0 0 3px;}
.head .sub{margin:0;}
.clock{flex:0 0 auto;display:flex;align-items:center;gap:11px;
 background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:7px 8px 7px 13px;
 box-shadow:0 1px 2px rgba(20,25,40,.04);}
.clock .tw{line-height:1.15;text-align:right;}
.clock .t{font-size:18px;font-weight:800;letter-spacing:-.2px;
 font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
.clock .d{font-size:11px;color:var(--muted);margin-top:1px;white-space:nowrap;}
.live{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:11.5px;font-weight:700;
 color:var(--muted);background:#f7f8fb;border:1px solid var(--line);border-radius:999px;
 padding:5px 11px;cursor:pointer;width:auto;white-space:nowrap;
 transition:color .18s,border-color .18s,background .18s;}
.live i{width:7px;height:7px;border-radius:50%;background:#c7ccd6;display:block;flex:0 0 7px;}
.live.on{color:var(--g);border-color:#cfe8d4;background:#f2fbf4;}
.live.on i{background:#22c55e;animation:beat 1.9s ease-in-out infinite;}
.live.busy{color:#5E3A9E;border-color:#ddd0fb;background:#f0eaff;}
.live.busy i{background:var(--accent);animation:beat .7s ease-in-out infinite;}
@keyframes beat{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.75)}}
/* 탭 두 줄(기간·앱)은 한 덩어리로 보이게 간격을 좁힌다 */
.tabs + .tabs{margin-top:-6px;}
@media(max-width:760px){
  .head{flex-direction:column;align-items:stretch;gap:11px;}
  .clock{justify-content:space-between;}
  .clock .tw{text-align:left;}
}

/* ── 상단바 */
.topbar{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.88);backdrop-filter:blur(10px);
 border-bottom:1px solid var(--line);}
.topbar .in{max-width:1120px;margin:0 auto;padding:0 18px;height:54px;display:flex;align-items:center;gap:14px;}
.topbar .bd{font-weight:800;font-size:15px;letter-spacing:-.3px;display:flex;align-items:center;gap:8px;}
.topbar .bd i{width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#C85A95);display:block;}
.topbar nav{display:flex;gap:4px;margin-left:6px;}
.topbar nav a{font-size:13px;font-weight:700;color:var(--muted);padding:7px 11px;border-radius:9px;text-decoration:none;}
.topbar nav a:hover{background:#f2f3f7;color:var(--ink);}
.topbar nav a.on{background:#f0eaff;color:#5E3A9E;}
.topbar .sp{flex:1}
.topbar .who{font-size:12px;color:var(--muted);}

/* ── 토스트 */
.toasts{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:60;
 display:flex;flex-direction:column;gap:9px;align-items:center;pointer-events:none;width:min(420px,calc(100vw - 32px));}
.toast{pointer-events:auto;cursor:pointer;display:flex;align-items:flex-start;gap:10px;width:100%;
 background:#1f2430;color:#fff;border-radius:13px;padding:12px 15px;font-size:13.5px;font-weight:600;line-height:1.5;
 box-shadow:0 14px 34px rgba(20,25,40,.28);opacity:0;transform:translateY(14px) scale(.97);
 transition:opacity .24s cubic-bezier(.2,.8,.2,1),transform .24s cubic-bezier(.2,.8,.2,1);}
.toast.in{opacity:1;transform:none;}
.toast .tk{width:7px;height:7px;border-radius:50%;background:#6ee7a8;margin-top:6px;flex:0 0 7px;}
.toast.err{background:#3a2126;}.toast.err .tk{background:#ff8a92;}
.toast .tm{flex:1;word-break:break-all;}

/* ── 모달 */
.mask{position:fixed;inset:0;z-index:70;background:rgba(24,20,40,.44);backdrop-filter:blur(3px);
 display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .2s;}
.mask.in{opacity:1;}
.modal{width:min(420px,100%);background:var(--panel);border-radius:18px;padding:22px;
 box-shadow:0 26px 70px rgba(30,20,60,.3);transform:translateY(12px) scale(.96);transition:transform .22s cubic-bezier(.2,.8,.2,1);}
.mask.in .modal{transform:none;}
.modal h3{margin:0 0 8px;font-size:17px;font-weight:800;}
.modal p{margin:0;font-size:14px;color:var(--muted);line-height:1.65;word-break:break-all;}
.modal p.copybox{background:#f6f7fb;border:1px solid var(--line);border-radius:10px;padding:11px 12px;color:var(--ink);font-size:12.5px;}
.modal .mbtns{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;}
.modal .mbtns .btn{min-width:78px;}

/* ── 로그인 */
.login{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
.login .box{width:min(380px,100%);background:var(--panel);border:1px solid var(--line);border-radius:20px;
 padding:30px 26px;box-shadow:0 20px 60px rgba(40,30,80,.09);}
.login .mark{width:46px;height:46px;border-radius:14px;margin:0 auto 14px;
 background:linear-gradient(135deg,var(--accent),#C85A95);display:flex;align-items:center;justify-content:center;
 color:#fff;font-weight:900;font-size:18px;letter-spacing:-.5px;}
.login h1{font-size:19px;text-align:center;margin:0 0 4px;}
.login .sub{text-align:center;margin-bottom:20px;}
.login .btn{width:100%;padding:12px;margin-top:6px;}
.login .err{background:#fff1f1;border:1px solid #f6cfcf;color:#a9313a;border-radius:10px;
 padding:10px 12px;font-size:13px;font-weight:600;margin-bottom:14px;}
.login .foot{text-align:center;margin-top:16px;font-size:11.5px;}
.copy{margin-left:6px;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;border:1px solid var(--line);
 background:#fff;cursor:pointer;color:var(--muted);}
.copy:hover{color:var(--ink);border-color:#cfd4dd;}
`;

/**
 * 관리 화면 공통 스크립트 — 시스템 alert/confirm 대신 직접 만든 모달·토스트를 쓴다.
 * 서버는 결과를 #hz-flash 데이터 속성으로만 넘기고, 표시는 전부 여기서 한다.
 */
const ADMIN_JS = `
(function(){
  var host = document.createElement('div'); host.className = 'toasts'; document.body.appendChild(host);

  function toast(msg, kind){
    var t = document.createElement('div');
    t.className = 'toast' + (kind === 'err' ? ' err' : '');
    var k = document.createElement('span'); k.className = 'tk';
    var m = document.createElement('span'); m.className = 'tm'; m.textContent = msg;
    t.appendChild(k); t.appendChild(m); host.appendChild(t);
    requestAnimationFrame(function(){ t.classList.add('in'); });
    var kill = function(){ t.classList.remove('in'); setTimeout(function(){ if (t.parentNode) t.remove(); }, 280); };
    var timer = setTimeout(kill, 4200);
    t.addEventListener('click', function(){ clearTimeout(timer); kill(); });
  }
  window.hzToast = toast;

  function modal(opts){
    return new Promise(function(resolve){
      var mask = document.createElement('div'); mask.className = 'mask';
      var box = document.createElement('div'); box.className = 'modal';
      var h = document.createElement('h3'); h.textContent = opts.title || '확인';
      var p = document.createElement('p'); p.textContent = opts.body || '';
      if (opts.mono) p.className = 'mono copybox';
      var btns = document.createElement('div'); btns.className = 'mbtns';
      box.appendChild(h); box.appendChild(p); box.appendChild(btns);
      mask.appendChild(box); document.body.appendChild(mask);

      function close(){
        mask.classList.remove('in');
        document.removeEventListener('keydown', esc);
        setTimeout(function(){ if (mask.parentNode) mask.remove(); }, 220);
      }
      function esc(e){ if (e.key === 'Escape') { close(); resolve(null); } }

      (opts.buttons || []).forEach(function(b){
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'btn' + (b.style ? ' ' + b.style : '');
        el.textContent = b.label;
        el.addEventListener('click', function(){ close(); resolve(b.value); });
        btns.appendChild(el);
      });
      document.addEventListener('keydown', esc);
      mask.addEventListener('click', function(e){ if (e.target === mask) { close(); resolve(null); } });
      requestAnimationFrame(function(){
        mask.classList.add('in');
        var f = btns.querySelector('.btn.p, .btn.d') || btns.querySelector('.btn');
        if (f) f.focus();
      });
    });
  }
  window.hzModal = modal;

  // 되돌릴 수 없는 동작은 직접 만든 확인 모달을 거친다.
  document.addEventListener('submit', function(e){
    var f = e.target;
    if (!f || !f.matches || !f.matches('form[data-confirm]')) return;
    if (f.getAttribute('data-confirmed') === '1') return;
    e.preventDefault();
    modal({
      title: f.getAttribute('data-confirm-title') || '확인해 주세요',
      body: f.getAttribute('data-confirm'),
      buttons: [
        { label: '취소', value: false },
        { label: f.getAttribute('data-confirm-ok') || '확인', value: true, style: f.getAttribute('data-danger') === '1' ? 'd' : 'p' }
      ]
    }).then(function(ok){
      if (!ok) return;
      f.setAttribute('data-confirmed', '1');
      if (f.requestSubmit) f.requestSubmit(); else f.submit();
    });
  }, true);

  function copyText(v){
    var done = function(){ toast('복사했어요'); };
    var fallback = function(){
      var ta = document.createElement('textarea');
      ta.value = v; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (err) { toast('복사하지 못했어요', 'err'); }
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(v).then(done, fallback);
    else fallback();
  }
  document.addEventListener('click', function(e){
    var b = e.target && e.target.closest ? e.target.closest('[data-copy]') : null;
    if (!b) return;
    e.preventDefault();
    copyText(b.getAttribute('data-copy'));
  });

  // 서버가 넘긴 결과는 토스트로 띄우고, 주소창의 쿼리는 지운다.
  var flash = document.getElementById('hz-flash');
  if (flash) {
    var msg = flash.getAttribute('data-msg');
    var tok = flash.getAttribute('data-token');
    if (msg) toast(msg, flash.getAttribute('data-kind') || 'ok');
    if (tok) {
      modal({
        title: '토큰이 발급됐어요',
        body: tok,
        mono: true,
        buttons: [{ label: '닫기', value: null }, { label: '복사', value: 'copy', style: 'p' }]
      }).then(function(v){ if (v === 'copy') copyText(tok); });
    }
    if (window.history && history.replaceState) history.replaceState(null, '', location.pathname);
  }

  // ── 실시간 시계 (KST 고정 · 24시간제)
  // 브라우저·서버 시간대와 무관하게 늘 서울 시각을 보여준다.
  // hourCycle:'h23'이라야 자정이 24시가 아니라 00시로 나온다.
  var TF = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hourCycle: 'h23',
    hour: '2-digit', minute: '2-digit', second: '2-digit' });
  // 연도는 뺀다 — 늘 오늘이라 정보가 없고, 가로 배치에서 폭만 차지한다.
  var DF = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul',
    month: '2-digit', day: '2-digit', weekday: 'short' });

  // DOM이 통째로 갈릴 수 있어서 매번 다시 찾는다(참조를 들고 있으면 갱신 뒤 멈춘다).
  function tickClock(){
    var t = document.getElementById('hz-time');
    if (!t) return;
    var now = new Date();
    t.textContent = TF.format(now);
    var d = document.getElementById('hz-date');
    if (d) d.textContent = DF.format(now) + ' KST';
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ── 자동 갱신 — 새 호출이 들어오면 화면을 다시 그린다(대시보드에서만).
  // 매번 통계를 통째로 받아오면 무거우니, 가벼운 /admin/api/pulse로 변화만 감시하고
  // 값이 달라졌을 때만 페이지를 다시 받아 본문을 갈아끼운다.
  if (document.getElementById('hz-clock')) {
    var LIVE_KEY = 'hz_live';
    var live = localStorage.getItem(LIVE_KEY) !== '0';
    var sig = null, busy = false;

    function paintLive(state){
      var el = document.getElementById('hz-live');
      if (!el) return;
      el.className = 'live' + (live ? ' on' : '') + (state === 'busy' ? ' busy' : '');
      var t = document.getElementById('hz-live-t');
      if (t) t.textContent = state === 'busy' ? '불러오는 중' : (live ? '자동 갱신 켬' : '자동 갱신 끔');
    }

    function appQuery(){
      var c = document.getElementById('hz-clock');
      var a = c ? (c.getAttribute('data-app') || '') : '';
      return a ? '?app=' + encodeURIComponent(a) : '';
    }

    function refresh(){
      busy = true; paintLive('busy');
      fetch(location.href, { credentials: 'same-origin' })
        .then(function(r){ if (!r.ok) throw new Error('http'); return r.text(); })
        .then(function(html){
          var doc = new DOMParser().parseFromString(html, 'text/html');
          // 헤더(#hz-clock 포함)는 그대로 두고 데이터 영역만 갈아끼운다.
          // .wrap을 통째로 바꾸면 시계 DOM이 매번 새로 만들어져 값이 잠깐 비고 배치가 흔들린다.
          var neu = doc.querySelector('#hz-body') || doc.querySelector('.wrap');
          var cur = document.querySelector('#hz-body') || document.querySelector('.wrap');
          if (neu && cur) cur.innerHTML = neu.innerHTML;
        })
        .catch(function(){ /* 잠깐 실패해도 다음 주기에 다시 시도한다 */ })
        .then(function(){ busy = false; tickClock(); paintLive(); });
    }

    function poll(){
      if (!live || busy || document.hidden) return;
      fetch('/admin/api/pulse' + appQuery(), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function(r){
          if (r.status === 401 || r.status === 403) {
            live = false; paintLive();
            toast('로그인이 풀려서 자동 갱신을 멈췄어요. 새로고침해 주세요.', 'err');
            return null;
          }
          return r.ok ? r.json() : null;
        })
        .then(function(j){
          if (!j) return;
          var now = j.mx + '|' + j.ts;
          if (sig === null) { sig = now; return; }   // 첫 응답은 기준점만 잡는다
          if (now !== sig) { sig = now; refresh(); }
        })
        .catch(function(){});
    }

    document.addEventListener('click', function(e){
      var b = e.target && e.target.closest ? e.target.closest('#hz-live') : null;
      if (!b) return;
      live = !live;
      localStorage.setItem(LIVE_KEY, live ? '1' : '0');
      paintLive();
      if (live) poll();
    });
    // 다른 탭을 보다 돌아오면 바로 한 번 확인한다(백그라운드에선 폴링하지 않는다).
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) poll(); });

    paintLive();
    poll();
    setInterval(poll, 10000);
  }
})();
`;

/* ── 탭 분리(요약·사용량·추이·지역·로그)에서 새로 쓰는 스타일 ── */
const EXTRA_CSS = `
/* 상단바 메뉴가 6개라 좁은 화면에선 가로로 밀어서 본다 */
.topbar nav{overflow-x:auto;scrollbar-width:none;}
.topbar nav::-webkit-scrollbar{display:none}
.topbar nav a{white-space:nowrap;}
@media(max-width:640px){.topbar .in{gap:8px;padding:0 12px}.topbar .bd span{display:none}}

/* 제목 오른쪽에 "자세히" 링크를 붙이는 소제목 */
.sh2{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:26px 0 9px;}
.sh2 h2{margin:0;}
.sh2 a{font-size:12px;font-weight:700;color:var(--accent);text-decoration:none;white-space:nowrap;}
.sh2 a:hover{text-decoration:underline;}

/* 직전 같은 기간과 비교한 증감 */
.dl{display:inline-flex;align-items:center;gap:2px;font-size:11.5px;font-weight:800;
 border-radius:6px;padding:1px 6px;margin-left:6px;font-variant-numeric:tabular-nums;}
.dl.up{background:#fdeaf1;color:#B0356F;}
.dl.dn{background:#e9f7ee;color:#0a7d33;}
.dl.eq{background:#f1f2f6;color:var(--muted);}

/* 요약 화면 알림 줄 */
.alerts{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}
/* 탭 줄 안에 들어간 알림 — 위 JSON 뱃지와 오른쪽 끝을 맞춘다. 자리가 좁으면 아랫줄로 접힌다. */
.tabs .alerts{margin:0;justify-content:flex-end;}
.al{display:flex;align-items:center;gap:7px;background:#fff6f6;border:1px solid #f6cfcf;color:#a9313a;
 border-radius:11px;padding:8px 12px;font-size:12.5px;font-weight:700;}
.al.ok{background:#f2fbf4;border-color:#cfe8d4;color:#0a7d33;}
.al b{font-weight:900;}

/* 도넛 + 범례 */
.donut{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;
 display:flex;gap:18px;align-items:center;}
.donut svg{width:132px;height:132px;flex:0 0 132px;}
.donut .lgd{flex:1;min-width:0;}
.dg{display:flex;align-items:baseline;gap:8px;font-size:12.5px;padding:3px 0;}
.dg i{width:9px;height:9px;border-radius:3px;flex:0 0 9px;display:block;position:relative;top:1px;}
.dg .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;}
.dg .pc{font-variant-numeric:tabular-nums;font-weight:800;}
.dg .vl{color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums;}
.dg a{color:inherit;text-decoration:none;}
.dg a:hover .nm{text-decoration:underline;}
@media(max-width:520px){.donut{flex-direction:column;align-items:stretch}.donut svg{align-self:center}}

/* 요일 × 시각 히트맵 */
.hm{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;overflow-x:auto;}
.hm table{border:none;border-radius:0;background:none;font-size:11px;width:auto;min-width:100%;}
.hm td,.hm th{border:none;padding:0;}
.hm th{background:none;font-size:10px;color:var(--muted);text-align:center;padding-bottom:4px;font-weight:700;}
.hm th.wd{text-align:right;padding-right:7px;width:34px;}
.hm .c{width:100%;aspect-ratio:1;min-width:13px;border-radius:3px;background:#f1f2f6;display:block;}
.hm td{padding:1.5px;}
.hm .lgh{display:flex;align-items:center;gap:6px;justify-content:flex-end;margin-top:9px;
 font-size:11px;color:var(--muted);font-weight:600;}
.hm .lgh i{width:13px;height:13px;border-radius:3px;display:block;}

/* 로그 검색 */
.flt{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:12px;}
.flt .row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
.flt .row.r2{grid-template-columns:repeat(3,1fr) auto;align-items:end;}
.flt .fld{margin-bottom:0;}
.flt .acts{display:flex;gap:8px;}
@media(max-width:860px){.flt .row,.flt .row.r2{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.flt .row,.flt .row.r2{grid-template-columns:1fr}}
.quick{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0 0;}
.quick a{font-size:12px;font-weight:700;padding:5px 11px;border-radius:999px;border:1px solid var(--line);
 background:#fafbfc;color:var(--muted);text-decoration:none;}
.quick a.on{background:#f0eaff;border-color:#ddd0fb;color:#5E3A9E;}

/* 로그 표 — 행을 누르면 상세가 펼쳐진다 */
table.log{font-size:12.5px;}
table.log tr[data-det]{cursor:pointer;}
table.log tr[data-det]:hover td{background:#faf8ff;}
table.log td{white-space:nowrap;}
table.log td.w{white-space:normal;}
tr.det td{background:#fafbfc;white-space:normal;}
.kv{display:grid;grid-template-columns:88px 1fr;gap:3px 12px;font-size:12px;}
.kv dt{color:var(--muted);font-weight:700;}
.kv dd{margin:0;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;}
.pg{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-top:12px;}
.pg .cnt{font-size:12px;color:var(--muted);}
.pg .nav{display:flex;gap:8px;}
.pg .btn.off{opacity:.4;pointer-events:none;}
a.btn{text-decoration:none;display:inline-block;color:var(--ink);}

/* 표가 길 때 가로 스크롤 */
.scroll{overflow-x:auto;border-radius:14px;}
.scroll table{min-width:640px;}

/* ── 앱 관리 — 앱 1개 = 카드 1장. 표에 편집 폼까지 넣으면 세로로 한없이 길어진다. */
.lh{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:22px 0 11px;}
.lh .t{font-size:13px;font-weight:700;color:var(--muted);}
.lh .t b{color:var(--ink);font-size:14px;}
.lh .btn{padding:7px 14px;}
.apps{display:flex;flex-direction:column;gap:12px;}
.app{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:15px 17px;}
.app.off{background:#fcfcfd;}
.ah{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.ah .nm{min-width:170px;}
.ah .nm b{font-size:15.5px;font-weight:800;letter-spacing:-.2px;}
.ah .nm .id{font-size:11.5px;color:var(--muted);margin-top:2px;}
.ah .acts{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
.ah .acts .btn{padding:6px 11px;font-size:12px;}
.st{display:inline-block;font-size:11px;font-weight:800;border-radius:999px;padding:2px 9px;margin-left:8px;
 position:relative;top:-1px;}
.st.on{background:#eaf7ee;color:var(--g);}
.st.off{background:#ffecec;color:var(--r);}
.ab{display:grid;grid-template-columns:1fr 1fr;gap:11px 20px;margin-top:13px;
 border-top:1px solid var(--line);padding-top:12px;}
.ab .k{font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px;}
.ab .v{font-size:12.5px;word-break:break-all;}
.ab .wide{grid-column:1/-1;}
.tok .full{display:none;}
.tok.open .full{display:inline;}
/* 토큰 가림 — 클래스 이름은 모달 배경막(.mask)과 겹치지 않게 둔다.
   겹치면 화면 전체를 덮는 고정 막 스타일이 이 span에 걸려 모든 클릭이 막힌다. */
.tok.open .hid{display:none;}
.tok .copy{margin-left:6px;}
.mc{display:inline-flex;align-items:center;gap:7px;background:#f7f5fd;border:1px solid #ece6fb;
 border-radius:8px;padding:3px 9px;margin:0 6px 6px 0;font-size:11.5px;
 font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
.mc i{font-style:normal;font-weight:800;color:#5E3A9E;}
.aedit{margin-top:13px;border-top:1px solid var(--line);padding-top:14px;}
.eacts{display:flex;gap:8px;align-items:center;}
@media(max-width:700px){.ab{grid-template-columns:1fr}.lh{flex-wrap:wrap}}

/* 접었다 펴는 안내 상자 — 머리 줄 전체가 버튼이라 기호·글자 어디를 눌러도 열린다.
   (details/summary는 브라우저에 따라 열리지 않는 경우가 있어 쓰지 않는다.) */
.dt{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:13px 17px;margin-top:12px;}
.dth{display:flex;align-items:center;gap:8px;width:calc(100% + 34px);margin:-13px -17px;padding:13px 17px;
 font:inherit;font-size:13px;font-weight:700;color:var(--muted);text-align:left;
 background:none;border:0;border-radius:14px;cursor:pointer;}
.dth::before{content:'▸';color:var(--accent);font-weight:900;}
.dth.on::before{content:'▾';}
.dth:hover{color:var(--ink);background:#faf8ff;}
.dt .in{margin-top:12px;}
.dt .in.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
 white-space:pre-wrap;line-height:1.7;}
`;

/* ── 새 화면에서 쓰는 스크립트 — 로그 행 펼치기 ── */
const EXTRA_JS = `
document.addEventListener('click', function(e){
  var t = e.target;
  if (!t || !t.closest) return;
  if (t.closest('a,button,input,select,textarea')) return;
  var tr = t.closest('tr[data-det]');
  if (!tr) return;
  var d = document.getElementById('det-' + tr.getAttribute('data-det'));
  if (d) d.hidden = !d.hidden;
});

// 표 위 검색칸 — 모델이 수백 개라 눈으로 찾기 어렵다. 입력한 말이 든 줄만 남긴다.
document.addEventListener('input', function(e){
  var i = e.target;
  if (!i || !i.getAttribute || !i.getAttribute('data-filter')) return;
  var tb = document.getElementById(i.getAttribute('data-filter'));
  if (!tb) return;
  var v = i.value.trim().toLowerCase();
  var rows = tb.querySelectorAll('tbody tr');
  var n = 0;
  for (var k = 0; k < rows.length; k++) {
    var hit = !v || rows[k].textContent.toLowerCase().indexOf(v) >= 0;
    rows[k].hidden = !hit;
    if (hit) n++;
  }
  var c = document.getElementById(i.getAttribute('data-filter') + '-cnt');
  if (c) c.textContent = n.toLocaleString() + '개';
});

// 접었다 펴기 — 앱 편집 폼, 새 앱 추가 폼. data-on/data-off가 있으면 버튼 글자도 바꾼다.
document.addEventListener('click', function(e){
  var b = e.target && e.target.closest ? e.target.closest('[data-toggle]') : null;
  if (!b) return;
  var el = document.getElementById(b.getAttribute('data-toggle'));
  if (!el) return;
  var open = el.hidden;
  el.hidden = !open;
  var all = document.querySelectorAll('[data-toggle="' + b.getAttribute('data-toggle') + '"]');
  for (var k = 0; k < all.length; k++) {
    var lb = all[k].getAttribute(open ? 'data-on' : 'data-off');
    if (lb) all[k].textContent = lb;
    all[k].classList.toggle('on', open);
  }
  if (open) {
    var f = el.querySelector('input:not([type=hidden]),textarea');
    if (f) f.focus();
  }
});

// 토큰 보기/가리기 — 평소엔 가운데를 가려 둔다.
document.addEventListener('click', function(e){
  var b = e.target && e.target.closest ? e.target.closest('[data-reveal]') : null;
  if (!b) return;
  var w = b.closest('.tok');
  if (!w) return;
  b.textContent = w.classList.toggle('open') ? '가리기' : '보기';
});
`;

// ─────────────────────────────────────────────────────────────
// 바깥 틀
// ─────────────────────────────────────────────────────────────

/** 상단바 메뉴 키. */
export type TabKey = "summary" | "usage" | "trend" | "geo" | "logs" | "apps";

export interface AdminOpts {
	/** 세션 로그인으로 들어온 화면인지(= 로그아웃 버튼 노출). */
	session?: boolean;
	/** 상단바에서 강조할 메뉴 */
	tab?: TabKey;
	/** 상단바·본문 여백 없이 그리는 화면(로그인 등) */
	bare?: boolean;
	/** 화면을 열자마자 토스트로 띄울 결과 메시지 */
	flash?: string | null;
	/** 화면을 열자마자 모달로 보여줄 발급 토큰 */
	token?: string | null;
}

// 상단 메뉴는 조건 없는 주소로만 간다.
// 화면마다 기간·앱을 따로 고르는데, 메뉴에 조건을 얹으면 한 화면에서 고른 값이
// 나머지 화면까지 따라가 버린다. 화면을 옮기면 기본값(최근 30일·전체 앱)에서 다시 시작한다.
// 화면 안의 "자세히 →"·도넛 조각·"로그 →"는 눌러서 파고드는 링크라 조건을 그대로 넘긴다.
const NAV: { key: TabKey; href: string; label: string }[] = [
	{ key: "summary", href: "/admin", label: "요약" },
	{ key: "usage", href: "/admin/usage", label: "사용량" },
	{ key: "trend", href: "/admin/trend", label: "추이" },
	{ key: "geo", href: "/admin/geo", label: "지역" },
	{ key: "logs", href: "/admin/logs", label: "로그" },
	{ key: "apps", href: "/admin/apps", label: "앱 관리" },
];

export function shellAdmin(title: string, body: string, opts: AdminOpts = {}): string {
	const nav = NAV.map(
		(n) => `<a href="${n.href}"${opts.tab === n.key ? ' class="on"' : ""}>${n.label}</a>`,
	).join("");
	const topbar = opts.bare
		? ""
		: `<header class="topbar"><div class="in">
  <span class="bd"><i></i><span>AI 프록시</span></span>
  <nav>${nav}</nav>
  <span class="sp"></span>
  ${opts.session ? `<form method="post" action="/admin/logout"><button class="btn" type="submit">로그아웃</button></form>` : ""}
</div></header>`;
	const flash =
		opts.flash || opts.token
			? `<div id="hz-flash" hidden data-msg="${escapeHtml(opts.flash ?? "")}" data-token="${escapeHtml(opts.token ?? "")}"></div>`
			: "";
	return `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="robots" content="noindex,nofollow">
<style>${ADMIN_CSS}${EXTRA_CSS}</style></head><body>${topbar}
${opts.bare ? body : `<div class="wrap">${body}</div>`}
${flash}<script>${ADMIN_JS}${EXTRA_JS}</script></body></html>`;
}

// ─────────────────────────────────────────────────────────────
// 로그인 화면
// ─────────────────────────────────────────────────────────────
export function renderLogin(opts: { error?: string; user?: string; next?: string } = {}): string {
	return shellAdmin(
		"로그인",
		`<main class="login"><form class="box" method="post" action="/admin/login">
  <div class="mark">AI</div>
  <h1>AI 프록시 관리</h1>
  <p class="sub">호출 통계와 앱 토큰을 관리하는 화면이에요.</p>
  ${opts.error ? `<div class="err">${escapeHtml(opts.error)}</div>` : ""}
  <input type="hidden" name="next" value="${escapeHtml(opts.next ?? "/admin")}">
  <div class="fld"><label>아이디</label>
    <input name="user" value="${escapeHtml(opts.user ?? "")}" autocomplete="username" autocapitalize="none" autofocus required></div>
  <div class="fld"><label>비밀번호</label>
    <input name="pass" type="password" autocomplete="current-password" required></div>
  <button class="btn p" type="submit">로그인</button>
  <p class="foot">관리자 전용 화면이에요. 색인되지 않아요.</p>
</form></main>`,
		{ bare: true },
	);
}

// ─────────────────────────────────────────────────────────────
// 화면 머리 · 기간/앱 고르기
// ─────────────────────────────────────────────────────────────

/**
 * 제목 + 실시간 시계.
 * live가 false면 시계만 돌고 자동 갱신은 하지 않는다(로그 화면에서 쓴다 —
 * 보던 목록이 몇 초마다 다시 그려지면 읽을 수가 없다).
 */
export function pageHead(title: string, sub: string, appFilter: string, live = true): string {
	return `<div class="head">
  <div class="ht">
    <h1>${escapeHtml(title)}</h1>
    <p class="sub">${sub}</p>
  </div>
  <div class="clock"${live ? ` id="hz-clock" data-app="${escapeHtml(appFilter)}"` : ""}>
    <div class="tw">
      <div class="t" id="hz-time">--:--:--</div>
      <div class="d" id="hz-date">KST</div>
    </div>
    ${live ? `<button type="button" class="live" id="hz-live" title="끄면 화면을 자동으로 다시 그리지 않아요"><i></i><span id="hz-live-t">자동 갱신</span></button>` : ""}
  </div>
</div>`;
}

/**
 * 기간·앱 고르는 두 줄 탭.
 * rightLink는 첫 줄 오른쪽(JSON 뱃지), rightBelow는 둘째 줄 오른쪽에 붙는다.
 * 둘을 세로로 맞춰 두면 알림 줄이 따로 한 줄을 차지하지 않는다.
 */
export function filterTabs(
	path: string,
	period: string,
	appFilter: string,
	apps: { id: string; name: string; active: boolean }[],
	periods: Record<string, { label: string }>,
	rightLink = "",
	rightBelow = "",
): string {
	const q = (p: string, a: string) => `${path}?period=${p}${a ? `&app=${encodeURIComponent(a)}` : ""}`;
	const periodTabs = Object.entries(periods)
		.map(([k, v]) => `<a class="tab${k === period ? " on" : ""}" href="${q(k, appFilter)}">${v.label}</a>`)
		.join("");
	const appTabs =
		`<a class="tab${!appFilter ? " on" : ""}" href="${q(period, "")}">전체 앱</a>` +
		apps
			.map(
				(a) =>
					`<a class="tab${appFilter === a.id ? " on" : ""}" href="${q(period, a.id)}">${escapeHtml(a.name)}${a.active ? "" : " (중지)"}</a>`,
			)
			.join("");
	return (
		`<div class="tabs">${periodTabs}<span style="flex:1"></span>${rightLink}</div>` +
		`<div class="tabs">${appTabs}${rightBelow ? `<span style="flex:1"></span>${rightBelow}` : ""}</div>`
	);
}

/** 소제목 + 오른쪽 "자세히" 링크. */
export function sectionHead(title: string, href = "", linkLabel = "자세히 →"): string {
	return `<div class="sh2"><h2>${escapeHtml(title)}</h2>${href ? `<a href="${href}">${linkLabel}</a>` : ""}</div>`;
}

/**
 * 직전 같은 기간과 비교한 증감 표시.
 * higherIsWorse가 참이면 늘어난 쪽을 빨갛게(실패·비용·지연), 거짓이면 파랗게 본다.
 */
export function delta(cur: number, prev: number, higherIsWorse = false): string {
	if (!prev) return "";
	const pct = ((cur - prev) / prev) * 100;
	if (!isFinite(pct) || Math.abs(pct) < 0.5) return `<span class="dl eq">-</span>`;
	const up = pct > 0;
	const bad = higherIsWorse ? up : !up;
	const v = `${up ? "▲" : "▼"}${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
	return `<span class="dl ${bad ? "up" : "dn"}" title="직전 같은 기간 대비">${v}</span>`;
}

// ─────────────────────────────────────────────────────────────
// 도넛 · 히트맵
// ─────────────────────────────────────────────────────────────

/** 도넛 차트 — 상위 5개 + 나머지는 "기타"로 묶는다. 조각을 누르면 해당 화면으로 간다. */
export function svgDonut(
	rows: { label: string; value: number; sub?: string; href?: string }[],
	unit: string,
): string {
	const total = rows.reduce((a, b) => a + b.value, 0);
	if (!total) return `<div class="empty">이 기간에 기록이 없어요.</div>`;

	// 6개까지는 그대로 보여준다. 남는 게 하나뿐인데 "기타 1개"로 접으면 오히려 답답하다.
	const top = rows.length <= 6 ? rows : rows.slice(0, 5);
	const restV = rows.length <= 6 ? 0 : rows.slice(5).reduce((a, b) => a + b.value, 0);
	const items = restV ? [...top, { label: `기타 ${rows.length - 5}개`, value: restV, sub: "", href: "" }] : top;

	const C = 66, R = 58, r = 36;
	const pt = (ang: number, rad: number) => `${(C + rad * Math.cos(ang)).toFixed(2)},${(C + rad * Math.sin(ang)).toFixed(2)}`;

	let acc = -Math.PI / 2;
	const arcs =
		items.length === 1
			? `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${SHARE_COLORS[0]}" stroke-width="${R - r}"/>`
			: items
					.map((it, i) => {
						const ang = (it.value / total) * Math.PI * 2;
						const a0 = acc;
						const a1 = acc + ang;
						acc = a1;
						const large = ang > Math.PI ? 1 : 0;
						const d = `M ${pt(a0, R)} A ${R} ${R} 0 ${large} 1 ${pt(a1, R)} L ${pt(a1, r)} A ${r} ${r} 0 ${large} 0 ${pt(a0, r)} Z`;
						const title = `${it.label} — ${it.value.toLocaleString()}${unit} (${((it.value / total) * 100).toFixed(1)}%)`;
						return `<path d="${d}" fill="${SHARE_COLORS[i % SHARE_COLORS.length]}"><title>${escapeHtml(title)}</title></path>`;
					})
					.join("");

	const legend = items
		.map((it, i) => {
			const pct = (it.value / total) * 100;
			const inner =
				`<i style="background:${SHARE_COLORS[i % SHARE_COLORS.length]}"></i>` +
				`<span class="nm">${escapeHtml(it.label)}</span>` +
				`<span class="pc">${pct.toFixed(pct < 10 ? 1 : 0)}%</span>` +
				`<span class="vl">${it.value.toLocaleString()}${unit}</span>`;
			const href = (it as { href?: string }).href;
			return `<div class="dg">${href ? `<a href="${href}" style="display:contents">${inner}</a>` : inner}</div>`;
		})
		.join("");

	return `<div class="donut">
<svg viewBox="0 0 ${C * 2} ${C * 2}" role="img" aria-label="비중 도넛 차트">${arcs}</svg>
<div class="lgd">${legend}</div>
</div>`;
}

/** 요일 × 시각 히트맵 — 언제 호출이 몰리는지 본다(KST 기준). */
export function svgHeat(cells: { w: number; h: number; n: number }[]): string {
	const grid = new Map<string, number>();
	let max = 0;
	for (const c of cells) {
		grid.set(`${c.w}|${c.h}`, c.n);
		if (c.n > max) max = c.n;
	}
	if (!max) return `<div class="empty">이 기간에 호출이 없어요.</div>`;

	const WD = ["일", "월", "화", "수", "목", "금", "토"];
	const head = `<tr><th class="wd"></th>${Array.from({ length: 24 }, (_, h) => `<th>${h % 3 === 0 ? h : ""}</th>`).join("")}</tr>`;
	const body = WD.map((wd, w) => {
		const tds = Array.from({ length: 24 }, (_, h) => {
			const n = grid.get(`${w}|${h}`) ?? 0;
			// 값 차이가 커서 선형으로 칠하면 대부분 흰색이 된다. 제곱근으로 눌러 준다.
			const f = n ? 0.14 + Math.sqrt(n / max) * 0.86 : 0;
			const bg = n ? `rgba(146,95,240,${f.toFixed(3)})` : "#f1f2f6";
			return `<td><span class="c" style="background:${bg}" title="${wd}요일 ${h}시 · ${n.toLocaleString()}건"></span></td>`;
		}).join("");
		return `<tr><th class="wd">${wd}</th>${tds}</tr>`;
	}).join("");

	return `<div class="hm"><table>${head}${body}</table>
<div class="lgh">적음 <i style="background:#f1f2f6"></i><i style="background:rgba(146,95,240,.3)"></i><i style="background:rgba(146,95,240,.6)"></i><i style="background:rgba(146,95,240,1)"></i> 많음 (최대 ${max.toLocaleString()}건)</div></div>`;
}

export const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`;
export const kst = (ts: number) => new Date(ts + 9 * 3600_000).toISOString().replace("T", " ").slice(5, 19);

// ─────────────────────────────────────────────────────────────
// 차트 · 지도 (외부 라이브러리 없이 인라인 SVG)
// ─────────────────────────────────────────────────────────────

/** 축 눈금용 — 보기 좋은 상한값(1·2·5×10ⁿ)으로 올림. */
export function niceMax(v: number): number {
	if (v <= 0) return 1;
	const exp = Math.pow(10, Math.floor(Math.log10(v)));
	const f = v / exp;
	return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

export const shortNum = (v: number): string =>
	v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : String(v);

/**
 * 추이 차트 — 성공·실패 누적 막대 + 비용 꺾은선(오른쪽 축).
 * 값은 서버에서 좌표로 굳혀 보내고, 자세한 수치는 막대의 title(마우스 올리면 표시)로 준다.
 */
export function svgTrend(buckets: StatsSummary["buckets"]): string {
	const data = buckets.slice(0, 30).slice().reverse();   // 최신이 앞이라 뒤집어 시간순으로
	if (!data.length) return `<div class="empty">이 기간에 호출이 없어요.</div>`;

	const W = 1000, H = 240, L = 46, R = 56, T = 14, B = 30;
	const iw = W - L - R, ih = H - T - B;
	const maxCall = niceMax(Math.max(...data.map((d) => d.total)));
	const maxCost = niceMax(Math.max(...data.map((d) => d.cost), 0.0001));
	const bw = Math.max(3, Math.min(46, (iw / data.length) * 0.62));
	const cx = (i: number) => L + (iw / data.length) * (i + 0.5);
	const yCall = (v: number) => T + ih - (v / maxCall) * ih;
	const yCost = (v: number) => T + ih - (v / maxCost) * ih;

	const grid = [0, 0.25, 0.5, 0.75, 1]
		.map((f) => {
			const y = T + ih - f * ih;
			return `<line x1="${L}" y1="${y.toFixed(1)}" x2="${L + iw}" y2="${y.toFixed(1)}" class="gl"/>` +
				`<text x="${L - 8}" y="${(y + 4).toFixed(1)}" class="ax end">${shortNum(Math.round(maxCall * f))}</text>` +
				`<text x="${L + iw + 8}" y="${(y + 4).toFixed(1)}" class="ax cst">$${(maxCost * f).toFixed(maxCost < 0.1 ? 4 : 2)}</text>`;
		})
		.join("");

	const bars = data
		.map((d, i) => {
			const x = cx(i) - bw / 2;
			const okH = ((d.ok / maxCall) * ih) || 0;
			const erH = ((d.error / maxCall) * ih) || 0;
			const okY = T + ih - okH;
			const erY = okY - erH;
			const title = `${d.b}\n호출 ${d.total.toLocaleString()} · 성공 ${d.ok.toLocaleString()} · 실패 ${d.error.toLocaleString()}\n토큰 ${d.tokens.toLocaleString()} · 비용 ${usd(d.cost)}`;
			return `<g class="bg"><title>${escapeHtml(title)}</title>` +
				`<rect x="${x.toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${ih}" class="hit"/>` +
				`<rect x="${x.toFixed(1)}" y="${okY.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(okH, d.ok ? 1.5 : 0).toFixed(1)}" rx="2" class="b-ok"/>` +
				(d.error ? `<rect x="${x.toFixed(1)}" y="${erY.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(erH, 1.5).toFixed(1)}" rx="2" class="b-er"/>` : "") +
				`</g>`;
		})
		.join("");

	const line = data.map((d, i) => `${cx(i).toFixed(1)},${yCost(d.cost).toFixed(1)}`).join(" ");
	const dots = data.map((d, i) => `<circle cx="${cx(i).toFixed(1)}" cy="${yCost(d.cost).toFixed(1)}" r="2.6" class="cd"/>`).join("");

	// x축 라벨 — 겹치지 않게 일정 간격으로만
	const step = Math.max(1, Math.ceil(data.length / 9));
	const xlab = data
		.map((d, i) => (i % step === 0 || i === data.length - 1
			? `<text x="${cx(i).toFixed(1)}" y="${H - 9}" class="ax mid">${escapeHtml(d.b.replace(/^\d{4}-/, ""))}</text>`
			: ""))
		.join("");

	return `<div class="chart">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="기간별 호출·비용 추이">
${grid}${bars}<polyline points="${line}" class="cl"/>${dots}${xlab}
</svg>
<div class="lg"><span class="k"><i class="s-ok"></i>성공</span><span class="k"><i class="s-er"></i>실패</span><span class="k"><i class="s-ct"></i>비용(오른쪽 축)</span></div>
</div>`;
}

/** 가로 비중 막대 — 앱·모델처럼 항목이 적은 분포에 쓴다. */
export function svgShare(rows: { label: string; value: number; sub: string }[], unitLabel: string): string {
	if (!rows.length) return `<div class="empty">데이터 없어요.</div>`;
	const total = rows.reduce((a, b) => a + b.value, 0) || 1;
	return `<div class="shares">${rows
		.slice(0, 6)
		.map((r, i) => {
			const pct = (r.value / total) * 100;
			return `<div class="sh"><div class="sh-t"><span>${escapeHtml(r.label)}</span>` +
				`<span class="sh-v">${r.value.toLocaleString()}${unitLabel} <b>${pct.toFixed(pct < 10 ? 1 : 0)}%</b></span></div>` +
				`<div class="sh-b"><span style="width:${pct.toFixed(1)}%;background:${SHARE_COLORS[i % SHARE_COLORS.length]}"></span></div>` +
				(r.sub ? `<div class="sh-s">${escapeHtml(r.sub)}</div>` : "") +
				`</div>`;
		})
		.join("")}</div>`;
}
const SHARE_COLORS = ["#925FF0", "#C85A95", "#35A7FF", "#44AB42", "#F0A93B", "#7A7590"];

/** 세계 지도 — 육지 외곽선 위에 도시별 호출량을 원으로 얹는다. */
export function svgMap(points: StatsSummary["points"], unknown: number): string {
	const max = Math.max(1, ...points.map((p) => p.total));
	const bubbles = points
		.map((p) => {
			const { x, y } = projectLonLat(p.lon, p.lat);
			const r = 4 + Math.sqrt(p.total / max) * 16;
			const title = `${countryName(p.country)}${p.city && p.city !== "-" ? ` · ${p.city}` : ""}\n호출 ${p.total.toLocaleString()} · 고유 IP ${p.ips.toLocaleString()} · 비용 ${usd(p.cost)}`;
			return `<g class="bub"><title>${escapeHtml(title)}</title>` +
				`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" class="bo"/>` +
				`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(1.8, r * 0.26).toFixed(1)}" class="bi"/></g>`;
		})
		.join("");
	return `<div class="mapwrap">
<svg viewBox="0 0 ${MAP_W} ${MAP_H}" role="img" aria-label="호출 지역 지도">
<rect width="${MAP_W}" height="${MAP_H}" class="sea"/>
<path d="${WORLD_PATH}" class="land"/>
${bubbles}
</svg>
${points.length ? "" : `<div class="mapempty">아직 좌표가 있는 호출이 없어요.</div>`}
</div>
<p class="sm" style="margin:8px 2px 0">원 크기는 호출량이에요. 마우스를 올리면 지역·호출 수를 볼 수 있어요.${unknown ? ` 좌표가 없는 호출 ${unknown.toLocaleString()}건은 지도에 표시되지 않아요(이전 기록·미상 지역).` : ""}</p>`;
}
