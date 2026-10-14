import { spawn } from 'child_process';
import * as readline from 'readline';
import c from 'chalk';
import { WebSocketClient } from '../websocketClient.js';
import { uxLog } from './index.js';
import { t } from './i18n.js';

/**
 * Phases of a sfdmu migration job, in chronological order.
 * They are detected from the headers and messages printed by sfdmu (see sfdmu messages/logging.md)
 */
export type SfdmuPhaseKey =
  | 'starting'
  | 'preparing'
  | 'deletingOldData'
  | 'retrieving'
  | 'retrievalSummary'
  | 'updating'
  | 'deleting'
  | 'processingSummary'
  | 'ended';

export interface SfdmuProgressStats {
  // Overall progress of the current object set, from 0 to 100
  percent: number;
  // Current phase
  phaseKey: SfdmuPhaseKey;
  phaseLabel: string;
  phaseStage: number;
  objectSet: number;
  // Object currently being processed, and what is done with it
  currentObject?: string;
  currentOperation?: string;
  currentJobId?: string;
  // Records of the current object, within the current phase
  currentObjectProcessed: number;
  currentObjectExpected?: number;
  // Cumulated counters
  totalRecordsProcessed: number;
  recordsFailed: number;
  objectsProcessed: number;
  objects: string[];
  isCompleted: boolean;
  // Kept for backward compatibility with previous versions of this module
  errors: number;
}

export type SfdmuOperationType = 'export' | 'import' | 'delete';

export interface SfdmuOperationOptions {
  command: string;
  cwd?: string;
  commandThis?: any;
  operationType?: SfdmuOperationType;
  onProgress?: (stats: SfdmuProgressStats) => void;
}

/**
 * Percentage range allocated to each phase, depending on what the command does.
 * The phase where the time is actually spent gets the largest share of the progress bar:
 * - import: sfdmu reads local CSV files, then writes to the org (STAGE 1 of "Updating the Target")
 * - export: sfdmu queries the org (STAGE 1 of "Fetching the data"), then writes local CSV files in no time
 * - delete: sfdmu queries the records to delete, then deletes them
 */
function getPhaseRange(phaseKey: SfdmuPhaseKey, stage: number, operationType: SfdmuOperationType): [number, number] {
  const isExport = operationType === 'export';
  switch (phaseKey) {
    case 'starting':
      return [0, 2];
    case 'preparing':
      return [2, 5];
    case 'deletingOldData':
      return isExport ? [5, 8] : [5, 14];
    case 'retrieving':
      if (isExport) {
        // The source org is queried in STAGE 1, and the CSV target is not queried at all
        return stage >= 2 ? [80, 84] : [8, 80];
      }
      // The source CSV files are read in STAGE 1, the target org is queried in STAGE 2
      return stage >= 2 ? [18, 26] : [14, 18];
    case 'retrievalSummary':
      return isExport ? [84, 86] : [26, 27];
    case 'updating':
    case 'deleting':
      if (isExport) {
        return stage >= 2 ? [94, 96] : [86, 94];
      }
      return stage >= 2 ? [90, 94] : [27, 90];
    case 'processingSummary':
      return isExport ? [96, 97] : [94, 97];
    case 'ended':
      return [100, 100];
    default:
      return [0, 0];
  }
}

const PHASE_LABELS: Record<SfdmuPhaseKey, string> = {
  starting: 'Starting migration job',
  preparing: 'Analysing data',
  deletingOldData: 'Deleting old data from the target',
  retrieving: 'Fetching the data',
  retrievalSummary: 'Data retrieval summary',
  updating: 'Updating the target',
  deleting: 'Deleting from the target',
  processingSummary: 'Data processing summary',
  ended: 'Migration job ended',
};

function fmt(nb: number): string {
  return nb.toLocaleString('en-US');
}

/**
 * Stateful parser of the sfdmu output.
 *
 * sfdmu prints its real progress on stdout (and warnings on stderr): phase headers, the number of
 * records it is about to process for each object, then a line every few seconds while the Bulk /
 * REST job runs. This tracker turns that stream into a monotonic 0-100 percentage, so the caller
 * does not need to interrogate the Salesforce Bulk API to know where the job stands.
 */
