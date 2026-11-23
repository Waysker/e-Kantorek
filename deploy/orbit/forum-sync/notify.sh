#!/bin/sh
# Failure/recovery notifier for the forum sync. Installed root-owned at
# /usr/local/lib/ekantorek/notify.sh (never run from a user-writable path).
# Usage: notify.sh ok|fail|unmapped      Env: NTFY_SERVER, NTFY_TOPIC, optional NTFY_TOKEN.
# Alerts after ALERT_AFTER consecutive failures, repeats every REPEAT_EVERY
# failures, and sends one "recovered" message when it works again.
set -u
STATE_DIR=/var/lib/ekantorek-forum-sync
STATE_FILE="$STATE_DIR/consecutive_failures"
ALERT_AFTER=2
REPEAT_EVERY=6

mkdir -p "$STATE_DIR"
count=0
[ -f "$STATE_FILE" ] && count="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
case "$count" in ''|*[!0-9]*) count=0 ;; esac

send() { # title, priority, tags, message
  [ -n "${NTFY_SERVER:-}" ] && [ -n "${NTFY_TOPIC:-}" ] || { echo "ntfy not configured; skipping"; return 0; }
  if [ -n "${NTFY_TOKEN:-}" ]; then
    curl -fsS -m 10 --retry 2 -o /dev/null -H "Authorization: Bearer $NTFY_TOKEN" \
      -H "Title: $1" -H "Priority: $2" -H "Tags: $3" -d "$4" "${NTFY_SERVER%/}/$NTFY_TOPIC" || true
  else
    curl -fsS -m 10 --retry 2 -o /dev/null \
      -H "Title: $1" -H "Priority: $2" -H "Tags: $3" -d "$4" "${NTFY_SERVER%/}/$NTFY_TOPIC" || true
  fi
}

case "${1:-}" in
  ok)
    if [ "$count" -ge "$ALERT_AFTER" ]; then
      send "e-Kantorek: sync wrocil" default white_check_mark "Sync forum dziala ponownie (po $count nieudanych przebiegach)."
    fi
    echo 0 > "$STATE_FILE"
    ;;
  fail)
    count=$((count + 1))
    echo "$count" > "$STATE_FILE"
    if [ "$count" -eq "$ALERT_AFTER" ] || { [ "$count" -gt "$ALERT_AFTER" ] && [ $(( (count - ALERT_AFTER) % REPEAT_EVERY )) -eq 0 ]; }; then
      send "e-Kantorek: sync forum nie dziala" high warning "Nieudanych przebiegow z rzedu: $count. Sprawdz: journalctl -u ekantorek-forum-sync.service -n 50"
    fi
    ;;
  unmapped)
    # Alert when forum members have no instrument mapping. Fires when a new
    # member appears, and repeats once per UNMAPPED_REPEAT_HOURS while any remain.
    UNMAPPED_FILE="${UNMAPPED_FILE:-/home/waysker/e-Kantorek-sync/app/.cache/forum-sync/unmapped.json}"
    UNMAPPED_STATE="$STATE_DIR/unmapped_state.json"
    msg="$(python3 - "$UNMAPPED_FILE" "$UNMAPPED_STATE" "${UNMAPPED_REPEAT_HOURS:-24}" <<'PY'
import json, os, sys, time
src, state_path, repeat_h = sys.argv[1], sys.argv[2], float(sys.argv[3])
try:
    members = json.load(open(src, encoding="utf-8")).get("members", [])
except Exception:
    sys.exit(0)  # no/invalid file: stay silent, the sync failure path covers it
ids = sorted(m["id"] for m in members)
try:
    state = json.load(open(state_path, encoding="utf-8"))
except Exception:
    state = {"ids": [], "alertedAt": 0}
now = time.time()
new = [i for i in ids if i not in state.get("ids", [])]
due = ids and (new or now - state.get("alertedAt", 0) >= repeat_h * 3600)
if due:
    names = ", ".join(f'{m["fullName"]} ({m["id"].replace("forum-user-", "")})' for m in members[:8])
    more = f" i {len(members) - 8} wiecej" if len(members) > 8 else ""
    print(f"Osoby z forum bez instrumentu: {len(members)}. Nowe: {len(new)}. {names}{more}. Dodaj mapping w forum_instrument_overrides.")
    state = {"ids": ids, "alertedAt": now}
elif not ids:
    state = {"ids": [], "alertedAt": 0}
tmp = state_path + ".tmp"
json.dump(state, open(tmp, "w", encoding="utf-8"))
os.replace(tmp, state_path)
PY
)"
    if [ -n "$msg" ]; then
      send "e-Kantorek: nowe osoby bez instrumentu" high busts_in_silhouette "$msg"
    fi
    ;;
  *) echo "usage: $0 ok|fail|unmapped" >&2; exit 2 ;;
esac
