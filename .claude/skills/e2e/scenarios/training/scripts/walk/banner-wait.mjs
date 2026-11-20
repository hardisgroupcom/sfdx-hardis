// Lab 1.2, while init waits: waits for the fork to exist, then clicks the "I understand my
// workflows" banner of its Actions tab, as the learner does. Logs each step, watchdog (50
// minutes), explicit exit: 0 clicked, 1 no banner, 2 stuck.
// usage: node banner-wait.mjs <fork>      fork is <login>/sfdx-hardis-training
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { execSync } from "child_process";
import { createRequire } from "module";
import { COURSE } from "../env.mjs";
const require = createRequire(COURSE + "/package.json");
const { chromium } = require("playwright-core");
const fork = process.argv[2];
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "start";
const dog = setTimeout(() => { log("WATCHDOG stuck at: " + step); process.exit(2); }, 50 * 60 * 1000);
const exists = () => { try { execSync(`gh api repos/${fork} -q .full_name`, { stdio: "pipe" }); return true; } catch { return false; } };
step = "wait fork";
while (!exists()) await new Promise((r) => setTimeout(r, 5000));
log("fork exists");
await new Promise((r) => setTimeout(r, 8000));
step = "connect";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30000 });
const p = await b.contexts()[0].newPage();
let clicked = false;
for (let i = 0; i < 20 && !clicked; i++) {
  step = "goto " + i;
  await p.goto(`https://github.com/${fork}/actions`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.bringToFront();
  const btn = p.locator('button:has-text("I understand my workflows"), input[value*="I understand my workflows"]');
  try {
    await btn.first().waitFor({ timeout: 10000 });
    log("banner text: " + (await btn.first().innerText().catch(() => "?")).trim());
    await btn.first().click();
    await p.waitForTimeout(5000);
    clicked = true;
    log("clicked, now at " + p.url());
  } catch {
    log("no banner yet: " + (await p.title()));
    await p.waitForTimeout(5000);
  }
}
await p.close();
clearTimeout(dog);
log(clicked ? "DONE clicked" : "DONE no banner");
process.exit(clicked ? 0 : 1);