export class SfdmuProgressTracker {
  public percent = 0;
  public phaseKey: SfdmuPhaseKey = 'starting';
  public phaseStage = 1;
  public objectSet = 1;
  public currentObject: string | undefined;
  public currentOperation: string | undefined;
  public currentJobId: string | undefined;
  public totalRecordsProcessed = 0;
  public recordsFailed = 0;
  public isCompleted = false;

  // Number of records returned by the original query of each object, collected while sfdmu analyses data.
  // Used as an estimate for the objects that have not started yet in the current phase.
  private objectExpected: Map<string, number> = new Map();
  // Number of records announced by sfdmu for each object within the current phase
  private phaseExpected: Map<string, number> = new Map();
  // Number of records processed for each object within the current phase
  private phaseProcessed: Map<string, number> = new Map();
  // Number of failed records for each object of each phase (sfdmu reports a cumulated count per batch)
  private failedByObject: Map<string, number> = new Map();
  private objectsSeen: Set<string> = new Set();
  private objectsProcessed: Set<string> = new Set();
  private newObjectSet = false;

  constructor(private operationType: SfdmuOperationType = 'import') {}

  public getStats(): SfdmuProgressStats {
    return {
      percent: this.percent,
      phaseKey: this.phaseKey,
      phaseLabel: PHASE_LABELS[this.phaseKey],
      phaseStage: this.phaseStage,
      objectSet: this.objectSet,
      currentObject: this.currentObject,
      currentOperation: this.currentOperation,
      currentJobId: this.currentJobId,
      currentObjectProcessed: this.currentObject ? this.phaseProcessed.get(this.currentObject) || 0 : 0,
      currentObjectExpected: this.currentObject ? this.phaseExpected.get(this.currentObject) : undefined,
      totalRecordsProcessed: this.totalRecordsProcessed,
      recordsFailed: this.recordsFailed,
      objectsProcessed: this.objectsProcessed.size,
      objects: Array.from(this.objectsSeen),
      isCompleted: this.isCompleted,
      errors: this.recordsFailed,
    };
  }

  /** True when a new object set started: the caller should restart a fresh progress bar */
  public consumeNewObjectSet(): boolean {
    const res = this.newObjectSet;
    this.newObjectSet = false;
    return res;
  }

  /**
   * Parses a single sfdmu output line and updates the internal state.
   * Returns true when the line changed something worth reporting.
   */
  public processLine(line: string): boolean {
    if (!line || typeof line !== 'string') {
      return false;
    }
    let changed = false;
    changed = this.parsePhaseHeader(line) || changed;
    changed = this.parseObjectContext(line) || changed;
    changed = this.parseCounters(line) || changed;
    changed = this.parseCompletion(line) || changed;
    if (changed) {
      this.computePercent();
    }
    return changed;
  }

  private setPhase(phaseKey: SfdmuPhaseKey, stage = 1, resetPhaseCounters = true) {
    if (this.phaseKey === phaseKey && this.phaseStage === stage) {
      return;
    }
    this.phaseKey = phaseKey;
    this.phaseStage = stage;
    if (resetPhaseCounters) {
      this.phaseExpected = new Map();
      this.phaseProcessed = new Map();
      this.currentJobId = undefined;
      this.currentOperation = undefined;
      // sfdmu always names the object it works on before doing anything with it
      this.currentObject = undefined;
    }
  }

