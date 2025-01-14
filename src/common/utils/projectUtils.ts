import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { execCommand, uxLog } from './index.js';
import { glob } from 'glob';
import { parseXmlFile } from './xmlUtils.js';

export const GLOB_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/cache/**',
  '**/.npm/**',
  '**/logs/**',
  '**/.sfdx/**',
  '**/.sf/**',
  '**/.vscode/**',
];

export function isSfdxProject(cwd = process.cwd()) {
  return fs.existsSync(path.join(cwd, 'sfdx-project.json'));
}

export async function createBlankSfdxProject(cwd = process.cwd(), debug = false) {
  uxLog(this, c.cyan('Creating blank SFDX project...'));
  const projectCreateCommand = 'sf project generate --name "sfdx-hardis-blank-project"';
  await execCommand(projectCreateCommand, this, {
    cwd: cwd,
    fail: true,
    debug: debug,
    output: true,
  });
  return path.join(cwd, "sfdx-hardis-blank-project");
}

export async function listFlowFiles(packageDirs) {
  const flowFiles: any[] = [];
  const skippedFlows: string[] = [];
  for (const packageDir of packageDirs || []) {
    const flowMetadatas = await glob("**/*.flow-meta.xml", { cwd: packageDir.path });
    for (const flowMetadata of flowMetadatas) {
      const flowFile = path.join(packageDir.path, flowMetadata).replace(/\\/g, '/');
      if (await isManagedFlow(flowFile)) {
        skippedFlows.push(flowFile);
      }
      else {
        flowFiles.push(flowFile)
      }
    }
  }
  if (skippedFlows.length > 0) {
    uxLog(this, c.yellow(`Skipped ${skippedFlows.length} managed flows:`));
    for (const skippedFlow of skippedFlows.sort()) {
      uxLog(this, c.yellow(`  ${skippedFlow}`));
    }
  }
  return flowFiles.sort();
}

export async function isManagedFlow(flowFile: string) {
  const flowXml = await parseXmlFile(flowFile);
  for (const flowNodeType of [
    'start',
    'actionCalls',
    'assignments',
    'customErrors',
    'collectionProcessors',
    'decisions',
    'loops',
    'recordCreates',
    'recordDeletes',
    'recordLookups',
    'recordUpdates',
    'screens',
    'subflows',
    'variables',
    'constants',
    'formulas']) {
    if (flowXml?.Flow?.[flowNodeType] && flowXml?.Flow?.[flowNodeType]?.length > 0) {
      return false;
    }
  }
  return true;
}
