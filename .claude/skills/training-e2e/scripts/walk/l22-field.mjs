// Lab 2.2 step 2 in the browser: Setup > Object Manager > <object> > Fields & Relationships > New,
// a Checkbox field, Default Value Unchecked, field-level security cleared with the Visible header
// checkbox then Visible for one profile only, every page layout unticked, Save.
// usage: node l22-field.mjs <org> <objectApiName> <label> <visibleProfile> [shotDir]
// Logs each step with the time, exits 2 from its watchdog with the step it was stuck at.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { openPage, frameWith, durableId, dump } from "./cdp.mjs";
const [org, obj, label, visibleProfile, shotDir] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "start", page;
setTimeout(async () => { log("WATCHDOG stuck at: " + step); try { if (page) await dump(page, step); await page.close(); } catch {} process.exit(2); }, 300000);
const shot = async (name) => { if (shotDir) { await page.bringToFront(); await page.screenshot({ path: `${shotDir}/${name}.png` }); log(`shot ${shotDir}/${name}.png`); } };

step = "durable id";
const objId = durableId(org, obj);
step = "open fields list";
page = await openPage(org, `/lightning/setup/ObjectManager/${objId}/FieldsAndRelationships/view`);
step = "new";
await page.locator('button[title="Custom Field"]').first().click();
await page.waitForTimeout(8000);

step = "data type";
let f = await frameWith(page, "input[name=goNext]", 60000);
const picked = await f.evaluate(() => {
  const l = [...document.querySelectorAll("label")].find((x) => x.innerText.trim() === "Checkbox");
  if (!l) return false;
  document.getElementById(l.htmlFor).click();
  return true;
});
if (!picked) throw new Error("no Checkbox data type");
await f.click("input[name=goNext]");
await page.waitForTimeout(6000);

step = "details";
f = await frameWith(page, "input[name=MasterLabel]", 60000);
await f.fill("input[name=MasterLabel]", label);
await f.click("input[name=DeveloperName]");
await page.waitForTimeout(1500);
const defaults = await f.evaluate(() => [...document.querySelectorAll("input[type=radio]")].map((r) => `${r.name}=${r.value}:${r.checked}`));
log("DeveloperName: " + (await f.inputValue("input[name=DeveloperName]")) + ", radios: " + JSON.stringify(defaults));
await shot("details");
await f.click("input[name=goNext]");
await page.waitForTimeout(6000);

step = "field-level security";
f = await frameWith(page, "input[name=goNext]", 60000);
const before = await f.evaluate(() => [...document.querySelectorAll("td input[type=checkbox]")].filter((b) => b.checked).length);
log("FLS ticked on arrival: " + before);
for (let i = 0; i < 2; i++) {
  await f.evaluate(() => [...document.querySelectorAll("th")].find((x) => /Visible/.test(x.innerText) && x.querySelector("input[type=checkbox]")).querySelector("input[type=checkbox]").click());
  await page.waitForTimeout(800);
  log(`after header click ${i + 1}: ` + (await f.evaluate(() => [...document.querySelectorAll("td input[type=checkbox]")].filter((b) => b.checked).length)) + " ticked");
  if ((await f.evaluate(() => [...document.querySelectorAll("td input[type=checkbox]")].filter((b) => b.checked).length)) === 0) break;
}
const row = await f.evaluate((want) => {
  const tr = [...document.querySelectorAll("tr")].filter((x) => x.querySelectorAll("tr").length === 0).find((x) => x.innerText.trim().startsWith(want));
  if (!tr) return null;
  const box = tr.querySelector("input[type=checkbox]");
  box.click();
  return tr.innerText.trim().slice(0, 60) + " -> " + box.checked;
}, visibleProfile);
log("visible for: " + row);
log("ticked now: " + (await f.evaluate(() => [...document.querySelectorAll("td input[type=checkbox]")].filter((b) => b.checked).length)));
await shot("fls");
await f.click("input[name=goNext]");
await page.waitForTimeout(6000);

step = "page layout";
f = await frameWith(page, "input[name=save]", 60000);
const layouts = await f.evaluate(() => [...document.querySelectorAll("tr")].filter((tr) => tr.querySelector("input[type=checkbox]") && tr.querySelectorAll("tr").length === 0).map((tr) => {
  const b = tr.querySelector("input[type=checkbox]");
  const was = b.checked;
  if (b.checked) b.click();
  return `${tr.innerText.replace(/\s+/g, " ").trim()}: ${was} -> ${b.checked}`;
}));
log("layouts: " + JSON.stringify(layouts));
await shot("layouts");
step = "save";
await f.click("input[name=save]");
await page.waitForTimeout(10000);
const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
const err = body.match(/Error[^.]{0,200}/);
log(err ? "ERROR " + err[0] : "saved, url " + page.url().slice(0, 140));
await page.close();
process.exit(0);
