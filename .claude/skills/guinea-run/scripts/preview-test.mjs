// Serves a built preview like an Artifact does and plays it on a phone-sized
// page: Play opens the map, world 0 starts and plays; the "Try world" button,
// when the launcher shows it, opens its world and plays it.
//   node preview-test.mjs <outDir> [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { playwright } from "./training-repo.mjs";

const { chromium } = await playwright();
const root = process.argv[2];
const port = Number(process.argv[3] || 8790);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".mp3": "audio/mpeg", ".wasm": "application/wasm" };
const server = http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") {
      p = "/index.html";
    }
    const file = path.join(root, p);
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end();
      if (!p.endsWith("favicon.ico")) {
        console.log("404", p);
      }
      return;
    }
    let body = fs.readFileSync(file);
    // An Artifact wraps the page in its own document skeleton
    if (p === "/index.html") {
      body = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>" + body;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  })
  .listen(port);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu", "--use-angle=d3d11"] });
const state = (page) => page.evaluate(() => document.querySelector(".guinea-run")?.dataset.state);
const until = (page, wanted) =>
  page.waitForFunction((v) => document.querySelector(".guinea-run")?.dataset.state === v, wanted, { timeout: 60000 }).catch(() => console.log("never reached", wanted));
let failed = false;

async function play(button, world) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => {
    failed = true;
    console.log("page error:", e.message);
  });
  await page.goto("http://127.0.0.1:" + port + "/");
  if (button === "#try" && (await page.isHidden("#try"))) {
    await page.close();
    return;
  }
  await page.click(button);
  if (button === "#play") {
    await until(page, "map");
    console.log("Play:", await state(page));
    await page.click('.guinea-run [data-action="play"][data-world="' + world + '"]');
  }
  await until(page, "intro");
  await page.click('.guinea-run [data-action="start"]');
  await page.waitForTimeout(4000);
  const now = await state(page);
  console.log("world " + (await page.evaluate(() => document.querySelector(".guinea-run")?.dataset.world)) + ":", now);
  failed = failed || now !== "playing";
  await page.close();
}

await play("#play", 0);
await play("#try");
await browser.close();
server.close();
console.log(failed ? "preview FAILED" : "preview ok");
process.exit(failed ? 1 : 0);
