import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const candidates = [
  join("node_modules", "opencv.js", "opencv.js"),
  join("node_modules", "opencv.js", "build", "opencv.js"),
  join("node_modules", "@techstark", "opencv-js", "dist", "opencv.js"),
];
const target = join("public", "opencv.js");

const source = candidates.find((candidate) => existsSync(candidate));
if (!source) {
  console.warn("OpenCV.js package asset was not found; comic detection will use fallback until dependencies are installed.");
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`Copied ${source} to ${target}`);
