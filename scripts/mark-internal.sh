#!/bin/bash
# 내부용 앱에 표시를 남긴다 — IP 상한 검사를 건너뛰게 한다.
#
# D1 무료 하루 읽기 한도에 걸려 있으면 UPDATE 도 막힌다(행을 읽어야 하므로).
# 한도는 UTC 자정, 한국 시각 09:00 에 풀린다.
set -e
cd "$(dirname "$0")/.."
KEY=$(cat admin_api_key.txt)
for APP in ai-mail-agent ai-service-agent; do
  printf '%-18s ' "$APP"
  curl -s -X PATCH "https://ai.zerolive.co.kr/admin/api/apps/$APP" \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d '{"internal":true}' \
    | python3 -c 'import sys,json
t=sys.stdin.read()
try:
    d=json.loads(t)
    a=d.get("app")
    print("내부용 %s" % a.get("internal") if a else "실패 %s" % d.get("error") or d.get("detail"))
except Exception:
    print("실패 %s" % t[:120])'
done
