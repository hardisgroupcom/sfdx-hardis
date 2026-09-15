#!/usr/bin/env node
/**
 * Names the sfdx-hardis training labs a change would affect.
 *
 *   node scripts/check-training-impact.mjs
 *   node scripts/check-training-impact.mjs --base main
 *   node scripts/check-training-impact.mjs --strict   (exit 1 when labs are affected)
 *
 * It diffs the working tree against the base branch, pulls out the command ids,
 * flags, config keys and documentation slugs the diff touches, and looks each one
 * up in the training manifest of the sibling clone.
 *
 * It is a helper, not an oracle: it cannot see that a behaviour changed under an
 * unchanged name. The judgement lives in the `training-impact` skill.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TRAINING = path.resolve(ROOT, "..", "sfdx-hardis-training");

const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const BASE = baseIndex > -1 ? args[baseIndex + 1] : "main";
const STRICT = args.includes("--strict");

function git(argv, cwd = ROOT) {
  const res = spawnSync("git", argv, { cwd, encoding: "utf8" });
  return res.status === 0 ? (res.stdout || "") : "";
}

// ---------------------------------------------------------------- manifest
const manifestPath = path.join(TRAINING, "training-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.log("The sfdx-hardis-training clone is not a sibling of this repository, or has no manifest.");
  console.log("");
  console.log("  git clone https://github.com/hardisgroupcom/sfdx-hardis-training.git ../sfdx-hardis-training");
  console.log("");
  console.log("Training impact cannot be computed. Say so rather than assuming there is none.");
  process.exit(STRICT ? 1 : 0);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const index = manifest.reverseIndex || {};

// -------------------------------------------------------------- the diff
const changedFiles = git(["diff", "--name-only", `${BASE}...HEAD`])
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const workingTree = git(["diff", "--name-only"]).split("\n").map((l) => l.trim()).filter(Boolean);
const staged = git(["diff", "--name-only", "--cached"]).split("\n").map((l) => l.trim()).filter(Boolean);
const files = [...new Set([...changedFiles, ...workingTree, ...staged])];

if (files.length === 0) {
  console.log(`No change against ${BASE}. Training impact: none.`);
  process.exit(0);
}

const diff = [
  git(["diff", `${BASE}...HEAD`]),
  git(["diff"]),
  git(["diff", "--cached"])
].join("\n");

// --------------------------------------------------- what the diff touches
const touched = { commands: new Set(), config: new Set(), docs: new Set(), panels: new Set() };

// Command ids, from the changed command files and from the diff text
for (const file of files) {
  const match = file.match(/^src\/commands\/(.+)\.ts$/);
  if (match) {
    touched.commands.add(match[1].split("/").join(":"));
  }
  const doc = file.match(/^docs\/([a-z0-9-]+)\.md$/);
  if (doc) {
    touched.docs.add(doc[1]);
  }
}
for (const match of diff.matchAll(/\bhardis:[a-z0-9:]+/g)) {
  touched.commands.add(match[0]);
}
for (const match of diff.matchAll(/salesforce-(?:devops|monitoring|project)-[a-z0-9-]+/g)) {
  touched.docs.add(match[0]);
}
// Config keys: what the JSON schema declares, when the schema itself changed
if (files.includes("config/sfdx-hardis.jsonschema.json")) {
  for (const match of diff.matchAll(/^\+\s*"([a-zA-Z][a-zA-Z0-9]*)":\s*\{/gm)) {
    touched.config.add(match[1]);
  }
}
for (const key of Object.keys(index.config || {})) {
  if (new RegExp(`\\b${key}\\b`).test(diff)) {
    touched.config.add(key);
  }
}

// ------------------------------------------------------------- the answer
const affected = new Map();
let anyLookup = 0;

for (const [kind, values] of Object.entries(touched)) {
  for (const value of values) {
    const labs = (index[kind] || {})[value];
    if (!labs) {
      continue;
    }
    anyLookup++;
    for (const lab of labs) {
      if (!affected.has(lab)) {
        affected.set(lab, []);
      }
      affected.get(lab).push(`${kind}: ${value}`);
    }
  }
}

console.log(`${files.length} changed file(s) against ${BASE}.`);
console.log(
  `Touched: ${touched.commands.size} command(s), ${touched.config.size} config key(s), ${touched.docs.size} doc page(s).`
);
console.log("");

if (affected.size === 0) {
  console.log("Training impact: none of the changed items is used by any lab.");
  console.log("");
  console.log("This only covers names. If the change alters behaviour under an unchanged name,");
  console.log("especially a behaviour a seeded failure relies on, load the training-impact skill.");
  process.exit(0);
}

console.log(`Training impact: ${affected.size} lab(s) affected.`);
console.log("");
const byId = new Map(manifest.labs.map((lab) => [lab.id, lab]));
for (const [id, reasons] of [...affected].sort()) {
  const lab = byId.get(id);
  console.log(`  ${id}${lab ? `  (level ${lab.level}, lab ${lab.lab}) ${lab.title}` : ""}`);
  for (const reason of [...new Set(reasons)]) {
    console.log(`      ${reason}`);
  }
  if (lab) {
    console.log(`      ${lab.file}`);
  }
}
console.log("");
console.log("Load the training-impact skill to classify it, then training-update to do the edits.");
process.exit(STRICT ? 1 : 0);
