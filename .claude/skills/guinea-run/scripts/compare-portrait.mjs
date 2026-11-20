// A photo, cropped to a circle, next to its cartoon at 256, 40 and 64 px.
//   node compare-portrait.mjs <photo.jpg|png> <portrait.svg> <out.png>
import { readFileSync } from "node:fs";
import { playwright } from "./training-repo.mjs";

const { chromium } = await playwright();
const [photo, svgPath, out] = process.argv.slice(2);
const svg = readFileSync(svgPath, "utf8");
const type = photo.toLowerCase().endsWith(".png") ? "png" : "jpeg";
const data = "data:image/" + type + ";base64," + readFileSync(photo).toString("base64");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 700, height: 300 } });
await page.setContent(`<body style="margin:0;background:#fff;display:flex;gap:20px;align-items:center;padding:20px">
<img src="${data}" style="width:256px;height:256px;object-fit:cover;border-radius:50%">
<div style="width:256px;height:256px">${svg}</div><div style="width:40px;height:40px">${svg}</div><div style="width:64px;height:64px">${svg}</div></body>`);
await page.waitForTimeout(200);
await page.screenshot({ path: out });
await browser.close();
