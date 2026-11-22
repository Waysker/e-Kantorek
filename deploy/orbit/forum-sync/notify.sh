#!/bin/sh
# Failure/recovery notifier for the forum sync. Installed root-owned at
# /usr/local/lib/ekantorek/notify.sh (never run from a user-writable path).
# Usage: notify.sh ok|fail      Env: NTFY_SERVER, NTFY_TOPIC, optional NTFY_TOKEN.
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
  *) echo "usage: $0 ok|fail" >&2; exit 2 ;;
esac
