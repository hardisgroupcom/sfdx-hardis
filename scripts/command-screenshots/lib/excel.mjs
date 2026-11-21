/**
 * Captures a workbook as Excel draws it: excel-shot.ps1, started on a desktop nobody looks at by
 * the hidden desktop launcher of vscode-sfdx-hardis, so Excel never shows on the screen of the
 * person working. Retried, because Excel sometimes opens a dialog of its own on a first start.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log, runStreaming } from "./shell.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXCEL_SHOT = path.join(HERE, "..", "excel-shot.ps1");

export async function captureWorkbook({ extensionRepo, xlsxFile, pngFile, attempts = 3 }) {
  if (process.platform !== "win32") {
    throw new Error("Excel captures need Windows");
  }
  const launcher = path.join(extensionRepo, "scripts", "hidden-desktop", "run-on-hidden-desktop.ps1");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    fs.rmSync(pngFile, { force: true });
    const code = await runStreaming(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        launcher,
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        EXCEL_SHOT,
        "-Workbook",
        xlsxFile,
        "-Output",
        pngFile,
      ],
      { env: { ...process.env, SFDX_HARDIS_UI_DESKTOP: "sfdx-hardis-excel-shot" }, prefix: "  [excel] " }
    );
    if (code === 0 && fs.existsSync(pngFile)) {
      return pngFile;
    }
    log(`Excel capture of ${path.basename(xlsxFile)} failed (attempt ${attempt}/${attempts})`);
  }
  throw new Error(`Excel never showed ${xlsxFile}`);
}
