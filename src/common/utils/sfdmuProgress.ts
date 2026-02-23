import { spawn } from 'child_process';
import * as readline from 'readline';
import c from 'chalk';
import { WebSocketClient } from '../websocketClient.js';
import { uxLog } from './index.js';

export interface SfdmuProgressStats {
  totalRecordsProcessed: number;
  totalRecordsExpected?: number;
  objectsProcessed: number;
  currentObject?: string;
  currentRecordsInObject: number;
  phase?: string;
  totalObjects?: number;
  errors: number;
  isCompleted: boolean;
}

export interface SfdmuOperationOptions {
  command: string;
  cwd?: string;
  commandThis?: any;
  operationType?: 'export' | 'import' | 'delete';
  onProgress?: (stats: SfdmuProgressStats) => void;
}

/**
 * Parses SFDMU output lines to extract progress information
 * SFDMU typically outputs lines like:
 * - "[10:30:45] Account (1000 records processed)"
 * - "Processing object: Opportunity"
 * - "Records read: 50"
 * etc.
 */
export function parseSfdmuOutputLine(line: string): Partial<SfdmuProgressStats> | null {
  if (!line || typeof line !== 'string') {
    return null;
  }

  const updates: Partial<SfdmuProgressStats> = {};
  let hasUpdates = false;

  // Pattern: Phase headers (e.g., "===== MIGRATION JOB STARTED =====")
  const phaseMatch = line.match(/=====\s*(.*?)\s*=====/);
  if (phaseMatch) {
    updates.phase = phaseMatch[1].trim();
    hasUpdates = true;
  }

  // Pattern: Object names in braces (e.g., "{Contact} Processing the object ...")
  const braceObjectMatch = line.match(/\{([^}]+)\}\s*(.*)$/);
  if (braceObjectMatch) {
    const objectName = braceObjectMatch[1].trim();
    const rest = braceObjectMatch[2] || '';
    if (objectName) {
      updates.currentObject = objectName;
      hasUpdates = true;
    }

    // Pattern: Original query returns N records
    const originalQueryMatch = rest.match(/returning\s+(\d+)\s+records?/i);
    if (originalQueryMatch) {
      updates.totalRecordsExpected = parseInt(originalQueryMatch[1], 10);
      hasUpdates = true;
    }

    // Pattern: Data retrieval completed - got N records
    const gotRecordsMatch = rest.match(/got\s+(\d+)\s+new\s+records?/i);
    if (gotRecordsMatch) {
      updates.totalRecordsProcessed = parseInt(gotRecordsMatch[1], 10);
      hasUpdates = true;
    }

    // Pattern: Totally processed N records
    const processedMatch = rest.match(/totally\s+processed\s+(\d+)\s+records?/i);
    if (processedMatch) {
      updates.totalRecordsProcessed = parseInt(processedMatch[1], 10);
      hasUpdates = true;
    }
  }

  // Pattern: Object name with record count - "[HH:MM:SS] ObjectName (N records...)"
  const recordCountMatch = line.match(/\]\s*(\w+)\s*\((\d+)\s*records?/i);
  if (recordCountMatch) {
    const objectName = recordCountMatch[1];
    const recordCount = parseInt(recordCountMatch[2], 10);
    updates.currentObject = objectName;
    updates.currentRecordsInObject = recordCount;
    updates.totalRecordsProcessed = recordCount;
    hasUpdates = true;
  }

  // Pattern: Total records processed
  const totalMatch = line.match(/total.*?(\d+)\s*records?/i);
  if (totalMatch) {
    updates.totalRecordsProcessed = parseInt(totalMatch[1], 10);
    hasUpdates = true;
  }

  // Pattern: Processing specific object
  const objectMatch = line.match(/(?:processing|updating|inserting|upserting)[\s:]*(\w+)/i);
  if (objectMatch) {
    updates.currentObject = objectMatch[1];
    hasUpdates = true;
  }

  // Pattern: In progress... Completed N records
  const inProgressMatch = line.match(/in\s+progress\.+\s*completed\s+(\d+)\s+records?/i);
  if (inProgressMatch) {
    updates.totalRecordsProcessed = parseInt(inProgressMatch[1], 10);
    hasUpdates = true;
  }

  // Pattern: The total amount of the retrieved records ...: N
  const totalRetrievedMatch = line.match(/total\s+amount\s+of\s+the\s+retrieved\s+records.*?\s(\d+)\./i);
  if (totalRetrievedMatch) {
    updates.totalRecordsExpected = parseInt(totalRetrievedMatch[1], 10);
    hasUpdates = true;
  }

  // Pattern: Error/issue count
  const errorMatch = line.match(/(\d+)\s*(?:error|issue|failed|warning)/i);
  if (errorMatch) {
    updates.errors = parseInt(errorMatch[1], 10);
    hasUpdates = true;
  }

  // Pattern: Completion indicators
  if (line.match(/(?:command\s+succeeded|migration\s+job\s+ended|completed|finished|done|success)/i)) {
    updates.isCompleted = true;
    hasUpdates = true;
  }

  return hasUpdates ? updates : null;
}

/**
 * Executes an SFDMU command with real-time progress tracking
 * Captures stdout/stderr and parses progress information
 */
