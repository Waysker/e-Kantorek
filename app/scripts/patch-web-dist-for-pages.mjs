import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const indexPath = resolve(process.cwd(), "dist", "index.html");
const indexHtml = await readFile(indexPath, "utf8");

const patched = indexHtml
  .replaceAll('href="/', 'href="./')
  .replaceAll('src="/', 'src="./');

if (patched !== indexHtml) {
  await writeFile(indexPath, patched, "utf8");
  console.log("Patched dist/index.html for GitHub Pages subpath hosting.");
} else {
  console.log("No patch needed for dist/index.html.");
}
