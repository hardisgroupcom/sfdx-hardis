/**
 * Runs the command shots suite of vscode-sfdx-hardis (src/test/ui/commandShots.test.ts): a real
 * VS Code on a desktop of its own, the workspace of the run opened, the real CLI behind the sf
 * shim of the extension.
 */
import fs from "fs";
import path from "path";
import { runStreaming, sfRunJsPath } from "./shell.mjs";

/** yarn dev (webview bundle) then yarn compile (the tests), in the extension repository. */
export async function buildExtension(extensionRepo) {
  const yarn = process.platform === "win32" ? "yarn.cmd" : "yarn";
  for (const script of ["dev", "compile"]) {
    const code = await runStreaming(yarn, [script], { cwd: extensionRepo, prefix: `[extension ${script}] `, env: process.env, shell: true });
    if (code !== 0) {
      throw new Error(`yarn ${script} failed in ${extensionRepo}`);
    }
  }
}

/** Runs the suite for the specs file, and resolves with the exit code of the run. */
export async function runHarness({ extensionRepo, env, workspace, specsFile, outDir, transcriptsDir, recordDir }) {
  const runner = path.join(extensionRepo, "out", "test", "runUiTest.js");
  if (!fs.existsSync(runner)) {
    throw new Error(`The extension is not built (${runner} is missing): run yarn dev && yarn compile in ${extensionRepo}`);
  }
  return runStreaming(process.execPath, [runner], {
    cwd: extensionRepo,
    prefix: "[vscode] ",
    env: {
      ...env,
      SFDX_HARDIS_COMMAND_SHOTS: "true",
      SFDX_HARDIS_LAB_WORKSPACE: workspace,
      SFDX_HARDIS_COMMAND_SHOTS_SPECS: specsFile,
      SFDX_HARDIS_COMMAND_SHOTS_OUT: outDir,
      SF_MOCK_PASSTHROUGH: sfRunJsPath(),
      SF_MOCK_TRANSCRIPTS: transcriptsDir,
      SF_MOCK_RECORD_DIR: recordDir || "",
      NO_OPEN: "true",
    },
  });
}