export async function executeSfdmuCommandWithProgress(
  options: SfdmuOperationOptions
): Promise<{ stdout: string; stderr: string; exitCode: number; stats: SfdmuProgressStats }> {
  return new Promise((resolve, reject) => {
    const { command, cwd, commandThis, operationType, onProgress } = options;

    // Parse command: "sf sfdmu:run --sourceusername ... --targetusername ... -p ..."
    const parts = command.split(/\s+/);
    const cmd = parts[0]; // 'sf'
    const args = parts.slice(1);

    // Track progress statistics
    const stats: SfdmuProgressStats = {
      totalRecordsProcessed: 0,
      objectsProcessed: 0,
      currentRecordsInObject: 0,
      errors: 0,
      isCompleted: false,
    };

    let stdoutData = '';
    let stderrData = '';
    const objectsSet = new Set<string>();
    let lastReportedRecords = -1;
    let lastReportedObject = '';
    let lastReportedPhase = '';

    if (commandThis) {
      uxLog("log", commandThis, c.grey(`Executing: ${command}`));
    }

    // Send progress start if WebSocket is active
    if (WebSocketClient.isAlive()) {
      const operationLabel =
        operationType === 'export' ? 'Exporting' :
          operationType === 'import' ? 'Importing' :
            operationType === 'delete' ? 'Deleting' :
              'Processing';
      WebSocketClient.sendProgressStartMessage(`${operationLabel} data...`, 0);
    }

    const proc = spawn(cmd, args, {
      cwd: cwd || process.cwd(),
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0', // Disable colors in output
      },
    });

    // Handle stdout
    const rlOut = readline.createInterface({
      input: proc.stdout!,
      crlfDelay: Infinity,
    });

    rlOut.on('line', (line: string) => {
      stdoutData += line + '\n';

      // Parse progress from line
      const parsed = parseSfdmuOutputLine(line);
      if (parsed) {
        if (parsed.currentObject) {
          stats.currentObject = parsed.currentObject;
          objectsSet.add(parsed.currentObject);
          stats.objectsProcessed = objectsSet.size;
        }
        if (parsed.currentRecordsInObject) {
          stats.currentRecordsInObject = parsed.currentRecordsInObject;
        }
        if (parsed.totalRecordsProcessed) {
          stats.totalRecordsProcessed = parsed.totalRecordsProcessed;
        }
        if (parsed.totalRecordsExpected) {
          stats.totalRecordsExpected = parsed.totalRecordsExpected;
        }
        if (parsed.phase) {
          stats.phase = parsed.phase;
        }
        if (parsed.errors !== undefined) {
          stats.errors = parsed.errors;
        }
        if (parsed.isCompleted) {
          stats.isCompleted = true;
        }

        // Update progress
        if (onProgress) {
          onProgress(stats);
        }

        // Send to WebSocket if active
        if (WebSocketClient.isAlive()) {
          const totalSteps = stats.totalRecordsExpected || (stats.totalRecordsProcessed + 10);
          WebSocketClient.sendProgressStepMessage(stats.totalRecordsProcessed, totalSteps);
        }

        // Log progress to console
        if (commandThis) {
          const shouldLogRecords =
            stats.totalRecordsProcessed >= lastReportedRecords + 1000 ||
            stats.totalRecordsProcessed === stats.totalRecordsExpected;
          const shouldLogObject = stats.currentObject !== lastReportedObject;
          const shouldLogPhase = (stats.phase || '') !== lastReportedPhase;
          const shouldLogErrors = parsed.errors !== undefined;

          if (shouldLogRecords || shouldLogObject || shouldLogPhase || shouldLogErrors) {
            const phaseLabel = stats.phase ? ` | ${stats.phase}` : '';
            uxLog("other", commandThis, c.grey(
              `Progress: ${stats.objectsProcessed} object(s), ` +
              `${stats.totalRecordsProcessed} record(s) - ${stats.currentObject || 'Processing'}${phaseLabel}`
            ));
            lastReportedRecords = stats.totalRecordsProcessed;
            lastReportedObject = stats.currentObject || '';
            lastReportedPhase = stats.phase || '';
          }
        }
      } else if (line.trim()) {
        // Log non-empty lines that don't contain progress info
        if (commandThis && (line.includes('error') || line.includes('Error') || line.includes('ERROR'))) {
          uxLog("warning", commandThis, c.yellow(line));
        }
      }
    });

    // Handle stderr
    const rlErr = readline.createInterface({
      input: proc.stderr!,
      crlfDelay: Infinity,
    });

    rlErr.on('line', (line: string) => {
      stderrData += line + '\n';
      if (line.trim() && commandThis) {
        uxLog("warning", commandThis, c.yellow(`[SFDMU] ${line}`));
      }
    });

    // Handle process completion
    proc.on('close', (code: number) => {
      rlOut.close();
      rlErr.close();

      stats.isCompleted = true;

      // Send progress end if WebSocket is active
      if (WebSocketClient.isAlive()) {
        WebSocketClient.sendProgressEndMessage(stats.totalRecordsProcessed);
      }

      if (code === 0) {
        resolve({
          stdout: stdoutData,
          stderr: stderrData,
          exitCode: code,
          stats,
        });
      } else {
        const error = new Error(
          `SFDMU command failed with exit code ${code}: ${stderrData || stdoutData}`
        );
        reject(error);
      }
    });

    // Handle process error
    proc.on('error', (err: Error) => {
      rlOut.close();
      rlErr.close();
      reject(err);
    });
  });
}

/**
 * Legacy wrapper for backward compatibility - executes SFDMU command and returns a result object
 */
export async function executeSfdmuCommand(
  command: string,
  commandThis: any,
  options: { cwd?: string; fail?: boolean; output?: boolean; operationType?: 'export' | 'import' | 'delete' } = {}
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await executeSfdmuCommandWithProgress({
      command,
      cwd: options.cwd,
      commandThis,
      operationType: options.operationType,
    });
    await sendRefreshEvent();
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    await sendRefreshEvent();
    if (options.fail !== false) {
      throw error;
    }
    return {
      stdout: '',
      stderr: (error as Error).message,
    };
  }
}

async function sendRefreshEvent() {
  if (WebSocketClient.isAliveWithLwcUI()) {
    WebSocketClient.sendRefreshDataWorkbenchMessage();
  }
}