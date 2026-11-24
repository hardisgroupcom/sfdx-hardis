#!/usr/bin/env node
/**
 * Screenshots of the command pages: every command run from VS Code against real orgs, and every
 * report it writes opened in Excel.
 *
 *   yarn screenshots:commands                       every command that has a spec
 *   yarn screenshots:commands org:diagnose:*        one topic
 *   yarn screenshots:commands hardis:org:diagnose:unusedusers hardis:lint:access
 *
 * Options:
 *   --resume       skip the commands this run folder already captured
 *   --record       write the transcript of each live run (to curate into transcripts/)
 *   --no-excel     no report captures
 *   --keep-orgs    keep the throwaway scratch org at the end
 *   --skip-build   do not build sfdx-hardis nor the extension first
 *   --reseed       run the seed again on the showcase scratch org it reuses
 *   --mode=replay  only the replayed commands (or --mode=live)
 *   --no-doc       do not regenerate the command pages at the end
 *
 * Environment:
 *   SFDX_HARDIS_SHOTS_DIR      run folder (default %LOCALAPPDATA%/sfdx-hardis-command-shots),
 *                              kept between runs: the home of the orgs, the showcase scratch org
 *   SFDX_HARDIS_SHOTS_DEVHUB   alias or username of the Dev Hub (default: a connected orgfarm one)
 *
 * Needs Windows with Excel, the sibling clones ../vscode-sfdx-hardis and ../sfdx-hardis-training,
 * and sfdx-hardis linked to this repository in sf (sf plugins link .). See the
 * command-screenshots skill (.claude/skills/command-screenshots/SKILL.md).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { captureWorkbook } from "./lib/excel.mjs";
import { buildExtension, runHarness } from "./lib/harness.mjs";
import { imagePathOf, readManifest, renderImages, writeManifest } from "./lib/manifest.mjs";
import { ALIASES, buildMaskRules, deleteScratchOrg, ensureScratchOrg, homeEnv, pickDevHub, prepareHome, scratchDaysLeft, seedOrg } from "./lib/orgs.mjs";
import { buildReportFromOverlay, findReportCsv, findReportXlsx, makeLocaleNeutral, prepareRealReport, readOverlay, xlsxFromRealCsv } from "./lib/reports.mjs";
import { spawnSync } from "child_process";
import YAML from "yaml";
import { log, runStreaming, sfJson, sfRunJsPath } from "./lib/shell.mjs";
import { commandPathParts, loadSpecs, selectSpecs, slugOf, validateSpec } from "./lib/specs.mjs";
import { buildWorkspace } from "./lib/workspace.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const EXTENSION_REPO = path.resolve(REPO, "..", "vscode-sfdx-hardis");
const TRAINING_REPO = path.resolve(REPO, "..", "sfdx-hardis-training");
const SPECS_DIR = path.join(HERE, "specs");
const OVERLAYS_DIR = path.join(HERE, "overlays");
const TRANSCRIPTS_DIR = path.join(HERE, "transcripts");
const SEED_DIR = path.join(HERE, "seed");
const WORKSPACE_EXTRA_DIR = path.join(HERE, "workspace");
const MANIFEST_FILE = path.join(REPO, "docs", "assets", "command-screenshots.json");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const patterns = argv.filter((arg) => !arg.startsWith("--"));
const RUN_DIR = process.env.SFDX_HARDIS_SHOTS_DIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), "sfdx-hardis-command-shots");

async function main() {
  preflight();
  await waitForMemory();
  const knownIds = listCommandIds();
  const allSpecs = loadSpecs(SPECS_DIR);
  const problems = allSpecs.flatMap((spec) => validateSpec(spec, SPECS_DIR, knownIds));
  if (problems.length > 0) {
    problems.forEach((problem) => console.error(problem));
    throw new Error(`${problems.length} problem(s) in the specs`);
  }
  const modeFilter = (argv.find((arg) => arg.startsWith("--mode=")) || "").slice("--mode=".length);
  const selected = selectSpecs(allSpecs, patterns).filter((spec) => !modeFilter || (spec.mode || "live") === modeFilter);
  const flagProblems = [];
  for (const spec of selected.filter((candidate) => !candidate.skip)) {
    flagProblems.push(...(await unknownRunFlags(spec)));
  }
  if (flagProblems.length > 0) {
    flagProblems.forEach((problem) => console.error(problem));
    throw new Error(`${flagProblems.length} unknown flag(s) in the run lines of the specs`);
  }
  if (selected.length === 0) {
    throw new Error(`No spec matches ${patterns.join(" ")}`);
  }
  const manifest = readManifest(MANIFEST_FILE);
  for (const spec of selected.filter((candidate) => candidate.skip)) {
    manifest.commands[spec.command] = { skip: String(spec.skip) };
  }
  const outDir = path.join(RUN_DIR, "out");
  let runnable = selected.filter((spec) => !spec.skip);
  if (flag("--resume")) {
    runnable = runnable.filter((spec) => readResult(outDir, spec)?.status !== "success");
    log(`Resume: ${selected.length - runnable.length} command(s) already captured in ${outDir}`);
  } else {
    for (const spec of runnable) {
      fs.rmSync(path.join(outDir, slugOf(spec.command)), { recursive: true, force: true });
    }
  }
  log(`${runnable.length} command(s) to capture, ${selected.filter((spec) => spec.skip).length} skipped by their spec`);

  if (!flag("--skip-build")) {
    log("Building sfdx-hardis (yarn compile)...");
    if ((await runStreaming("yarn", ["compile"], { cwd: REPO, prefix: "[compile] ", shell: true })) !== 0) {
      throw new Error("yarn compile failed");
    }
  }

  const workspace = path.join(RUN_DIR, "helios-solar");
  const home = path.join(RUN_DIR, "home");
  const env = homeEnv(home);
  if (runnable.length > 0) {
    const orgKinds = new Set(runnable.filter((spec) => (spec.mode || "live") === "live").map((spec) => spec.org || "showcase"));
    // Scratch orgs to create: the showcase one when it is missing or about to expire, the
    // throwaway one when a spec needs it
    const stateFile = path.join(RUN_DIR, "state.json");
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
    const needsShowcase = orgKinds.has("showcase") || orgKinds.has("throwaway");
    const homeExists = fs.existsSync(path.join(home, ".sfdx"));
    const showcaseDays = needsShowcase && homeExists ? scratchDaysLeft(env, ALIASES.showcase) : -1;
    const throwawayDays = orgKinds.has("throwaway") && homeExists ? scratchDaysLeft(env, ALIASES.throwaway) : -1;
    const neededSlots = (needsShowcase && showcaseDays < 3 ? 1 : 0) + (orgKinds.has("throwaway") && throwawayDays < 0.5 ? 1 : 0);
    const devHub = pickDevHub({ neededSlots, previousUsername: state.devHubUsername });
    log(`Dev Hub: ${devHub.alias || "(no alias)"}`);
    prepareHome(home, devHub);
    fs.writeFileSync(stateFile, JSON.stringify({ ...state, devHubUsername: devHub.username }, null, 2));
    buildWorkspace({ workspace, trainingRepo: TRAINING_REPO, extensionRepo: EXTENSION_REPO, extraDir: WORKSPACE_EXTRA_DIR });
    if (orgKinds.has("showcase") || orgKinds.has("throwaway")) {
      const created = ensureScratchOrg("showcase", { env, workspace, seedDir: SEED_DIR, minDaysLeft: 3 });
      if (!created && flag("--reseed")) {
        seedOrg(ALIASES.showcase, { env, workspace, seedDir: SEED_DIR });
      }
    }
    if (orgKinds.has("throwaway")) {
      ensureScratchOrg("throwaway", { env, workspace, seedDir: SEED_DIR, minDaysLeft: 0.5 });
    }
    sfJson(["config", "set", `target-org=${ALIASES.showcase}`], { env, cwd: workspace, allowFailure: true });

    const mask = buildMaskRules({ env, runDir: RUN_DIR, workspace });
    log(`${mask.length} values masked in the captures`);
    fs.writeFileSync(path.join(RUN_DIR, "mask.json"), JSON.stringify(mask, null, 2));

    const transcriptsActive = path.join(RUN_DIR, "transcripts");
    fs.rmSync(transcriptsActive, { recursive: true, force: true });
    fs.mkdirSync(transcriptsActive, { recursive: true });
    for (const spec of runnable.filter((candidate) => candidate.mode === "replay")) {
      const name = `${spec.command.replace(/:/g, "_")}.json`;
      const source = path.join(TRANSCRIPTS_DIR, name);
      if (!fs.existsSync(source)) {
        throw new Error(`${spec.command} is replayed but has no transcript ${path.relative(REPO, source)}`);
      }
      fs.copyFileSync(source, path.join(transcriptsActive, name));
    }

    // The commands that change their org run last, on the throwaway org
    const ordered = [...runnable].sort((a, b) => Number(a.org === "throwaway") - Number(b.org === "throwaway"));
    const specsFile = path.join(RUN_DIR, "specs.json");
    fs.writeFileSync(specsFile, JSON.stringify({ specs: ordered.map((spec) => toHarnessSpec(spec)), mask }, null, 2));

    if (!flag("--skip-build")) {
      log("Building the extension (yarn dev, yarn compile)...");
      await buildExtension(EXTENSION_REPO);
    }
    log("Running the commands in VS Code...");
    const code = await runHarness({
      extensionRepo: EXTENSION_REPO,
      env,
      workspace,
      specsFile,
      outDir,
      transcriptsDir: transcriptsActive,
      recordDir: flag("--record") ? path.join(RUN_DIR, "recorded") : "",
    });
    log(`VS Code run ended with code ${code}`);
  }
  writeDiscoveredAnswers(selected.filter((spec) => !spec.skip), outDir);

  // Images, reports and manifest, for every selected command captured by this run folder
  const summary = { captured: [], failed: [], reportsMissing: [] };
  const mask = fs.existsSync(path.join(RUN_DIR, "mask.json")) ? JSON.parse(fs.readFileSync(path.join(RUN_DIR, "mask.json"), "utf8")) : [];
  for (const spec of selected.filter((candidate) => !candidate.skip)) {
    const result = readResult(outDir, spec);
    if (!result || result.status !== "success") {
      summary.failed.push({ command: spec.command, error: result?.error || "not run" });
      continue;
    }
    try {
      manifest.commands[spec.command] = await buildCommandImages(spec, result, { mask, workspace, outDir, summary });
      summary.captured.push(spec.command);
    } catch (error) {
      summary.failed.push({ command: spec.command, error: error.message });
    }
  }
  writeManifest(MANIFEST_FILE, manifest);
  fs.writeFileSync(path.join(RUN_DIR, "summary.json"), JSON.stringify(summary, null, 2));

  if (!flag("--no-doc")) {
    const ids = selected.map((spec) => spec.command);
    log("Regenerating the command pages...");
    await runStreaming(process.execPath, [path.join(REPO, "bin", "dev.js"), "hardis:doc:plugin:generate", "--commands", ...ids], {
      cwd: REPO,
      prefix: "[doc] ",
    });
  }
  if (!flag("--keep-orgs") && runnable.some((spec) => spec.org === "throwaway")) {
    deleteScratchOrg("throwaway", env);
  }

  log(`Captured: ${summary.captured.length}, failed: ${summary.failed.length}, reports without image: ${summary.reportsMissing.length}`);
  for (const failure of summary.failed) {
    log(`  FAILED ${failure.command}: ${String(failure.error).split("\n")[0].slice(0, 300)}`);
  }
  for (const missing of summary.reportsMissing) {
    log(`  NO REPORT IMAGE ${missing.command} ${missing.report}: ${missing.reason}`);
  }
}

/** The spec as the harness reads it. */
function toHarnessSpec(spec) {
  const kind = spec.org || "showcase";
  return {
    command: spec.command,
    slug: slugOf(spec.command),
    run: spec.run,
    targetOrg: spec.mode === "replay" || kind === "none" ? undefined : ALIASES[kind],
    answers: spec.answers || [],
    caption: spec.caption || "",
    pills: spec.pills || [],
    timeoutMs: spec.timeoutMs || 420000,
    allowedStatuses: spec.allowedStatuses,
    reportPill: spec.reportPill,
    discover: spec.discover === true,
    before: spec.mode === "replay" ? undefined : spec.before,
  };
}

