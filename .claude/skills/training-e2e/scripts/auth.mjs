/**
 * Lab 3.1, one branch at a time: Orgs Manager > Add/Configure Org, then the two
 * secrets it prints, stored on the fork.
 *
 *   node auth.mjs <orgAlias> <branch> <urlChoiceRegex> <mergeTargetRegex> [appName]
 *   node auth.mjs helios-preprod preprod "Other: Dev org" "^main$"
 *   node auth.mjs helios-integration integration "Sandbox or Scratch org" "^uat$"
 *
 * Match the URL choice on its whole label, not on one word: the list also holds
 * "Custom login URL (Sandbox, DevHub or Production Org)", which "Sandbox" alone
 * matches first, and which then asks for a URL nothing answers.
 *
 * It runs the command twice on purpose: the first run switches the default org
 * and stops, which is what a learner sees too. The second does the work, and the
 * secrets are read out of its log rather than guessed.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { LOGS, RUN, PANEL, EMAIL, HERE } from "./env.mjs";

const [org, branch, url, target, appName] = process.argv.slice(2);
if (!org || !branch) {
  console.log("usage: node auth.mjs <orgAlias> <branch> <urlChoiceRegex> <mergeTargetRegex> [appName]");
  process.exit(1);
}

const answers = [
  { q: "select or login into the org", choice: `\\(${org}\\)` },
  { q: "name of the git branch", choice: `^${branch}$` },
  { q: "base URL or domain", choice: url },
  { q: "target git branches", choice: target },
  { q: "username that will be used", value: "__INITIAL__" },
  { q: "SSL certificate", choice: "self-signed" },
  { q: "configure the SF CLI External Client App|Connected App on your org", choice: "Yes" },
  { q: "storage mode", choice: "decryption key as secret" },
  { q: "confirm when variables have been set", choice: ".", optional: true },
  { q: "name the External Client App|name", value: appName || "__INITIAL__", optional: true },
  { q: "email", value: EMAIL, optional: true },
  { q: "profile", choice: "^(System Administrator|Administrateur syst)", optional: true }
];

const run = () =>
  spawnSync(
    process.execPath,
    [PANEL, "--cwd", RUN, "--answers", JSON.stringify(answers), "--", "hardis:project:configure:auth"],
    { encoding: "utf8", maxBuffer: 1 << 28 }
  );

fs.mkdirSync(LOGS, { recursive: true });
let stored = false;
for (const pass of [1, 2]) {
  const result = run();
  const out = result.stdout || "";
  const log = path.join(LOGS, `auth-${branch}-${pass}.log`);
  fs.writeFileSync(log, out);
  console.log(
    `pass ${pass}: exit ${result.status}`,
    (out.match(/\[PANEL\][^\n]*/g) || []).join(" | "),
    /Successfully deployed/.test(out) ? "| app deployed" : ""
  );
  // panel.mjs exits 2 on a question no rule covers and 3 when it could not
  // start: either way the pass is a finding, not something to run past.
  if (result.status === 2 || result.status === 3) {
    console.log(`The command stopped on an unexpected question. See ${log}`);
    process.exit(result.status);
  }
  if (/Variable: <copy>SFDX_CLIENT_ID_/.test(out)) {
    const res = spawnSync(process.execPath, [path.join(HERE, "setsecrets.mjs"), log, branch.toUpperCase()], { encoding: "utf8" });
    console.log(res.stdout.trim(), (res.stderr || "").trim());
    if (res.status !== 0) {
      console.log(`Storing the secrets of ${branch} failed. See ${log}`);
      process.exit(1);
    }
    stored = true;
    break;
  }
}
if (!stored) {
  console.log(`No secret was printed for ${branch}: the branch is not wired. See ${LOGS}`);
  process.exit(1);
}
