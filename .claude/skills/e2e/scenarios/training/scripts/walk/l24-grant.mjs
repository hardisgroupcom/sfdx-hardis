// Lab 2.4 step 1: Object Settings > Crew Capacities > Edit on a permission set, in Setup:
// Tab Settings Available + Visible, object Read/Create/Edit, Read/Edit on every field row.
// usage: node l24-grant.mjs <org> <permissionSetId> <objectId>
// The boxes are found by the stable suffix of their id. A tr filtered on a cell reading "Read"
// also matches the outer layout row, whose first checkbox is the tab's Available: the grant then
// saves a tab setting and no object permission. Prove with ObjectPermissions and
// PermissionSetTabSetting.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { openPage } from "./cdp.mjs";
const [org, psId, objId] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "open";
setTimeout(() => { log("WATCHDOG stuck at: " + step); process.exit(2); }, 150000);
const page = await openPage(org, `/${psId}/e?s=EntityPermissions&o=${objId}`);
step = "tab";
for (const [label, suffix] of [["tab Available", "tab_available_ck"], ["tab Visible", "tab_visible_ck"], ["object Read", "obj_perms_data_table:0:olp_check"], ["object Create", "obj_perms_data_table:1:olp_check"], ["object Edit", "obj_perms_data_table:2:olp_check"]]) {
  const box = page.locator(`input[id$="${suffix}"]`).first();
  if (!(await box.count())) { log(label + " absent"); continue; }
  await box.check();
  log(label + " " + (await box.isChecked()));
}
step = "fields";
const rows = page.locator("table", { hasText: "Field API Name" }).last().locator("tr");
for (let i = 0; i < (await rows.count()); i++) {
  const boxes = rows.nth(i).locator("input[type=checkbox]:not([disabled])");
  const c = await boxes.count();
  if (!c) continue;
  for (let j = 0; j < c; j++) await boxes.nth(j).check();
  log("field " + (await rows.nth(i).innerText()).replace(/\s+/g, " ").slice(0, 50));
}
step = "save";
await page.locator("input[type=submit][value=Save]").first().click();
await page.waitForTimeout(8000);
const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
const m = body.match(/Error[^.]{0,200}/);
log(m ? "ERROR " + m[0] : "saved: " + page.url().slice(0, 120));
await page.close();
process.exit(0);
