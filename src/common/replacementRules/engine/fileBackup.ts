// Replacement rules change the metadata files in place for the duration of a deployment, because
// `sf project deploy start` reads them from the package directories. Every file is copied before its
// first change and restored afterwards, also when the process exits or is interrupted. A pointer file
// in the system temp folder lists the backups, so a run killed before restoring is repaired by the next one.

import * as crypto from 'crypto';
import * as nodeFs from 'fs';
import * as os from 'os';
import * as path from 'path';
import fs from '../../utils/fsUtils.js';
import { createTempDir } from '../../utils/index.js';

interface BackupEntry {
  file: string;
  backup: string;
}

interface BackupPointer {
  cwd: string;
  createdAt: string;
  entries: BackupEntry[];
}

export class ReplacementFileBackup {
  private backupDir: string | null = null;
  private entries: BackupEntry[] = [];
  private restored = false;
  private exitHandler: (() => void) | null = null;
  private signalHandler: ((signal: NodeJS.Signals) => void) | null = null;

  /** Copy a file before its first change. Must be called before writing the file. */
  public async backupFile(file: string): Promise<void> {
    const absolute = path.resolve(file);
    if (this.entries.some((entry) => entry.file === absolute)) {
      return;
    }
    if (!this.backupDir) {
      this.backupDir = await createTempDir();
      this.registerProcessHandlers();
    }
    const backup = path.join(this.backupDir, String(this.entries.length));
    await fs.copy(absolute, backup);
    this.entries.push({ file: absolute, backup });
    writePointer({ cwd: process.cwd(), createdAt: new Date().toISOString(), entries: this.entries });
  }

  public get changedFileCount(): number {
    return this.entries.length;
  }

  /** Put every changed file back. Safe to call several times. Returns the number of restored files. */
  public restore(): number {
    if (this.restored) {
      return 0;
    }
    this.restored = true;
    this.unregisterProcessHandlers();
    const count = restoreEntries(this.entries);
    deletePointer();
    return count;
  }

  private registerProcessHandlers(): void {
    // Synchronous on purpose: nothing asynchronous runs in an exit handler
    this.exitHandler = () => this.restore();
    process.on('exit', this.exitHandler);
    this.signalHandler = (signal: NodeJS.Signals) => {
      this.restore();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    };
    process.once('SIGINT', this.signalHandler);
    process.once('SIGTERM', this.signalHandler);
  }

  private unregisterProcessHandlers(): void {
    if (this.exitHandler) {
      process.removeListener('exit', this.exitHandler);
    }
    if (this.signalHandler) {
      process.removeListener('SIGINT', this.signalHandler);
      process.removeListener('SIGTERM', this.signalHandler);
    }
    this.exitHandler = null;
    this.signalHandler = null;
  }
}

/** Restore the files a killed run left changed in this folder. Returns the number of restored files. */
export function restoreLeftoverReplacementFiles(): number {
  const pointerFile = getPointerFile();
  if (!nodeFs.existsSync(pointerFile)) {
    return 0;
  }
  let pointer: BackupPointer | null = null;
  try {
    pointer = JSON.parse(nodeFs.readFileSync(pointerFile, 'utf-8'));
  } catch {
    pointer = null;
  }
  const count = pointer && pointer.cwd === process.cwd() ? restoreEntries(pointer.entries || []) : 0;
  deletePointer();
  return count;
}

function restoreEntries(entries: BackupEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    try {
      if (nodeFs.existsSync(entry.backup)) {
        nodeFs.copyFileSync(entry.backup, entry.file);
        count++;
      }
    } catch {
      // Best effort: the other files are restored anyway
    }
  }
  return count;
}

function getPointerFile(): string {
  const hash = crypto.createHash('sha1').update(process.cwd()).digest('hex').substring(0, 16);
  return path.join(os.tmpdir(), `sfdx-hardis-replacement-rules-${hash}.json`);
}

function writePointer(pointer: BackupPointer): void {
  try {
    nodeFs.writeFileSync(getPointerFile(), JSON.stringify(pointer));
  } catch {
    // Without the pointer only the recovery of a killed run is lost
  }
}

function deletePointer(): void {
  try {
    nodeFs.rmSync(getPointerFile(), { force: true });
  } catch {
    // Nothing to do
  }
}
