/**
 * The reports of the command screenshots, made ready for Excel.
 *
 * - A report the command really wrote is opened as it is (with the formatting the command gave
 *   it), every real value is masked, and its overlay, when there is one, adds fictional rows in
 *   the style of the existing ones ("append") or replaces them ("replace").
 * - A command that was replayed wrote nothing: its report is built from its overlay alone, by the
 *   function the commands use themselves (createXlsxFromCsv), so it looks the same.
 *
 * Overlay: overlays/<command path>/<report file>.json
 *   { "mode": "append" | "replace", "sheet": "optional worksheet name", "title": "...",
 *     "rows": [ { "Column": "value", ... } ] }
 */
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/** Masks and overlays a real report, written to `outFile`. */
export async function prepareRealReport({ xlsxFile, overlay, maskRules, outFile }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxFile);
  const mask = maskFunction(maskRules);
  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        cell.value = maskValue(cell.value, mask);
      });
    });
  }
  if (overlay) {
    applyOverlay(workbook, overlay);
  }
  rebuildTables(workbook);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await workbook.xlsx.writeFile(outFile);
  return outFile;
}

/**
 * Builds a report from an overlay alone, with the xlsx writer of sfdx-hardis (compiled in lib/),
 * and returns the path of the xlsx written to `outFile`.
 */
export async function buildReportFromOverlay({ overlay, repoRoot, workDir, fileName, outFile }) {
  const rows = overlay.rows || [];
  if (rows.length === 0) {
    throw new Error(`The overlay of ${fileName} has no rows to build a report from`);
  }
  const columns = overlay.columns || Object.keys(rows[0]);
  const csvFile = path.join(workDir, `${fileName}.csv`);
  fs.mkdirSync(workDir, { recursive: true });
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  fs.writeFileSync(csvFile, [columns.map(escape).join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\n") + "\n");
  process.env.NO_OPEN = "true";
  const filesUtils = await import(pathToFileURL(path.join(repoRoot, "lib", "common", "utils", "filesUtils.js")).href);
  const result = {};
  await filesUtils.createXlsxFromCsv(csvFile, { fileTitle: overlay.title || fileName, noOpen: true }, result);
  if (!result.xlsxFile || !fs.existsSync(result.xlsxFile)) {
    throw new Error(`createXlsxFromCsv wrote no xlsx for ${fileName}`);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.copyFileSync(result.xlsxFile, outFile);
  return outFile;
}

/**
 * The xlsx of a report the run only wrote as a CSV (or as an .xls that is a CSV): the CSV masked,
 * then turned into an xlsx by the product's own createXlsxFromCsv, as the commands that write an
 * xlsx do. Returns the path of the xlsx.
 */
export async function xlsxFromRealCsv({ csvFile, maskRules, repoRoot, workDir, fileName, title }) {
  const mask = maskFunction(maskRules);
  fs.mkdirSync(workDir, { recursive: true });
  const maskedCsv = path.join(workDir, `${fileName}.csv`);
  const text = mask(fs.readFileSync(csvFile, "utf8"));
  const header = text.split(/\r?\n/)[0] || "";
  if ((header.match(/;/g) || []).length > (header.match(/,/g) || []).length) {
    // generateReports writes semicolons, the product's CSV reader expects commas
    const semicolonCsv = path.join(workDir, `${fileName}.semicolon.csv`);
    fs.writeFileSync(semicolonCsv, text);
    const workbook = new ExcelJS.Workbook();
    await workbook.csv.readFile(semicolonCsv, { parserOptions: { delimiter: ";" } });
    await workbook.csv.writeFile(maskedCsv);
  } else {
    fs.writeFileSync(maskedCsv, text);
  }
  process.env.NO_OPEN = "true";
  const filesUtils = await import(pathToFileURL(path.join(repoRoot, "lib", "common", "utils", "filesUtils.js")).href);
  const result = {};
  await filesUtils.createXlsxFromCsv(maskedCsv, { fileTitle: title || fileName, noOpen: true }, result);
  if (!result.xlsxFile || !fs.existsSync(result.xlsxFile)) {
    throw new Error(`createXlsxFromCsv wrote no xlsx for ${fileName}`);
  }
  return result.xlsxFile;
}

/**
 * Makes a report read the same in any Excel language, then returns its number of data rows:
 * booleans become TRUE / FALSE, decimals keep their dot and dates are written as ISO dates, where
 * Excel would show VRAI, 0,18 or 04/11/2025 on a French desktop.
 */
export async function makeLocaleNeutral(xlsxFile) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxFile);
  let dataRows = 0;
  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > 1) {
        dataRows++;
      }
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value;
        if (typeof value === "boolean") {
          cell.value = value ? "TRUE" : "FALSE";
        } else if (typeof value === "number" && !Number.isInteger(value)) {
          cell.value = String(value);
        } else if (value instanceof Date) {
          const iso = value.toISOString();
          cell.value = iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
        }
      });
    });
  }
  rebuildTables(workbook);
  await workbook.xlsx.writeFile(xlsxFile);
  return dataRows;
}