/** WebP images of the captures and of the reports of one command, and its manifest entry. */
async function buildCommandImages(spec, result, { mask, workspace, outDir, summary }) {
  const parts = commandPathParts(spec.command);
  const shots = result.shots || [];
  const items = [];
  const entry = { shots: [], reports: {} };
  let promptShot = 0;
  for (const shot of shots) {
    const isFinal = path.basename(shot.file, ".png") === slugOf(spec.command);
    const image = isFinal ? imagePathOf(parts) : imagePathOf(parts, `-${++promptShot}`);
    items.push({ source: shot.file, pills: shot.pills, image });
    entry.shots.push({ image, caption: shot.caption || "", pills: shot.pills || [] });
    for (const missing of shot.missingPills || []) {
      log(`  ${spec.command}: no element shows "${missing}", its pill is not drawn`);
    }
  }
  const declared = await declaredReports(spec.command);
  for (const report of declared) {
    if (flag("--no-excel")) {
      break;
    }
    try {
      const overlay = readOverlay(OVERLAYS_DIR, parts, report.file);
      const reportDir = path.join(outDir, slugOf(spec.command), "reports");
      const xlsxOut = path.join(reportDir, `${report.file}.xlsx`);
      // The Dev Hub is shared with real people and real packages: what it holds never reaches an
      // image, its reports come from an overlay
      if (spec.org === "devhub" && overlay?.mode !== "replace") {
        summary.reportsMissing.push({ command: spec.command, report: report.file, reason: "a report read from the Dev Hub needs a replace overlay" });
        continue;
      }
      const reportedFiles = (result.reports || []).map((item) => item.copy || item.file);
      let realXlsx = findReportXlsx(reportedFiles, workspace, report.file);
      const realCsv = realXlsx ? null : findReportCsv(reportedFiles, workspace, report.file);
      if (realCsv) {
        realXlsx = await xlsxFromRealCsv({
          csvFile: realCsv,
          maskRules: mask,
          repoRoot: REPO,
          workDir: path.join(reportDir, "real-csv"),
          fileName: report.file,
          title: report.title,
        });
      }
      // A replace overlay that gives its columns needs nothing from the real report, which may be
      // empty, without even a header
      if (overlay?.mode === "replace" && Array.isArray(overlay.columns)) {
        realXlsx = null;
      }
      if (realXlsx) {
        await prepareRealReport({ xlsxFile: realXlsx, overlay, maskRules: mask, outFile: xlsxOut });
      } else if (overlay) {
        await buildReportFromOverlay({ overlay, repoRoot: REPO, workDir: path.join(reportDir, "csv"), fileName: report.file, outFile: xlsxOut });
      } else {
        summary.reportsMissing.push({ command: spec.command, report: report.file, reason: "the run wrote no such report and it has no overlay" });
        continue;
      }
      if ((await makeLocaleNeutral(xlsxOut)) === 0) {
        summary.reportsMissing.push({ command: spec.command, report: report.file, reason: "the report has no rows: give it an overlay" });
        continue;
      }
      const png = path.join(reportDir, `${report.file}.png`);
      await captureWorkbook({ extensionRepo: EXTENSION_REPO, xlsxFile: xlsxOut, pngFile: png });
      const image = imagePathOf(parts, `-report-${report.file}`);
      items.push({ source: png, pills: [], image });
      entry.reports[report.file] = { image };
    } catch (error) {
      summary.reportsMissing.push({ command: spec.command, report: report.file, reason: error.message });
    }
  }
  await renderImages(REPO, items);
  return entry;
}

