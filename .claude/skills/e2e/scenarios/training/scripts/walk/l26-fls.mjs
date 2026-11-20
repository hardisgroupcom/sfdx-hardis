// Lab 2.6 step 1: Set Field-Level Security of a field, tick Visible for one profile, Save.
// usage: node l26-fls.mjs <org> <objDurableId> <fieldId15> <profile label>
// Exit 3 when no row starts with the profile label, 2 when stuck.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { openPage, frameWith } from "./cdp.mjs";
const [org, obj, fid, profile] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "open", page;
setTimeout(async () => { log("WATCHDOG stuck at: " + step); try { await page.close(); } catch {} process.exit(2); }, 100000);
page = await openPage(org, `/lightning/setup/ObjectManager/${obj}/FieldsAndRelationships/${fid}/view`);
log("url " + page.url().slice(0, 140));
step = "button";
const f0 = await frameWith(page, "input[name=fieldAccessEdit]", 40000);
await f0.click("input[name=fieldAccessEdit]");
await page.waitForTimeout(6000);
step = "frame";
const f = await frameWith(page, "input[name=save]", 40000);
step = "row";
const info = await f.evaluate((want) => {
  const rows = [...document.querySelectorAll("tr")].filter((tr) => tr.querySelectorAll("input[type=checkbox]").length >= 1 && tr.querySelectorAll("tr").length === 0);
  const row = rows.find((tr) => (tr.querySelector("th,td") || {}).innerText && tr.innerText.replace(/\s+/g, " ").trim().startsWith(want));
  if (!row) return { n: rows.length, found: false, sample: rows.slice(0, 5).map((r) => r.innerText.replace(/\s+/g, " ").trim().slice(0, 40)) };
  const boxes = row.querySelectorAll("input[type=checkbox]");
  const before = [...boxes].map((b) => b.checked);
  if (!boxes[0].checked) boxes[0].click();
  return { n: rows.length, found: true, before, after: [...boxes].map((b) => b.checked) };
}, profile);
log(JSON.stringify(info));
if (!info.found) { await page.close(); process.exit(3); }
step = "save";
await f.click("input[name=save]");
await page.waitForTimeout(7000);
log("saved, url " + page.url().slice(0, 120));
await page.close();
process.exit(0);
