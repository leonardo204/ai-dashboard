#!/usr/bin/env python3
"""App Store Connect API 호출 도우미 — JWT(ES256)를 만들어 붙인다.

키는 저장소 밖(appstore-admob/)에 둔다. 이 파일에는 비밀이 없다.
쓰는 법:  python3 scripts/asc.py GET /v1/apps
"""
import json, time, base64, subprocess, os, sys, urllib.request, urllib.error

CRED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "appstore-admob")
BASE = "https://api.appstoreconnect.apple.com"


def _info():
    d = {}
    for line in open(os.path.join(CRED, "info.txt")):
        line = line.strip()
        if "=" in line:
            k, v = line.split("=", 1)
            d[k.strip()] = v.strip()
    return d


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _der2raw(d):
    """ECDSA DER 서명 → r‖s 64바이트. JWT 는 raw 를 요구한다."""
    assert d[0] == 0x30
    off = 2 if d[1] < 0x80 else 2 + (d[1] & 0x7F)
    out = bytearray(64)
    for half in (0, 32):
        assert d[off] == 0x02
        off += 1
        ln = d[off]; off += 1
        s = off; off += ln
        while ln > 32:
            s += 1; ln -= 1
        out[half + (32 - ln):half + 32] = d[s:s + ln]
    return bytes(out)


def token(ttl=1200):
    i = _info()
    kid = i["key_id"]
    hdr = _b64(json.dumps({"alg": "ES256", "kid": kid, "typ": "JWT"}, separators=(",", ":")).encode())
    now = int(time.time())
    pl = _b64(json.dumps({"iss": i["issuer_id"], "iat": now, "exp": now + ttl,
                          "aud": "appstoreconnect-v1"}, separators=(",", ":")).encode())
    tmp = "/tmp/_asc_signing"
    open(tmp, "wb").write((hdr + "." + pl).encode())
    der = subprocess.run(["openssl", "dgst", "-sha256", "-sign",
                          os.path.join(CRED, "AuthKey_%s.p8" % kid), tmp],
                         capture_output=True).stdout
    os.remove(tmp)
    return hdr + "." + pl + "." + _b64(_der2raw(der))


def call(method, path, body=None, tok=None):
    tok = tok or token()
    url = path if path.startswith("http") else BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Authorization": "Bearer " + tok,
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as f:
            raw = f.read()
            return f.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:400]}


if __name__ == "__main__":
    m, p = sys.argv[1], sys.argv[2]
    b = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None
    st, d = call(m, p, b)
    print(st)
    print(json.dumps(d, ensure_ascii=False, indent=2)[:4000])