/**
 * Discovery: the answers given to the questions no rule covered are added to the answers of the
 * spec, to be reviewed (captions, pills, shot) before `discover` is removed.
 */
function writeDiscoveredAnswers(specs, outDir) {
  for (const spec of specs.filter((candidate) => candidate.discover)) {
    const discovered = readResult(outDir, spec)?.discovered || [];
    if (discovered.length === 0) {
      continue;
    }
    // The spec as it is now: it may have been edited while the run was going on, and then what
    // this run discovered answers the old version
    const current = YAML.parse(fs.readFileSync(spec.file, "utf8")) || {};
    if (current.discover !== true || current.run !== spec.run) {
      log(`  ${spec.command}: its spec changed during the run, discovered answers not written`);
      continue;
    }
    const answers = [...(current.answers || [])];
    for (const rule of discovered) {
      if (!answers.some((answer) => answer.q === rule.q)) {
        answers.push({ q: rule.q, ...(rule.choice !== undefined ? { choice: rule.choice } : { value: rule.value }) });
      }
    }
    current.answers = answers;
    fs.writeFileSync(spec.file, YAML.stringify(current, { lineWidth: 140, aliasDuplicateObjects: false }));
    log(`  ${spec.command}: ${discovered.length} answer(s) discovered, written to its spec`);
  }
}

