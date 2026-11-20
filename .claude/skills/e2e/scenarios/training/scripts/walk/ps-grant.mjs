// Stands in for the field grant a learner ticks in Setup (written during Lab 2.6): Object
// Settings > Installations > Edit on a permission set, as Setup shows it, then the field row.
// usage: node ps-grant.mjs <org> <permissionSetId> <objectId> <field label> <read> <edit>
//   read, edit: 1 ticks the box, anything else leaves it as it is
// No watchdog in this one: start it with a timeout.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { openPage } from "./cdp.mjs";
const [org, psId, objId, label, read, edit] = process.argv.slice(2);
const page = await openPage(org, `/${psId}/e?s=EntityPermissions&o=${objId}`);
const row = page.locator("tr", { hasText: label }).last();
console.log("row:", (await row.innerText()).replace(/\s+/g, " ").slice(0, 120));
const boxes = row.locator("input[type=checkbox]");
console.log("checkboxes in row:", await boxes.count());
if (read === "1") await boxes.nth(0).check();
if (edit === "1") await boxes.nth(1).check();
console.log("read/edit:", await boxes.nth(0).isChecked(), await boxes.nth(1).isChecked());
await page.locator("input[type=submit][value=Save]").first().click();
await page.waitForTimeout(8000);
const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
const m = body.match(/Error[^.]{0,200}/);
console.log(m ? "ERROR " + m[0] : "saved: " + page.url().slice(0, 120));
await page.close();
process.exit(0);
