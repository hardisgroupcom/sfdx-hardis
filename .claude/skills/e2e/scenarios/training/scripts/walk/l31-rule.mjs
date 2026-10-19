// Lab 3.1 step 3 in the browser: Settings > Branches > Add rule, the five things of the lab,
// Create.
// usage: node l31-rule.mjs <fork> <pattern> [--probe]
// --probe fills the form, takes the screenshot, and creates nothing.
// The screenshots go to SHOTS (see cdp.mjs) as l31-rule-<pattern>.png, -after.png and
// l31-rule-error.png.
// GitHub asks to confirm access (sudo mode) before it saves the rule, and a walk cannot answer
// that: the script says SUDO PROMPT, and the rule is then created with the lab's own gh api call.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { createRequire } from "module";
import { COURSE } from "../env.mjs";
import { SHOTS } from "./cdp.mjs";
const require = createRequire(COURSE + "/package.json");
const { chromium } = require("playwright-core");
const [fork, pattern, flag] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "connect";
setTimeout(() => { log("WATCHDOG stuck at: " + step); process.exit(2); }, 150000);
const b = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30000 });
const p = await b.contexts()[0].newPage();
process.on("uncaughtException", async (e) => { log("ERROR at " + step + ": " + String(e.message).split(String.fromCharCode(10))[0]); await p.screenshot({ path: SHOTS + "/l31-rule-error.png", fullPage: true }).catch(() => {}); await p.close().catch(() => {}); process.exit(1); });
process.on("unhandledRejection", (e) => { throw e; });
await p.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});
step = "goto";
await p.goto(`https://github.com/${fork}/settings/branches`, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.bringToFront();
await p.waitForTimeout(4000);
step = "add rule";
await p.getByRole("link", { name: "Add rule" }).or(p.getByRole("button", { name: "Add rule" })).first().click();
await p.waitForTimeout(4000);
log("form url: " + p.url());
step = "pattern";
await p.getByLabel(/Branch name pattern/).fill(pattern);
step = "require PR";
const pr = p.getByLabel("Require a pull request before merging");
await pr.check();
await p.waitForTimeout(1000);
const approvals = p.getByLabel("Require approvals", { exact: true });
log("Require approvals ticked on arrival: " + (await approvals.isChecked()));
if (await approvals.isChecked()) await approvals.uncheck();
step = "status checks";
await p.getByLabel("Require status checks to pass before merging").check();
await p.waitForTimeout(1000);
for (const [typed, pick] of [["Simulate", "Simulate Deployment to Major Org"], ["Mega", "Mega-Linter"]]) {
  step = "search " + typed;
  const search = p.getByPlaceholder(/Search for status checks/).or(p.locator("#status-checks-input, input[aria-label*='status checks' i]")).first();
  await search.click();
  await search.fill("");
  await search.pressSequentially(typed, { delay: 80 });
  await p.waitForTimeout(3000);
  const opts = await p.locator("[role=option], .select-menu-item, .ActionListItem").filter({ hasText: pick }).allInnerTexts();
  log(`suggestions for "${typed}": ` + JSON.stringify(opts.map((t) => t.replace(/\s+/g, " ").trim()).slice(0, 6)));
  await p.locator("[role=option], .select-menu-item, .ActionListItem").filter({ hasText: pick }).first().click();
  await p.waitForTimeout(1500);
}
step = "no bypass";
await p.getByLabel("Do not allow bypassing the above settings").check();
await p.waitForTimeout(500);
await p.screenshot({ path: `${SHOTS}/l31-rule-${pattern}.png`, fullPage: true });
const required = await p.evaluate(() => document.body.innerText.match(/Status checks that are required[\s\S]{0,300}/)?.[0]);
log("required box: " + (required || "").replace(/\s+/g, " "));
if (flag === "--probe") { await p.close(); process.exit(0); }
step = "create";
const create = p.getByRole("button", { name: "Create", exact: true });
log("Create button count: " + (await create.count()));
await create.first().click();
await p.waitForTimeout(6000);
log("after: " + p.url());
await p.screenshot({ path: `${SHOTS}/l31-rule-${pattern}-after.png` });
log("page says: " + (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 600));
if (/sudo|sessions/.test(p.url())) log("SUDO PROMPT: GitHub asks to confirm access");
await p.close();
process.exit(0);
