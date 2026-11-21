/**
 * The project the commands run in: the Helios Energy project of the training course (its
 * metadata, scratch org definition and data), with the sfdx-hardis configuration of the
 * extension's training fixture (major branches, deployment actions), as a git repository with the
 * branches of the pipeline and a fictional git identity.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/** File of the extra folder appended to config/.sfdx-hardis.yml */
const APPENDED_CONFIG = "sfdx-hardis.append.yml";

/** The changes of the commit of the feature branch: [file, text, replacement] */
const FEATURE_CHANGES = [
  [
    "force-app/main/default/flows/Installation_Crew_Warning.flow-meta.xml",
    "<description>Warns when the crew is too small.</description>",
    "<description>Warns the planner when the crew is too small for the panels to install.</description>",
  ],
  [
    "force-app/main/default/flows/Installation_Crew_Warning.flow-meta.xml",
    "<label>Crew Too Small</label>",
    "<label>Crew Too Small For The Panels</label>",
  ],
  [
    "force-app/main/default/classes/InstallationScheduler.cls",
    "Integer suggested = (Integer) Math.ceil(panelCount / 8.0);",
    "Integer suggested = (Integer) Math.ceil(panelCount / 8.0);\n        System.debug('Suggested crew size: ' + suggested);",
  ],
];

/** Builds the workspace from scratch and returns its path. */
export function buildWorkspace({ workspace, trainingRepo, extensionRepo, extraDir }) {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  // Metadata, scratch org definition and data of the course
  for (const item of ["sfdx-project.json", ".forceignore", "force-app", "manifest", "config/project-scratch-def.json", "scripts/data", "scripts/apex"]) {
    copyIfExists(path.join(trainingRepo, item), path.join(workspace, item));
  }
  // sfdx-hardis configuration of the pipeline
  const fixture = path.join(extensionRepo, "test", "fixtures", "training-project");
  for (const item of ["config/branches", "scripts/actions", "manifest/package-no-overwrite.xml"]) {
    copyIfExists(path.join(fixture, item), path.join(workspace, item));
  }
  // In config/, where the commands that change the configuration write it
  const configFile = path.join(workspace, "config", ".sfdx-hardis.yml");
  copyIfExists(path.join(fixture, ".sfdx-hardis.yml"), configFile);
  // Files of the command screenshots themselves (files workspace, custom function, Apex script),
  // copied over the rest, and what the commands work on added to the configuration
  if (extraDir && fs.existsSync(extraDir)) {
    fs.cpSync(extraDir, workspace, { recursive: true });
    const appended = path.join(workspace, APPENDED_CONFIG);
    if (fs.existsSync(appended)) {
      fs.appendFileSync(configFile, fs.readFileSync(appended, "utf8"));
      fs.rmSync(appended);
    }
  }
  fs.writeFileSync(
    path.join(workspace, ".gitignore"),
    ["node_modules/", ".sfdx/", ".sf/", "hardis-report/", ".vscode/", ".localdevserver/", ""].join("\n")
  );
  const git = (...args) => execFileSync("git", args, { cwd: workspace, stdio: "pipe" });
  git("init", "--initial-branch=main");
  git("config", "user.name", "Victor Martin");
  git("config", "user.email", "victor.martin@helios-solar.demo");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-m", "Helios Energy project");
  for (const branch of ["preprod", "uat", "integration"]) {
    git("checkout", "-b", branch);
  }
  git("checkout", "-b", "features/HEL-42-installation-checklist");
  // The work of the User Story: one commit the delta, diff and deployment commands can compare
  for (const [file, find, replace] of FEATURE_CHANGES) {
    const full = path.join(workspace, file);
    if (fs.existsSync(full)) {
      fs.writeFileSync(full, fs.readFileSync(full, "utf8").replace(find, replace));
    }
  }
  git("add", "-A");
  git("commit", "--allow-empty", "-m", "HEL-42 Warn the planner when the crew is too small");
  // A local bare origin with every branch, so the commands that pull or fetch work offline
  const origin = `${workspace}-origin.git`;
  fs.rmSync(origin, { recursive: true, force: true });
  execFileSync("git", ["init", "--bare", "--initial-branch=main", origin], { stdio: "pipe" });
  git("remote", "add", "origin", origin);
  git("push", "--all", "-u", "origin");
  return workspace;
}

function copyIfExists(source, target) {
  if (!fs.existsSync(source)) {
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}
