// The deliverability step of US-026 in the browser: Setup > Deliverability, Access level set to
// "All email", Save. Labs 3.5, 3.6 and 3.11 ask it of the learner in each org before a promotion.
// usage: node deliv-set.mjs <org>
// Prints the access level before and after. An org that already reads "All email" is left as it is,
// which is the fourth line of the step. The option is matched by its label, in English or French
// ("Tous les e-mails"), since an org whose user was never switched to English labels it that way.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes whatever happens.
import { openPage, frameWith } from "./cdp.mjs";
const [org] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "open";
let page = null;
setTimeout(async () => {
  log("WATCHDOG stuck at: " + step);
  await page?.close().catch(() => {});
  process.exit(2);
}, 150000);

const SELECT = "select[id$='sendEmailAccessControlSelect']";
const ALL = /^(All email|Tous les e-mails)$/;
let code = 0;
try {
  page = await openPage(org, "/lightning/setup/OrgEmailSettings/home");
  step = "form";
  const f = await frameWith(page, SELECT, 40000);
  const current = async () => f.evaluate((s) => { const e = document.querySelector(s); return e.options[e.selectedIndex].text.trim(); }, SELECT);
  const before = await current();
  log("before: " + before);
  if (ALL.test(before)) {
    log("already All email: nothing to do");
  } else {
    step = "select";
    const label = await f.evaluate(([s, re]) => [...document.querySelector(s).options].map((o) => o.text.trim()).find((t) => new RegExp(re).test(t)), [SELECT, ALL.source]);
    await f.selectOption(SELECT, { label });
    step = "save";
    await Promise.all([page.waitForTimeout(8000), f.click("input[value='Save'], input[value='Enregistrer']")]);
    const f2 = await frameWith(page, SELECT, 40000);
    const after = await f2.evaluate((s) => { const e = document.querySelector(s); return e.options[e.selectedIndex].text.trim(); }, SELECT);
    log("after: " + after);
    if (!ALL.test(after)) code = 1;
  }
} catch (e) {
  log(`FAILED at ${step}: ${e.message.split("\n")[0]}`);
  code = 1;
} finally {
  await page?.close().catch(() => {});
}
process.exit(code);
