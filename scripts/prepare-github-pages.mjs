import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const indexPath = join("dist", "index.html");
const html = readFileSync(indexPath, "utf8")
  .replaceAll('href="/assets/', 'href="./assets/')
  .replaceAll('src="/assets/', 'src="./assets/');
const version = process.env.GITHUB_SHA ?? process.env.VITE_APP_VERSION ?? "local";

writeFileSync(indexPath, html);
writeFileSync(join("dist", "version.json"), JSON.stringify({ version }));
console.log("Prepared dist/index.html for GitHub Pages relative asset paths.");
