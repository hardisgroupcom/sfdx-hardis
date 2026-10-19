// node setsecrets-mon.mjs <log file>: stores the values configure:monitoring printed,
// as secrets of the monitoring repository (not the source one).
import fs from "fs";
import { spawnSync } from "child_process";
import { MONREPO } from "./env.mjs";

const [log] = process.argv.slice(2);
const text = fs.readFileSync(log, "utf8");

// The command names the secrets itself, so read the names out of the log rather than guessing them.
const pairs = [...text.matchAll(/Variable: <copy>(SFDX_CLIENT_(?:ID|KEY)_[A-Z0-9_]+)<\/copy>\s*\n\s*- Value: <copy>([^<]+)<\/copy>/g)];
if (pairs.length === 0) {
  console.log("no secret found in the log");
  process.exitCode = 1;
}
for (const [, name, value] of pairs) {
  const res = spawnSync("gh", ["secret", "set", name, "-R", MONREPO], { input: value, encoding: "utf8", shell: true });
  console.log(`${name}: ${res.status === 0 ? "set" : res.stderr}`);
}
