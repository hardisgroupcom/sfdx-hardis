// Proves the Lab 3.4 audit rule both ways, on throwaway clones of the learner clone whose
// integration is set to a given state and whose teammate branch of US-020 is there or not. No
// browser, no org: it reads the course clone (COURSE of ../env.mjs, for scripts/verify/rules.mjs)
// and the learner clone (RUN), and writes only in the temporary folder, which it removes.
// usage: node prove-34.mjs
// The learner clone needs an "upstream" remote with the training/start-level-* branches fetched.
// "After Lab 2.9" is a commit of the fork the walk ran in: PROVE34_AFTER_29 names it, and its
// default is the one of the fork of 2026-10-12, which no other fork has.
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { COURSE, RUN } from "../env.mjs";
const { makeContext, findRule } = await import(pathToFileURL(COURSE + "/scripts/verify/rules.mjs").href);
const sh = (cmd, cwd) => execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const rule = findRule("3.4") || findRule(3, 4);
const B = "training/mate-us-020-apex-refactor";
const has = (() => { try { sh(`git rev-parse --verify --quiet origin/${B}`, RUN); return true; } catch { return false; } })();
const states = [
  ["Level 3 not started, reset path (upstream training/start-level-3), no US-020 branch", "upstream/training/start-level-3", false],
  ["Level 3 not started, continuous path (this walk after Lab 2.9, PR #15), no US-020 branch", process.env.PROVE34_AFTER_29 || "288bd45", false],
  ["this walk now (origin/integration), no US-020 branch", "origin/integration", false],
  ...(has ? [["this walk now (origin/integration) WITH the US-020 branch of the fork", "origin/integration", true],
             ["reset path start state WITH a US-020 branch (Lab 3.4 done after a reset)", "upstream/training/start-level-3", true]] : []),
];
for (const [label, ref, withBranch] of states) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prove34-"));
  const sha = sh(`git rev-parse ${ref}`, RUN).trim();
  sh(`git clone -q --no-checkout --shared "${RUN}" "${dir}"`);
  sh(`git update-ref refs/remotes/origin/integration ${sha}`, dir);
  sh(`git update-ref refs/heads/integration ${sha}`, dir);
  // the throwaway clone took the local branches of the learner clone as its origin/*: drop or set the US-020 one
  try { sh(`git update-ref -d refs/remotes/origin/${B}`, dir); } catch { /* absent */ }
  try { sh(`git update-ref -d refs/heads/${B}`, dir); } catch { /* absent */ }
  if (withBranch) sh(`git update-ref refs/remotes/origin/${B} ${sh(`git rev-parse origin/${B}`, RUN).trim()}`, dir);
  const r = rule.check(makeContext(dir));
  console.log((r.ok ? "PASS" : "MISS") + "  " + label + "\n      " + (r.message || r.detail || JSON.stringify(r)).slice(0, 230));
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
