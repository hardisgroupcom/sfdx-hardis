// Stands in for a learner reading a GitHub page (a Pull Request, its checks, a job): prints the
// text matching a regex, takes a screenshot (of the bottom of the page when asked).
// usage: node gh-look.mjs <url> <out.png> [bottom] [regex]
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { createRequire } from "module";
import { COURSE } from "../env.mjs";
const require = createRequire(COURSE + "/package.json");
const { chromium } = require("playwright-core");
const [url, out, where = "top", re] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "start";
setTimeout(() => { log("WATCHDOG stuck at: " + step); process.exit(2); }, 120000);
step = "connect";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30000 });
const p = await b.contexts()[0].newPage();
await p.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});
step = "goto";
await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.bringToFront();
await p.waitForTimeout(6000);
if (where === "bottom") { step = "scroll"; await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(3000); }
step = "text";
const text = (await p.evaluate(() => document.body.innerText)).replace(/[ \t]+/g, " ");
if (re) for (const m of text.matchAll(new RegExp(re, "g"))) log("match: " + m[0].replace(/\n+/g, " | ").slice(0, 300));
step = "shot";
await p.screenshot({ path: out });
log("shot " + out);
await p.close();
process.exit(0);
