import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { createTempDir, uxLog } from './index.js';
import { glob } from 'glob';
import { parseXmlFile, writeXmlFile } from './xmlUtils.js';
import { isScratchOrg } from './orgUtils.js';
import { GLOB_IGNORE_PATTERNS } from './projectUtils.js';

// Update files for special cases
export async function arrangeFilesBefore(commandThis: any, options: any = {}) {
  const tempDir = await createTempDir();
  const arrangedFiles: any[] = [];
  if ((await isScratchOrg(options)) === true) {
    const arrangedLookupFields = await removeLookupFilters(tempDir, commandThis, options);
    arrangedFiles.push(...arrangedLookupFields);
  }
  return arrangedFiles;
}

// Remove lookup filters because they aren't pushed well
export async function removeLookupFilters(tempDir: string, commandThis: any, options: any = {}) {
  const arrangedFiles: any = [];
  const findFieldsPattern = (options.rootFolder || '.') + `/**/objects/**/fields/**.field-meta.xml`;
  const matchingFieldFiles = await glob(findFieldsPattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS });
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
      uxLog("log", commandThis, c.grey(`Removed lookup filter from field ${fieldFile}`));
    }
  }
  return arrangedFiles;
}

// Update files for special cases
export async function restoreArrangedFiles(arrangedFiles: any[], commandThis: any) {
  for (const arrangedFile of arrangedFiles) {
    await fs.copyFile(arrangedFile.backupFile, arrangedFile.file);
    uxLog("log", commandThis, c.grey(`Restored file ${arrangedFile.file}`));
  }
}
// Parse the given query and re-apply the limit clause if exists and is lower than the provided limit
export async function parseSoqlAndReapplyLimit(soqlQuery: string, limit: number | undefined, commandThis: any) {
  const limitRegex = /\slimit (\d+)\s?/ig;
  let tempSoqlQuery = soqlQuery;
  let newLimit: number | undefined;
  const matches = tempSoqlQuery.matchAll(limitRegex);
  if (matches) {
    for (const match of matches) {
      newLimit = match[1] ? parseInt(match[1]) : undefined;
    }
  }

  if (newLimit && limit && newLimit <= limit) {
    tempSoqlQuery = tempSoqlQuery.replace(limitRegex, ' ') + ` LIMIT ${newLimit}`;
  } else if (limit) {
    tempSoqlQuery = tempSoqlQuery.replace(limitRegex, ' ') + ` LIMIT ${limit}`;
  }
  //Replace 2 or more spaces with single space
  tempSoqlQuery = tempSoqlQuery.replace(/\s{2,}/g, ' ');
  uxLog("log", commandThis, c.grey(`New Query: ${tempSoqlQuery}`));
  return tempSoqlQuery;
}
