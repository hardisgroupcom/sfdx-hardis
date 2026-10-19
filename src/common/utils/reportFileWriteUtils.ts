import * as path from 'path';
import c from 'chalk';
import fs from './fsUtils.js';
import { isCI, uxLog } from './index.js';
import { t } from './i18n.js';

// Highest suffix tried before giving up: report-2.xlsx ... report-10.xlsx
const MAX_FALLBACK_INDEX = 10;

// Error codes Windows returns when another application (Excel) holds the file open
const LOCKED_FILE_ERROR_CODES = ['EBUSY', 'EPERM', 'EACCES'];

// Fallback path -> path the caller asked for, so a workbook built from a renamed CSV keeps the
// usual sheet name (see reportFileRequestedPath)
const requestedPathByWrittenPath = new Map<string, string>();

export type WriteReportFileOptions = {
  // Only fall back to a name that does not exist yet: for files a user may have written by hand,
  // like a test notebook, that a fallback must never overwrite
  newFileOnly?: boolean;
  // Defaults to Windows outside CI, the only place where Excel locks files: elsewhere EPERM and
  // EACCES mean a read-only file or a file of another user, which must stay an error
  fallback?: boolean;
};

/**
 * Writes a report file with the given writer, and falls back to "name-2.ext", "name-3.ext"... when
 * the target file exists and is locked by another application, typically a report left open in
 * Excel. Returns the path actually written: callers must use it instead of the one they passed.
 * Any other error, or a lock on every name, is thrown as is.
 * The writer is called once per name tried: build the content before, and only write it inside.
 */
export async function writeReportFile(
  targetPath: string,
  write: (filePath: string) => Promise<unknown>,
  commandThis: any = null,
  options: WriteReportFileOptions = {}
): Promise<string> {
  const fallback = options.fallback ?? (process.platform === 'win32' && !isCI);
  let candidate = targetPath;
  let index = 1;
  for (;;) {
    try {
      await write(candidate);
      break;
    } catch (e) {
      if (!fallback || !isLockedFileError(e, candidate)) {
        throw e;
      }
      const next = nextFallbackPath(targetPath, index, options.newFileOnly === true);
      if (!next) {
        throw e;
      }
      ({ candidate, index } = next);
    }
  }
  requestedPathByWrittenPath.delete(candidate);
  if (candidate !== targetPath) {
    requestedPathByWrittenPath.set(candidate, targetPath);
    uxLog('warning', commandThis, c.yellow(t('reportFileLockedWrittenAs', { file: targetPath, newFile: candidate })));
  }
  return candidate;
}

/**
 * The path a caller asked for when the file was written under a fallback name, else the path itself.
 * Used to name a worksheet after the usual CSV name ("Users", not "Users-2").
 */
export function reportFileRequestedPath(writtenPath: string): string {
  return requestedPathByWrittenPath.get(writtenPath) ?? writtenPath;
}

// A lock error on a file that does not exist is something else (missing or read-only folder):
// another name would fail the same way.
function isLockedFileError(e: any, filePath: string): boolean {
  return LOCKED_FILE_ERROR_CODES.includes(e?.code) && fs.existsSync(filePath);
}

// Next name to try after "index", or null when every name was tried
function nextFallbackPath(targetPath: string, index: number, newFileOnly: boolean): { candidate: string; index: number } | null {
  for (let nextIndex = index + 1; nextIndex <= MAX_FALLBACK_INDEX; nextIndex++) {
    const candidate = fallbackPath(targetPath, nextIndex);
    if (!newFileOnly || !fs.existsSync(candidate)) {
      return { candidate, index: nextIndex };
    }
  }
  return null;
}

// Built from the original name every time, so the suffixes never pile up (no report-2-2.xlsx)
function fallbackPath(targetPath: string, index: number): string {
  const extension = path.extname(targetPath);
  const baseName = path.basename(targetPath, extension);
  return path.join(path.dirname(targetPath), `${baseName}-${index}${extension}`);
}
