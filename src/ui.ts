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
.chart .lv-c{fill:#d1495b;}.chart .lv-w{fill:#E0A33B;}.chart .lv-i{fill:#7fa8e0;}
.chart.lvl svg{aspect-ratio:1000/200;min-height:150px;}
.chart .lg .s-c{background:#d1495b;}.chart .lg .s-w{background:#E0A33B;}.chart .lg .s-i{background:#7fa8e0;}
.chart .tr-h{fill:var(--accent);}.chart .tr-a{fill:#C85A95;}.chart .tr-s{fill:#35A7FF;}.chart .tr-o{fill:#cfd6e4;}
.chart .lg .s-h{background:var(--accent);}.chart .lg .s-a{background:#C85A95;}
.chart .lg .s-s{background:#35A7FF;}.chart .lg .s-o{background:#cfd6e4;}
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
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;}
.two>section{min-width:0;}
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
.live.wait{color:var(--muted);border-color:var(--line);background:#f7f8fb;}
.live.wait i{background:#c7ccd6;animation:none;}
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
/* 패스키 — 비밀번호 칸 위에 두되, 눈에 띄되 튀지 않게 테두리 버튼으로 */
.login .btn.pk{display:flex;align-items:center;justify-content:center;gap:8px;margin:0 0 4px;
 background:#fff;border:1.5px solid var(--accent);color:var(--accent);font-weight:800;}
.login .btn.pk:hover{background:#f7f3ff;}
.login .btn.pk svg{width:18px;height:18px;fill:currentColor;display:block;}
.login .btn.pk[disabled]{opacity:.55;cursor:default;}
.login .or{display:flex;align-items:center;gap:10px;margin:16px 0 14px;color:var(--muted);font-size:11.5px;font-weight:700;}
.login .or::before,.login .or::after{content:"";flex:1;height:1px;background:var(--line);}

/* 패스키 목록 (앱 관리 맨 아래) */
.pks{display:flex;flex-direction:column;gap:8px;}
.pk1{display:flex;align-items:center;gap:10px;background:#fafbfc;border:1px solid var(--line);
 border-radius:11px;padding:10px 13px;}
.pk1 .nm{font-weight:700;font-size:13px;}
.pk1 .sm{margin-left:auto;white-space:nowrap;}
.pk1 form{margin:0;}
.pk1 .btn{padding:5px 11px;font-size:11.5px;}
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
      el.className = 'live' + (live ? ' on' : '') + (state === 'busy' ? ' busy' : '') + (state === 'wait' ? ' wait' : '');
      var t = document.getElementById('hz-live-t');
      if (!t) return;
      if (state === 'busy') t.textContent = '불러오는 중';
      else if (state === 'wait') t.textContent = '잠시 멈춤';
      else t.textContent = live ? '자동 갱신 켬' : '자동 갱신 끔';
    }

    // 지금 다시 그리면 보던 걸 뺏는 상황이면 이번 주기는 건너뛴다.
    //  - 검색칸·입력칸에 커서가 있을 때
    //  - 로그에서 줄을 펼쳐 뒀을 때
    //  - 로그 다음 쪽으로 넘어갔을 때(첫 쪽에서만 새 호출을 얹는다)
    function paused(){
      var a = document.activeElement;
      if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return true;
      if (document.querySelector('tr.det:not([hidden])')) return true;
      if (location.search.indexOf('before=') >= 0) return true;
      return false;
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
        .then(function(){ busy = false; tickClock(); paintLive(); if (window.hzMobileTables) window.hzMobileTables(); });
    }

    function poll(){
      if (!live || busy || document.hidden) return;
      if (paused()) { paintLive('wait'); return; }
      paintLive();
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

/* 마우스를 따라다니는 툴팁 — 차트 공통 */
.tipbox{position:fixed;z-index:99;pointer-events:none;opacity:0;transform:translateY(3px);
 transition:opacity .12s ease,transform .12s ease;background:#23262e;color:#f3f4f8;
 border-radius:10px;padding:8px 11px;font-size:12px;line-height:1.5;font-weight:600;
 box-shadow:0 8px 24px rgba(20,22,30,.28);max-width:280px;white-space:pre-line;}
.tipbox.on{opacity:1;transform:translateY(0);}
.tipbox b{display:block;font-weight:800;font-size:12.5px;margin-bottom:2px;}
[data-tip]{cursor:default;}

/* 도넛 + 범례 */
.donut{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;
 display:flex;gap:18px;align-items:center;}
.donut svg{width:132px;height:132px;flex:0 0 132px;}
.donut path{transition:opacity .12s ease;}
.donut.hi path{opacity:.3;}
.donut.hi path.on{opacity:1;}
.dg{border-radius:7px;transition:background .12s ease;}
.donut.hi .dg{opacity:.45;}
.donut.hi .dg.on{opacity:1;background:#f5f2fd;}
.donut .lgd{flex:1;min-width:0;}
.dg{display:flex;align-items:baseline;gap:8px;font-size:12.5px;padding:3px 6px;margin-left:-6px;}
.dg i{width:9px;height:9px;border-radius:3px;flex:0 0 9px;display:block;position:relative;top:1px;}
.dg .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;}
.dg .pc{font-variant-numeric:tabular-nums;font-weight:800;}
.dg .vl{color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums;}
.dg a{color:inherit;text-decoration:none;}
.dg a:hover .nm{text-decoration:underline;}
@media(max-width:520px){.donut{flex-direction:column;align-items:stretch}.donut svg{align-self:center}}

/* 이상탐지 — 심각도 색은 화면 어디서나 같은 뜻으로 쓴다 */
.sev{display:inline-flex;align-items:center;gap:5px;font-weight:800;font-size:11.5px;
 border-radius:999px;padding:2px 9px;white-space:nowrap;}
.sev.critical{background:#fdecec;color:#a9313a;border:1px solid #f6cfcf;}
.sev.warn{background:#fff6e8;color:#96601a;border:1px solid #f2ddbe;}
.sev.info{background:#eef4ff;color:#2f5aa8;border:1px solid #d5e2f7;}
.srv{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--panel);
 border:1px solid var(--line);border-radius:14px;padding:13px 16px;margin-bottom:12px;}
.srv .dot{width:10px;height:10px;border-radius:50%;background:#0a7d33;flex:0 0 10px;}
.srv.down .dot{background:#c0392b;}
.srv.stale .dot{background:#E0A33B;}
.srv .t{font-weight:800;font-size:13.5px;}
.srv .sm{color:var(--muted);font-size:12px;}
.srv .jobs{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto;}
.srv .job{font-size:11.5px;font-weight:700;color:var(--muted);background:#f5f6fa;
 border:1px solid var(--line);border-radius:8px;padding:3px 8px;}
/* 아직 판정을 시작하지 못했을 때 — 조용한 화면과 구분되게 한 줄 알린다 */
.warm{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;background:#fffaf2;
 border:1px solid #f2e2c6;border-radius:14px;padding:12px 16px;margin-bottom:12px;font-size:13px;}
.warm b{font-weight:900;color:#96601a;white-space:nowrap;}
.warm span{color:var(--muted);}
.warm .sm{margin-left:auto;font-weight:700;}
@media(max-width:640px){.warm .sm{margin-left:0;}}

.srv .job.bad{background:#fdecec;border-color:#f6cfcf;color:#a9313a;}
/* 검증 에이전트 판정 태그 */
.vd{display:inline-flex;align-items:center;font-weight:800;font-size:11.5px;
 border-radius:999px;padding:2px 9px;white-space:nowrap;border:1px solid transparent;}
.vd.hit{background:#f2fbf4;color:#0a7d33;border-color:#cfe8d4;}
.vd.miss{background:#f5f6fa;color:#6b7280;border-color:#e6e9ef;}
.vd.wait{background:#fffaf2;color:#96601a;border-color:#f2e2c6;}
/* 승격 심사 결과 */
.pm{display:inline-flex;font-weight:800;font-size:11.5px;border-radius:999px;padding:2px 9px;}
.pm.up{background:#f2fbf4;color:#0a7d33;border:1px solid #cfe8d4;}
.pm.hold{background:#fff6e8;color:#96601a;border:1px solid #f2ddbe;}
.pm.off{background:#f5f6fa;color:#6b7280;border:1px solid #e6e9ef;}

/* 요약 화면의 이상탐지 칸 — 왼쪽은 지금 상태, 오른쪽은 최근에 무엇이 잡혔나 */
.anb{display:grid;grid-template-columns:236px minmax(0,1fr);gap:16px;align-items:start;
 background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:13px 15px;}
.anb .st{display:inline-flex;align-items:center;gap:7px;font-weight:800;font-size:12.5px;white-space:nowrap;}
.anb .st .dot{width:9px;height:9px;border-radius:50%;background:var(--g);flex:0 0 9px;}
.anb .st.down .dot{background:var(--r);}
.anb .st.stale .dot{background:#E0A33B;}
.sevd{display:flex;align-items:center;gap:12px;margin-top:11px;}
.sevd svg{width:88px;height:88px;flex:0 0 88px;overflow:visible;}
.sevd svg path{cursor:default;}
.sevd .cv{text-anchor:middle;font-size:19px;font-weight:900;fill:var(--ink);font-variant-numeric:tabular-nums;}
.sevd .cl{text-anchor:middle;font-size:10px;font-weight:700;fill:var(--muted);}
.sevd .lgs{min-width:0;}
.sevd .lg{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:2px 0;}
.sevd .lg i{width:9px;height:9px;border-radius:3px;flex:0 0 9px;display:block;}
.sevd .lg .nm{color:var(--muted);}
.sevd .lg b{font-size:14px;font-weight:900;font-variant-numeric:tabular-nums;}
.anb .sub{margin-top:8px;font-size:11.5px;color:var(--muted);}
.anb .sub a{color:var(--accent);font-weight:700;text-decoration:none;}
.anb .sub a:hover{text-decoration:underline;}
.anb .scroll{border-radius:10px;}
.anb table.mini{border:0;border-radius:0;background:none;font-size:12.5px;min-width:0;}
.anb table.mini th,.anb table.mini td{padding:5px 9px;white-space:nowrap;}
.anb table.mini th{background:none;padding-top:0;}
.anb table.mini tr:last-child td{border-bottom:none;}
.anb.quiet{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.anb.quiet .t{font-size:13px;font-weight:700;}
@media(max-width:860px){.anb{grid-template-columns:1fr}}

/* 보낸 메일 게시판 */
.kind{display:inline-flex;font-weight:800;font-size:11.5px;border-radius:999px;padding:2px 9px;
 border:1px solid;white-space:nowrap;}
.kind.k-an{background:#f6f1ff;color:#5E3A9E;border-color:#e5daff;}
.kind.k-tr{background:#eef7f0;color:#0a7d33;border-color:#cfe8d4;}
.kind.k-ts{background:#f5f6fa;color:#6b7280;border-color:#e6e9ef;}
table.mail tr[data-det]{cursor:pointer;}
table.mail tr[data-det]:hover td{background:#faf8ff;}
table.mail td.w{white-space:normal;max-width:520px;}
table.mail td.w .sm{margin-top:2px;display:block;line-height:1.5;}
.mailbody{background:#fafbfc;border:1px solid var(--line);border-radius:10px;padding:13px 15px;
 margin:0 0 10px;font-family:inherit;font-size:12.5px;line-height:1.8;white-space:pre-wrap;
 word-break:break-word;max-height:380px;overflow:auto;}

/* 지표 위 안내 줄 — 왼쪽은 설명, 오른쪽은 상세로 가는 링크 */
.noteline{display:flex;align-items:baseline;gap:12px;margin:16px 2px 6px;}
.noteline .sm{min-width:0;}
.noteline a{margin-left:auto;font-size:12px;font-weight:800;color:var(--accent);
 text-decoration:none;white-space:nowrap;}
.noteline a:hover{text-decoration:underline;}

/* 없는 주소 요청(404) — 종류 딱지와 판단 한 줄 */
.th{display:inline-flex;font-weight:800;font-size:11px;border-radius:999px;padding:2px 8px;
 border:1px solid;white-space:nowrap;}
.th.t-wordpress,.th.t-exploit{background:#fdecec;color:#a9313a;border-color:#f6cfcf;}
.th.t-secret{background:#fff1e8;color:#a1521a;border-color:#f5d9c4;}
.th.t-admin,.th.t-probe{background:#fff6e8;color:#96601a;border-color:#f2ddbe;}
.th.t-broken{background:#eef4ff;color:#2f5aa8;border-color:#d5e2f7;}
.th.t-other{background:#f5f6fa;color:#6b7280;border-color:#e6e9ef;}
.nfv{display:flex;flex-direction:column;gap:4px;background:var(--panel);border:1px solid var(--line);
 border-left:3px solid var(--g);border-radius:14px;padding:12px 16px;margin-bottom:12px;}
.nfv.warn{border-left-color:#E0A33B;}
.nfv b{font-size:13.5px;}
.nfv span{font-size:12.5px;color:var(--muted);line-height:1.6;}

/* 이상탐지 상세 게시판 — 가로 스크롤 없이 화면 폭에 맞춘다.
   게시판에서 옆으로 미는 건 최악이라, 칸 너비를 못박고 글이 줄바꿈하게 둔다. */
table.anb2{table-layout:fixed;width:100%;font-size:12.5px;}
table.anb2 th,table.anb2 td{white-space:normal;word-break:break-word;overflow-wrap:anywhere;
 vertical-align:top;}
table.anb2 th,table.anb2 td{padding:8px 10px;}
table.anb2 col.c-when{width:100px;}
table.anb2 col.c-sev{width:58px;}
table.anb2 col.c-sig{width:106px;}
table.anb2 col.c-app{width:100px;}
table.anb2 col.c-vd{width:116px;}
table.anb2 col.c-ml{width:56px;}
table.anb2 .vd,table.anb2 .sev{font-size:11px;padding:2px 7px;}
table.anb2 tr[data-det]{cursor:pointer;}
table.anb2 tr[data-det]:hover td{background:#faf8ff;}
table.anb2 tr[data-det].fp td{opacity:.62;}
table.anb2 td.mono{font-size:11.5px;}
table.anb2 td.w b{font-weight:700;line-height:1.55;}
table.anb2 td.w .sm{margin-top:3px;display:block;line-height:1.5;}
/* 화면이 좁아지면 표에서 덜 중요한 칸부터 접는다(내용은 펼친 줄에 다 있다) */
@media(max-width:900px){
 table.anb2 col.c-sig,table.anb2 col.c-app{width:0;}
 table.anb2 th:nth-child(3),table.anb2 td:nth-child(3),
 table.anb2 th:nth-child(4),table.anb2 td:nth-child(4){display:none;}
}
@media(max-width:620px){
 table.anb2 col.c-ml{width:0;}
 table.anb2 th:nth-child(7),table.anb2 td:nth-child(7){display:none;}
}
table.anb2 tr.det .cb{border:0;border-left:3px solid #c0392b;border-radius:0 10px 10px 0;
 background:#fff;padding:11px 14px;}
table.anb2 tr.det .cb.fp{border-left-color:#c9ced8;}
tr.hl td{background:#fff8e6 !important;}

/* 심각 신호 브리핑 — "심각 3건"만으로는 무엇을 볼지 알 수 없어서 건마다 풀어 쓴다 */
.cbs{display:grid;gap:10px;}
.cb{background:var(--panel);border:1px solid var(--line);border-left:3px solid #c0392b;
 border-radius:14px;padding:13px 16px;}
.cb.fp{border-left-color:#c9ced8;}
.cb .hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.cb .hd b{font-size:14px;}
.cb .lead{margin:9px 0 10px;font-size:13.5px;line-height:1.6;}
.cb .ln{display:flex;gap:10px;font-size:12.5px;line-height:1.6;padding:3px 0;}
.cb .ln b{flex:0 0 62px;color:var(--muted);font-weight:800;}
.cb .ln span{min-width:0;}
.cb .ln.wait span{color:var(--muted);}
.cb .acts{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px;}
.cb .lk{font-size:12px;font-weight:800;color:var(--accent);text-decoration:none;
 background:#f5f1ff;border:1px solid #e6dcff;border-radius:9px;padding:5px 10px;}
.cb .lk:hover{background:#ece4ff;}
.cb .lk.mail{background:#fff6e8;border-color:#f2ddbe;color:#96601a;}
tr.hl>td{background:#fff8e6 !important;}

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

/* 집계 표(사용량 · 지역) — 칸이 8~10개라 그냥 두면 옆으로 밀린다.
   너비를 못박아 화면 안에 넣고, 좁아지면 덜 중요한 칸(o1 → o2)부터 접는다.
   접힌 값은 같은 화면의 다른 표나 로그에서 볼 수 있어 잃는 정보가 없다. */
table.fx{table-layout:fixed;width:100%;}
table.fx th,table.fx td{white-space:normal;word-break:break-word;overflow-wrap:anywhere;
 vertical-align:middle;padding:8px 9px;}
table.fx td.n,table.fx th.n{white-space:nowrap;}
table.fx td.mono{font-size:11.5px;}
@media(max-width:1040px){table.fx .o1{display:none;}table.fx col.o1{width:0;}}
@media(max-width:860px){table.fx .o2{display:none;}table.fx col.o2{width:0;}}

/* 로그 표 — 행을 누르면 상세가 펼쳐진다 */
table.log{font-size:12.5px;}
table.log tr[data-det]{cursor:pointer;}
table.log tr[data-det]:hover td{background:#faf8ff;}
table.log td{white-space:nowrap;}
table.log td.w{white-space:normal;}

/* 호출 목록(로그 탭 · 요약 화면 최근 호출) — 칸이 11개라 그냥 두면 옆으로 밀린다.
   너비를 못박아 화면 안에 넣고, 남는 폭은 오류·메타 칸이 가져간다. */
table.calls{table-layout:fixed;width:100%;}
/* 모든 칸을 한 줄로 고정한다. 한 칸이라도 줄바꿈되면 그 줄만 높아져 오른쪽 눈금이 어긋나 보이고,
   반대로 줄바꿈을 막기만 하면 긴 값이 옆 칸 위로 넘쳐 겹친다. 넘치는 만큼은 …으로 자르고,
   자른 값은 마우스를 올리거나 줄을 펼치면 다 나온다. */
table.calls th,table.calls td{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
 vertical-align:middle;padding:8px 9px;}
/* 앱·모델만 너비를 비워 둔다. 나머지를 값이 딱 들어갈 만큼만 잡아 두면
   남는 폭이 전부 이 두 칸으로 가서 이름이 잘리지 않는다. */
table.calls col.c-ts{width:126px;}
table.calls col.c-kind{width:62px;}
table.calls col.c-st{width:52px;}
table.calls col.c-http{width:50px;}
table.calls col.c-lat{width:76px;}
table.calls col.c-tok{width:62px;}
table.calls col.c-cost{width:76px;}
table.calls col.c-geo{width:72px;}
table.calls col.c-err{width:206px;}
table.calls td.mono{font-size:11.5px;}
table.calls td.n{white-space:nowrap;}
table.calls td.err{max-width:none;font-size:11.5px;color:var(--muted);}
table.calls td.geo .sm{color:var(--muted);}
/* 화면이 좁아지면 덜 중요한 칸부터 접는다(내용은 줄을 펼치면 다 있다) */
@media(max-width:1000px){
 table.calls col.c-kind,table.calls col.c-tok{width:0;}
 table.calls th:nth-child(3),table.calls td:nth-child(3),
 table.calls th:nth-child(8),table.calls td:nth-child(8){display:none;}
}
@media(max-width:860px){
 table.calls col.c-geo{width:0;}
 table.calls th:nth-child(4),table.calls td:nth-child(4),
 table.calls th:nth-child(10),table.calls td:nth-child(10){display:none;}
}
@media(max-width:640px){
 table.calls col.c-http,table.calls col.c-cost{width:0;}
 table.calls th:nth-child(6),table.calls td:nth-child(6),
 table.calls th:nth-child(9),table.calls td:nth-child(9){display:none;}
}
tr.det td{background:#fafbfc;white-space:normal;}
.kv{display:grid;grid-template-columns:88px 1fr;gap:3px 12px;font-size:12px;}
.kv dt{color:var(--muted);font-weight:700;}
.kv dd{margin:0;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;}
.pg{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-top:12px;}
.pg .cnt{font-size:12px;color:var(--muted);}
.pg .nav{display:flex;gap:8px;}
.pg .btn.off{opacity:.4;pointer-events:none;}
a.btn{text-decoration:none;display:inline-block;color:var(--ink);}

/* 요약 맨 아래 최근 호출 — 한 줄이 접히지 않게 가로로 넓게 둔다 */
table.recent{font-size:12.5px;}
table.recent td,table.recent th{white-space:nowrap;}
table.recent td.err{max-width:260px;overflow:hidden;text-overflow:ellipsis;}
.pill{display:inline-block;font-size:11px;font-weight:800;border-radius:999px;padding:1px 8px;}
.pill.g{background:#eaf7ee;color:var(--g);}
.pill.r{background:#ffecec;color:var(--r);}

/* 표가 길 때 가로 스크롤 */
.scroll{overflow-x:auto;border-radius:14px;}
/* 줄이 계속 늘어나는 표 — 높이를 묶어 두 칸 배치가 한쪽으로 길어지지 않게 한다. */
.scroll.cap{max-height:420px;overflow-y:auto;border:1px solid var(--line);background:var(--panel);}
/* 표만 있는 칸도 같은 높이로 맞춘다 — 두 칸 배치에서 한쪽만 길어지면 아래가 어긋난다 */
.cap:not(.scroll){max-height:420px;overflow:auto;border-radius:14px;}
.cap table{border-radius:14px;}
.cap thead th{position:sticky;top:0;z-index:1;background:#fafbfc;}

/* 방문 종류 · 유입 경로 태그 — 트래픽 화면에서 쓴다 */
.kd,.rg{display:inline-flex;font-weight:800;font-size:11.5px;border-radius:999px;padding:2px 9px;white-space:nowrap;
 background:#f5f6fa;color:#6b7280;border:1px solid #e6e9ef;}
.kd.ai,.rg.ai{background:#fdeef6;color:#9c3a72;border-color:#f5d4e6;}
.kd.search,.rg.search{background:#eef4ff;color:#2f5aa8;border-color:#d5e2f7;}
.kd.social,.rg.social{background:#f0faf1;color:#2f7d3a;border-color:#d3ecd7;}
.kd.human{background:#f4f0ff;color:#5E3A9E;border-color:#e5dcfb;}
.scroll.cap table{border:none;border-radius:0;}
.scroll.cap thead th,.scroll.cap tr:first-child th{position:sticky;top:0;z-index:1;}
/* 칸이 좁아 글자가 세로로 깨지는 표 — 넘치면 가로로 민다. */
table.tight{font-size:12.5px;}
table.tight td,table.tight th{white-space:nowrap;padding:7px 10px;}
.scroll table{min-width:640px;}
.scroll.cap table{min-width:0;}

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

/* ── 연결 가이드 — 마크다운 원문을 그대로 그린다 */
.gacts{flex:0 0 auto;display:flex;gap:8px;align-items:center;}
.gnote{background:#f7f5fd;border:1px solid #ece6fb;border-radius:12px;padding:11px 14px;
 font-size:12.5px;color:#5E3A9E;font-weight:600;margin-bottom:14px;}
.gnote a{color:inherit;}
.mdx{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:26px 30px 30px;
 font-size:14px;line-height:1.75;}
.mdx h2{font-size:19px;font-weight:800;color:var(--ink);margin:30px 0 10px;padding-top:4px;letter-spacing:-.3px;}
.mdx h3{font-size:15.5px;font-weight:800;color:var(--ink);margin:22px 0 8px;}
.mdx h4{font-size:14px;font-weight:800;color:var(--muted);margin:18px 0 6px;}
.mdx > h2:first-child,.mdx > h3:first-child{margin-top:0;}
.mdx p{margin:0 0 12px;}
.mdx ul,.mdx ol{margin:0 0 13px;padding-left:22px;}
.mdx li{margin-bottom:5px;}
.mdx hr{border:0;border-top:1px solid var(--line);margin:26px 0;}
.mdx code{background:#f4f2fa;border:1px solid #ece6fb;border-radius:5px;padding:1px 5px;
 font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;word-break:break-all;}
.mdx pre.cb{background:#1f2430;color:#e8eaf2;border-radius:12px;padding:15px 17px;overflow-x:auto;
 margin:0 0 14px;line-height:1.65;}
.mdx pre.cb code{background:none;border:0;padding:0;color:inherit;font-size:12.5px;white-space:pre;word-break:normal;}
.mdx blockquote{margin:0 0 14px;padding:12px 16px;background:#fffaf2;border:1px solid #f2e2c6;
 border-left:3px solid #E0A33B;border-radius:10px;}
.mdx blockquote p{margin:0 0 8px;font-size:13px;}
.mdx blockquote p:last-child{margin:0;}
.mdx table{font-size:13px;margin-bottom:14px;}
.mdx .scroll{margin-bottom:14px;}
.mdx td,.mdx th{vertical-align:top;}
.mdx a{color:var(--accent);}
@media(max-width:640px){.mdx{padding:18px 16px 22px;}.gacts{width:100%;}}

/* ─────────────────────────────────────────────────────────────
   좁은 화면(휴대폰) — 표를 카드로 편다.

   칸이 8~11개인 표를 휴대폰 폭에 밀어 넣으면 글자가 한 자씩 세로로 쌓이거나
   칸이 서로 겹친다. 폭을 줄여서 될 일이 아니라서, 좁아지면 표 모양을 버리고
   줄 하나를 카드 한 장으로 세워 "이름 — 값"으로 읽게 한다.
   칸 이름은 화면을 그릴 때 머리글에서 읽어 각 칸에 붙여 둔다(ADMIN_JS).
   ───────────────────────────────────────────────────────────── */
@media(max-width:640px){
 .wrap{padding:16px 12px 60px;}
 h1{font-size:20px;}
 .head{gap:10px;}
 .clock{gap:8px;}
 .clock .t{font-size:15px;}
 .tabs{gap:6px;margin-bottom:10px;}
 .tab{font-size:12px;padding:6px 11px;}
 .sh2{flex-wrap:wrap;gap:4px;margin:20px 0 8px;}
 .sh2 h2{font-size:15px;}
 .kpi2{grid-template-columns:repeat(2,1fr);gap:8px;}
 .m{padding:9px 11px;}
 .m .v{font-size:15px;}
 .two{gap:12px;}
 .noteline{flex-wrap:wrap;gap:4px;}
 .noteline a{margin-left:0;}

 /* 표 → 카드 */
 table.mbc{display:block;border:0;background:none;border-radius:0;overflow:visible;}
 table.mbc colgroup,table.mbc thead,table.mbc tr.mb-hdr{display:none;}
 table.mbc tbody{display:block;}
 table.mbc tr{display:block;background:var(--panel);border:1px solid var(--line);
  border-radius:12px;padding:7px 12px;margin-bottom:8px;}
 table.mbc tr:last-child{margin-bottom:0;}
 table.mbc td{display:flex !important;gap:10px;align-items:baseline;justify-content:space-between;
  border:0;border-bottom:1px solid #f2f3f7;padding:5px 0;white-space:normal !important;
  overflow:visible !important;text-overflow:clip !important;text-align:left;
  max-width:none !important;font-size:12.5px;line-height:1.5;word-break:break-word;}
 table.mbc td:last-child{border-bottom:0;}
 table.mbc td::before{content:attr(data-l);color:var(--muted);font-size:11px;font-weight:800;
  flex:0 0 auto;white-space:nowrap;}
 table.mbc td.mb-empty{display:none !important;}
 /* 첫 칸은 그 줄의 제목처럼 크게 */
 table.mbc td.mb-key{font-weight:800;font-size:13.5px;padding-top:2px;}
 table.mbc td.mb-key::before{display:none;}
 /* 펼쳐지는 상세 줄과 "기록이 없어요" 같은 안내 줄은 그대로 한 덩이로 둔다 */
 table.mbc tr.det td,table.mbc tr.mb-wide td{display:block !important;padding:4px 0;}
 table.mbc tr.det td::before,table.mbc tr.mb-wide td::before{display:none;}
 table.mbc tr.det{background:#fafbfc;}
 .scroll{overflow-x:visible;}
 .scroll.cap,.cap:not(.scroll){max-height:none;overflow:visible;border:0;background:none;}

 /* 카드 안에서는 접어 뒀던 칸도 다시 보여준다 — 세로라 자리가 넉넉하다 */
 table.mbc td.o1,table.mbc td.o2{display:flex !important;}

 /* 요약 화면의 이상탐지·트래픽 칸 */
 .anb{padding:11px 12px;}
 .anb .nums{grid-template-columns:repeat(3,1fr);}
 .sevd{gap:10px;}
 .sevd svg{width:76px;height:76px;flex:0 0 76px;}
 /* 판정 카드 */
 .cb{padding:11px 12px;}
 .cb .ln{flex-direction:column;gap:2px;}
 .cb .ln b{flex:none;}
 /* 로그 검색 폼 */
 .flt{padding:12px;}
 .quick a{font-size:11.5px;padding:4px 9px;}
 /* 메일 본문 */
 .mailbody{font-size:11.5px;padding:11px 12px;}
}
@media(max-width:400px){
 .kpi2{grid-template-columns:1fr;}
 .anb .nums{grid-template-columns:repeat(2,1fr);}
}
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

// 가이드 원문 전체 복사 — 파일로 받지 않고 채팅에 바로 붙여넣을 때 쓴다.
document.addEventListener("click", function(e){
  var b = e.target && e.target.closest ? e.target.closest("#g-copy") : null;
  if (!b) return;
  var ta = document.getElementById("g-src");
  if (!ta) return;
  var say = function(msg){ b.textContent = msg; setTimeout(function(){ b.textContent = "전체 복사"; }, 1800); };
  var done = function(){ say("복사했어요"); };
  var fail = function(){ say("복사하지 못했어요"); };
  var fallback = function(){
    var tmp = document.createElement("textarea");
    tmp.value = ta.value; tmp.style.position = "fixed"; tmp.style.opacity = "0";
    document.body.appendChild(tmp); tmp.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (err) {}
    tmp.remove();
    if (ok) done(); else fail();
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(ta.value).then(done, fallback);
  else fallback();
});

// 차트 툴팁 — data-tip이 붙은 요소에 마우스를 올리면 커서를 따라다니는 상자를 띄운다.
// 첫 줄은 제목처럼 굵게 나온다. 브라우저 기본 title은 뜨는 데 1초쯤 걸려서 직접 그린다.
(function(){
  var box = null, cur = null;
  function ensure(){
    if (!box) { box = document.createElement('div'); box.className = 'tipbox'; document.body.appendChild(box); }
    return box;
  }
  function place(x, y){
    var b = ensure(), w = b.offsetWidth, h = b.offsetHeight;
    var left = x + 14, top = y + 16;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (left < 8) left = 8;
    if (top + h > window.innerHeight - 8) top = y - h - 14;
    if (top < 8) top = 8;
    b.style.left = left + 'px'; b.style.top = top + 'px';
  }
  function hide(){
    cur = null;
    if (box) box.classList.remove('on');
    var d = document.querySelectorAll('.donut.hi');
    for (var k = 0; k < d.length; k++) d[k].classList.remove('hi');
    var o = document.querySelectorAll('.on[data-seg]');
    for (var j = 0; j < o.length; j++) o[j].classList.remove('on');
  }
  function mark(el){
    // 도넛 — 조각이든 범례든, 같은 번호끼리 함께 강조한다.
    var dn = el.closest ? el.closest('.donut') : null;
    var seg = el.getAttribute('data-seg');
    if (!dn || seg === null) return;
    dn.classList.add('hi');
    var same = dn.querySelectorAll('[data-seg="' + seg + '"]');
    for (var k = 0; k < same.length; k++) same[k].classList.add('on');
  }
  document.addEventListener('mouseover', function(e){
    var t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!t) { if (cur) hide(); return; }
    if (t === cur) return;
    hide();
    cur = t;
    var txt = t.getAttribute('data-tip') || '';
    var i = txt.indexOf('\\n');
    var b = ensure();
    b.innerHTML = '';
    var head = document.createElement('b');
    head.textContent = i < 0 ? txt : txt.slice(0, i);
    b.appendChild(head);
    if (i >= 0) b.appendChild(document.createTextNode(txt.slice(i + 1)));
    b.classList.add('on');
    place(e.clientX, e.clientY);
    mark(t);
  }, true);
  document.addEventListener('mousemove', function(e){ if (cur) place(e.clientX, e.clientY); }, true);
  document.addEventListener('mouseout', function(e){
    if (!cur) return;
    var to = e.relatedTarget;
    if (to && to.closest && to.closest('[data-tip]') === cur) return;
    hide();
  }, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
})();

// 다른 화면에서 "메일 보기 →"·"자세히 보기 →"로 건너오면 그 줄을 펼쳐서 보여준다.
(function(){
  var m = (location.hash || '').match(/^#([ma])-(\d+)$/);
  if (!m) return;
  var key = m[1] + '-' + m[2];
  var tr = document.getElementById(key);
  if (!tr) return;
  var d = document.getElementById('det-' + m[1] + m[2]);
  if (d) d.hidden = false;
  tr.classList.add('hl');
  tr.scrollIntoView({block: 'center'});
  setTimeout(function(){ tr.classList.remove('hl'); }, 2600);
})();

// 좁은 화면에서 표를 카드로 펴기 위한 밑작업.
//
// 칸이 여덟 개 넘는 표를 휴대폰 폭에 밀어 넣으면 글자가 세로로 쌓이거나 칸끼리 겹친다.
// CSS만으로는 각 값이 무슨 칸인지 알려 줄 수 없어서, 머리글의 칸 이름을 읽어
// 같은 자리의 칸에 data-l로 붙여 둔다. 좁아지면 CSS가 그 이름을 앞에 찍어 준다.
// 넓은 화면에서는 아무것도 달라지지 않는다.
window.hzMobileTables = function(){
  var tables = document.querySelectorAll('table');
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    // 히트맵(요일×시각)과 요약 칸의 작은 표는 원래 모양이 더 읽기 좋다.
    if (t.closest('.hm') || t.classList.contains('mini') || t.classList.contains('mb-skip')) continue;

    var head = t.querySelector('thead tr');
    if (!head) {
      var first = t.querySelector('tr');
      if (first && first.querySelector('th')) head = first;
    }
    if (!head) continue;
    head.classList.add('mb-hdr');

    var names = [];
    for (var h = 0; h < head.children.length; h++) {
      var span = parseInt(head.children[h].getAttribute('colspan') || '1', 10);
      var text = (head.children[h].textContent || '').trim();
      for (var s2 = 0; s2 < span; s2++) names.push(s2 === 0 ? text : '');
    }

    var rows = t.querySelectorAll('tr');
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (row === head || row.classList.contains('mb-hdr')) continue;
      var cells = row.children;
      // 칸 하나가 표 전체를 차지하는 줄(펼친 상세·"기록이 없어요")은 통째로 둔다.
      if (cells.length === 1) { row.classList.add('mb-wide'); continue; }
      for (var c = 0; c < cells.length; c++) {
        var cell = cells[c];
        if (cell.tagName !== 'TD') continue;
        var name = names[c] || '';
        if (name) cell.setAttribute('data-l', name);
        var val = (cell.textContent || '').trim();
        // 값이 비었거나 '-' 한 글자면 카드에서는 줄만 차지한다.
        if (!val || val === '-') cell.classList.add('mb-empty');
        else cell.classList.remove('mb-empty');
        if (c === 0) cell.classList.add('mb-key');
      }
    }
    t.classList.add('mbc');
  }
};
window.hzMobileTables();

// 토큰 보기/가리기 — 평소엔 가운데를 가려 둔다.
document.addEventListener('click', function(e){
  var b = e.target && e.target.closest ? e.target.closest('[data-reveal]') : null;
  if (!b) return;
  var w = b.closest('.tok');
  if (!w) return;
  b.textContent = w.classList.toggle('open') ? '가리기' : '보기';
});

// 패스키(WebAuthn) — 로그인 화면의 '패스키로 로그인', 앱 관리 화면의 '이 기기 등록'.
// 브라우저는 값을 ArrayBuffer로 주고받으므로 base64url로 바꿔 서버와 오간다.
(function(){
  var login = document.getElementById('pk-login');
  var add = document.getElementById('pk-add');
  if (!login && !add) return;

  function b64u(buf){
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    var t = btoa(s).split('+').join('-').split('/').join('_');
    while (t.charAt(t.length - 1) === '=') t = t.slice(0, -1);
    return t;
  }
  function bin(s){
    var p = String(s).split('-').join('+').split('_').join('/');
    while (p.length % 4) p += '=';
    var raw = atob(p), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function say(msg){
    var e = document.getElementById('pk-err');
    if (!e) { if (msg) alert(msg); return; }
    if (!msg) { e.hidden = true; return; }
    e.textContent = msg; e.hidden = false;
  }
  function post(path, body){
    return fetch('/admin/api/passkey/' + path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){ return { ok: r.ok, j: j }; });
    });
  }
  // 사용자가 창을 닫거나 취소한 경우(NotAllowedError)는 오류가 아니라 그냥 그만둔 것이다.
  function reason(e, fallback){
    if (e && e.name === 'NotAllowedError') return '';
    return (e && e.message) || fallback;
  }
  var supported = !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.get);

  if (login) {
    if (!supported) login.disabled = true;
    login.addEventListener('click', function(){
      say('');
      var lb = login.querySelector('span');
      var was = lb ? lb.textContent : '';
      login.disabled = true;
      if (lb) lb.textContent = '기기 확인 중…';
      var stop = function(msg){ login.disabled = false; if (lb) lb.textContent = was; say(msg); };
      post('login/options').then(function(r){
        if (!r.ok) throw new Error(r.j.error || '준비하지 못했어요.');
        return navigator.credentials.get({ publicKey: {
          challenge: bin(r.j.challenge),
          rpId: r.j.rpId,
          userVerification: r.j.userVerification,
          timeout: 60000
        }});
      }).then(function(c){
        return post('login/verify', {
          id: c.id,
          clientDataJSON: b64u(c.response.clientDataJSON),
          authenticatorData: b64u(c.response.authenticatorData),
          signature: b64u(c.response.signature)
        });
      }).then(function(r){
        if (!r.ok) throw new Error(r.j.error || '확인하지 못했어요.');
        var nx = document.querySelector('input[name=next]');
        location.href = (nx && nx.value) || '/admin';
      }).catch(function(e){ stop(reason(e, '패스키로 로그인하지 못했어요.')); });
    });
  }

  if (add) {
    add.addEventListener('click', function(){
      say('');
      if (!supported || !navigator.credentials.create) { say('이 브라우저는 패스키를 지원하지 않아요.'); return; }
      var label = prompt('이 기기를 뭐라고 부를까요?', '내 기기');
      if (label === null) return;
      var was = add.textContent;
      add.disabled = true; add.textContent = '등록 중…';
      var stop = function(msg){ add.disabled = false; add.textContent = was; say(msg); };
      post('register/options').then(function(r){
        if (!r.ok) throw new Error(r.j.error || '준비하지 못했어요.');
        var o = r.j;
        return navigator.credentials.create({ publicKey: {
          challenge: bin(o.challenge),
          rp: o.rp,
          user: { id: bin(o.user.id), name: o.user.name, displayName: o.user.displayName },
          pubKeyCredParams: o.pubKeyCredParams,
          excludeCredentials: (o.excludeCredentials || []).map(function(c){
            return { type: 'public-key', id: bin(c.id) };
          }),
          authenticatorSelection: o.authenticatorSelection,
          timeout: 60000
        }});
      }).then(function(c){
        var res = c.response;
        // getPublicKey()가 SPKI 공개키를 그대로 준다. 없으면 서버가 CBOR을 풀어야 하는데 그 길은 두지 않았다.
        var pub = res.getPublicKey ? res.getPublicKey() : null;
        if (!pub) throw new Error('이 브라우저는 패스키 등록에 필요한 정보를 주지 않아요.');
        return post('register/verify', {
          id: c.id,
          publicKey: b64u(pub),
          alg: res.getPublicKeyAlgorithm ? res.getPublicKeyAlgorithm() : -7,
          clientDataJSON: b64u(res.clientDataJSON),
          label: label
        });
      }).then(function(r){
        if (!r.ok) throw new Error(r.j.error || '등록하지 못했어요.');
        location.href = '/admin/apps?msg=' + encodeURIComponent('패스키를 등록했어요.');
      }).catch(function(e){ stop(reason(e, '패스키를 등록하지 못했어요.')); });
    });
  }
})();
`;

// ─────────────────────────────────────────────────────────────
// 바깥 틀
// ─────────────────────────────────────────────────────────────

/** 상단바 메뉴 키. */
export type TabKey = "summary" | "usage" | "trend" | "geo" | "anomaly" | "traffic" | "logs" | "apps" | "guide";

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
	{ key: "anomaly", href: "/admin/anomaly", label: "이상탐지" },
	{ key: "traffic", href: "/admin/traffic", label: "트래픽" },
	{ key: "logs", href: "/admin/logs", label: "로그" },
	{ key: "apps", href: "/admin/apps", label: "앱 관리" },
	{ key: "guide", href: "/admin/guide", label: "가이드" },
];

export function shellAdmin(title: string, body: string, opts: AdminOpts = {}): string {
	const nav = NAV.map(
		(n) => `<a href="${n.href}"${opts.tab === n.key ? ' class="on"' : ""}>${n.label}</a>`,
	).join("");
	const topbar = opts.bare
		? ""
		: `<header class="topbar"><div class="in">
  <span class="bd"><i></i><span>AI Service</span></span>
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
export function renderLogin(
	opts: { error?: string; user?: string; next?: string; passkey?: boolean } = {},
): string {
	// 패스키 버튼은 등록된 기기가 있을 때만 띄운다. 눌러도 아무 일이 없는 버튼은 두지 않는다.
	const pk = opts.passkey
		? `<button type="button" class="btn pk" id="pk-login">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 7a4 4 0 1 0-3.6 3.98L10 12.4V14H8.6L7 15.6V18h3.5l4.9-4.9A4 4 0 0 0 15 7Zm1.6 1.4a1.2 1.2 0 1 1-1.7 1.7 1.2 1.2 0 0 1 1.7-1.7Z"/></svg>
    <span>패스키로 로그인</span></button>
  <div class="or"><span>또는 비밀번호</span></div>`
		: "";

	return shellAdmin(
		"로그인",
		`<main class="login"><form class="box" method="post" action="/admin/login">
  <div class="mark">AI</div>
  <h1>AI Service 관리</h1>
  <p class="sub">호출 통계와 앱 토큰을 관리하는 화면이에요.</p>
  ${opts.error ? `<div class="err">${escapeHtml(opts.error)}</div>` : ""}
  <div class="err" id="pk-err" hidden></div>
  <input type="hidden" name="next" value="${escapeHtml(opts.next ?? "/admin")}">
  ${pk}
  <div class="fld"><label>아이디</label>
    <input name="user" value="${escapeHtml(opts.user ?? "")}" autocomplete="username" autocapitalize="none"${opts.passkey ? "" : " autofocus"} required></div>
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
	opts: { key?: string; allLabel?: string; extra?: string } = {},
): string {
	const key = opts.key ?? "app";
	// extra는 이 화면이 기간·앱 말고도 물고 다녀야 하는 조건이다(예: 이상탐지 갈래).
	const q = (p: string, a: string) =>
		`${path}?period=${p}${a ? `&${key}=${encodeURIComponent(a)}` : ""}${opts.extra ?? ""}`;
	const periodTabs = Object.entries(periods)
		.map(([k, v]) => `<a class="tab${k === period ? " on" : ""}" href="${q(k, appFilter)}">${v.label}</a>`)
		.join("");
	const appTabs =
		`<a class="tab${!appFilter ? " on" : ""}" href="${q(period, "")}">${escapeHtml(opts.allLabel ?? "전체 앱")}</a>` +
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
/** 도넛 툴팁 문구 — 첫 줄은 이름, 다음 줄에 건수·비중·부가 정보. */
function donutTip(it: { label: string; value: number; sub?: string }, total: number, unit: string): string {
	const pct = ((it.value / total) * 100).toFixed(1);
	return `${it.label}\n${it.value.toLocaleString()}${unit} · 전체의 ${pct}%${it.sub ? `\n${it.sub}` : ""}`;
}

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
			? `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${SHARE_COLORS[0]}" stroke-width="${R - r}" data-seg="0" data-tip="${escapeHtml(donutTip(items[0], total, unit))}"/>`
			: items
					.map((it, i) => {
						const ang = (it.value / total) * Math.PI * 2;
						const a0 = acc;
						const a1 = acc + ang;
						acc = a1;
						const large = ang > Math.PI ? 1 : 0;
						const d = `M ${pt(a0, R)} A ${R} ${R} 0 ${large} 1 ${pt(a1, R)} L ${pt(a1, r)} A ${r} ${r} 0 ${large} 0 ${pt(a0, r)} Z`;
						const tip = donutTip(it, total, unit);
						return `<path d="${d}" fill="${SHARE_COLORS[i % SHARE_COLORS.length]}" data-seg="${i}" data-tip="${escapeHtml(tip)}"/>`;
					})
					.join("");

	const legend = items
		.map((it, i) => {
			const pct = (it.value / total) * 100;
			const inner =
				`<i style="background:${SHARE_COLORS[i % SHARE_COLORS.length]}"></i>` +
				`<span class="nm">${escapeHtml(it.label)}</span>` +
				`<span class="pc">${pct.toFixed(pct < 10 ? 1 : 0)}%</span>` +
				`<span class="vl">${it.value.toLocaleString()}${unit}${it.sub ? ` · ${escapeHtml(it.sub)}` : ""}</span>`;
			const href = (it as { href?: string }).href;
			return `<div class="dg" data-seg="${i}" data-tip="${escapeHtml(donutTip(it, total, unit))}">` +
				`${href ? `<a href="${href}" style="display:contents">${inner}</a>` : inner}</div>`;
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
			return `<td><span class="c" style="background:${bg}" data-tip="${escapeHtml(`${wd}요일 ${h}시\n호출 ${n.toLocaleString()}건`)}"></span></td>`;
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
			const title = `${d.b}\n호출 ${d.total.toLocaleString()}건 (성공 ${d.ok.toLocaleString()} · 실패 ${d.error.toLocaleString()})\n토큰 ${d.tokens.toLocaleString()} · 비용 ${usd(d.cost)}`;
			return `<g class="bg" data-tip="${escapeHtml(title)}">` +
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

/**
 * 심각도 누적 막대 — 이상 신호가 언제 몇 건 잡혔는지 본다.
 * 값이 작아 꺾은선을 얹을 게 없으므로 추이 차트보다 단순하게 그린다.
 */
export function svgLevels(
	buckets: { b: string; critical: number; warn: number; info: number; total: number }[],
): string {
	const data = buckets.slice(0, 40).slice().reverse();
	if (!data.length) return `<div class="empty">이 기간에 잡힌 이상 신호가 없어요.</div>`;

	const W = 1000, H = 200, L = 44, R = 16, T = 14, B = 30;
	const iw = W - L - R, ih = H - T - B;
	const max = niceMax(Math.max(...data.map((d) => d.total), 1));
	const bw = Math.max(3, Math.min(46, (iw / data.length) * 0.62));
	const cx = (i: number) => L + (iw / data.length) * (i + 0.5);

	const grid = [0, 0.25, 0.5, 0.75, 1]
		.map((f) => {
			const y = T + ih - f * ih;
			return `<line x1="${L}" y1="${y.toFixed(1)}" x2="${L + iw}" y2="${y.toFixed(1)}" class="gl"/>` +
				`<text x="${L - 8}" y="${(y + 4).toFixed(1)}" class="ax end">${shortNum(Math.round(max * f))}</text>`;
		})
		.join("");

	const bars = data
		.map((d, i) => {
			const x = cx(i) - bw / 2;
			let y = T + ih;
			const seg = (n: number, cls: string) => {
				if (!n) return "";
				const h = Math.max((n / max) * ih, 1.5);
				y -= h;
				return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="${cls}"/>`;
			};
			const body = seg(d.info, "lv-i") + seg(d.warn, "lv-w") + seg(d.critical, "lv-c");
			const tip = `${d.b}\n이상 ${d.total.toLocaleString()}건\n심각 ${d.critical} · 주의 ${d.warn} · 참고 ${d.info}`;
			return `<g class="bg" data-tip="${escapeHtml(tip)}">` +
				`<rect x="${x.toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${ih}" class="hit"/>${body}</g>`;
		})
		.join("");

	const step = Math.max(1, Math.ceil(data.length / 9));
	const xlab = data
		.map((d, i) => (i % step === 0 || i === data.length - 1
			? `<text x="${cx(i).toFixed(1)}" y="${H - 9}" class="ax mid">${escapeHtml(d.b.replace(/^\d{4}-/, ""))}</text>`
			: ""))
		.join("");

	return `<div class="chart lvl">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="기간별 이상 신호">
${grid}${bars}${xlab}
</svg>
<div class="lg"><span class="k"><i class="s-c"></i>심각</span><span class="k"><i class="s-w"></i>주의</span><span class="k"><i class="s-i"></i>참고</span></div>
</div>`;
}

/**
 * 방문 누적 막대 — 사람 · 검색 크롤러 · AI 크롤러를 한 칸에 쌓는다.
 * 사람만 보면 SEO·AEO가 도는지 알 수 없고, 크롤러만 보면 성과인지 알 수 없어 함께 놓는다.
 */
export function svgTraffic(
	buckets: { b: string; human: number; ai: number; search: number; other: number; total: number }[],
): string {
	const data = buckets.slice(0, 40).slice().reverse();
	if (!data.length) return `<div class="empty">이 기간에 들어온 방문 기록이 없어요.</div>`;

	const W = 1000, H = 200, L = 44, R = 16, T = 14, B = 30;
	const iw = W - L - R, ih = H - T - B;
	const max = niceMax(Math.max(...data.map((d) => d.total), 1));
	const bw = Math.max(3, Math.min(46, (iw / data.length) * 0.62));
	const cx = (i: number) => L + (iw / data.length) * (i + 0.5);

	const grid = [0, 0.25, 0.5, 0.75, 1]
		.map((f) => {
			const y = T + ih - f * ih;
			return `<line x1="${L}" y1="${y.toFixed(1)}" x2="${L + iw}" y2="${y.toFixed(1)}" class="gl"/>` +
				`<text x="${L - 8}" y="${(y + 4).toFixed(1)}" class="ax end">${shortNum(Math.round(max * f))}</text>`;
		})
		.join("");

	const bars = data
		.map((d, i) => {
			const x = cx(i) - bw / 2;
			let y = T + ih;
			const seg = (n: number, cls: string) => {
				if (!n) return "";
				const h = Math.max((n / max) * ih, 1.5);
				y -= h;
				return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="${cls}"/>`;
			};
			const body = seg(d.other, "tr-o") + seg(d.search, "tr-s") + seg(d.ai, "tr-a") + seg(d.human, "tr-h");
			const tip = `${d.b}\n방문 ${d.total.toLocaleString()}건\n사람 ${d.human} · AI 크롤러 ${d.ai} · 검색 크롤러 ${d.search} · 기타 ${d.other}`;
			return `<g class="bg" data-tip="${escapeHtml(tip)}">` +
				`<rect x="${x.toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${ih}" class="hit"/>${body}</g>`;
		})
		.join("");

	const step = Math.max(1, Math.ceil(data.length / 9));
	const xlab = data
		.map((d, i) => (i % step === 0 || i === data.length - 1
			? `<text x="${cx(i).toFixed(1)}" y="${H - 9}" class="ax mid">${escapeHtml(d.b.replace(/^\d{4}-/, ""))}</text>`
			: ""))
		.join("");

	return `<div class="chart lvl">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="기간별 방문">
${grid}${bars}${xlab}
</svg>
<div class="lg"><span class="k"><i class="s-h"></i>사람</span><span class="k"><i class="s-a"></i>AI 크롤러</span><span class="k"><i class="s-s"></i>검색 크롤러</span><span class="k"><i class="s-o"></i>기타 봇</span></div>
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
			const tip = `${r.label}\n${r.value.toLocaleString()}${unitLabel} · 전체의 ${pct.toFixed(1)}%${r.sub ? `\n${r.sub}` : ""}`;
			return `<div class="sh" data-tip="${escapeHtml(tip)}"><div class="sh-t"><span>${escapeHtml(r.label)}</span>` +
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
			const title = `${countryName(p.country)}${p.city && p.city !== "-" ? ` · ${p.city}` : ""}\n호출 ${p.total.toLocaleString()}건 · 고유 IP ${p.ips.toLocaleString()}\n비용 ${usd(p.cost)}`;
			return `<g class="bub" data-tip="${escapeHtml(title)}">` +
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

/**
 * F1 흐름 — 재학습할 때마다 잰 성적을 시간순 꺾은선으로 본다.
 * 규칙과 모델을 같은 자에 올려 두면 "모델이 규칙을 언제 넘어섰나"가 한눈에 잡힌다.
 */
export function svgF1(
	rows: { ran_at: number; detector: string; version: string | null; f1: number; precision: number; recall: number }[],
): string {
	if (rows.length < 2) return `<div class="empty">채점 기록이 아직 모자라요. 두 번 이상 재학습하면 흐름이 그려져요.</div>`;

	const W = 1000, H = 200, L = 44, R = 16, T = 14, B = 30;
	const iw = W - L - R, ih = H - T - B;
	const series = ["rule", "model"].map((d) => ({
		key: d,
		label: d === "rule" ? "규칙" : "모델",
		color: d === "rule" ? "#925FF0" : "#C85A95",
		pts: rows.filter((r) => r.detector === d),
	})).filter((s) => s.pts.length > 0);
	if (!series.length) return `<div class="empty">채점 기록이 없어요.</div>`;

	const times = rows.map((r) => r.ran_at);
	const t0 = Math.min(...times), t1 = Math.max(...times);
	const span = Math.max(1, t1 - t0);
	const x = (t: number) => L + ((t - t0) / span) * iw;
	const y = (f: number) => T + ih - Math.max(0, Math.min(1, f)) * ih;

	const grid = [0, 0.25, 0.5, 0.75, 1]
		.map((f) => {
			const yy = y(f);
			return `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${L + iw}" y2="${yy.toFixed(1)}" class="gl"/>` +
				`<text x="${L - 8}" y="${(yy + 4).toFixed(1)}" class="ax end">${Math.round(f * 100)}%</text>`;
		})
		.join("");

	const body = series
		.map((s) => {
			const pts = s.pts.map((r) => `${x(r.ran_at).toFixed(1)},${y(r.f1).toFixed(1)}`).join(" ");
			const dots = s.pts
				.map((r) => {
					const tip = `${s.label} · ${r.version ?? "-"}\nF1 ${(r.f1 * 100).toFixed(1)}%` +
						`\n정밀도 ${(r.precision * 100).toFixed(1)}% · 재현율 ${(r.recall * 100).toFixed(1)}%`;
					return `<circle cx="${x(r.ran_at).toFixed(1)}" cy="${y(r.f1).toFixed(1)}" r="3.2"` +
						` fill="#fff" stroke="${s.color}" stroke-width="1.8" data-tip="${escapeHtml(tip)}"/>`;
				})
				.join("");
			return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2"` +
				` stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
		})
		.join("");

	const lab = (t: number) => kst(t).slice(0, 11);
	const xlab = `<text x="${L}" y="${H - 9}" class="ax">${escapeHtml(lab(t0))}</text>` +
		`<text x="${L + iw}" y="${H - 9}" class="ax end">${escapeHtml(lab(t1))}</text>`;

	const legend = series
		.map((s) => `<span class="k"><i style="background:${s.color}"></i>${s.label}</span>`)
		.join("");

	return `<div class="chart lvl">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="F1 흐름">
${grid}${body}${xlab}
</svg>
<div class="lg">${legend}</div>
</div>`;
}
