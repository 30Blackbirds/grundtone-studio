#!/usr/bin/env bash
# Rød-før-grøn for dommeren. Fixtures serveres lokalt, fordi de tilstande vi
# skal afvise ('dev', 'unknown', tom) ikke kan fremkaldes paa den levende flade
# — og en gate, der kun er proevet mod det gode tilfaelde, er ikke proevet.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT=${PORT:-8931}
FAILED=0

serve() { # $1 = json-body
  printf '%s' "$1" > /tmp/healthz-fixture.json
  python3 - "$PORT" <<'PY' &
import http.server, socketserver, sys, json
body = open('/tmp/healthz-fixture.json','rb').read()
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def log_message(self,*a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', int(sys.argv[1])), H) as s: s.serve_forever()
PY
  SERVER=$!
  sleep 0.6
}
stop() { kill "$SERVER" 2>/dev/null; wait "$SERVER" 2>/dev/null; }

check() { # $1 label, $2 body, $3 expected-sha, $4 forventet-exit
  serve "$2"
  "$HERE/assert-served-revision.sh" "http://127.0.0.1:$PORT" "$3" >/dev/null 2>&1
  got=$?
  stop
  if [ "$got" = "$4" ]; then echo "  ✓ $1"; else echo "  ✗ $1 (exit $got, forventet $4)"; FAILED=1; fi
}

SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
echo "── formen afviser placeholdere UDEN at kende den forventede sha"
check "revision 'dev' afvises"      '{"revision":"dev"}'      "$SHA" 1
check "revision 'unknown' afvises"  '{"revision":"unknown"}'  "$SHA" 1
check "tom revision afvises"        '{"revision":""}'         "$SHA" 1
check "manglende felt afvises"      '{"status":"ok"}'         "$SHA" 1
check "kort sha afvises"            '{"revision":"aaaaaaa"}'  "$SHA" 1
check "versaler afvises"            "{\"revision\":\"${SHA^^}\"}" "$SHA" 1
echo "── og den rigtige sha slipper igennem"
check "korrekt sha accepteres"      "{\"revision\":\"$SHA\"}" "$SHA" 0
echo "── en gyldig sha der ikke er DENNE bygning"
check "forkert sha afvises"         '{"revision":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}' "$SHA" 1

[ "$FAILED" = 0 ] && echo "alle cases bestået" || { echo "FEJLEDE"; exit 1; }
