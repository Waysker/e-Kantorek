import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const indexPath = resolve(process.cwd(), "dist", "index.html");
const versionPath = resolve(process.cwd(), "dist", "version.json");
const indexHtml = await readFile(indexPath, "utf8");
const buildId =
  process.env.APP_BUILD_ID?.trim() ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

// Expo's template says lang="en". Browsers then offer to translate the Polish
// UI, and a translated page crashes React on the next re-render (e.g. picking
// an instrument chip on sign-up). Declare the real language and opt out of
// machine translation; the app has its own locale (EXPO_PUBLIC_APP_LOCALE).
const appLang = process.env.EXPO_PUBLIC_APP_LOCALE?.trim().toLowerCase() === "en" ? "en" : "pl";
if (!/<html lang="[^"]*">/.test(indexHtml)) {
  throw new Error('Could not find <html lang="…"> in the Expo web export.');
}

let patched = indexHtml
  .replace(/<html lang="[^"]*">/, `<html lang="${appLang}" translate="no">`)
  .replace("</title>", '</title>\n    <meta name="google" content="notranslate" />')
  .replaceAll('href="/', 'href="./')
  .replaceAll('src="/', 'src="./');

const versionGuard = `
<script>
  (() => {
    const buildId = ${JSON.stringify(buildId)};
    const url = new URL("./version.json", window.location.href);
    url.searchParams.set("check", String(Date.now()));

    fetch(url, { cache: "no-store", credentials: "omit" })
      .then((response) => (response.ok ? response.json() : null))
      .then((version) => {
        const latestBuildId = version?.buildId;
        if (!latestBuildId || latestBuildId === buildId) {
          const currentUrl = new URL(window.location.href);
          if (currentUrl.searchParams.has("__oragh_build")) {
            currentUrl.searchParams.delete("__oragh_build");
            window.history.replaceState(null, "", currentUrl);
          }
          return;
        }

        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.get("__oragh_build") === latestBuildId) return;
        currentUrl.searchParams.set("__oragh_build", latestBuildId);
        window.location.replace(currentUrl.href);
      })
      .catch(() => {});
  })();
</script>`;

if (!patched.includes("</head>")) {
  throw new Error("Could not find </head> in the Expo web export.");
}

// Installable web app: manifest, icons and a service worker (public/). Paths
// are relative because the app is served under /e-Kantorek/ on GitHub Pages.
const installTags = `
    <link rel="manifest" href="./manifest.webmanifest" />
    <link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="e-Kantorek" />
    <meta name="mobile-web-app-capable" content="yes" />
<script>
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
    });
  }
</script>`;

patched = patched.replace("</head>", `${installTags}\n${versionGuard}\n</head>`);
await Promise.all([
  writeFile(indexPath, patched, "utf8"),
  writeFile(versionPath, `${JSON.stringify({ buildId }, null, 2)}\n`, "utf8"),
]);

console.log(`Patched dist/index.html for GitHub Pages; build ${buildId}.`);
