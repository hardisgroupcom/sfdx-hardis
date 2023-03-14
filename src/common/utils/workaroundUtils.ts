import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { createTempDir, uxLog } from ".";
import * as glob from "glob-promise";
import { parseXmlFile, writeXmlFile } from "./xmlUtils";
import { isScratchOrg } from "./orgUtils";

// Update files for special cases
export async function arrangeFilesBefore(commandThis: any, options: any = {}) {
  const tempDir = await createTempDir();
  const arrangedFiles = [];
  if ((await isScratchOrg(options)) === true) {
    const arrangedLookupFields = await removeLookupFilters(tempDir, commandThis, options);
    arrangedFiles.push(...arrangedLookupFields);
  }
  return arrangedFiles;
}

// Remove lookup filters because they aren't pushed well
export async function removeLookupFilters(tempDir: string, commandThis: any, options: any = {}) {
  const arrangedFiles = [];
  const findFieldsPattern = (options.rootFolder || ".") + `/**/objects/**/fields/**.field-meta.xml`;
  const matchingFieldFiles = await glob(findFieldsPattern, { cwd: process.cwd() });
  for (const fieldFile of matchingFieldFiles) {
    // skip if managed field
    if ((path.basename(fieldFile).match(/__/g) || []).length === 2) {
      continue;
    }
    const fieldXml = await parseXmlFile(fieldFile);
    if (fieldXml?.CustomField?.lookupFilter) {
      const backupFile = path.join(tempDir, fieldFile);
      await fs.ensureDir(path.dirname(backupFile));
      await fs.copyFile(fieldFile, backupFile);
      delete fieldXml.CustomField.lookupFilter;
      await writeXmlFile(fieldFile, fieldXml);
      arrangedFiles.push({ file: fieldFile, backupFile: backupFile });
      ("");
      uxLog(commandThis, c.grey(`Removed lookup filter from field ${fieldFile}`));
    }
  }
  return arrangedFiles;
}

// Update files for special cases
export async function restoreArrangedFiles(arrangedFiles: any[], commandThis: any) {
  for (const arrangedFile of arrangedFiles) {
    await fs.copyFile(arrangedFile.backupFile, arrangedFile.file);
    uxLog(commandThis, c.grey(`Restored file ${arrangedFile.file}`));
  }
}
