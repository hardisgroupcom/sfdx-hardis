// Reads Setup > Deliverability of an org: the Access level selected in its classic iframe.
// usage: node deliv-read.mjs <org>
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes whatever happens.
import { openPage, frameWith } from "./cdp.mjs";
const [org] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let page = null;
setTimeout(async () => { log("WATCHDOG"); await page?.close().catch(() => {}); process.exit(2); }, 90000);
let code = 0;
try {
  page = await openPage(org, "/lightning/setup/OrgEmailSettings/home");
  const f = await frameWith(page, "select", 40000);
  const sel = await f.evaluate(() => [...document.querySelectorAll("select")].map((s) => `${s.name || s.id}=${s.options[s.selectedIndex]?.text}`));
  log("selects: " + JSON.stringify(sel));
} catch (e) {
  log("FAILED: " + e.message.split("\n")[0]);
  code = 1;
} finally {
  await page?.close().catch(() => {});
}
process.exit(code);
