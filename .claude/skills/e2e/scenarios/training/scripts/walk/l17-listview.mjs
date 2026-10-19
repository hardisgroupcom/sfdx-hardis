// Lab 1.7: the Open Installations list view, clicked in Lightning as a learner does.
// usage: node l17-listview.mjs <org> <stage> [--keep]   stage: new | filters | fields | look
// --keep leaves the tab open for l17-lv2.mjs, which carries on in it.
// The screenshots go to SHOTS (see cdp.mjs) as lv-*.png.
// Role and text locators pierce the Lightning shadow DOM, CSS selectors on inner parts do not.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done (unless --keep). It never starts or closes the browser.
import { openPage, SHOTS } from "./cdp.mjs";
const [org, stage] = process.argv.slice(2);
const dir = SHOTS + "/";
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "start";
setTimeout(() => { log("WATCHDOG stuck at: " + step); process.exit(2); }, 200000);
const page = await openPage(org, stage === "new" ? "/lightning/o/Installation__c/list" : "/lightning/o/Installation__c/list?filterName=Open_Installations");
await page.waitForTimeout(4000);
const shot = async (n) => { await page.bringToFront(); await page.screenshot({ path: dir + n + ".png" }); log("shot " + n); };
const dumpButtons = async () => log("buttons: " + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("button, a[role=menuitem], lightning-menu-item a, li[role=presentation] a")].filter((e) => e.offsetParent).map((e) => (e.title || e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40)).filter(Boolean).slice(0, 80))));
try {
  if (stage === "new") {
    step = "controls";
    await page.locator('button[title="List View Controls"]').first().click();
    await page.waitForTimeout(1500);
    step = "menu New";
    await page.locator('a[role=menuitem]:has-text("New"), [role=menuitem]:has-text("New")').first().click();
    await page.waitForTimeout(2500);
    await shot("lv-new-dialog");
    step = "name";
    const name = page.getByLabel("List Name", { exact: false }).first();
    await name.fill("Open Installations");
    await name.press("Tab");
    await page.waitForTimeout(800);
    step = "sharing";
    
    await page.getByText("All users can see this list view", { exact: true }).first().click();
    await shot("lv-new-filled");
    step = "save";
    await page.getByRole("button", { name: "Save", exact: true }).last().click();
    await page.waitForTimeout(6000);
    await shot("lv-after-save");
    log("url " + page.url());
    await dumpButtons();
  } else if (stage === "filters") {
    step = "open filters";
    if (!(await page.getByText("Filter by Owner").count())) await page.locator('button[title="Show filters"], button[title="Filters"]').first().click();
    await page.waitForTimeout(1500);
    step = "owner card";
    await page.getByText("Filter by Owner").first().click();
    await page.waitForTimeout(1500);
    await shot("lv-owner");
    step = "all installations";
    await page.getByText("All installations", { exact: true }).first().click();
    await page.getByRole("button", { name: "Done", exact: true }).first().click();
    await page.waitForTimeout(1500);
    step = "add filter";
    await page.getByText("Add Filter", { exact: true }).first().click();
    await page.waitForTimeout(2000);
    await shot("lv-addfilter");
    await dumpButtons();
    log("inputs: " + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("input, select, button[role=combobox], [role=combobox]")].filter((e) => e.offsetParent).map((e) => `${e.tagName}|${e.type || ""}|${e.name || ""}|${(e.getAttribute("aria-label") || e.placeholder || e.innerText || e.value || "").trim().slice(0, 30)}`).slice(0, 40))));
  } else {
    await shot("lv-" + stage);
    await dumpButtons();
  }
} catch (e) {
  log("FAILED at " + step + ": " + String(e).split("\n")[0]);
  await shot("lv-fail-" + stage).catch(() => {});
  await dumpButtons().catch(() => {});
}
if (!process.argv.includes("--keep")) await page.close();
process.exit(0);
