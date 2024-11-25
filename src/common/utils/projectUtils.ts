import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { execCommand, uxLog } from './index.js';

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