  private parsePhaseHeader(line: string): boolean {
    // ===== OBJECT SET #1 STARTED =====
    const objectSetMatch = line.match(/=====\s*OBJECT SET #(\d+) STARTED\s*=====/i);
    if (objectSetMatch) {
      const setNb = parseInt(objectSetMatch[1], 10);
      if (setNb !== this.objectSet || this.percent > 0) {
        this.objectSet = setNb;
        this.newObjectSet = true;
        this.percent = 0;
        this.objectExpected = new Map();
        this.currentObject = undefined;
      }
      this.setPhase('preparing');
      return true;
    }
    // ===== MIGRATION JOB STARTED =====
    if (line.match(/=====\s*MIGRATION JOB STARTED\s*=====/i)) {
      this.setPhase('starting');
      return true;
    }
    // ===== Fetching the data (STAGE 1) =====
    const retrievingMatch = line.match(/=====\s*Fetching the data \(STAGE (\d+)\)\s*=====/i);
    if (retrievingMatch) {
      this.setPhase('retrieving', parseInt(retrievingMatch[1], 10));
      return true;
    }
    // ===== DATA RETRIEVAL SUMMARY =====
    if (line.match(/=====\s*DATA RETRIEVAL SUMMARY\s*=====/i)) {
      this.setPhase('retrievalSummary');
      return true;
    }
    // ===== Updating the Target (STAGE 1) =====
    const updatingMatch = line.match(/=====\s*Updating the Target \(STAGE (\d+)\)\s*=====/i);
    if (updatingMatch) {
      this.setPhase('updating', parseInt(updatingMatch[1], 10));
      return true;
    }
    // ===== Deleting from the Target (STAGE 1) =====
    const deletingMatch = line.match(/=====\s*Deleting from the Target \(STAGE (\d+)\)\s*=====/i);
    if (deletingMatch) {
      this.setPhase('deleting', parseInt(deletingMatch[1], 10));
      return true;
    }
    // ===== DATA PROCESSING SUMMARY =====
    if (line.match(/=====\s*DATA PROCESSING SUMMARY\s*=====/i)) {
      this.setPhase('processingSummary');
      return true;
    }
    // ===== MIGRATION JOB ENDED =====
    if (line.match(/=====\s*MIGRATION JOB ENDED\s*=====/i)) {
      this.setPhase('ended');
      this.isCompleted = true;
      return true;
    }
    // ANALYSING DATA...
    if (line.match(/ANALYSING DATA/i)) {
      this.setPhase('preparing');
      return true;
    }
    // Deleting old data from the Target ...
    if (line.match(/Deleting old data from the Target/i)) {
      this.setPhase('deletingOldData');
      return true;
    }
    return false;
  }

  /** Only the {ObjectName} prefix printed by sfdmu is a reliable source for the current object */
  private parseObjectContext(line: string): boolean {
    const braceMatch = line.match(/\{([\w.]+)\}/);
    if (!braceMatch) {
      return false;
    }
    const objectName = braceMatch[1];
    if (this.currentObject === objectName) {
      return false;
    }
    this.currentObject = objectName;
    this.objectsSeen.add(objectName);
    return true;
  }

  private parseCounters(line: string): boolean {
    let changed = false;

    // {Account} The original query string of this object is returning 177373 records from the TARGET org.
    const originalQueryMatch = line.match(/original query string .*? returning (\d+) records?/i);
    if (originalQueryMatch && this.currentObject) {
      this.objectExpected.set(this.currentObject, parseInt(originalQueryMatch[1], 10));
      changed = true;
    }

    // {Account} Amount of records to Update: 177373.
    const amountMatch = line.match(/Amount of records to (\w+): (\d+)/i);
    if (amountMatch && this.currentObject) {
      this.currentOperation = amountMatch[1];
      this.phaseExpected.set(this.currentObject, parseInt(amountMatch[2], 10));
      changed = true;
    }

    // {Account} TARGET was not queried since csvfile is set as a TARGET.
    // {Account} No records to delete.
    if (line.match(/was not queried since|No records to (?:delete|update|insert)/i) && this.currentObject) {
      this.phaseExpected.set(this.currentObject, 0);
      this.phaseProcessed.set(this.currentObject, 0);
      changed = true;
    }

    // [Job# 750h70000004EQzAAM:Update] {Account} The job has been created. Uploading data ...
    const jobMatch = line.match(/\[Job#\s*([\w]+):(\w+)\]/i);
    if (jobMatch) {
      this.currentJobId = jobMatch[1] === 'REST' ? undefined : jobMatch[1];
      this.currentOperation = jobMatch[2];
      changed = true;
    }

    // [Batch# 750h70000004EQzAAM:Update] {Account} Processing ... 3600 records processed, 0 records failed.
    // [Batch# 750h70000004EQzAAM:Update] {Account} Completed. 177373 records processed, 4 records failed.
    // [Batch# 750h70000004EQzAAM:Update] {Account} Completed with issues. 100 records processed, 2 records failed.
    const dmlProgressMatch = line.match(/(\d+) records? processed, (\d+) records? failed/i);
    if (dmlProgressMatch && this.currentObject) {
      const processed = parseInt(dmlProgressMatch[1], 10);
      const failed = parseInt(dmlProgressMatch[2], 10);
      this.setObjectProcessed(this.currentObject, processed);
      this.setObjectFailed(this.currentObject, failed);
      const batchMatch = line.match(/\[Batch#\s*([\w]+):(\w+)\]/i);
      if (batchMatch) {
        this.currentJobId = batchMatch[1] === 'REST' ? this.currentJobId : batchMatch[1];
        this.currentOperation = batchMatch[2];
      }
      changed = true;
    }

    // In progress... Completed 2000 records. (or "Completed 2000/177373 records." when the total is known)
    const queryProgressMatch = line.match(/In progress\.+\s*Completed (\d+)(?:\/(\d+))? records?/i);
    if (queryProgressMatch && this.currentObject) {
      this.setObjectProcessed(this.currentObject, parseInt(queryProgressMatch[1], 10));
      if (queryProgressMatch[2]) {
        this.phaseExpected.set(this.currentObject, parseInt(queryProgressMatch[2], 10));
      }
      changed = true;
    }

    // {Account} Data retrieval (SOURCE) has been completed. Got 177373 new records.
    const retrievedMatch = line.match(/Data retrieval \(\w+\) has been completed\. Got (\d+) new records?/i);
    if (retrievedMatch && this.currentObject) {
      const nb = parseInt(retrievedMatch[1], 10);
      this.phaseExpected.set(this.currentObject, nb);
      this.setObjectProcessed(this.currentObject, nb);
      this.objectsProcessed.add(this.currentObject);
      changed = true;
    }

    // {Account} The Target has been updated. Totally processed 177373 records.
    const targetUpdatedMatch = line.match(/The Target has been updated\. Totally processed (\d+) records?/i);
    if (targetUpdatedMatch && this.currentObject) {
      const nb = parseInt(targetUpdatedMatch[1], 10);
      this.setObjectProcessed(this.currentObject, Math.max(nb, this.phaseProcessed.get(this.currentObject) || 0));
      this.phaseExpected.set(this.currentObject, Math.max(nb, this.phaseExpected.get(this.currentObject) || 0));
      this.objectsProcessed.add(this.currentObject);
      changed = true;
    }

    // {Account} Deleting has been completed.
    if (line.match(/Deleting has been completed/i) && this.currentObject) {
      const expected = this.phaseExpected.get(this.currentObject);
      if (expected) {
        this.setObjectProcessed(this.currentObject, expected);
      }
      this.objectsProcessed.add(this.currentObject);
      changed = true;
    }

    return changed;
  }

  /** sfdmu reports a cumulated amount of failed records per batch, so keep the highest value seen */
  private setObjectFailed(objectName: string, failed: number) {
    const key = `${this.phaseKey}${this.phaseStage}|${objectName}`;
    if (failed <= (this.failedByObject.get(key) || 0)) {
      return;
    }
    this.failedByObject.set(key, failed);
    let total = 0;
    for (const nb of this.failedByObject.values()) {
      total += nb;
    }
    this.recordsFailed = total;
  }

  private setObjectProcessed(objectName: string, processed: number) {
    const previous = this.phaseProcessed.get(objectName) || 0;
    if (processed < previous) {
      return;
    }
    this.phaseProcessed.set(objectName, processed);
    if (this.phaseKey === 'updating' || this.phaseKey === 'deleting' || this.phaseKey === 'deletingOldData') {
      this.totalRecordsProcessed += processed - previous;
    }
  }

  private parseCompletion(line: string): boolean {
    if (line.match(/Execution of the command .*? has been completed/i) || line.match(/Command succeeded/i)) {
      this.isCompleted = true;
      return true;
    }
    return false;
  }

  /**
   * Completion ratio of the current phase.
   * Objects that have not started yet are counted with the record amount collected during the analysis,
   * so the ratio remains meaningful when several objects are processed one after the other.
   */
  private getPhaseFraction(): number {
    const allObjects = new Set([...this.phaseExpected.keys(), ...this.objectExpected.keys()]);
    let expectedTotal = 0;
    let processedTotal = 0;
    for (const objectName of allObjects) {
      const expected = this.phaseExpected.has(objectName)
        ? (this.phaseExpected.get(objectName) as number)
        : this.objectExpected.get(objectName) || 0;
      expectedTotal += expected;
      processedTotal += Math.min(expected, this.phaseProcessed.get(objectName) || 0);
    }
    return expectedTotal > 0 ? Math.min(1, processedTotal / expectedTotal) : 0;
  }

  private computePercent() {
    const [from, to] = getPhaseRange(this.phaseKey, this.phaseStage, this.operationType);
    const percent = Math.round(from + (to - from) * this.getPhaseFraction());
    // Progress must never go backwards, even if sfdmu discovers more records to process than announced
    this.percent = Math.max(this.percent, Math.min(100, percent));
  }

  /** Label of the phase in progress, with its stage when sfdmu runs it in several passes */
  public getPhaseLabel(): string {
    const stageSuffix = this.phaseStage > 1 ? ` (stage ${this.phaseStage})` : '';
    return `${PHASE_LABELS[this.phaseKey]}${stageSuffix}`;
  }

  /** False when the console progress line would carry no useful information: the phase line is enough */
  public hasProgressDetail(): boolean {
    if (!this.currentObject) {
      return false;
    }
    if (this.phaseExpected.get(this.currentObject) === 0) {
      // sfdmu has nothing to do with this object in this phase
      return false;
    }
    const processed = this.phaseProcessed.get(this.currentObject) || 0;
    if (processed > 0) {
      return true;
    }
    // No record processed yet: only worth displaying when sfdmu is about to process some
    return (
      this.objectExpected.has(this.currentObject) &&
      ['retrieving', 'updating', 'deleting', 'deletingOldData'].includes(this.phaseKey)
    );
  }

  /** Values to display in the console progress line */
  public getProgressLabels(): {
    object: string;
    processed: string;
    expected: string;
    percent: number;
    failed: string;
    jobId: string;
  } {
    const processed = this.currentObject ? this.phaseProcessed.get(this.currentObject) || 0 : 0;
    // sfdmu does not always announce how many records it is about to handle: fall back on the amount
    // returned by the original query of the object, collected while sfdmu was analysing the data
    const expected = this.currentObject
      ? (this.phaseExpected.get(this.currentObject) ?? this.objectExpected.get(this.currentObject))
      : undefined;
    return {
      object: this.currentObject
        ? this.currentOperation
          ? `${this.currentObject} (${this.currentOperation})`
          : this.currentObject
        : this.getPhaseLabel(),
      processed: fmt(processed),
      expected: expected === undefined ? '?' : fmt(expected),
      percent: this.percent,
      failed: fmt(this.recordsFailed),
      jobId: this.currentJobId || '',
    };
  }
}

/**
 * Executes an SFDMU command with real-time progress tracking.
 * Captures stdout/stderr, parses progress information and forwards it to the console and the VS Code UI.
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

    const tracker = new SfdmuProgressTracker(operationType || 'import');
    let stdoutData = '';
    let stderrData = '';
    let lastReportedPercent = -1;
    let lastReportedPhase = '';
    let lastReportedObject = '';
    let lastReportedFailed = 0;

    if (commandThis) {
      uxLog('log', commandThis, c.grey(t('executing', { command })));
    }

    const progressTitle = () => {
      const msgKey =
        operationType === 'export'
          ? 'sfdmuExportingData'
          : operationType === 'import'
            ? 'sfdmuImportingData'
            : operationType === 'delete'
              ? 'sfdmuDeletingData'
              : 'sfdmuProcessingData';
      return tracker.objectSet > 1 ? `${t(msgKey)} (object set #${tracker.objectSet})` : t(msgKey);
    };

    // Progress is sent as a percentage: the VS Code UI computes its ETA from the time elapsed
    // between two steps, so steps must be regular and of the same size.
    if (WebSocketClient.isAlive()) {
      WebSocketClient.sendProgressStartMessage(progressTitle(), 100);
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

    const handleLine = (line: string) => {
      const changed = tracker.processLine(line);
      if (!changed) {
        return;
      }
      const stats = tracker.getStats();

      if (onProgress) {
        onProgress(stats);
      }

      // A new object set restarts the progress from scratch
      if (tracker.consumeNewObjectSet()) {
        lastReportedPercent = -1;
        lastReportedPhase = '';
        lastReportedObject = '';
        if (WebSocketClient.isAlive()) {
          WebSocketClient.sendProgressStartMessage(progressTitle(), 100);
        }
      }

      // Send one step message per percent so the VS Code UI can compute a meaningful remaining time
      if (WebSocketClient.isAlive() && stats.percent > lastReportedPercent) {
        for (let step = Math.max(lastReportedPercent + 1, 1); step <= stats.percent; step++) {
          WebSocketClient.sendProgressStepMessage(step, 100);
        }
      }

      if (commandThis) {
        const phaseLabel = tracker.getPhaseLabel();
        const phaseChanged = phaseLabel !== lastReportedPhase;
        const objectChanged = (stats.currentObject || '') !== lastReportedObject;
        const percentChanged = stats.percent > lastReportedPercent;
        const failedChanged = stats.recordsFailed > lastReportedFailed;
        if (phaseChanged) {
          uxLog('log', commandThis, c.cyan(t('sfdmuStep', { phase: phaseLabel })));
        }
        if ((percentChanged || objectChanged || failedChanged) && tracker.hasProgressDetail()) {
          const labels = tracker.getProgressLabels();
          const message =
            stats.recordsFailed > 0 ? t('sfdmuProgressRecordsFailed', labels) : t('sfdmuProgressRecords', labels);
          uxLog('log', commandThis, c.grey(message + (labels.jobId ? ` [job ${labels.jobId}]` : '')));
        }
        lastReportedPhase = phaseLabel;
        lastReportedObject = stats.currentObject || '';
        lastReportedFailed = stats.recordsFailed;
      }
      if (stats.percent > lastReportedPercent) {
        lastReportedPercent = stats.percent;
      }
    };

    // Handle stdout
    const rlOut = readline.createInterface({
      input: proc.stdout!,
      crlfDelay: Infinity,
    });

    rlOut.on('line', (line: string) => {
      stdoutData += line + '\n';
      handleLine(line);
    });

    // Handle stderr: sfdmu sends its warnings there, and some of them carry progress information
    // (for example the final "Completed. N records processed, M records failed." of a batch with errors)
    const rlErr = readline.createInterface({
      input: proc.stderr!,
      crlfDelay: Infinity,
    });

    rlErr.on('line', (line: string) => {
      stderrData += line + '\n';
      handleLine(line);
      if (line.trim() && commandThis) {
        uxLog('warning', commandThis, c.yellow(`[SFDMU] ${line}`));
      }
    });

    // Handle process completion
    proc.on('close', (code: number) => {
      rlOut.close();
      rlErr.close();

      tracker.isCompleted = true;
      tracker.percent = 100;
      const stats = tracker.getStats();

      if (WebSocketClient.isAlive()) {
        WebSocketClient.sendProgressEndMessage(100);
      }

      if (code === 0) {
        resolve({
          stdout: stdoutData,
          stderr: stderrData,
          exitCode: code,
          stats,
        });
      } else {
        const error = new Error(`SFDMU command failed with exit code ${code}: ${stderrData || stdoutData}`);
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
  options: { cwd?: string; fail?: boolean; output?: boolean; operationType?: SfdmuOperationType } = {}
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
