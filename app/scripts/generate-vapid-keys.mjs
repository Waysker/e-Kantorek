// Generates the VAPID key pair for push notifications (docs/ops/push-notifications.md).
// Prints only the PUBLIC key (not a secret). The PRIVATE key goes straight to
// the clipboard, never to the screen, so it can be saved with
//   secret.ps1 clip -Entry orbit/ekantorek-vapid
// and sent to orbit with secret.ps1 push.
//
//   node app/scripts/generate-vapid-keys.mjs
import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";

const toBase64Url = (bytes) => Buffer.from(bytes).toString("base64url");

const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = toBase64Url(new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey)));
const privateKey = (await webcrypto.subtle.exportKey("jwk", pair.privateKey)).d;

const clipboard =
  process.platform === "win32"
    ? { cmd: "clip.exe", args: [] }
    : process.platform === "darwin"
      ? { cmd: "pbcopy", args: [] }
      : { cmd: "xclip", args: ["-selection", "clipboard"] };
const copied = spawnSync(clipboard.cmd, clipboard.args, { input: privateKey });
if (copied.status !== 0) {
  console.error("Could not copy the private key to the clipboard; nothing was printed. Try again on a desktop.");
  process.exit(1);
}

console.log("Private key: copied to the clipboard (not shown).");
console.log("Next: secret.ps1 clip -Entry orbit/ekantorek-vapid");
console.log("");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
