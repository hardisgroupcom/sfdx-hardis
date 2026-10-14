// Lab 1.4 steps 4 and 5 in the browser: open an installation, find Panels Required with its help
// text, read the timeline, type the total with the pencil and Save.
// usage: node l14-record.mjs <org> <INST name> <field label> [value|sum] [shot.png]
// sum (the default) types the sum of the pallets of the installation, read from the org.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { execSync } from "child_process";
import { openPage } from "./cdp.mjs";
const [org, name, label, valueArg = "sum", shot] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "start";
setTimeout(() => { log("WATCHDOG stuck at: " + step); process.exit(2); }, 240000);
const q = (soql) => JSON.parse(execSync(`sf data query --json -o ${org} -q "${soql}"`, { encoding: "utf8" })).result.records;
const rec = q(`SELECT Id FROM Installation__c WHERE Name = '${name}'`)[0];
step = "open";
const page = await openPage(org, `/lightning/r/Installation__c/${rec.Id}/view`);
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
const input = page.locator(`input[name="Panels_Required__c"], input[name="Crew_Notes__c"]`).first();
await input.waitFor({ timeout: 15000 });
await input.fill(value);
step = "save";
await page.locator('button[name="SaveEdit"]').first().click();
await page.waitForTimeout(6000);
const after = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
const err = after.match(/(We hit a snag|Review the errors)[^.]{0,200}/);
log(err ? "ERROR " + err[0] : "saved");
await page.close();
log("org value: " + JSON.stringify(q(`SELECT Name, ${label.replace(/ /g, "_")}__c FROM Installation__c WHERE Id = '${rec.Id}'`)[0]));
process.exit(0);
