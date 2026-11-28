"""Builds one SQL file that imports Facebook posts into Kantorek (docs/ops/kantorek-feed.md).

Input: a JSON list of posts in the shape of import_feed_post (migrations 037, 038):
  [{"authorName": "Ania Raczkowska", "authorProfileId": "<profiles.id or null>",
    "createdAt": "2026-11-06T12:00:00+01:00", "likeCount": 4, "externalUrl": null,
    "body": "...", "poll": null | {"question", "multiple", "options": [{"label", "votes"}]},
    "comments": [{"authorName", "authorProfileId", "body", "createdAt"}]}]

The SQL runs as one transaction under the importing board member's account
(request.jwt.claims sub), so auth.uid() and the board check work as in the app.
Imports never send push.

  python build_import_sql.py posts.json import.sql <board member profiles.id>
  scp import.sql orbit:/tmp/ ; then on orbit:
  sudo docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /tmp/import.sql
"""
import json
import re
import sys


def main() -> None:
    source, target, actor = sys.argv[1], sys.argv[2], sys.argv[3]
    if not re.fullmatch(r"[0-9a-f-]{36}", actor):
        sys.exit("actor must be a profiles.id (uuid)")
    posts = json.load(open(source, encoding="utf-8"))
    lines = [
        "-- Kantorek: import from Facebook. One transaction: all posts or none.",
        "begin;",
        f"select set_config('request.jwt.claims', '{{\"sub\":\"{actor}\"}}', true);",
    ]
    for post in posts:
        payload = json.dumps(post, ensure_ascii=False)
        if "$fb$" in payload:
            sys.exit("payload contains $fb$")
        lines.append(f"select public.import_feed_post($fb${payload}$fb$::jsonb) as id;")
    lines += ["commit;", ""]
    with open(target, "w", encoding="utf-8", newline="\n") as out:
        out.write("\n".join(lines))
    print(f"{len(posts)} post(s) -> {target}")


if __name__ == "__main__":
    main()
