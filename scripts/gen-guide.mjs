/**
 * docs/PROXY-CLIENT-GUIDE.md → src/guide-md.ts
 *
 * Workers에는 파일 시스템이 없어서 가이드 원문을 코드에 문자열로 담아야 한다.
 * 원본은 언제나 docs/PROXY-CLIENT-GUIDE.md 하나뿐이고, 이 스크립트가 그걸 옮겨 적는다.
 * 배포(npm run deploy)와 타입 검사 전에 자동으로 돌아간다.
 */
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "docs/PROXY-CLIENT-GUIDE.md";
const OUT = "src/guide-md.ts";

const md = readFileSync(SRC, "utf8");
const escaped = md.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

writeFileSync(
	OUT,
	`// 자동 생성 파일 — 직접 고치지 마세요.\n` +
		`// 원본: ${SRC}  ·  다시 만들기: npm run gen:guide\n\n` +
		`export const GUIDE_MD = \`${escaped}\`;\n\n` +
		`/** 내려받을 때 붙는 파일 이름. */\nexport const GUIDE_FILENAME = "PROXY-CLIENT-GUIDE.md";\n`,
	"utf8",
);
console.log(`${OUT} 갱신 (${md.length.toLocaleString()}자)`);
