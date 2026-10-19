// Lab 2.2 step 2 in the browser: Setup > Object Manager > <object> > Fields & Relationships > New,
// a Checkbox field, Default Value Unchecked, field-level security cleared with the Visible header
// checkbox then Visible for one profile only, every page layout unticked, Save.
// usage: node l22-field.mjs <org> <objectApiName> <label> <visibleProfile> [shotDir]
// The profile row is matched on its exact label. Logs each step with the time, exits 2 from its
// watchdog with the step it was stuck at, and 1 when a step fails or the save is refused.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes whatever happens.
/* jscpd:ignore-start */
import { openPage, frameWith, durableId, dump, saveError } from "./cdp.mjs";
const [org, obj, label, visibleProfile, shotDir] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "start", page = null;
setTimeout(async () => { log("WATCHDOG stuck at: " + step); try { if (page) await dump(page, step); await page.close(); } catch {} process.exit(2); }, 300000);
const shot = async (name) => { if (shotDir) { await page.bringToFront(); await page.screenshot({ path: `${shotDir}/${name}.png` }); log(`shot ${shotDir}/${name}.png`); } };
const tickedCount = (f) => f.evaluate(() => [...document.querySelectorAll("td input[type=checkbox]")].filter((b) => b.checked).length);

let code = 0;
try {
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
  log("FLS ticked on arrival: " + (await tickedCount(f)));
  for (let i = 0; i < 2 && (await tickedCount(f)) > 0; i++) {
    await f.evaluate(() => [...document.querySelectorAll("th")].find((x) => /Visible/.test(x.innerText) && x.querySelector("input[type=checkbox]")).querySelector("input[type=checkbox]").click());
    await page.waitForTimeout(800);
    log(`after header click ${i + 1}: ` + (await tickedCount(f)) + " ticked");
  }
  const left = await tickedCount(f);
  if (left > 0) throw new Error(`${left} Visible box(es) still ticked after the header clicks`);
  const row = await f.evaluate((want) => {
    // The profile name is the first cell of an innermost row
    const tr = [...document.querySelectorAll("tr")]
      .filter((x) => x.querySelectorAll("tr").length === 0 && x.querySelector("input[type=checkbox]"))
      .find((x) => (x.cells[0]?.innerText || "").trim() === want);
    if (!tr) return null;
    const box = tr.querySelector("input[type=checkbox]");
    if (!box.checked) box.click();
    return tr.cells[0].innerText.trim() + " -> " + box.checked;
  }, visibleProfile);
  log("visible for: " + row);
  if (!row) throw new Error("no profile row named " + visibleProfile);
  log("ticked now: " + (await tickedCount(f)));
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
  const err = await saveError(page);
  log(err ? "ERROR " + err : "saved, url " + page.url().slice(0, 140));
  if (err) code = 1;
} catch (e) {
  log(`FAILED at ${step}: ${e.message.split("\n")[0]}`);
  code = 1;
} finally {
  await page?.close().catch(() => {});
}
process.exit(code);
/* jscpd:ignore-end */
