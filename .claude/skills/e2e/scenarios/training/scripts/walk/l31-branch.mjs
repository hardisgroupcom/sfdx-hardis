// Lab 3.1 step 2 in the browser: Branches page > New branch > preprod from main.
// usage: node l31-branch.mjs <fork> <name> [--probe]
// --probe fills the dialog, takes the screenshot, and creates nothing.
// The screenshot goes to SHOTS (see cdp.mjs) as l31-new-branch.png.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { createRequire } from "module";
import { COURSE } from "../env.mjs";
import { SHOTS } from "./cdp.mjs";
const require = createRequire(COURSE + "/package.json");
const { chromium } = require("playwright-core");
const [fork, name, flag] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "connect";
setTimeout(() => { log("WATCHDOG stuck at: " + step); process.exit(2); }, 120000);
const b = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30000 });
const p = await b.contexts()[0].newPage();
await p.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});
step = "goto";
await p.goto(`https://github.com/${fork}/branches`, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.bringToFront();
await p.waitForTimeout(5000);
step = "new branch";
await p.getByRole("button", { name: /New branch/ }).first().click();
await p.waitForTimeout(2500);
const dialog = p.getByRole("dialog");
log("dialog text: " + (await dialog.innerText()).replace(/\s+/g, " ").slice(0, 300));
step = "type";
await dialog.getByRole("textbox").first().fill(name);
await p.waitForTimeout(1500);
await p.screenshot({ path: `${SHOTS}/l31-new-branch.png` });
if (flag === "--probe") { await p.close(); process.exit(0); }
step = "create";
await dialog.getByRole("button", { name: /Create new branch/ }).click();
await p.waitForTimeout(5000);
log("after: " + p.url());
await p.close();
process.exit(0);