/** The flags of the run line of a spec that its command does not have (compiled class). */
async function unknownRunFlags(spec) {
  const file = path.join(REPO, "lib", "commands", ...spec.command.split(":")) + ".js";
  if (!fs.existsSync(file)) {
    return [];
  }
  // A few commands export their class by name only
  const module = await import(pathToFileURL(file).href);
  const flags = (module.default || Object.values(module).find((value) => value?.flags))?.flags || {};
  const known = new Set(Object.entries(flags).flatMap(([name, definition]) => [`--${name}`, ...(definition?.char ? [`-${definition.char}`] : []), ...(definition?.aliases || []).map((alias) => `--${alias}`)]));
  const used = String(spec.run).match(/(?<=\s)--?[a-zA-Z][\w-]*/g) || [];
  return used.filter((flagName) => !known.has(flagName)).map((flagName) => `${spec.command}: its run line uses ${flagName}, which the command does not have`);
}

/** The `reports` a command declares, read from its compiled class. */
async function declaredReports(commandId) {
  const file = path.join(REPO, "lib", "commands", ...commandId.split(":")) + ".js";
  if (!fs.existsSync(file)) {
    return [];
  }
  const module = await import(pathToFileURL(file).href);
  return module.default?.reports || [];
}

function readResult(outDir, spec) {
  const file = path.join(outDir, slugOf(spec.command), "result.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

// Ids of the commands: the files of src/commands exporting a command class (abstract base classes do not count)
function listCommandIds() {
  const root = path.join(REPO, "src", "commands");
  const ids = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && /export (default )?class \w+ extends/.test(fs.readFileSync(full, "utf8"))) {
        ids.push(path.relative(root, full).replace(/\.ts$/, "").split(path.sep).join(":"));
      }
    }
  };
  walk(root);
  return ids;
}

