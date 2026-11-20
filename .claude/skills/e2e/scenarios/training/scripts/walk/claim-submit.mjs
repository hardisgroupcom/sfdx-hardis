// Submits the badge claim form in the e2e Chrome (signed in to GitHub), as a learner does:
// opens the prefilled URL, picks the Level dropdown (a link cannot prefill it), ticks the
// three boxes, clicks Create. usage: node claim-submit.mjs <urlFile> <levelLabel> [--probe]
import fs from "fs";
import { createRequire } from "module";
import { COURSE } from "../env.mjs";
import { SHOTS } from "./cdp.mjs";
const require = createRequire(COURSE + "/package.json");
const { chromium } = require("playwright-core");
const [urlFile, levelLabel, flag] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "start";
setTimeout(() => { log("WATCHDOG stuck at: " + step); process.exit(2); }, 150000);
step = "connect";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30000 });
const p = await b.contexts()[0].newPage();
try {
  step = "goto";
  await p.goto(fs.readFileSync(urlFile, "utf8").trim(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.bringToFront();
  await p.waitForTimeout(5000);
  log("url: " + p.url());
  step = "dropdown";
  const dd = p.locator("button", { hasText: /^\s*None\s*$/ }).first();
  log("dropdown on arrival: " + JSON.stringify((await dd.innerText()).trim()));
  await dd.click();
  await p.waitForTimeout(800);
  log("options: " + JSON.stringify(await p.getByRole("menuitemradio").allInnerTexts().catch(() => [])));
  await p.getByRole("menuitemradio", { name: levelLabel, exact: false }).first().click();
  await p.waitForTimeout(800);
  log("dropdown now: " + JSON.stringify((await p.locator("button", { hasText: levelLabel }).first().innerText()).trim()));
  step = "boxes";
  const boxes = p.getByRole("checkbox", { name: /My repository is public|I understand/ });
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  log("checkboxes ticked: " + n);
  await p.screenshot({ path: `${SHOTS}/claim-form-${levelLabel[0]}.png` });
  if (flag === "--probe") { await p.close(); process.exit(0); }
  step = "submit";
  await p.getByRole("button", { name: /^Create(?! more| new)/ }).last().click();
  await p.waitForURL(/\/issues\/\d+/, { timeout: 60000 });
  log("created: " + p.url());
} catch (e) {
  log("FAILED at " + step + ": " + String(e).split("\n")[0]);
  await p.screenshot({ path: `${SHOTS}/claim-fail.png` }).catch(() => {});
}
await p.close().catch(() => {});
process.exit(0);
