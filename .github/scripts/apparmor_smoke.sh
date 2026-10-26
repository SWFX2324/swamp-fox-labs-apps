#!/usr/bin/env bash
# Runs the real image with the app's AppArmor profile enforced, the way Home
# Assistant does, and calls every endpoint against the saved responses in
# ham_dashboard/tests/fixtures. Fails on any denied access, any endpoint that
# doesn't answer 200, or errors in the app's log. 1.5.0 shipped a profile that
# blocked Node's locale data; this is the check that would have caught it.
#
# Expects the image built as ham-dashboard:ci and the profile loaded.
set -euo pipefail

IMAGE=ham-dashboard:ci
NAME=ham-apparmor
BASE=http://127.0.0.1:8099
QTH='lat=34.1458&lon=-116.0417'

data=$(mktemp -d)
chmod 777 "$data"
cat > "$data/options.json" <<'EOF'
{"station_type": "amateur", "callsign": "N0CALL", "grid": "DM14xd", "distance_units": "mi",
 "dx_cluster_enabled": false, "aprs_enabled": false, "ha_sensors": false, "nws_alerts": true}
EOF
echo '{"done": true}' > "$data/setup.json"

fail() { echo "FAIL: $*"; echo "--- app log"; docker logs "$NAME" 2>&1 | tail -50 || true; exit 1; }

# Host networking: requests from the runner then come from 127.0.0.1, which the
# server accepts alongside Home Assistant's ingress proxy.
docker run -d --name "$NAME" --network host --security-opt apparmor=ham_dashboard \
  -v "$data:/data" -v "$PWD/ham_dashboard/tests:/app/tests:ro" \
  "$IMAGE" node --require /app/tests/fixtures/fake-services.js /app/server.js > /dev/null

for _ in $(seq 1 60); do
  curl -sf "$BASE/api/config" > /dev/null && break
  sleep 1
done
curl -sf "$BASE/api/config" > /dev/null || fail "the server didn't start"

# The app must run in the profile's own "node" child profile, enforced.
label=$(curl -sf "$BASE/api/status" | jq -r '.live.apparmor')
echo "AppArmor label: $label"
[[ "$label" == *"ham_dashboard//node (enforce)"* ]] || fail "unexpected AppArmor label: $label"

paths=(
  / /app.js /api/config /api/solar /api/ionosondes /api/cycle /api/storm /api/pota
  /api/status /api/accuracy /api/paths "/api/lookup?call=W1AW"
  "/api/activity?$QTH" "/api/vhf?$QTH" "/api/beacons?$QTH" "/api/timesignals?$QTH"
  "/api/satellites?$QTH" "/api/repeaters?$QTH&radius=150"
  "/api/path?$QTH&target=JO31" "/api/path?$QTH&target=JA1ABC"
  /api/map/mufd.svg /api/map/fof2.svg
)
for p in "${paths[@]}"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept-Encoding: gzip' "$BASE$p")
  echo "$code $p"
  [[ "$code" == 200 ]] || fail "$p answered $code"
done

# Writes go to /data.
body='{"label": "CI path", "target": {"lat": 51, "lon": 0, "label": "JO01"}}'
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$body" "$BASE/api/paths")
[[ "$code" == 200 ]] || fail "saving a path answered $code"
[[ -s "$data/paths.json" ]] || fail "paths.json wasn't written"

# A clean stop (s6 passes SIGTERM on) saves the cache to /data.
docker stop -t 20 "$NAME" > /dev/null
[[ -s "$data/cache.json" ]] || fail "cache.json wasn't saved on shutdown"

log=$(docker logs "$NAME" 2>&1)
if grep -E 'UNMOCKED|Icu error|EACCES|EPERM|\[fetch\]' <<< "$log"; then fail "errors in the app's log"; fi

denied=$(sudo dmesg | grep 'apparmor="DENIED"' | grep ham_dashboard || true)
if [[ -n "$denied" ]]; then echo "$denied"; fail "AppArmor denied access"; fi

docker rm "$NAME" > /dev/null
echo "The image runs under its enforced AppArmor profile with nothing denied."
