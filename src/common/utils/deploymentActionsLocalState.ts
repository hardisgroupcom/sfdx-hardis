import * as path from 'path';
import fs from './fsUtils.js';
import { DeploymentActionStateEntry } from './deploymentActionsStateUtils.js';

/**
 * Results of deployment actions run in a developer org, for a Pull Request that has no comment
 * to hold them yet (draft) or when no git provider token is available.
 *
 * Stored under config/user/, which sfdx-hardis projects keep out of git: the file belongs to the
 * developer's machine and org, never to the project.
 */
const LOCAL_STATE_DIR = path.join('config', 'user', 'deployment-actions');

export function getLocalActionStateFile(prId: string): string {
  return path.join(LOCAL_STATE_DIR, `${prId || 'draft'}.json`);
}

export function readLocalActionStates(prId: string): DeploymentActionStateEntry[] {
  const file = getLocalActionStateFile(prId);
  if (!fs.existsSync(file)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch (_e) {
    // A file edited by hand into invalid JSON must not block a run: it is rewritten on the next one
    return [];
  }
}

export function findLocalActionState(prId: string, actionId: string, orgBranch: string): DeploymentActionStateEntry | null {
  return readLocalActionStates(prId).find((e) => e.actionId === actionId && e.orgBranch === orgBranch) || null;
}

export function upsertLocalActionState(prId: string, entry: DeploymentActionStateEntry): string {
  const entries = readLocalActionStates(prId).filter((e) => !(e.actionId === entry.actionId && e.orgBranch === entry.orgBranch));
  entries.push(entry);
  const file = getLocalActionStateFile(prId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ entries }, null, 2) + '\n', 'utf8');
  return file;
}
