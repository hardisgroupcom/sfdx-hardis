// Reads Setup > Deliverability of an org: the Access level selected in its classic iframe.
// usage: node deliv-read.mjs <org>
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { openPage, frameWith } from "./cdp.mjs";
const [org] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
setTimeout(() => { log("WATCHDOG"); process.exit(2); }, 90000);
const page = await openPage(org, "/lightning/setup/OrgEmailSettings/home");
const f = await frameWith(page, "select", 40000);
const sel = await f.evaluate(() => [...document.querySelectorAll("select")].map((s) => `${s.name || s.id}=${s.options[s.selectedIndex]?.text}`));
log("selects: " + JSON.stringify(sel));
await page.close();
process.exit(0);
