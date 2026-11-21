# Forum sync timer on orbit (Docker)

Runs `npm run forum:sync:publish` every ~20 min in a throwaway `node:24-slim`
container started by a systemd timer. Nothing is installed on the host besides
the checkout and two unit files, and nothing is shared with `teatr-bilety-watcher`.
GitHub Actions `Forum Sync Publish` stays as a manual/backup trigger.
Needs `sudo` (Docker and /etc). Do not paste secrets in chat.

## Install

```bash
# 1. Checkout (no sudo)
git clone https://github.com/Waysker/e-Kantorek.git /home/waysker/e-Kantorek-sync

# 2. Dependencies, once, using the same image the service uses
sudo docker run --rm --user 1000:1000 -e HOME=/tmp \
  -v /home/waysker/e-Kantorek-sync:/repo -w /repo/app node:24-slim npm ci
mkdir -p /home/waysker/e-Kantorek-sync/app/.cache

# 3. Secrets (owner root, mode 600)
sudo install -d -m 700 /etc/ekantorek
sudo install -m 600 /home/waysker/e-Kantorek-sync/deploy/orbit/forum-sync/forum-sync.env.example /etc/ekantorek/forum-sync.env
sudoedit /etc/ekantorek/forum-sync.env

# 4. Units
sudo cp /home/waysker/e-Kantorek-sync/deploy/orbit/forum-sync/ekantorek-forum-sync.{service,timer} /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/ekantorek-forum-sync.service
sudo systemctl daemon-reload

# 5. Test one run by hand, then enable the timer
sudo systemctl start ekantorek-forum-sync.service
journalctl -u ekantorek-forum-sync.service -n 50 --no-pager
sudo systemctl enable --now ekantorek-forum-sync.timer
systemctl list-timers ekantorek-forum-sync.timer
```

## Operate

- Update code: `git -C /home/waysker/e-Kantorek-sync pull --ff-only`; rerun step 2 if `package-lock.json` changed.
- Logs: `journalctl -u ekantorek-forum-sync.service --since today`.
- Pause: `sudo systemctl stop ekantorek-forum-sync.timer`.
- A failed run is retried by the next timer tick, not in a loop (be gentle with the forum).
- Suspicious-snapshot refusal: see `FORUM_PUBLISH_FORCE=1` in `app/scripts/publish-snapshot-to-supabase.mjs`.
- Once pings arrive reliably, remove the schedule triggers from `.github/workflows/forum-sync-publish.yml`.
