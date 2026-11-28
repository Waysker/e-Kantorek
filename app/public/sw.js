// Service worker of the installed web app. It caches nothing: every request
// goes to the network, so a new deploy is picked up at once (the version
// guard in index.html still reloads stale pages). Without a connection, page
// loads get a short Polish message instead of the browser's error page.
const OFFLINE_PAGE = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>e-Kantorek</title></head>
<body style="margin:0;padding:32px 24px;font-family:system-ui,sans-serif;background:#F5F6F3;color:#121512">
<h1 style="font-size:22px">Brak połączenia</h1>
<p style="font-size:16px;line-height:1.5">e-Kantorek potrzebuje internetu. Spróbuj ponownie, gdy wrócisz do sieci.</p>
</body></html>`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(OFFLINE_PAGE, {
          status: 503,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    ),
  );
});

// Push notifications (Partytura → Patterns → Notifications), sent by the Edge
// Function push_new_events: { title, body, eventId?, tag }.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "e-Kantorek", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "e-Kantorek";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "./icons/icon-192.png",
      lang: "pl",
      data: { eventId: data.eventId || null },
    }),
  );
});

// Tap: focus an open app window and tell it which event to open, or open the
// app at ?event=<id> (App.tsx reads it once and drops it from the address).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const eventId = event.notification.data && event.notification.data.eventId;
  const target = new URL(self.registration.scope);
  if (eventId) {
    target.searchParams.set("event", eventId);
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.registration.scope));
      if (open) {
        if (eventId) {
          open.postMessage({ type: "open-event", eventId });
        }
        return open.focus();
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
