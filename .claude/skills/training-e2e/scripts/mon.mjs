/**
 * Lab 3.8: Install Org Monitoring, driven the way auth.mjs drives Add/Configure Org.
 *
 *   node mon.mjs
 *
 * The first pass switches the default org and stops, the second (sometimes the
 * third) does the work. Run it from an empty repository cloned into MONRUN, the
 * way the lab tells a learner to.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { LOGS, MONRUN, PANEL, EMAIL, HERE } from "./env.mjs";

const answers = [
  { q: "configure the sfdx-hardis monitoring pre-requisites", choice: "Yes" },
  { q: "select or connect to the org that you want to monitor", choice: "\\(helios-prod\\)" },
  { q: "does not exist on the remote server.*push", choice: "Yes|yes", optional: true },
  { q: "SSL certificate", choice: "self-signed", optional: true },
  { q: "configure the SF CLI External Client App|Connected App on your org", choice: "Yes", optional: true },
  { q: "storage mode", choice: "decryption key as secret", optional: true },
  { q: "confirm when variables have been set", choice: ".", optional: true },
  { q: "name the External Client App|name of the", value: "Helios Monitoring", optional: true },
  { q: "email", value: EMAIL, optional: true },
  { q: "profile", choice: "^(System Administrator|Administrateur syst)", optional: true },
  { q: "save the configuration on the remote server|auto-commit", choice: "Yes|yes", optional: true }
];

const run = () =>
  spawnSync(
    process.execPath,
    [PANEL, "--cwd", MONRUN, "--answers", JSON.stringify(answers), "--", "hardis:org:configure:monitoring"],
    { encoding: "utf8", maxBuffer: 1 << 28 }
  ).stdout;

fs.mkdirSync(LOGS, { recursive: true });
for (const pass of [1, 2, 3]) {
  const out = run();
  const log = path.join(LOGS, `mon-pass${pass}.log`);
  fs.writeFileSync(log, out);
  console.log(`pass ${pass}:`, (out.match(/\[PANEL\][^\n]*/g) || []).join(" | ").slice(0, 400));
  if (/Variable: <copy>SFDX_CLIENT_ID_/.test(out)) {
    const res = spawnSync(process.execPath, [path.join(HERE, "setsecrets-mon.mjs"), log], { encoding: "utf8" });
    console.log(res.stdout.trim(), res.stderr.trim());
    break;
  }
}
