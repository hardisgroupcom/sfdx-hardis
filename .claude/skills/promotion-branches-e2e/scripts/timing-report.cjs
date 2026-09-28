#!/usr/bin/env node
// Performance tables of an end to end run, from what the libraries record:
//   $LOGS/timings.tsv            one line per job or backpromote call (e2e_time_record)
//   $LOGS/progress/<label>.jsonl the SFDX_HARDIS_PROGRESS_FILE of each backpromote call
//   $LOGS/<label>.json           the --json document of a backpromote call (its mode and status)
//
//   node timing-report.cjs <logs folder> [--title "GitHub"] [--json out.json]
//
// Prints markdown: wall-clock time per kind of call (and per backpromote mode), the time of each
// backpromote step (median and worst, with the call it came from), and the slowest calls.
// A step lasts from its first progress line to the first line of the next step; the last step ends
// with the call. "startup" is the time between the start of the call and its first progress line
// (node, oclif and the command imports).

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const logs = args[0];
if (!logs) {
  console.error("usage: node timing-report.cjs <logs folder> [--title T] [--json out.json]");
  process.exit(2);
}
const title = args.includes("--title") ? args[args.indexOf("--title") + 1] : path.basename(logs);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

const tsv = path.join(logs, "timings.tsv");
if (!fs.existsSync(tsv)) {
  console.error(`no ${tsv}`);
  process.exit(1);
}

// A label run several times (a step rerun by hand) keeps its last run only
const calls = new Map();
for (const line of fs.readFileSync(tsv, "utf8").split(/\r?\n/)) {
  if (!line.trim()) {
    continue;
  }
  const [label, kind, ms, code, start, end] = line.split("\t");
  calls.set(label, { label, kind, ms: Number(ms), code: Number(code), start: Number(start), end: Number(end) });
}

function readJson(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    return JSON.parse(text.substring(text.indexOf("{")));
  } catch {
    return null;
  }
}

const STEP_ORDER = ["startup", "gitProvider", "targetOrg", "fetch", "listing", "history", "delta", "actions", "retrieve", "compare", "checkout", "preActions", "deploy", "postActions", "comments", "push"];
const stepSamples = {};

for (const call of calls.values()) {
  if (call.kind !== "backpromote") {
    continue;
  }
  const doc = readJson(path.join(logs, `${call.label}.json`));
  const result = doc && (doc.result || doc.data);
  call.mode = (result && result.mode) || (doc && doc.status === 1 ? "error" : "-");
  call.status = (result && result.status) || "-";
  const progressFile = path.join(logs, "progress", `${call.label}.jsonl`);
  const altProgress = path.join(logs, `${call.label}.progress.jsonl`);
  const file = fs.existsSync(progressFile) ? progressFile : fs.existsSync(altProgress) ? altProgress : null;
  call.steps = {};
  if (!file) {
    continue;
  }
  const lines = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (lines.length === 0) {
    continue;
  }
  // Collapse consecutive lines of the same step
  const starts = [];
  for (const l of lines) {
    const t = Date.parse(l.time);
    if (starts.length === 0 || starts[starts.length - 1].step !== l.step) {
      starts.push({ step: l.step, t });
    }
  }
  const add = (step, ms) => {
    call.steps[step] = (call.steps[step] || 0) + ms;
  };
  add("startup", Math.max(0, starts[0].t - call.start));
  for (let i = 0; i < starts.length; i++) {
    const next = i + 1 < starts.length ? starts[i + 1].t : call.end;
    add(starts[i].step, Math.max(0, next - starts[i].t));
  }
  for (const [step, ms] of Object.entries(call.steps)) {
    (stepSamples[step] = stepSamples[step] || []).push({ ms, label: call.label });
  }
}

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) {
    return 0;
  }
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sec = (ms) => (ms / 1000).toFixed(1);

const out = [];
out.push(`### Timings: ${title}`);
out.push("");
out.push("| Kind | Calls | Median (s) | Worst (s) | Worst call | Total (s) |");
out.push("|------|-------|------------|-----------|------------|-----------|");
const groups = {};
for (const c of calls.values()) {
  const key = c.kind === "backpromote" ? `backpromote ${c.mode}` : c.kind;
  (groups[key] = groups[key] || []).push(c);
}
for (const key of Object.keys(groups).sort()) {
  const list = groups[key];
  const worst = list.reduce((a, b) => (b.ms > a.ms ? b : a));
  const total = list.reduce((a, b) => a + b.ms, 0);
  out.push(`| ${key} | ${list.length} | ${sec(median(list.map((c) => c.ms)))} | ${sec(worst.ms)} | \`${worst.label}\` | ${sec(total)} |`);
}
out.push("");
out.push("Backpromote steps (from the progress files):");
out.push("");
out.push("| Step | Calls | Median (s) | Worst (s) | Worst call |");
out.push("|------|-------|------------|-----------|------------|");
const steps = Object.keys(stepSamples).sort((a, b) => {
  const ia = STEP_ORDER.indexOf(a);
  const ib = STEP_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});
for (const step of steps) {
  const samples = stepSamples[step];
  const worst = samples.reduce((a, b) => (b.ms > a.ms ? b : a));
  out.push(`| ${step} | ${samples.length} | ${sec(median(samples.map((s) => s.ms)))} | ${sec(worst.ms)} | \`${worst.label}\` |`);
}
out.push("");
out.push("Slowest calls:");
out.push("");
out.push("| Call | Kind | Seconds | Exit | Three slowest steps |");
out.push("|------|------|---------|------|---------------------|");
const slowest = [...calls.values()].sort((a, b) => b.ms - a.ms).slice(0, 12);
for (const c of slowest) {
  const top = c.steps
    ? Object.entries(c.steps)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s, ms]) => `${s} ${sec(ms)}`)
        .join(", ")
    : "";
  out.push(`| \`${c.label}\` | ${c.kind === "backpromote" ? `backpromote ${c.mode}` : c.kind} | ${sec(c.ms)} | ${c.code} | ${top} |`);
}
console.log(out.join("\n"));

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ title, calls: [...calls.values()], stepSamples }, null, 1));
}
