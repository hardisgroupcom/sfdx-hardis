import * as child from 'child_process';
import * as csvStringify from 'csv-stringify/lib/sync';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as util from 'util';
import * as xml2js from 'xml2js';
const exec = util.promisify(child.exec);

let pluginsStdout = null;

// Install plugin if not present
export async function checkSfdxPlugin(
  pluginName: string
): Promise<{ installed: boolean; message: string }> {
  let installed = false;
  if (pluginsStdout == null) {
    const pluginsRes = await exec('sfdx plugins');
    pluginsStdout = pluginsRes.stdout;
  }
  if (!pluginsStdout.includes(pluginName)) {
    await exec(`sfdx plugins:install ${pluginName}`);
    installed = true;
  }
  return {
    installed,
    message: installed
      ? `[sfdx-hardis] Installed sfdx plugin ${pluginName}`
      : `[sfdx-hardis] sfdx plugin ${pluginName} is already installed`
  };
}

// Filter package XML
export async function filterPackageXml(
  packageXmlFile: string,
  packageXmlFileOut: string,
  removeMetadatas: string[]
): Promise<{ updated: boolean; message: string }> {
  let updated = false;
  let message = `[sfdx-hardis] ${packageXmlFileOut} not updated`;
  const initialFileContent = fs.readFileSync(packageXmlFile);
  const manifest = await xml2js.parseStringPromise(initialFileContent);
  manifest.Package.types = manifest.Package.types.filter(
    (type: any) => !removeMetadatas.includes(type.name[0])
  );
  const builder = new xml2js.Builder();
  const updatedFileContent = builder.buildObject(manifest);
  if (updatedFileContent !== initialFileContent) {
    fs.writeFileSync(packageXmlFileOut, updatedFileContent);
    updated = true;
    message = `[sfdx-hardis] ${packageXmlFile} has been filtered to ${packageXmlFileOut}`;
  }
  return {
    updated,
    message
  };
}

// Catch matches in files according to criteria
export async function catchMatches(
  catcher: any,
  file: string,
  fileText: string,
  commandThis: any
) {
  const matchResults = [];
  if (catcher.regex) {
    // Check if there are matches
    const matches = await countRegexMatches(catcher.regex, fileText);
    if (matches > 0) {
      // If match, extract match details
      const fileName = path.basename(file);
      const detail: any = {};
      for (const detailCrit of catcher.detail) {
        const detailCritVal = await extractRegexGroups(
          detailCrit.regex,
          fileText
        );
        if (detailCritVal.length > 0) {
          detail[detailCrit.name] = detailCritVal;
        }
      }
      const catcherLabel = catcher.regex
        ? `regex ${catcher.regex.toString()}`
        : 'ERROR';
      matchResults.push({
        fileName,
        fileText,
        matches,
        type: catcher.type,
        subType: catcher.subType,
        detail,
        catcherLabel
      });
      if (commandThis.debug) {
        commandThis.ux.log(
          `[sfdx-hardis] [${fileName}]: Match [${matches}] occurences of [${catcher.type}/${catcher.name}] with catcher [${catcherLabel}]`
        );
      }
    }
  }
  return matchResults;
}

// Count matches of a regex
export async function countRegexMatches(
  regex: RegExp,
  text: string
): Promise<number> {
  return ((text || '').match(regex) || []).length;
}

// Get all captured groups of a regex in a string
export async function extractRegexGroups(
  regex: RegExp,
  text: string
): Promise<string[]> {
  const matches = ((text || '').match(regex) || []).map(e =>
    e.replace(regex, '$1').trim()
  );
  return matches;
  // return ((text || '').matchAll(regex) || []).map(item => item.trim());
}

// Generate output files
export async function generateReports(
  resultSorted: any[],
  columns: any[],
  commandThis: any
): Promise<any[]> {
  const logFileName = 'sfdx-hardis-' + commandThis.id.substr(commandThis.id.lastIndexOf(':') + 1);
  const reportFile = path.resolve(
    `./hardis-report/${logFileName}.csv`
  );
  const reportFileExcel = path.resolve(
    `./hardis-report/${logFileName}.xls`
  );
  await fs.ensureDir(path.dirname(reportFile));
  const csv = csvStringify(resultSorted, {
    delimiter: ';',
    header: true,
    columns
  });
  await fs.writeFile(reportFile, csv, 'utf8');
  const excel = csvStringify(resultSorted, {
    delimiter: '\t',
    header: true,
    columns
  });
  await fs.writeFile(reportFileExcel, excel, 'utf8');
  commandThis.ux.log('[sfdx-hardis] Generated report files:');
  commandThis.ux.log(`[sfdx-hardis] - CSV: ${reportFile}`);
  commandThis.ux.log(`[sfdx-hardis] - XLS: ${reportFileExcel}`);
  return [
    { type: 'csv', file: reportFile },
    { type: 'xls', file: reportFileExcel }
  ];
}
