// Lab 1.7, continued in the tab l17-listview.mjs left open: the Status filter, then Save.
// usage: node l17-lv2.mjs <step> [<step> ...]
//   step: field | operator | value | card | popsave | panelsave | fields | done | save | close
//   any other word only takes the screenshot
// The screenshots go to SHOTS (see cdp.mjs) as lv2-<step>.png.
// The filter popup and the panel both have a Save button: popsave is the one left of x=1250,
// panelsave the other. Save the popup first. Never press Escape in the popup, it drops the filter.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and works in the
// list view tab it finds there. It never starts or closes the browser; "close" closes that tab.
import { createRequire } from "module";
import { COURSE } from "../env.mjs";
import { SHOTS } from "./cdp.mjs";
const require = createRequire(COURSE + "/package.json");
const { chromium } = require("playwright-core");
const dir = SHOTS + "/";
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "start";
setTimeout(() => { log("WATCHDOG stuck at: " + step); process.exit(2); }, 120000);
const b = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30000 });
const page = b.contexts()[0].pages().find((p) => /Installation__c\/list/.test(p.url()));
if (!page) { log("no list view tab"); process.exit(1); }
await page.bringToFront();
const shot = async (n) => { await page.screenshot({ path: dir + n + ".png" }); log("shot " + n); };
const options = async () => log("options: " + JSON.stringify(await page.getByRole("option").allInnerTexts().catch(() => [])).slice(0, 600));
try {
  for (const s of process.argv.slice(2)) {
    step = s;
    if (s === "field") {
      await page.getByRole("combobox", { name: "Field" }).first().click();
      await page.waitForTimeout(800); await options();
      await page.getByRole("option", { name: "Status", exact: true }).first().click();
    } else if (s === "operator") {
      await page.getByRole("combobox", { name: "Operator" }).first().click();
      await page.waitForTimeout(800); await options();
      await page.getByRole("option", { name: "not equal to", exact: true }).first().click();
    } else if (s === "value") {
      const v = page.getByRole("combobox", { name: /Value/ }).first();
      if (await v.count()) { await v.click(); await page.waitForTimeout(800); await options(); await page.getByRole("option", { name: "Completed" }).first().click(); }
      else { log("value is not a combobox"); await shot("lv-value"); }
    } else if (s === "card") {
      await page.getByText("New Filter*").first().click();
    } else if (s === "popsave" || s === "panelsave") {
      const all = await page.getByRole("button", { name: "Save", exact: true }).all();
      let hit = null;
      for (const x of all) { const bb = await x.boundingBox(); if (!bb) continue; log("Save button at x=" + Math.round(bb.x)); if (s === "popsave" ? bb.x < 1250 : bb.x >= 1250) hit = x; }
      if (!hit) throw new Error("no such Save button");
      await hit.click(); await page.waitForTimeout(3000);
    } else if (s === "fields") {
      await page.locator('button[title="List View Controls"]').first().click();
      await page.waitForTimeout(1200);
      await page.locator('[role=menuitem]:has-text("Select Fields to Display")').first().click();
      await page.waitForTimeout(2500);
      await options();
      for (const f of ["Account", "Status", "Install Date", "Panels Required"]) {
        await page.getByRole("option", { name: f, exact: true }).first().click();
        await page.locator('button[title*="Visible Fields"]').first().click();
        await page.waitForTimeout(500);
      }
      await shot("lv2-fields-picked");
      await page.getByRole("button", { name: "Save", exact: true }).last().click();
      await page.waitForTimeout(4000);
    } else if (s === "done") {
      await page.getByRole("button", { name: "Done", exact: true }).first().click();
    } else if (s === "save") {
      await page.getByRole("button", { name: "Save", exact: true }).first().click();
      await page.waitForTimeout(4000);
    } else if (s === "close") {
      await page.close(); log("closed"); process.exit(0);
    }
    await page.waitForTimeout(1500);
    await shot("lv2-" + s);
  }
} catch (e) { log("FAILED at " + step + ": " + String(e).split("\n")[0]); await shot("lv2-fail").catch(() => {}); }
process.exit(0);
