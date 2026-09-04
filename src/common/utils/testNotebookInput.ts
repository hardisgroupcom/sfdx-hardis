import { SfError } from '@salesforce/core';
import fs from './fsUtils.js';
import { parseNotebookFile, validateNormalizedCases } from './testNotebookUtils.js';
import { NormalizedTestCase } from './testNotebookTypes.js';

/**
 * Exactly one of --notebook / --testsjsonfile, never both, never neither.
 *
 * This lives in src/common/ and not in the command file for two reasons: `src/commands/**`
 * holds nothing but the command class in this repo, and `render` applies the very same rule.
 */
export async function resolveNotebookInput(flags: any): Promise<NormalizedTestCase[]> {
  const notebook = flags.notebook;
  const jsonFile = flags.testsjsonfile;
  if (notebook && jsonFile) {
    throw new SfError('Pass exactly one of --notebook or --testsjsonfile, not both.');
  }
  if (!notebook && !jsonFile) {
    throw new SfError('Pass a notebook with --notebook (.md, .xlsx, .csv) or a pre-normalized --testsjsonfile.');
  }
  if (jsonFile) {
    if (!(await fs.pathExists(jsonFile))) {
      throw new SfError(`Test cases JSON file not found: ${jsonFile}`);
    }
    return validateNormalizedCases(JSON.parse(await fs.readFile(jsonFile, 'utf8')));
  }
  return parseNotebookFile(notebook, flags['ticket-number']);
}
