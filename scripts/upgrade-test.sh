#!/usr/bin/env bash
# Upgrade rehearsal: does an install made by an older Brewlab survive an update to this checkout?
#
#   scripts/upgrade-test.sh [old-ref]      (default: the latest v* tag; needs Docker)
#
# Builds <old-ref> and the working tree as images, starts the old one on a fresh volume with the
# demo data (fictional), then starts the new one on the same volume and checks: it comes up
# healthy, it's still set up, no row counts drop, the same recipes/bags/gear are there, and the
# startup log has no errors. Run it before tagging a release. Leaves nothing behind.
set -euo pipefail
cd "$(dirname "$0")/.."

OLD_REF="${1:-$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)}"
[ -n "$OLD_REF" ] || { echo "No v* tag yet — pass a ref: scripts/upgrade-test.sh <commit|tag>"; exit 2; }
PORT="${UPGRADE_TEST_PORT:-3199}"
NAME=brewlab-upgrade-test
VOL=brewlab-upgrade-test-data
BASE="http://127.0.0.1:$PORT"
TMP="$(mktemp -d)"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$VOL" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
cleanup; TMP="$(mktemp -d)"

wait_healthy() {
  for _ in $(seq 1 60); do curl -fs "$BASE/api/health" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "✗ $1 didn't come up"; docker logs "$NAME" | tail -30; exit 1
}
run() { docker run -d --name "$NAME" -e DISABLE_CRON=1 -v "$VOL:/data" -p "127.0.0.1:$PORT:7642" "$1" >/dev/null; }
snapshot() { # counts + names, sorted, so the two can be diffed
  curl -fs "$BASE/api/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s).counts;for(const k of Object.keys(c).sort())console.log(`count ${k} ${c[k]}`)})'
  for what in recipes inventory gear brews; do
    curl -fs "$BASE/api/$what" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const a=Array.isArray(j)?j:(j.items??j.rows??Object.values(j).find(Array.isArray)??[]);for(const r of a)console.log(`'"$what"' ${r.id} ${r.name??r.coffeeName??r.recipeName??""}`)})' | sort
  done
}

echo "Building $OLD_REF …"
mkdir "$TMP/old" && git archive --format=tar "$OLD_REF" | tar -x -C "$TMP/old"
docker build -q -t brewlab:upgrade-old "$TMP/old" >/dev/null
echo "Building the working tree …"
docker build -q -t brewlab:upgrade-new . >/dev/null

echo "Old version: demo data"
run brewlab:upgrade-old; wait_healthy "$OLD_REF"
curl -fs -XPOST "$BASE/api/setup/demo" >/dev/null
curl -fs -XPOST "$BASE/api/setup/complete" >/dev/null
curl -fs -XPOST "$BASE/api/backups" >/dev/null
snapshot > "$TMP/before.txt"
docker rm -f "$NAME" >/dev/null

echo "New version: same volume"
run brewlab:upgrade-new; wait_healthy "working tree"
snapshot > "$TMP/after.txt"
docker logs "$NAME" > "$TMP/log.txt" 2>&1

fail=0
ok() { echo "✓ $1"; }
bad() { echo "✗ $1"; fail=1; }
onboarded=$(curl -fs "$BASE/api/setup" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).onboarded))')
[ "$onboarded" = "true" ] && ok "still set up (no first-run screen)" || bad "first-run setup shows again"
dropped=$(join <(grep '^count' "$TMP/before.txt" | awk '{print $2, $3}' | sort) <(grep '^count' "$TMP/after.txt" | awk '{print $2, $3}' | sort) | awk '$3 < $2')
[ -z "$dropped" ] && ok "no counts dropped ($(grep -c '^count' "$TMP/after.txt") tables)" || bad "counts dropped: $dropped"
missing=$(comm -23 <(grep -v '^count' "$TMP/before.txt") <(grep -v '^count' "$TMP/after.txt") || true)
[ -z "$missing" ] && ok "every recipe, bag, gear item and brew is still there ($(grep -vc '^count' "$TMP/before.txt") rows)" || bad "missing or renamed after the upgrade:
$missing"
errors=$(grep -iE 'error|invalid|SQLITE|exception' "$TMP/log.txt" || true)
[ -z "$errors" ] && ok "startup log is clean" || bad "startup log:
$errors"
echo "--- startup log (new version) ---"; cat "$TMP/log.txt"
docker rmi brewlab:upgrade-old brewlab:upgrade-new >/dev/null 2>&1 || true
exit $fail
