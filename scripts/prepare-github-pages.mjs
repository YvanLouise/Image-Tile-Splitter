import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const indexPath = join("dist", "index.html");
const html = readFileSync(indexPath, "utf8")
  .replaceAll('href="/assets/', 'href="./assets/')
  .replaceAll('src="/assets/', 'src="./assets/');

writeFileSync(indexPath, html);
console.log("Prepared dist/index.html for GitHub Pages relative asset paths.");
