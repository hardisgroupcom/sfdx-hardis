// Lab 3.1 step 7 in the browser: Setup > External Client App Manager > the app > Policies.
// usage: node l31-policies.mjs <org> <appName> <profile>
// Prints the App Authorization line, the App Policies > Selected Profiles section and whether
// <profile> is among them, and takes a screenshot into SHOTS (see cdp.mjs) as
// l31-policies-<org>.png. Exits 1 when the profile is not found.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes whatever happens: a tab left open by a script that threw is what
// wedges the next CDP attach.
/* jscpd:ignore-start */
import { openPage, text, SHOTS } from "./cdp.mjs";
const [org, app, profile] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "open";
let page = null;
setTimeout(async () => {
  log("WATCHDOG stuck at: " + step);
  await page?.close().catch(() => {});
  process.exit(2);
}, 180000);

// Setup renders the list and the record page in nested frames and shadow roots: look in every
// frame, by visible text, which pierces the shadow roots.
async function inAnyFrame(make, tries = 30) {
  for (let i = 0; i < tries; i++) {
    for (const f of page.frames()) {
      const l = make(f).first();
      if (await l.count().catch(() => 0)) return l;
    }
    await page.waitForTimeout(2000);
  }
  return null;
}

let code = 0;
try {
  page = await openPage(org, "/lightning/setup/ManageExternalClientApplication/home");
  step = "find app";
  const link = await inAnyFrame((f) => f.getByText(app, { exact: true }));
  if (!link) throw new Error("no link named " + app);
  await link.click();
  await page.waitForTimeout(8000);
  step = "policies tab";
  const tab = await inAnyFrame((f) => f.getByRole("tab", { name: "Policies" }), 15);
  if (!tab) throw new Error("no Policies tab");
  await tab.click();
  await page.waitForTimeout(6000);
  step = "read";
  let all = "";
  for (const f of page.frames()) all += " " + (await text(f).catch(() => ""));
  for (const re of [/App Authorization[^.]{0,80}/, /Selected Profiles[^.]{0,200}/]) {
    const m = all.match(re);
    log(`${re}: ${m ? m[0] : "NOT FOUND"}`);
  }
  const selected = all.match(/Selected Profiles(.{0,400})/)?.[1] || "";
  const found = !!profile && selected.includes(profile);
  log(`profile ${profile} among the selected profiles: ${found}`);
  if (!found) code = 1;
} catch (e) {
  log(`FAILED at ${step}: ${e.message.split("\n")[0]}`);
  code = 1;
} finally {
  if (page) {
    await page.screenshot({ path: `${SHOTS}/l31-policies-${org}.png`, fullPage: true }).catch(() => {});
    log(`shot ${SHOTS}/l31-policies-${org}.png`);
    await page.close().catch(() => {});
  }
}
process.exit(code);
/* jscpd:ignore-end */
