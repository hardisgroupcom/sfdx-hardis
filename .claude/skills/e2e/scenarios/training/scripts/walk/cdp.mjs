// Shared CDP helpers of the walk scripts: they drive Salesforce pages in the Chrome that is
// already running and signed in, attached over CDP on port 9222. Nothing here starts or closes the
// browser: a helper opens a tab of its own and closes that tab.
//
// Not run on its own: import { openPage, frameWith, SHOTS } from "./cdp.mjs".
//
// playwright-core is not a dependency of sfdx-hardis: it is resolved from the package.json of the
// course clone (COURSE of ../env.mjs).
// SHOTS is the folder the helpers write their screenshots to when they take no path argument: the
// SHOTS environment variable, or <LOGS>/walk-shots (LOGS of ../env.mjs). It is created on import.
import { execSync } from "child_process";
import { createRequire } from "module";
import fs from "fs";
import { COURSE, LOGS } from "../env.mjs";
const require = createRequire(COURSE + "/package.json");
const { chromium } = require("playwright-core");

export const SHOTS = (process.env.SHOTS || LOGS + "/walk-shots").replace(/\\/g, "/");
fs.mkdirSync(SHOTS, { recursive: true });

export function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
}
export function durableId(org, api) {
  const r = JSON.parse(sh(`sf data query --use-tooling-api --json -o ${org} -q "SELECT DurableId FROM EntityDefinition WHERE QualifiedApiName = '${api}'"`));
  return r.result.records[0].DurableId;
}
export async function openPage(org, path) {
  const url = JSON.parse(sh(`sf org open --url-only --json -o ${org} --path "${path}"`)).result.url;
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const page = await browser.contexts()[0].newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.bringToFront();
  await page.waitForTimeout(10000);
  return page;
}
// The frame that holds a selector (Setup wizards live in an iframe)
export async function frameWith(page, selector, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const f of page.frames()) {
      if (await f.$(selector).catch(() => null)) return f;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`no frame holds ${selector}`);
}
export async function dump(page, label = "") {
  console.log(`--- ${label} ${page.url().slice(0, 140)}`);
  for (const f of page.frames()) {
    try {
      const items = await f.evaluate(() =>
        [...document.querySelectorAll("input,select,textarea,button")]
          .filter((e) => e.type !== "hidden")
          .map((e) => `${e.tagName}|${e.type}|name=${e.name}|id=${e.id}|val=${(e.value || "").slice(0, 30)}|title=${e.title || ""}|${(e.innerText || "").trim().slice(0, 30)}`)
      );
      if (items.length) console.log(" FRAME", f.url().slice(0, 110), "\n  " + items.slice(0, 60).join("\n  "));
    } catch {}
  }
}
export async function text(f) {
  return (await f.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
}
// The error a Setup save left, in the top page or in any frame: the classic wizards and edit
// pages print theirs inside their iframe. Returns the first match, or null.
export async function saveError(page) {
  for (const f of page.frames()) {
    const t = await text(f).catch(() => "");
    const m = t.match(/(Error: [^.]{0,200}|Review all error messages[^.]{0,120}|We hit a snag[^.]{0,200})/);
    if (m) return m[0];
  }
  return null;
}
