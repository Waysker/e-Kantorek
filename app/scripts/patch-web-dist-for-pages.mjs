import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const indexPath = resolve(process.cwd(), "dist", "index.html");
const versionPath = resolve(process.cwd(), "dist", "version.json");
const indexHtml = await readFile(indexPath, "utf8");
const buildId =
  process.env.APP_BUILD_ID?.trim() ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

let patched = indexHtml
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

patched = patched.replace("</head>", `${versionGuard}\n</head>`);
await Promise.all([
  writeFile(indexPath, patched, "utf8"),
  writeFile(versionPath, `${JSON.stringify({ buildId }, null, 2)}\n`, "utf8"),
]);

console.log(`Patched dist/index.html for GitHub Pages; build ${buildId}.`);
