#!/usr/bin/env python3
"""분석 보고서가 준비됐는지 본다.  python3 scripts/asc-analytics-check.py

Apple 은 요청한 뒤 24~48시간이 지나야 실제 파일(instance)을 만든다.
'인스턴스 0'이면 아직 만드는 중이고, 숫자가 뜨면 내려받을 수 있다.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asc

# 우리가 쓰려는 것만 본다. 나머지 150여 종은 지금 필요 없다.
WANT = ("App Store Installation and Deletion Standard", "App Sessions Standard", "App Opt In")

tok = asc.token()
_, apps = asc.call("GET", "/v1/apps?limit=50", tok=tok)
ready = 0
for a in apps.get("data", []):
    aid, nm = a["id"], a["attributes"]["name"][:20]
    _, reqs = asc.call("GET", "/v1/apps/%s/analyticsReportRequests?limit=10" % aid, tok=tok)
    for req in reqs.get("data", []):
        at = req["attributes"]["accessType"]
        _, reps = asc.call("GET",
            "/v1/analyticsReportRequests/%s/reports?filter[category]=APP_USAGE&limit=50" % req["id"], tok=tok)
        for rep in reps.get("data", []):
            if rep["attributes"]["name"] not in WANT:
                continue
            _, ins = asc.call("GET", "/v1/analyticsReports/%s/instances?limit=200" % rep["id"], tok=tok)
            n = len(ins.get("data", []))
            ready += n
            print("  %-20s %-18s %-44s %d" % (nm, at, rep["attributes"]["name"], n))
print("\n준비된 인스턴스 합계: %d" % ready)
print("0 이면 아직 만드는 중이에요(요청 뒤 24~48시간)." if not ready else "내려받을 수 있어요.")
