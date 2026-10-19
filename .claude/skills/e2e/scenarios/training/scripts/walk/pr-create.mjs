// Lab 1.6 step 1 in the browser: the compare page Create Pull Request opens, checked and filled
// as the lab says. Prints the prefilled title, the range and the start of the template.
// usage: node pr-create.mjs <fork> <base> <head> <title> <bodyFile> [--probe]
// --probe reads and takes the screenshot, and creates nothing.
// The screenshot goes to SHOTS (see cdp.mjs) as pr-create-<head>.png.
// The first "Create pull request" button of the page is hidden: click the visible one.
// A script that throws leaves its tab open: close it through /json/close/<id>.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import fs from "fs";
import { createRequire } from "module";
import { COURSE } from "../env.mjs";
import { SHOTS } from "./cdp.mjs";
const require = createRequire(COURSE + "/package.json");
const { chromium } = require("playwright-core");
const [fork, base, head, title, bodyFile, flag] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "start";
setTimeout(() => { log("WATCHDOG stuck at: " + step); process.exit(2); }, 150000);
step = "connect";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30000 });
const p = await b.contexts()[0].newPage();
step = "goto";
await p.goto(`https://github.com/${fork}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?expand=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.bringToFront();
await p.waitForTimeout(5000);
step = "read";
log("url: " + p.url());
const info = await p.evaluate(() => {
  const t = document.querySelector('input[name="pull_request[title]"], #pull_request_title');
  const d = document.querySelector('textarea[name="pull_request[body]"], #pull_request_body');
  const range = [...document.querySelectorAll(".range-editor summary, .range-editor .css-truncate-target, [data-testid*=ref-selector], .range-cross-repo-pair summary")].map((e) => e.innerText.trim().replace(/\s+/g, " ")).filter(Boolean);
  return { title: t && t.value, body: d && d.value, range: [...new Set(range)].slice(0, 12) };
});
log("prefilled title: " + JSON.stringify(info.title));
log("range: " + JSON.stringify(info.range));
log("prefilled body starts: " + JSON.stringify((info.body || "").slice(0, 120)));
await p.screenshot({ path: `${SHOTS}/pr-create-${head.replace(/[^a-z0-9]/gi, "_")}.png` });
if (flag === "--probe") { await p.close(); process.exit(0); }
step = "fill";
await p.fill('input[name="pull_request[title]"], #pull_request_title', title);
await p.fill('textarea[name="pull_request[body]"], #pull_request_body', fs.readFileSync(bodyFile, "utf8"));
step = "create";
await p.locator('button[type=submit]:has-text("Create pull request"):visible').first().click();
await p.waitForURL(/\/pull\/\d+/, { timeout: 60000 });
log("created: " + p.url());
await p.close();
process.exit(0);
