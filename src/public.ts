/**
 * 공개 페이지 두 장 — 소개(/)와 개인정보처리방침(/privacy).
 *
 * 이 서버는 원래 관리 화면뿐이라 공개 페이지가 없었다. 두 장을 둔 이유는 하나다 —
 * 구글 OAuth 동의 화면을 '프로덕션'으로 올리려면 같은 도메인의 홈페이지 주소와
 * 개인정보처리방침 주소가 있어야 한다. 테스트 상태로 두면 AdMob 수익을 읽어 오는
 * refresh token 이 이레마다 죽어서, 어느 날 수치가 조용히 멈춘다.
 *
 * 관리 화면 스타일(ui.ts)을 끌어오지 않는다. 그쪽은 로그인한 사람을 위한 틀이라
 * 상단바·자동 갱신·토스트가 함께 딸려 온다. 여기는 글 몇 줄이면 된다.
 */

const CONTACT = "zerolive7@gmail.com";

/** 색인은 막는다 — 남에게 알릴 서비스가 아니라 주소가 있어야 해서 둔 페이지다. */
const SHELL = (title: string, body: string) => `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="robots" content="noindex,nofollow">
<style>
:root{--ink:#1c1f23;--muted:#6b7280;--line:#e6e9ef;--accent:#925ff0;--bg:#f6f7fb;--panel:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);line-height:1.75;
 font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",Inter,sans-serif;}
main{max-width:660px;margin:0 auto;padding:56px 20px 80px;}
.mark{display:flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:-.3px;margin-bottom:26px;}
.mark i{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#c85a95);display:block;}
h1{font-size:26px;letter-spacing:-.5px;margin:0 0 10px;}
h2{font-size:15px;margin:30px 0 6px;}
p{margin:0 0 12px;font-size:15px;}
ul{margin:0 0 12px;padding-left:20px;font-size:15px;}
li{margin-bottom:5px;}
.lead{color:var(--muted);font-size:15px;margin-bottom:24px;}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px 24px;}
.btn{display:inline-block;margin-top:8px;padding:10px 18px;border-radius:12px;background:var(--accent);
 color:#fff;text-decoration:none;font-weight:700;font-size:15px;}
a{color:var(--accent);}
footer{margin-top:28px;font-size:12.5px;color:var(--muted);}
footer a{color:var(--muted);}
</style></head><body><main>
<div class="mark"><i></i><span>AI Service</span></div>
${body}
</main></body></html>`;

/** 로그인하지 않은 사람이 ai.zerolive.co.kr 을 열었을 때. */
export function renderPublicHome(): string {
	return SHELL(
		"AI Service",
		`<div class="card">
<h1>AI Service</h1>
<p class="lead">zerolive 가 자기 서비스들을 한곳에서 보려고 만든 관리 도구예요.
누구나 쓰는 서비스가 아니라 관리자 한 명만 쓰는 화면이라, 가입이나 로그인 계정을 따로 드리지 않아요.</p>
<p>하는 일은 넷이에요 — 내가 만든 앱들의 AI 호출을 중계하면서 비용과 실패를 집계하고,
서비스 방문 기록을 모아 검색·AI 크롤러가 다녀갔는지 보고, 평소와 다른 움직임을 알려 주고,
App Store·AdMob 에서 다운로드와 수익을 받아와 함께 놓아요.</p>
<a class="btn" href="/admin">관리 화면 열기</a>
</div>
<footer><a href="/privacy">개인정보처리방침</a> &nbsp;·&nbsp; <a href="mailto:${CONTACT}">${CONTACT}</a></footer>`,
	);
}

/**
 * 개인정보처리방침.
 *
 * 구글 동의 화면에서 이 주소를 건다. 그래서 "구글 계정으로 무엇을 가져가는가"를
 * 맨 앞에 적는다 — 읽는 사람이 그걸 확인하려고 들어오기 때문이다.
 */
export function renderPrivacyPage(): string {
	return SHELL(
		"개인정보처리방침 — AI Service",
		`<div class="card">
<h1>개인정보처리방침</h1>
<p class="lead">마지막 갱신 2026-09-23 · 운영 zerolive (개인)</p>

<p>이 화면은 zerolive 개인이 자기 서비스를 보려고 만든 관리 도구예요.
가입 기능이 없고 관리자 한 명만 씁니다. 그래서 남의 개인정보를 받는 자리가 없어요.</p>

<h2>구글 계정으로 무엇을 가져가나요</h2>
<p>AdMob 광고 수익을 화면에 보여 주려고 <b>읽기 전용 권한 두 가지</b>만 요청해요.</p>
<ul>
<li><code>admob.readonly</code> — 등록된 앱 목록을 읽어요</li>
<li><code>admob.report</code> — 날짜·앱별 수익과 노출 수를 읽어요</li>
</ul>
<p>AdMob 설정을 바꾸거나 광고를 만들지 않아요. 쓰기 권한은 요청하지 않아요.
구글 계정의 이름·이메일 주소·프로필 사진·연락처는 <b>받지도, 저장하지도 않아요.</b></p>

<h2>무엇을 저장하나요</h2>
<ul>
<li>AdMob 이 돌려준 날짜별·앱별 수익 금액과 노출·클릭 수</li>
<li>App Store Connect 가 돌려준 날짜별·앱별 다운로드 수와 매출</li>
<li>내 앱들이 AI 모델을 부른 기록(모델 이름·토큰 수·비용·응답 시간)</li>
<li>내 서비스에 들어온 방문 기록 — 방문자 수를 세는 데만 쓰려고 IP 주소는
  되돌릴 수 없는 짧은 해시로 바꿔 담아요. 원래 주소는 남기지 않아요.</li>
</ul>
<p>저장하는 곳은 Cloudflare D1 이고, 관리자 로그인을 거쳐야만 볼 수 있어요.
호출 기록은 180일이 지나면 지워요.</p>

<h2>남에게 주지 않아요</h2>
<p>모은 값을 제3자에게 팔거나 넘기지 않아요. 광고·분석 도구를 붙이지 않았어요.
법으로 요구받는 경우가 아니면 밖으로 나가는 경로 자체가 없어요.</p>

<h2>권한을 거두고 싶을 때</h2>
<p><a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">구글 계정 권한 관리</a>
에서 언제든 이 도구의 접근을 끊을 수 있어요. 끊으면 그때부터 AdMob 수치를 가져오지 않아요.
이미 받아 둔 수치를 지워 달라고 하시려면 아래 주소로 알려 주세요.</p>

<h2>문의</h2>
<p><a href="mailto:${CONTACT}">${CONTACT}</a></p>
</div>
<footer><a href="/">처음으로</a></footer>`,
	);
}
