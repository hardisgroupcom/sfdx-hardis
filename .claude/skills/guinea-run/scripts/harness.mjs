// Opens a Guinea Run world on the served course site and takes screenshots.
//   node harness.mjs <world|map> <outDir> [query] [steps-json]
// The built site must be served on GUINEA_PORT (default 8765), for example:
//   node --input-type=module -e "import { serveSite } from './scripts/lib/site-server.mjs'; await serveSite(8765);"
// GPU=1 uses the real WebGPU backend, MOBILE=1 a phone, LANG_PAGE=fr the French page.
// Steps: {"key": "Enter"}, {"keys": [...], "gap": ms}, {"click": selector},
// {"eval": "js expression"}, {"wait": ms}, {"shot": "name"}, in any mix.
import { playwright } from "./training-repo.mjs";

const { chromium } = await playwright();
const world = process.argv[2] ?? "0";
const out = process.argv[3];
const extra = process.argv[4] || "";
const steps = process.argv[5] ? JSON.parse(process.argv[5]) : [{ wait: 3000, shot: "play" }];
const port = process.env.GUINEA_PORT || "8765";
const mobile = process.env.MOBILE === "1";
const lang = process.env.LANG_PAGE || "en";

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: process.env.GPU === "1" ? ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu", "--use-angle=d3d11"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
});
const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 } });
await context.route(/google-analytics\.com|googletagmanager\.com/, (r) => r.abort());
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/giscus|Failed to load resource/.test(m.text())) {
    errors.push("console: " + m.text());
  }
});
const query = world === "map" ? "?guinea-seed=3" + extra : "?guinea-unlock=all&guinea-world=" + world + "&guinea-seed=3" + extra;
await page.goto("http://127.0.0.1:" + port + "/" + lang + "/" + query, { waitUntil: "load" });
// The Konami code opens the game
for (const k of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) {
  await page.keyboard.press(k);
}
const want = world === "map" ? "map" : "intro";
await page
  .waitForFunction((v) => document.querySelector(".guinea-run")?.dataset.state === v, want, { timeout: 40000 })
  .catch(() => errors.push("never reached state " + want));
await page.waitForTimeout(800);
await page.screenshot({ path: out + "/w" + world + "-0-" + want + ".png" });
let i = 1;
for (const step of steps) {
  if (step.key) {
    await page.keyboard.press(step.key);
  }
  if (step.keys) {
    for (const k of step.keys) {
      await page.keyboard.press(k);
      await page.waitForTimeout(step.gap || 120);
    }
  }
  if (step.click) {
    await page.click(step.click).catch((e) => errors.push("click " + step.click + ": " + e.message.split("\n")[0]));
  }
  if (step.eval) {
    const r = await page.evaluate(step.eval).catch((e) => "eval error " + e.message);
    console.log("eval:", JSON.stringify(r));
  }
  if (step.wait) {
    await page.waitForTimeout(step.wait);
  }
  if (step.shot) {
    await page.screenshot({ path: out + "/w" + world + "-" + i + "-" + step.shot + ".png" });
    i += 1;
  }
}
const state = await page.evaluate(() => {
  const o = document.querySelector(".guinea-run");
  return o ? Object.fromEntries(Object.entries(o.dataset)) : null;
});
console.log("final dataset:", JSON.stringify(state));
console.log(errors.length ? errors.join("\n") : "no errors");
await browser.close();
