import * as path from 'path';
import c from 'chalk';
import fs from './fsUtils.js';
import { uxLog } from './index.js';
import { t } from './i18n.js';

// Highest suffix tried before giving up: report-2.xlsx ... report-10.xlsx
const MAX_FALLBACK_INDEX = 10;

// Error codes Windows returns when another application (Excel) holds the file open
const LOCKED_FILE_ERROR_CODES = ['EBUSY', 'EPERM', 'EACCES'];

/**
 * Writes a report file with the given writer, and falls back to "name-2.ext", "name-3.ext"... when
 * the target file exists and is locked by another application, typically a report left open in
 * Excel. Returns the path actually written: callers must use it instead of the one they passed.
 * Any other error, or a lock on every name, is thrown as is.
 */
export async function writeReportFile(
  targetPath: string,
  write: (filePath: string) => Promise<unknown>,
  commandThis: any = null
): Promise<string> {
  let candidate = targetPath;
  for (let index = 2; ; index++) {
    try {
      await write(candidate);
      break;
    } catch (e) {
      if (index > MAX_FALLBACK_INDEX || !isLockedFileError(e, candidate)) {
        throw e;
      }
      candidate = fallbackPath(targetPath, index);
    }
  }
  if (candidate !== targetPath) {
    uxLog('warning', commandThis, c.yellow(t('reportFileLockedWrittenAs', { file: targetPath, newFile: candidate })));
  }
  return candidate;
}

// A lock error on a file that does not exist is something else (missing or read-only folder):
// another name would fail the same way.
function isLockedFileError(e: any, filePath: string): boolean {
  return LOCKED_FILE_ERROR_CODES.includes(e?.code) && fs.existsSync(filePath);
}

// Built from the original name every time, so the suffixes never pile up (no report-2-2.xlsx)
function fallbackPath(targetPath: string, index: number): string {
  const extension = path.extname(targetPath);
  const baseName = path.basename(targetPath, extension);
  return path.join(path.dirname(targetPath), `${baseName}-${index}${extension}`);
}
