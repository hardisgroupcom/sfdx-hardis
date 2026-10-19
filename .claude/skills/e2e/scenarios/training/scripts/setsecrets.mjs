// node setsecrets.mjs <log file> <BRANCH>: stores the two values configure:auth printed as fork secrets.
// The names come out of the log, so a rename upstream shows up as "not found" rather than a wrong secret.
import fs from "fs";
import { spawnSync } from "child_process";
import { FORK } from "./env.mjs";

const [log, branch] = process.argv.slice(2);
const text = fs.readFileSync(log, "utf8");
for (const kind of ["ID", "KEY"]) {
  const name = `SFDX_CLIENT_${kind}_${branch}`;
  const m = text.match(new RegExp(`Variable: <copy>${name}</copy>\\s*\\n\\s*- Value: <copy>([^<]+)</copy>`));
  if (!m) {
    console.log(`${name}: not found in the log`);
    process.exitCode = 1;
    continue;
  }
  const res = spawnSync("gh", ["secret", "set", name, "-R", FORK], { input: m[1], encoding: "utf8", shell: true });
  console.log(`${name}: ${res.status === 0 ? "set" : res.stderr}`);
}
