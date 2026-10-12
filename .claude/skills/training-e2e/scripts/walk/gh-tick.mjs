// Stands in for the click on a manual step of the Deployment Actions comment (Level 2, and the
// deliverability box of the promotions of Labs 3.5, 3.6 and 3.11): ticks the first task box of a
// Pull Request page whose line holds a text.
// usage: node gh-tick.mjs <fork> <pr> <text> [shot.png]
// The first match is the box of the Deployment Actions comment.
// Attaches to the Chrome that already runs with --remote-debugging-port=9222 and opens a tab of
// its own, which it closes when it is done. It never starts or closes the browser.
import { createRequire } from "module";
import { COURSE } from "../env.mjs";
const require = createRequire(COURSE + "/package.json");
const { chromium } = require("playwright-core");
const [fork, pr, text, shot] = process.argv.slice(2);
const log = (m) => console.log(new Date().toTimeString().slice(0, 8), m);
let step = "connect";
setTimeout(() => { log("WATCHDOG stuck at: " + step); process.exit(2); }, 120000);
const b = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30000 });
const p = await b.contexts()[0].newPage();
step = "goto";
await p.goto(`https://github.com/${fork}/pull/${pr}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.bringToFront();
await p.waitForTimeout(6000);
step = "find";
const items = p.locator("li.task-list-item", { hasText: text });
log("task lines holding the text: " + (await items.count()));
const box = items.first().locator("input[type=checkbox]").first();
log("checked before: " + (await box.isChecked()) + " disabled: " + (await box.isDisabled()));
await box.scrollIntoViewIfNeeded();
if (shot) await p.screenshot({ path: shot });
step = "click";
await box.click();
await p.waitForTimeout(6000);
log("checked after: " + (await box.isChecked()));
await p.close();
process.exit(0);