/** The overlay of a report, or null. */
export function readOverlay(overlaysDir, commandPathParts, reportFile) {
  const file = path.join(overlaysDir, ...commandPathParts, `${reportFile}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

/**
 * Finds, among the files a run reported, the xlsx of a declared report: its name starts with the
 * prefix the command gives generateReportPath, followed by "-" or the extension.
 */
export function findReportXlsx(reportedFiles, workspace, declaredPrefix) {
  return findReportFile(reportedFiles, workspace, declaredPrefix, ".xlsx");
}

/**
 * The CSV of a report the run wrote without an xlsx, or null: some commands only write a CSV, and
 * a few older ones an .xls that is a CSV.
 */
export function findReportCsv(reportedFiles, workspace, declaredPrefix) {
  return findReportFile(reportedFiles, workspace, declaredPrefix, ".csv");
}

function findReportFile(reportedFiles, workspace, declaredPrefix, extension) {
  // A prefix may be declared with the separator that follows it ("unused-users-")
  const prefix = declaredPrefix.replace(/[-_]+$/, "");
  const candidates = reportedFiles
    .map((file) => (path.isAbsolute(file) ? file : path.join(workspace, file)))
    .filter((file) => file.toLowerCase().endsWith(extension))
    .filter((file) => {
      const name = path.basename(file).toLowerCase();
      const lowerPrefix = prefix.toLowerCase();
      return name === `${lowerPrefix}${extension}` || name.startsWith(`${lowerPrefix}-`) || name.startsWith(`${lowerPrefix}_`);
    })
    .filter((file) => fs.existsSync(file))
    // When a prefix starts other reports too ("what-will-break" and "what-will-break-apex-..."),
    // the main report is the one with the shortest name
    .sort((a, b) => path.basename(a).length - path.basename(b).length);
  return candidates[0] || null;
}

function applyOverlay(workbook, overlay) {
  const worksheet = overlay.sheet ? workbook.getWorksheet(overlay.sheet) : workbook.worksheets[0];
  if (!worksheet) {
    throw new Error(`No worksheet ${overlay.sheet || "(first)"} in the report`);
  }
  const header = worksheet.getRow(1);
  const columnOf = {};
  header.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    columnOf[String(cell.value?.richText ? cell.value.richText.map((part) => part.text).join("") : cell.value)] = columnNumber;
  });
  // The style of the first data row, kept before the rows go
  const model = worksheet.rowCount >= 2 ? worksheet.getRow(2) : null;
  const styles = {};
  const height = model?.height;
  if (model) {
    model.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      styles[columnNumber] = JSON.parse(JSON.stringify(cell.style || {}));
    });
  }
  if (overlay.mode === "replace" && worksheet.rowCount >= 2) {
    worksheet.spliceRows(2, worksheet.rowCount - 1);
  }
  for (const values of overlay.rows || []) {
    const row = worksheet.addRow([]);
    for (const [column, value] of Object.entries(values)) {
      const columnNumber = columnOf[column];
      if (!columnNumber) {
        throw new Error(`The overlay names a column the report does not have: "${column}" (columns: ${Object.keys(columnOf).join(", ")})`);
      }
      const cell = row.getCell(columnNumber);
      cell.value = value;
      if (styles[columnNumber]) {
        cell.style = JSON.parse(JSON.stringify(styles[columnNumber]));
      }
    }
    if (height) {
      row.height = height;
    }
  }
  // Keep the autofilter over every row
  if (worksheet.autoFilter && typeof worksheet.autoFilter === "object" && worksheet.autoFilter.from) {
    worksheet.autoFilter = { from: worksheet.autoFilter.from, to: { row: worksheet.rowCount, column: worksheet.autoFilter.to?.column || worksheet.columnCount } };
  }
}

/**
 * ExcelJS writes back the tables it loaded from a file in a way Excel offers to repair, and the
 * workbook never opens: each table is created again from the cells it covers.
 */
function rebuildTables(workbook) {
  for (const worksheet of workbook.worksheets) {
    for (const [name, table] of Object.entries(worksheet.tables || {})) {
      const model = table.table || table.model;
      const ref = model.ref || model.tableRef;
      const [start, end] = String(ref).split(":");
      const first = worksheet.getCell(start);
      const last = worksheet.getCell(end || start);
      const columns = [];
      for (let column = first.col; column <= last.col; column++) {
        const header = worksheet.getRow(first.row).getCell(column).value;
        columns.push({ name: String(header?.richText ? header.richText.map((part) => part.text).join("") : header ?? `Column${column}`), filterButton: true });
      }
      const rows = [];
      for (let row = first.row + 1; row <= Math.max(last.row, worksheet.rowCount); row++) {
        const values = [];
        for (let column = first.col; column <= last.col; column++) {
          const value = worksheet.getRow(row).getCell(column).value;
          values.push(value?.richText ? value.richText.map((part) => part.text).join("") : value ?? null);
        }
        if (values.some((value) => value !== null && value !== "")) {
          rows.push(values);
        }
      }
      worksheet.removeTable(name);
      worksheet.addTable({
        name,
        ref: start,
        headerRow: true,
        style: { theme: model.style?.theme || "TableStyleMedium2", showRowStripes: true },
        columns,
        rows: rows.length > 0 ? rows : [columns.map(() => null)],
      });
    }
  }
}

function maskFunction(rules) {
  const compiled = (rules || []).map((rule) => [new RegExp(rule.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), rule.replace]);
  return (text) => compiled.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

function maskValue(value, mask) {
  if (typeof value === "string") {
    return mask(value);
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string" || typeof value.hyperlink === "string") {
      return { ...value, text: typeof value.text === "string" ? mask(value.text) : value.text, hyperlink: typeof value.hyperlink === "string" ? mask(value.hyperlink) : value.hyperlink };
    }
    if (Array.isArray(value.richText)) {
      return { ...value, richText: value.richText.map((part) => ({ ...part, text: mask(part.text || "") })) };
    }
  }
  return value;
}
