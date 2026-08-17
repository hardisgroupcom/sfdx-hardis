import fs from 'fs-extra';
import * as path from 'path';

// The actions report is the audit trail of a sandbox refresh: when before-refresh or
// after-refresh is run several times, the report must stay cumulative across runs.
// Actions are persisted in the backup folder and merged with the current run's rows.

export interface RefreshActionRow {
  step: string;
  type: string;
  name: string;
  status: string;
  details: string;
  runDate?: string;
}

export const BEFORE_REFRESH_ACTIONS_HISTORY_FILE = 'sandbox-refresh-before-actions-history.json';
export const AFTER_REFRESH_ACTIONS_HISTORY_FILE = 'sandbox-refresh-after-actions-history.json';

function rowKey(row: RefreshActionRow): string {
  return `${row.step}|${row.type}|${row.name}`;
}

/**
 * Merge the current run's action rows with the ones persisted by previous runs, then save the history.
 *
 * Merge rules:
 * - A current row replaces the previous row with the same step/type/name.
 * - Steps listed in replaceSteps rebuild their data from scratch when they really run:
 *   when the current run holds at least one non-Skipped row for such a step, all its
 *   previous rows are dropped (they describe data that no longer exists).
 * - All other previous rows are kept: they describe backup content still on disk.
 */
export async function mergeAndSaveRefreshActions(
  saveProjectPath: string,
  historyFileName: string,
  currentRows: RefreshActionRow[],
  replaceSteps: string[],
  runDate: string
): Promise<RefreshActionRow[]> {
  const stampedCurrentRows = currentRows.map((row) => ({ ...row, runDate: row.runDate || runDate }));

  const historyFile = path.join(saveProjectPath, historyFileName);
  let previousRows: RefreshActionRow[] = [];
  if (fs.existsSync(historyFile)) {
    try {
      const historyContent = await fs.readJson(historyFile);
      previousRows = Array.isArray(historyContent) ? historyContent : [];
    } catch {
      previousRows = [];
    }
  }

  const reExecutedSteps = new Set(
    stampedCurrentRows.filter((row) => row.status !== 'Skipped').map((row) => row.step)
      .filter((step) => replaceSteps.includes(step))
  );
  const currentKeys = new Set(stampedCurrentRows.map(rowKey));
  const keptPreviousRows = previousRows.filter(
    (row) => !reExecutedSteps.has(row.step) && !currentKeys.has(rowKey(row))
  );

  const combinedRows = [...keptPreviousRows, ...stampedCurrentRows];
  await fs.writeJson(historyFile, combinedRows, { spaces: 2 });
  return combinedRows;
}
