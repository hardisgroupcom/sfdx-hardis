/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as path from 'path';
import { glob } from 'glob';
import fs from '../../../../src/common/utils/fsUtils.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../src/common/utils/projectUtils.js';
import {
  METADATA_STATUS_FILE_TYPES,
  listMetadataStatusFiles,
} from '../../../../src/commands/hardis/lint/metadatastatus.js';

/**
 * hardis:lint:metadatastatus used to run one glob per metadata type, so the sources were walked nine
 * times. listMetadataStatusFiles passes the nine patterns to a single glob call and buckets the result
 * per type. These tests check the buckets hold exactly what the per-type patterns used to return.
 *
 * The hooks stay inside the describe block: mocha treats file level hooks as root hooks that run for
 * every test of the whole suite, which would move the cwd under other test files.
 */

// One file per checked metadata type, in the folder layout the patterns expect
const FIXTURE_FILES = [
  'force-app/main/default/flows/Status_Flow.flow-meta.xml',
  'force-app/main/default/objects/Account/validationRules/Status_Rule.validationRule-meta.xml',
  'force-app/main/default/objects/Account/recordTypes/Status_Type.recordType-meta.xml',
  'force-app/main/default/approvalProcesses/Status_Approval.approvalProcess-meta.xml',
  'force-app/main/default/forecastingTypes/Status_Forecast.forecastingType-meta.xml',
  'force-app/main/default/workflows/Account.workflow-meta.xml',
  'force-app/main/default/assignmentRules/Lead.assignmentRules-meta.xml',
  'force-app/main/default/autoResponseRules/Case.autoResponseRules-meta.xml',
  'force-app/main/default/escalationRules/Case.escalationRules-meta.xml',
  // Decoys: must never show up in any bucket
  'node_modules/some-package/flows/Decoy.flow-meta.xml',
  'force-app/main/default/elsewhere/Stray.flow-meta.xml',
];

describe('hardis:lint:metadatastatus file listing', () => {
  const tmpRoot = path.join(process.cwd(), 'tmp');
  let tmpDir = '';
  let previousCwd = '';

  beforeEach(async () => {
    tmpDir = path.join(tmpRoot, `hardis-status-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    for (const fixtureFile of FIXTURE_FILES) {
      const filePath = path.join(tmpDir, fixtureFile);
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, '<?xml version="1.0" encoding="UTF-8"?>');
    }
    previousCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.remove(tmpDir);
  });

  it('returns per type exactly what a glob on that type pattern returns', async () => {
    const filesByType = await listMetadataStatusFiles(GLOB_IGNORE_PATTERNS);
    for (const fileType of METADATA_STATUS_FILE_TYPES) {
      const expected = await glob(fileType.pattern, { ignore: GLOB_IGNORE_PATTERNS });
      expect(filesByType.get(fileType.key)?.slice().sort(), fileType.key).to.deep.equal(expected.slice().sort());
    }
  });

  it('finds one file for every checked metadata type', async () => {
    const filesByType = await listMetadataStatusFiles(GLOB_IGNORE_PATTERNS);
    expect(filesByType.size).to.equal(METADATA_STATUS_FILE_TYPES.length);
    for (const fileType of METADATA_STATUS_FILE_TYPES) {
      expect(filesByType.get(fileType.key), fileType.key).to.have.lengthOf(1);
    }
  });

  it('leaves out the files of the ignored folders', async () => {
    const filesByType = await listMetadataStatusFiles(GLOB_IGNORE_PATTERNS);
    const allFiles = [...filesByType.values()].flat();
    expect(allFiles.filter((file) => file.includes('node_modules'))).to.deep.equal([]);
  });

  it('does not attribute a file sitting outside the folder of its type', async () => {
    const filesByType = await listMetadataStatusFiles(GLOB_IGNORE_PATTERNS);
    const allFiles = [...filesByType.values()].flat();
    expect(allFiles.filter((file) => file.includes('Stray'))).to.deep.equal([]);
  });

  it('gives every metadata type a distinct file suffix, so a file lands in a single bucket', () => {
    const suffixes = METADATA_STATUS_FILE_TYPES.map((fileType) => fileType.suffix);
    expect(new Set(suffixes).size).to.equal(suffixes.length);
  });
});
