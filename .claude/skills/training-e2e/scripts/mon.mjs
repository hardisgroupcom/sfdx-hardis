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
  );

fs.mkdirSync(LOGS, { recursive: true });
let stored = false;
for (const pass of [1, 2, 3]) {
  const result = run();
  const out = result.stdout || "";
  const log = path.join(LOGS, `mon-pass${pass}.log`);
  fs.writeFileSync(log, out);
  console.log(`pass ${pass}: exit ${result.status}`, (out.match(/\[PANEL\][^\n]*/g) || []).join(" | ").slice(0, 400));
  // panel.mjs exits 2 on a question no rule covers and 3 when it could not
  // start: either way the pass is a finding, not something to run past.
  if (result.status === 2 || result.status === 3) {
    console.log(`The command stopped on an unexpected question. See ${log}`);
    process.exit(result.status);
  }
  if (/Variable: <copy>SFDX_CLIENT_ID_/.test(out)) {
    const res = spawnSync(process.execPath, [path.join(HERE, "setsecrets-mon.mjs"), log], { encoding: "utf8" });
    console.log((res.stdout || "").trim(), (res.stderr || "").trim());
    if (res.status !== 0) {
      console.log(`Storing the monitoring secrets failed. See ${log}`);
      process.exit(1);
    }
    stored = true;
    break;
  }
}
if (!stored) {
  console.log(`No secret was printed: the monitoring repository is not wired. See ${LOGS}`);
  process.exit(1);
}
