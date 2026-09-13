/*
 * Progress of a command that a VS Code panel runs in the background, with --json and without the
 * WebSocket (ex: sf hardis:work:backpromote --plan). When SFDX_HARDIS_PROGRESS_FILE is set, each step
 * is appended to that file as one JSON line, which the panel reads while it waits for the JSON result.
 * Without the variable nothing is written.
 */
import fs from './fsUtils.js';

export interface CommandProgressEvent {
  /** Stable id of the step, ex: listing, delta */
  step: string;
  /** What the command is doing, in the user language */
  message: string;
  /** Position in a counted step (1-based), with total */
  current?: number;
  total?: number;
}

export function getProgressFile(): string | null {
  return process.env.SFDX_HARDIS_PROGRESS_FILE || null;
}

export function reportCommandProgress(event: CommandProgressEvent): void {
  const progressFile = getProgressFile();
  if (!progressFile) {
    return;
  }
  const line: Record<string, unknown> = { time: new Date().toISOString(), step: event.step, message: event.message };
  if (typeof event.current === 'number' && typeof event.total === 'number') {
    line.current = event.current;
    line.total = event.total;
  }
  try {
    fs.appendFileSync(progressFile, JSON.stringify(line) + '\n', 'utf8');
  } catch {
    // A progress line the panel does not get is not worth failing the command
  }
}
