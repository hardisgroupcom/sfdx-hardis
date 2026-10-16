// Lab 1.4 step 2 (and Lab 1.7) in the browser: Setup > Object Manager > <object> > Fields &
// Relationships > New, then the custom field wizard as a learner clicks it: data type, details,
// field-level security (every Visible box cleared with the header checkbox), page layout, Save.
// usage: node l14-field.mjs <org> <objectApiName> <Number|LongTextArea> <label> <length> <description> <helpText> [shotDir]
// Number gets 0 decimal places; LongTextArea gets the default visible lines.
// Logs each step with the time, exits 2 from its watchdog with the step it was stuck at.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { openPage, frameWith, durableId, dump } from "./cdp.mjs";
const [org, obj, type, label, length, description, helpText, shotDir] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "start", page;
setTimeout(async () => { log("WATCHDOG stuck at: " + step); try { if (page) await dump(page, step); await page.close(); } catch {} process.exit(2); }, 300000);
const shot = async (name) => { if (shotDir) { await page.bringToFront(); await page.screenshot({ path: `${shotDir}/${name}.png` }); log(`shot ${shotDir}/${name}.png`); } };

step = "durable id";
const objId = durableId(org, obj);
log(`${obj} is ${objId}`);
step = "open fields list";
page = await openPage(org, `/lightning/setup/ObjectManager/${objId}/FieldsAndRelationships/view`);
await shot("fields-list");
step = "new";
await page.locator('button[title="Custom Field"]').first().click();
await page.waitForTimeout(8000);

step = "data type";
const typeCodes = { Number: "Number", LongTextArea: "Text Area (Long)" };
let f = await frameWith(page, "input[name=goNext]", 60000);
const picked = await f.evaluate((want) => {
  const labels = [...document.querySelectorAll("label")];
  const l = labels.find((x) => x.innerText.trim() === want);
  if (!l) return { ok: false, sample: labels.map((x) => x.innerText.trim()).slice(0, 30) };
  const input = document.getElementById(l.htmlFor);
  input.click();
  return { ok: true, id: l.htmlFor };
}, typeCodes[type]);
log("type radio: " + JSON.stringify(picked));
if (!picked.ok) throw new Error("no data type " + type);
await f.click("input[name=goNext]");
await page.waitForTimeout(6000);

step = "details";
f = await frameWith(page, "input[name=MasterLabel]", 60000);
await f.fill("input[name=MasterLabel]", label);
await f.click("input[name=DeveloperName]");
await page.waitForTimeout(1500);
if (type === "Number") {
  await f.fill("input[name=digleft]", length);
  await f.fill("input[name=Scale]", "0");
} else {
  await f.fill("input[name=Length]", length).catch(async () => { await f.fill("input[name=digleft]", length); });
}
await f.fill("textarea[name=Description]", description);
await f.fill("textarea[name=InlineHelpText]", helpText);
const req = await f.$("input[name=options_0]");
log("DeveloperName: " + (await f.inputValue("input[name=DeveloperName]")) + ", Required ticked: " + (req ? await req.isChecked() : "no box"));
await shot("details");
await f.click("input[name=goNext]");
await page.waitForTimeout(6000);

step = "field-level security";
f = await frameWith(page, "input[name=goNext]", 60000);
const fls = await f.evaluate(() => {
  const boxes = [...document.querySelectorAll("input[type=checkbox]")];
  return { total: boxes.length, ticked: boxes.filter((b) => b.checked).length, names: boxes.slice(0, 6).map((b) => `${b.name}|${b.id}|${b.title}|${b.checked}`) };
});
log("FLS boxes on arrival: " + JSON.stringify(fls));
await shot("fls-arrival");
// The lab: the checkbox in the Visible column header toggles the whole column; click it once to
// tick everything and again to leave nothing ticked.
const header = await f.evaluate(() => {
  const th = [...document.querySelectorAll("th")].find((x) => /Visible/.test(x.innerText) && x.querySelector("input[type=checkbox]"));
  if (!th) return null;
  const box = th.querySelector("input[type=checkbox]");
  return box.id || box.name || "found-without-id";
});
log("Visible header checkbox: " + header);
if (header) {
  for (let i = 0; i < 2; i++) {
    await f.evaluate(() => [...document.querySelectorAll("th")].find((x) => /Visible/.test(x.innerText) && x.querySelector("input[type=checkbox]")).querySelector("input[type=checkbox]").click());
    await page.waitForTimeout(800);
    log(`after header click ${i + 1}: ` + (await f.evaluate(() => [...document.querySelectorAll("td input[type=checkbox]")].filter((b) => b.checked).length)) + " ticked");
  }
}
await f.click("input[name=goNext]");
await page.waitForTimeout(6000);

step = "page layout";
f = await frameWith(page, "input[name=save]", 60000);
const layouts = await f.evaluate(() => [...document.querySelectorAll("tr")].filter((tr) => tr.querySelector("input[type=checkbox]") && tr.querySelectorAll("tr").length === 0).map((tr) => `${tr.innerText.replace(/\s+/g, " ").trim()}=${tr.querySelector("input[type=checkbox]").checked}`));
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
