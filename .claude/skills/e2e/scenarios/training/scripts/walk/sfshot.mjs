// Stands in for a learner looking at a Salesforce page: opens a page of an org, prints its text
// (or what matches a regex), takes a screenshot.
// usage: node sfshot.mjs <org> <path> <out.png> [grep regex]
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { openPage } from "./cdp.mjs";
const [org, p, out, re] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "open";
setTimeout(() => { log("WATCHDOG stuck at: " + step); process.exit(2); }, 120000);
const page = await openPage(org, p);
await page.waitForTimeout(7000);
step = "read";
const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
if (re) { const m = body.match(new RegExp(re)); log("match: " + (m ? m[0].slice(0, 600) : "NONE")); } else log(body.slice(0, 1500));
step = "shot";
await page.bringToFront();
await page.screenshot({ path: out, fullPage: false });
log("shot " + out);
await page.close();
process.exit(0);
