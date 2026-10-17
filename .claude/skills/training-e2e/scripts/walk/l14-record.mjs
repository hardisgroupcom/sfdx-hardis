// Lab 1.4 steps 4 and 5 in the browser: open an installation, find Panels Required with its help
// text, read the timeline, type the total with the pencil and Save.
// usage: node l14-record.mjs <org> <INST name> <field label> [value|sum] [shot.png]
// sum (the default) types the sum of the pallets of the installation, read from the org. The
// field's inline editor can be an input, a textarea (long text) or a checkbox, whose value is
// true or false. Exits 1 when the save is refused.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes whatever happens.
import { execSync } from "child_process";
import { openPage } from "./cdp.mjs";
const [org, name, label, valueArg = "sum", shot] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "start", page = null;
setTimeout(async () => { log("WATCHDOG stuck at: " + step); await page?.close().catch(() => {}); process.exit(2); }, 240000);
const q = (soql) => JSON.parse(execSync(`sf data query --json -o ${org} -q "${soql}"`, { encoding: "utf8" })).result.records;
const apiName = `${label.replace(/ /g, "_")}__c`;
const errorShot = shot ? (/\.png$/i.test(shot) ? shot.replace(/\.png$/i, "-error.png") : shot + "-error.png") : null;

let code = 0;
try {
  const rec = q(`SELECT Id FROM Installation__c WHERE Name = '${name}'`)[0];
  step = "open";
  page = await openPage(org, `/lightning/r/Installation__c/${rec.Id}/view`);
  await page.waitForTimeout(6000);
  step = "read";
  const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
  log("field on page: " + body.includes(label));
  const tl = body.match(/Panel delivery timeline.{0,400}/);
  log("timeline: " + (tl ? tl[0].slice(0, 300) : "NOT FOUND"));
  const help = await page.locator(`lightning-helptext`).count();
  log("help text icons on the page: " + help);
  const hasEditButton = await page.locator('button[name="Edit"]').count();
  log("Edit buttons (lab says none): " + hasEditButton);
  let value = valueArg;
  if (valueArg === "sum") {
    const s = q(`SELECT SUM(Quantity__c) q FROM Panel_Batch__c WHERE Installation__c = '${rec.Id}'`)[0].q;
    value = String(s ?? 0);
    log("sum of the pallets (data): " + value);
  }
  if (shot) { await page.bringToFront(); await page.screenshot({ path: shot }); log("shot " + shot); }
  step = "pencil";
  const pencil = page.locator(`button[title="Edit ${label}"]`).first();
  await pencil.scrollIntoViewIfNeeded();
  await pencil.click();
  step = "type";
  const editor = page.locator(`input[name="${apiName}"], textarea[name="${apiName}"]`).first();
  await editor.waitFor({ timeout: 15000 });
  if ((await editor.getAttribute("type")) === "checkbox") {
    if (value === "true") await editor.check(); else await editor.uncheck();
  } else {
    await editor.fill(value);
  }
  step = "save";
  await page.locator('button[name="SaveEdit"]').first().click();
  await page.waitForTimeout(6000);
  const after = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
  const err = after.match(/(We hit a snag|Review the errors).{0,300}/);
  log(err ? "ERROR " + err[0] : "saved");
  if (err) {
    code = 1;
    if (errorShot) { await page.screenshot({ path: errorShot }); log("shot " + errorShot); }
  }
  log("org value: " + JSON.stringify(q(`SELECT Name, ${apiName} FROM Installation__c WHERE Id = '${rec.Id}'`)[0]));
} catch (e) {
  log(`FAILED at ${step}: ${e.message.split("\n")[0]}`);
  code = 1;
} finally {
  await page?.close().catch(() => {});
}
process.exit(code);
