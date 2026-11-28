// Checks the Web Push module of push_new_events in Node: the encrypted body
// decrypts like a browser would (RFC 8291, receiver side written here), the
// VAPID JWT verifies with the public key, and the notification texts follow
// Partytura (title without the forum date, "sob. 28.11 · 10:30 · Sandomierz").
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";

import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPayload,
  sendWebPush,
  vapidAuthorization,
} from "../supabase/functions/push_new_events/webPush.ts";
import { buildPayloads, eventMetaLine, polishEventsCount } from "../supabase/functions/push_new_events/notificationText.ts";

const subtle = crypto.webcrypto.subtle;
const encoder = new TextEncoder();

async function hkdf(salt, ikm, info, bytes) {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

async function makeBrowserSubscription() {
  const keys = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicRaw = new Uint8Array(await subtle.exportKey("raw", keys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    keys,
    publicRaw,
    auth,
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-device",
      p256dh: base64UrlEncode(publicRaw),
      auth: base64UrlEncode(auth),
    },
  };
}

// What the browser does on receipt (RFC 8291 §3.4 / RFC 8188 §2).
async function browserDecrypt(browser, body) {
  const salt = body.slice(0, 16);
  const recordSize = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idLength = body[20];
  const senderPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);
  const senderKey = await subtle.importKey("raw", senderPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(
    await subtle.deriveBits({ name: "ECDH", public: senderKey }, browser.keys.privateKey, 256),
  );
  const keyInfo = new Uint8Array([...encoder.encode("WebPush: info\0"), ...browser.publicRaw, ...senderPublic]);
  const ikm = await hkdf(browser.auth, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const aes = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, ciphertext));
  assert.equal(padded[padded.length - 1], 0x02, "last record delimiter");
  return { recordSize, idLength, text: new TextDecoder().decode(padded.slice(0, -1)) };
}

async function makeVapidKeys() {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await subtle.exportKey("jwk", pair.privateKey);
  const publicRaw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  return {
    verifyKey: pair.publicKey,
    keys: { publicKey: base64UrlEncode(publicRaw), privateKey: jwk.d, subject: "https://example.org/app/" },
  };
}

describe("webPush", () => {
  it("encrypts a payload the browser can decrypt", async () => {
    const browser = await makeBrowserSubscription();
    const message = JSON.stringify({ title: "Nowe wydarzenie: Barbórka PBI", body: "sob. 28.11 · 10:30" });
    const body = await encryptPayload(browser.subscription, encoder.encode(message));
    const decrypted = await browserDecrypt(browser, body);
    assert.equal(decrypted.text, message);
    assert.equal(decrypted.recordSize, 4096);
    assert.equal(decrypted.idLength, 65);
  });

  it("signs a VAPID JWT for the push service origin", async () => {
    const { keys, verifyKey } = await makeVapidKeys();
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/x", keys, 1_800_000_000);
    const match = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
    assert.ok(match, header);
    const [, head, claims, signature, k] = match;
    assert.equal(k, keys.publicKey);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(base64UrlDecode(claims))), {
      aud: "https://fcm.googleapis.com",
      exp: 1_800_000_000 + 12 * 3600,
      sub: keys.subject,
    });
    const valid = await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      base64UrlDecode(signature),
      encoder.encode(`${head}.${claims}`),
    );
    assert.equal(valid, true);
  });

  it("posts with the Web Push headers and reports a gone subscription", async () => {
    const browser = await makeBrowserSubscription();
    const { keys } = await makeVapidKeys();
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return new Response("", { status: 410 });
    };
    const result = await sendWebPush(browser.subscription, { title: "x" }, keys, { topic: "forum-event-1128", fetchImpl });
    assert.equal(result.gone, true);
    assert.equal(calls[0].url, browser.subscription.endpoint);
    assert.equal(calls[0].init.headers["Content-Encoding"], "aes128gcm");
    assert.equal(calls[0].init.headers.Topic, "forum-event-1128");
    assert.match(calls[0].init.headers.Authorization, /^vapid t=/);
    const decrypted = await browserDecrypt(browser, new Uint8Array(calls[0].init.body));
    assert.deepEqual(JSON.parse(decrypted.text), { title: "x" });
  });
});

describe("notification texts", () => {
  const event = (id, title, iso, venue = "") => ({ id, title, startsAt: new Date(iso), venue });

  it("drops the forum date from the title and shows date, time and place", () => {
    const [payload] = buildPayloads([
      event("forum-event-1097", "2026.11.28 Barbóka PBI (duża)", "2026-11-28T10:30:00+01:00", "Sandomierz Hala MOSIR"),
    ]);
    assert.deepEqual(payload, {
      title: "Nowe wydarzenie: Barbóka PBI (duża)",
      body: "sob. 28.11 · 10:30 · Sandomierz Hala MOSIR",
      eventId: "forum-event-1097",
      tag: "forum-event-1097",
    });
  });

  it("uses Warsaw time", () => {
    assert.equal(eventMetaLine(new Date("2026-07-04T17:00:00Z"), ""), "sob. 04.07 · 19:00");
  });

  it("sends one summary when many events arrive at once", () => {
    const payloads = buildPayloads(
      [1, 2, 3, 4, 5].map((n) => event(`forum-event-${n}`, `2026.12.0${n} Koncert ${n}`, `2026-12-0${n}T18:00:00+01:00`)),
    );
    assert.deepEqual(payloads, [
      { title: "5 nowych wydarzeń", body: "Koncert 1, Koncert 2, Koncert 3…", tag: "new-events" },
    ]);
  });

  it("spells Polish plurals", () => {
    assert.deepEqual([4, 5, 12, 22, 25].map(polishEventsCount), [
      "4 nowe wydarzenia",
      "5 nowych wydarzeń",
      "12 nowych wydarzeń",
      "22 nowe wydarzenia",
      "25 nowych wydarzeń",
    ]);
  });
});
