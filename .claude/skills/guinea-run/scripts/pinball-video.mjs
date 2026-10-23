// Records Pipeline Pinball in motion: screencast frames (with their times) and
// the balls and flippers of every rendered frame, while the bot plays.
//   node pinball-video.mjs <outDir> [seconds] [steps-json]
// The built site must be served (see harness.mjs). MOBILE=1 for a phone, GPU=1
// for WebGPU, NO_AUTOPLAY=1 to leave the flippers alone. Steps run before the
// recording: {"eval": "window.__guineaRun.pinball.jump(1)"}, {"wait": ms}.
// Writes frames/NNNN.jpg, frames.json, track.json; pinball-video.py turns them
// into a GIF, a contact sheet and the speeds of the ball in m/s.
import fs from "node:fs";
import path from "node:path";
import { playwright } from "./training-repo.mjs";

const out = process.argv[2];
const seconds = Number(process.argv[3] || 12);
const extraSteps = process.argv[4] ? JSON.parse(process.argv[4]) : [];
const mobile = process.env.MOBILE === "1";
fs.mkdirSync(path.join(out, "frames"), { recursive: true });
const watchdog = setTimeout(() => {
  console.log("watchdog: too long, exiting");
  process.exit(2);
}, (seconds + 90) * 1000);

const { chromium } = await playwright();
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: process.env.GPU === "1" ? ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu", "--use-angle=d3d11"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
});
const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
await context.route(/google-analytics\.com|googletagmanager\.com/, (r) => r.abort());
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
await page.goto("http://127.0.0.1:" + (process.env.GUINEA_PORT || "8765") + "/en/?guinea-unlock=all&guinea-world=pinball&guinea-seed=3&guinea-test=1", { waitUntil: "load" });
for (const k of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) {
  await page.keyboard.press(k);
}
await page.waitForFunction(() => document.querySelector(".guinea-run")?.dataset.state === "intro", null, { timeout: 40000 });
await page.waitForTimeout(500);
await page.click("[data-action=bonus-new]");
await page.waitForFunction(() => window.__guineaRun && window.__guineaRun.pinball, null, { timeout: 20000 });
console.log("step: game open");
// Record the balls at every rendered frame
await page.evaluate(() => {
  window.__track = [];
  const t0 = performance.now();
  const loop = () => {
    const pb = window.__guineaRun && window.__guineaRun.pinball;
    if (pb) {
      window.__track.push({ t: (performance.now() - t0) / 1000, b: pb.balls(), f: pb.flippers() });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
for (const step of extraSteps) {
  if (step.eval) {
    console.log("eval:", JSON.stringify(await page.evaluate(step.eval).catch((e) => "error " + e.message)));
  }
  if (step.wait) {
    await page.waitForTimeout(step.wait);
  }
}
if (process.env.NO_AUTOPLAY !== "1") {
  await page.evaluate(() => window.__guineaRun.pinball.autoplay(true));
}
const client = await context.newCDPSession(page);
const frames = [];
let n = 0;
client.on("Page.screencastFrame", async (f) => {
  const file = String(n++).padStart(4, "0") + ".jpg";
  fs.writeFileSync(path.join(out, "frames", file), Buffer.from(f.data, "base64"));
  frames.push({ file, t: f.metadata.timestamp });
  await client.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await client.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });
console.log("step: recording");
await page.waitForTimeout(seconds * 1000);
await client.send("Page.stopScreencast");
const track = await page.evaluate(() => window.__track);
fs.writeFileSync(path.join(out, "frames.json"), JSON.stringify(frames));
fs.writeFileSync(path.join(out, "track.json"), JSON.stringify(track));
const fps = frames.length / seconds;
const renderFps = track.length / (track[track.length - 1].t - track[0].t);
console.log("frames", frames.length, "screencast fps", fps.toFixed(1), "render fps", renderFps.toFixed(1));
console.log(errors.length ? errors.join("\n") : "no errors");
await browser.close();
clearTimeout(watchdog);
process.exit(0);
