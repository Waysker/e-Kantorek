// Web Push with Web Crypto only (no npm), so it runs the same in the Edge
// Runtime and in Node tests (scripts/push-web-push.test.mjs):
// - VAPID (RFC 8292): an ES256 JWT for the push service's origin;
// - payload encryption aes128gcm (RFC 8188 + RFC 8291), one record.
//
// Keys are base64url, as browsers and `web-push generate-vapid-keys` give them:
// the public key is the 65-byte uncompressed P-256 point, the private key the
// 32-byte scalar.

export type PushSubscriptionKeys = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type VapidKeys = {
  publicKey: string;
  privateKey: string;
  /** mailto: or https: contact for the push service operator. */
  subject: string;
};

export type PushResult = {
  status: number;
  /** The push service says this subscription no longer exists: delete it. */
  gone: boolean;
  body: string;
};

const encoder = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// Web Crypto and fetch take a plain ArrayBuffer (newer TypeScript libs reject a
// Uint8Array whose buffer may be shared).
function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  const publicBytes = base64UrlDecode(keys.publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) {
    throw new Error("VAPID public key must be a 65-byte uncompressed P-256 point.");
  }
  if (base64UrlDecode(keys.privateKey).length !== 32) {
    throw new Error("VAPID private key must be 32 bytes.");
  }
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey.trim(),
      x: base64UrlEncode(publicBytes.slice(1, 33)),
      y: base64UrlEncode(publicBytes.slice(33, 65)),
      ext: false,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** The Authorization header value for one push service origin. */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: nowSeconds + 12 * 60 * 60,
        sub: keys.subject,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const key = await importVapidPrivateKey(keys);
  // Web Crypto returns r || s (64 bytes), which is the JWS ES256 form.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, buf(encoder.encode(unsigned))),
  );
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${keys.publicKey.trim()}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) }, key, bytes * 8),
  );
}

/** aes128gcm body for one subscription (RFC 8291 §3.4, a single record). */
export async function encryptPayload(
  subscription: PushSubscriptionKeys,
  payload: Uint8Array,
  options: { salt?: Uint8Array; senderKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const userPublic = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);
  if (userPublic.length !== 65 || authSecret.length < 16) {
    throw new Error("Invalid subscription keys.");
  }
  if (payload.length > 3800) {
    throw new Error("Payload too large for one push message.");
  }

  const senderKeys =
    options.senderKeys ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", senderKeys.publicKey));
  const userKey = await crypto.subtle.importKey(
    "raw",
    buf(userPublic),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: userKey }, senderKeys.privateKey, 256),
  );

  const keyInfo = concat(encoder.encode("WebPush: info\0"), userPublic, senderPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", buf(contentKey), "AES-GCM", false, ["encrypt"]);
  // 0x02 = padding delimiter of the last (only) record.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: buf(nonce), tagLength: 128 },
      aesKey,
      buf(concat(payload, new Uint8Array([0x02]))),
    ),
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([senderPublic.length]), senderPublic, ciphertext);
}

/** Sends one message. ttlSeconds: how long the push service keeps it for an offline device. */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: unknown,
  keys: VapidKeys,
  options: { ttlSeconds?: number; topic?: string; fetchImpl?: typeof fetch } = {},
): Promise<PushResult> {
  const body = await encryptPayload(subscription, encoder.encode(JSON.stringify(payload)));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(subscription.endpoint, keys),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttlSeconds ?? 24 * 60 * 60),
    Urgency: "normal",
  };
  if (options.topic) {
    // Replaces an undelivered message with the same topic (max 32 url-safe chars).
    headers.Topic = options.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  }
  const response = await (options.fetchImpl ?? fetch)(subscription.endpoint, {
    method: "POST",
    headers,
    body: buf(body),
  });
  const text = await response.text().catch(() => "");
  return {
    status: response.status,
    gone: response.status === 404 || response.status === 410,
    body: text.slice(0, 300),
  };
}
