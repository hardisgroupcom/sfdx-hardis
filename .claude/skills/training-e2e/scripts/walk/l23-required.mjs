// Lab 2.3 step 1 in the browser: Setup > Object Manager > <object> > Fields & Relationships >
// <field> > Edit, tick Required, Confirm the warning Salesforce shows on the tick, then Save.
// usage: node l23-required.mjs <org> <objDurableId> <fieldId15> [shotDir]
// Logs each step with the time, exits 2 from its watchdog with the step it was stuck at.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { openPage, frameWith, dump } from "./cdp.mjs";
const [org, obj, fid, shotDir] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "open", page;
setTimeout(async () => { log("WATCHDOG stuck at: " + step); try { if (page) await dump(page, step); await page.close(); } catch {} process.exit(2); }, 200000);
const shot = async (name) => { if (shotDir) { await page.bringToFront(); await page.screenshot({ path: `${shotDir}/${name}.png` }); log(`shot ${shotDir}/${name}.png`); } };
page = await openPage(org, `/lightning/setup/ObjectManager/${obj}/FieldsAndRelationships/${fid}/view`);
step = "edit button";
let f = await frameWith(page, "input[name=edit]", 40000);
await f.click("input[name=edit]");
await page.waitForTimeout(6000);
step = "required box";
f = await frameWith(page, "input[name=save]", 40000);
const box = await f.evaluate(() => {
  // options_0 is Required: its label is the cell of the row, not a label element
  const b = [...document.querySelectorAll("input[type=checkbox]")].find((x) => /^Required/.test((x.closest("tr")?.innerText || "").trim()));
  if (!b) return null;
  const was = b.checked;
  if (!b.checked) b.click();
  return `${b.name}: ${was} -> ${b.checked}`;
});
log("Required: " + box);
if (!box) { log("checkboxes: " + JSON.stringify(await f.evaluate(() => [...document.querySelectorAll("input[type=checkbox]")].map((b) => b.name + "|" + b.id + "|" + (document.querySelector(`label[for="${b.id}"]`)?.innerText || "").trim() + "|" + (b.closest("tr")?.innerText || "").replace(/\s+/g, " ").slice(0, 60))))); await page.close(); process.exit(3); }
await page.waitForTimeout(2000);
await shot("required");
step = "confirm on tick";
// Salesforce shows its warning as soon as the box is ticked, before Save
const ok = await f.evaluate(() => { const c = [...document.querySelectorAll("input[type=button], input[type=submit], button")].find((x) => (x.value || x.innerText).trim() === "Confirm"); if (!c) return false; c.click(); return true; });
log("confirm clicked: " + ok);
await page.waitForTimeout(2000);
step = "save";
page.on("dialog", async (d) => { log("dialog: " + d.message().replace(/\s+/g, " ").slice(0, 300)); await d.accept(); });
await f.click("input[name=save]");
await page.waitForTimeout(8000);
step = "confirm";
// The warning is a page of its own in some orgs, with a Confirm button, and a browser dialog in others
for (const fr of page.frames()) {
  const c = await fr.$("input[value=Confirm], input[name=confirm], button:has-text('Confirm')").catch(() => null);
  if (c) {
    log("confirm page: " + (await fr.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300))));
    await c.click();
    await page.waitForTimeout(8000);
    break;
  }
}
const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
const err = body.match(/Error[^.]{0,200}/);
log(err ? "ERROR " + err[0] : "saved, url " + page.url().slice(0, 140));
await shot("after");
await page.close();
process.exit(0);