function preflight() {
  if (process.platform !== "win32") {
    throw new Error("The command screenshots run on Windows: VS Code and Excel are captured on a desktop of their own");
  }
  for (const [name, dir] of [
    ["vscode-sfdx-hardis", EXTENSION_REPO],
    ["sfdx-hardis-training", TRAINING_REPO],
  ]) {
    if (!fs.existsSync(dir)) {
      throw new Error(`Clone ${name} next to this repository (${dir} is missing)`);
    }
  }
  const answer = spawnSync(process.execPath, [sfRunJsPath(), "plugins", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let list = [];
  try {
    const parsed = JSON.parse(answer.stdout.slice(Math.min(...["[", "{"].map((char) => answer.stdout.indexOf(char)).filter((index) => index >= 0))));
    list = Array.isArray(parsed) ? parsed : parsed.result || [];
  } catch {
    log("Could not read sf plugins, the run goes on");
  }
  const hardis = list.find((plugin) => plugin.name === "sfdx-hardis");
  if (list.length > 0 && (!hardis || hardis.type !== "link" || path.resolve(hardis.root || "") !== path.resolve(REPO))) {
    throw new Error(`sf must run sfdx-hardis from this repository: run "sf plugins link ." in ${REPO}`);
  }
  fs.mkdirSync(RUN_DIR, { recursive: true });
}

// A run is heavy (VS Code, the CLI, Excel): it waits for memory rather than failing halfway
async function waitForMemory(minFreeGb = Number(process.env.SFDX_HARDIS_SHOTS_MIN_FREE_GB || 1.5), maxWaitMinutes = 30) {
  for (let minute = 0; minute < maxWaitMinutes; minute++) {
    const freeGb = os.freemem() / 1024 ** 3;
    if (freeGb >= minFreeGb) {
      return;
    }
    log(`Only ${freeGb.toFixed(1)} GB of free memory, waiting a minute...`);
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
}

main().catch((error) => {
  console.error(`[shots] ${error.message || error}`);
  process.exit(1);
});
