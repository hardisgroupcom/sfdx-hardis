// Proves the Lab 2.8 audit rule both ways, on throwaway clones of the learner clone whose
// integration is set to a given state. No browser, no org: it reads the course clone (COURSE of
// ../env.mjs, for scripts/verify/rules.mjs) and the learner clone (RUN), and writes only in the
// temporary folder, which it removes.
// usage: node prove-28.mjs
// The learner clone needs an "upstream" remote with the training/start-level-* branches fetched.
// "Before Lab 2.8" is a commit of the fork the walk ran in: PROVE28_BEFORE names it, and its
// default is the one of the fork of 2026-10-12, which no other fork has.
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { COURSE, RUN } from "../env.mjs";
const { makeContext, findRule } = await import(pathToFileURL(COURSE + "/scripts/verify/rules.mjs").href);
const sh = (cmd, cwd) => execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const rule = findRule("2.8") || findRule(2, 8);
const states = [
  ["brand new fork (upstream training/start-level-1)", "upstream/training/start-level-1"],
  ["Level 2 not started (upstream training/start-level-2)", "upstream/training/start-level-2"],
  ["this walk before Lab 2.8 (PR #12 merged)", process.env.PROVE28_BEFORE || "befde23"],
  ["this walk after Lab 2.8 (PR #13 merged)", "origin/integration"],
  ["what Reset this level gives a Level 3 learner (upstream training/start-level-3)", "upstream/training/start-level-3"],
];
for (const [label, ref] of states) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prove28-"));
  const sha = sh(`git rev-parse ${ref}`, RUN).trim();
  sh(`git clone -q --no-checkout --shared "${RUN}" "${dir}"`);
  sh(`git update-ref refs/remotes/origin/integration ${sha}`, dir);
  sh(`git update-ref refs/heads/integration ${sha}`, dir);
  const r = rule.check(makeContext(dir));
  console.log((r.ok ? "PASS" : "MISS") + "  " + label + "\n      " + (r.message || r.detail || JSON.stringify(r)).slice(0, 230));
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
