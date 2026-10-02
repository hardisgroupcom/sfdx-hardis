import { Connection } from '@salesforce/core';
import { ActionsProvider, ActionResult, PrePostCommand, buildActionOutput } from './actionsProvider.js';
import {
  HIDDEN_APEX_BODY,
  buildApexClassQuery,
  hasNoVisibleNoArgConstructor,
  parseApexClassName,
  pickApexClassToSchedule,
} from './apexClassActionUtils.js';
import { createTempDir, execCommand, uxLog } from '../utils/index.js';
import { soqlQuery, soqlQueryTooling } from '../utils/apiUtils.js';
import { t } from '../utils/i18n.js';
import c from 'chalk';
import fs from '../utils/fsUtils.js';
import path from 'path';

export type RunBatchMode = 'wait' | 'no-wait';
export const RUN_BATCH_MODES: RunBatchMode[] = ['wait', 'no-wait'];
export const RUN_BATCH_CONTEXT: PrePostCommand['context'] = 'process-deployment-only';
export const RUN_BATCH_DEFAULT_BATCH_SIZE = 200;
export const RUN_BATCH_MAX_BATCH_SIZE = 2000;
export const RUN_BATCH_DEFAULT_WAIT_TIMEOUT_MINUTES = 60;
// Written by the anonymous Apex in the debug log, so the job can be followed
export const RUN_BATCH_JOB_ID_MARKER = 'SFDX_HARDIS_BATCH_JOB_ID=';
const RUN_BATCH_POLL_INTERVAL_MS = 10000;
// A wait can last an hour: one query that fails must not fail an action whose batch is still running
const RUN_BATCH_MAX_POLL_FAILURES = 3;
// A job waiting in the flex queue changes nothing for a long time: a CI runner without output is killed
const RUN_BATCH_HEARTBEAT_MS = 5 * 60 * 1000;
// The job of a batch that was just enqueued can take a few seconds to be readable
const RUN_BATCH_JOB_LOOKUP_ATTEMPTS = 3;
const RUN_BATCH_JOB_LOOKUP_DELAY_MS = 5000;
// A deployment retried after a wait timeout must not process the same records twice
export const RUN_BATCH_RECENT_JOB_MINUTES = 180;
const RUN_BATCH_FLAGS = ['run-mode', 'batch-size', 'wait-timeout', 'success-even-if-batch-errors'];

export interface RunBatchOptions {
  runMode: RunBatchMode;
  batchSize: number;
  waitTimeoutMinutes: number;
  successEvenIfBatchErrors: boolean;
}

/** What the state of an AsyncApexJob means for the action waiting for it. */
export type RunBatchJobOutcome = 'running' | 'success' | 'successWithErrors' | 'completedWithErrors' | 'failed';

/** What to do with the latest job of the class found in the org before launching the batch. */
export type RunBatchExistingJobDecision = 'launch' | 'follow' | 'reuse';

/** Applies the run-batch flags of action:create and action:update on top of the current parameters. */
export function applyRunBatchFlags(parameters: PrePostCommand['parameters'], flags: any): Record<string, any> {
  const updated: Record<string, any> = { ...(parameters || {}) };
  if (flags['run-mode']) updated.runMode = flags['run-mode'];
  if (flags['batch-size'] !== undefined) updated.batchSize = flags['batch-size'];
  if (flags['wait-timeout'] !== undefined) updated.waitTimeoutMinutes = flags['wait-timeout'];
  if (flags['success-even-if-batch-errors'] !== undefined) updated.successEvenIfBatchErrors = flags['success-even-if-batch-errors'];
  return normalizeRunBatchParameters(updated);
}

/** True when a run-batch flag of action:create or action:update is passed. */
export function hasRunBatchFlags(flags: any): boolean {
  return RUN_BATCH_FLAGS.some((flag) => flags?.[flag] !== undefined);
}

/**
 * Stored form of run-batch parameters: numbers as numbers, optional values left out when empty,
 * and the wait-only parameters dropped when the batch is not waited for.
 * A value that is not a number is kept as typed, so the validation reports it.
 */
export function normalizeRunBatchParameters(parameters: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = { ...parameters };
  normalized.runMode = normalized.runMode || 'wait';
  for (const key of ['batchSize', 'waitTimeoutMinutes']) {
    if (isMissing(normalized[key])) {
      delete normalized[key];
    } else if (Number.isFinite(Number(normalized[key]))) {
      normalized[key] = Number(normalized[key]);
    }
  }
  if (normalized.successEvenIfBatchErrors !== true) {
    delete normalized.successEvenIfBatchErrors;
  }
  if (normalized.runMode === 'no-wait') {
    delete normalized.waitTimeoutMinutes;
    delete normalized.successEvenIfBatchErrors;
  }
  return normalized;
}

/** Errors of a run-batch action definition, as translated messages (empty when valid). */
export function listRunBatchParameterErrors(action: Partial<PrePostCommand>, checkContext = true): string[] {
  const errors: string[] = [];
  const parameters = action.parameters || {};
  if (!parameters.className) {
    errors.push(t('actionValidationRunBatchNoClassName'));
  }
  if (!isMissing(parameters.runMode) && !RUN_BATCH_MODES.includes(parameters.runMode as RunBatchMode)) {
    errors.push(t('actionValidationRunBatchInvalidRunMode', { runMode: parameters.runMode }));
  }
  if (!isMissing(parameters.batchSize)) {
    const batchSize = Number(parameters.batchSize);
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > RUN_BATCH_MAX_BATCH_SIZE) {
      errors.push(t('actionValidationRunBatchInvalidBatchSize', { batchSize: parameters.batchSize }));
    }
  }
  if (!isMissing(parameters.waitTimeoutMinutes)) {
    const waitTimeoutMinutes = Number(parameters.waitTimeoutMinutes);
    if (!Number.isInteger(waitTimeoutMinutes) || waitTimeoutMinutes < 1) {
      errors.push(t('actionValidationRunBatchInvalidWaitTimeout', { waitTimeoutMinutes: parameters.waitTimeoutMinutes }));
    }
  }
  // Running a batch changes the data of the org, so it never happens during a deployment check
  if (checkContext && action.context && action.context !== RUN_BATCH_CONTEXT) {
    errors.push(t('actionValidationRunBatchContext', { context: action.context }));
  }
  return errors;
}

/** Parameters of a run-batch action, with the defaults applied. */
export function resolveRunBatchOptions(parameters: PrePostCommand['parameters']): RunBatchOptions {
  return {
    runMode: parameters?.runMode === 'no-wait' ? 'no-wait' : 'wait',
    batchSize: isMissing(parameters?.batchSize) ? RUN_BATCH_DEFAULT_BATCH_SIZE : Number(parameters?.batchSize),
    waitTimeoutMinutes: isMissing(parameters?.waitTimeoutMinutes)
      ? RUN_BATCH_DEFAULT_WAIT_TIMEOUT_MINUTES
      : Number(parameters?.waitTimeoutMinutes),
    successEvenIfBatchErrors: parameters?.successEvenIfBatchErrors === true,
  };
}

/** True when the class body declares the Database.Batchable interface. */
export function isBatchableApexBody(body: string): boolean {
  return /Database\s*\.\s*Batchable/i.test(body || '');
}

/**
 * Decides whether the latest batch job of the class makes a new launch useless.
 * - follow: it is still running, so it is this job the action deals with.
 * - reuse: it completed recently with a result the action accepts, so it stands for this run.
 * - launch: there is none, it is old, or it failed, was aborted or had errors the action refuses.
 */
export function decideExistingBatchJob(job: any, options: RunBatchOptions, now: number = Date.now()): RunBatchExistingJobDecision {
  if (!job?.Status) {
    return 'launch';
  }
  const outcome = evaluateBatchJob(job, options.successEvenIfBatchErrors);
  if (outcome === 'running') {
    return 'follow';
  }
  const completedAt = job.CompletedDate ? new Date(job.CompletedDate).getTime() : NaN;
  const isRecent = Number.isFinite(completedAt) && now - completedAt <= RUN_BATCH_RECENT_JOB_MINUTES * 60 * 1000;
  if (job.Status !== 'Completed' || !isRecent) {
    return 'launch';
  }
  // Without waiting, the result of the batch is not looked at: a recent run is enough
  const isAccepted = options.runMode === 'no-wait' || outcome === 'success' || outcome === 'successWithErrors';
  return isAccepted ? 'reuse' : 'launch';
}

/** Anonymous Apex launching the batch and writing its job id in the debug log. */
export function buildRunBatchApex(className: string, batchSize: number): string {
  return `Id jobId = Database.executeBatch(new ${className}(), ${batchSize});\nSystem.debug('${RUN_BATCH_JOB_ID_MARKER}' + jobId);`;
}

/** Reads the id of the launched job from the output of the anonymous Apex, null when it is not there. */
export function extractBatchJobId(output: string): string | null {
  const match = new RegExp(`${RUN_BATCH_JOB_ID_MARKER}([a-zA-Z0-9]{15,18})`).exec(output || '');
  return match ? match[1] : null;
}

export function evaluateBatchJob(job: any, successEvenIfBatchErrors: boolean): RunBatchJobOutcome {
  const status = job?.Status || '';
  if (status === 'Failed' || status === 'Aborted') {
    return 'failed';
  }
  if (status !== 'Completed') {
    return 'running';
  }
  if ((job?.NumberOfErrors || 0) > 0) {
    return successEvenIfBatchErrors ? 'successWithErrors' : 'completedWithErrors';
  }
  return 'success';
}

export class RunBatchAction extends ActionsProvider {
  public getLabel(): string {
    return 'RunBatchAction';
  }

  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    // The execution loop runs a run-batch action as a deployment-only one whatever its context says,
    // so a context written by hand is not a reason to fail the action in every job
    const errors = listRunBatchParameterErrors(cmd, false);
    if (errors.length > 0) {
      uxLog('error', this, c.red(`[DeploymentActions] ${errors.join('\n')}`));
      return { statusCode: 'failed', skippedReason: errors.join('\n') };
    }
    return null;
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;

    const className = ((cmd.parameters?.className as string) || '').trim();
    const options = resolveRunBatchOptions(cmd.parameters);
    const targetOrgFlag = this.customUsernameToUse ? ` --target-org ${this.customUsernameToUse}` : '';

    const conn: Connection = globalThis.jsForceConn;

    // 1. Verify the Apex class exists and implements Database.Batchable
    uxLog('log', this, c.grey(`[DeploymentActions] ${t('runBatchVerifyingClass', { className })}`));
    // The class can belong to an installed package: ns.ClassName for a managed one
    const { namespace, name: classBareName } = parseApexClassName(className);
    const classResult = await soqlQueryTooling(buildApexClassQuery(classBareName, namespace), conn);
    const classRecords = classResult.records || [];
    const apexClass = pickApexClassToSchedule(classRecords, namespace);
    if (!apexClass && classRecords.length > 0) {
      // The name only exists with a namespace: say how to write it rather than "not found"
      const qualifiedName = `${classRecords[0].NamespacePrefix}.${classRecords[0].Name}`;
      return this.fail(t('scheduleBatchClassNeedsNamespace', { className, qualifiedName }));
    }
    if (!apexClass) {
      // Before the metadata deployment, a class shipped by this deployment is not in the org yet
      return this.fail(
        cmd.when === 'pre-deploy' ? t('runBatchClassNotFoundPreDeploy', { className }) : t('scheduleBatchClassNotFound', { className })
      );
    }
    // A managed package shows the signature of its global classes and hides every other class,
    // and only a global class can be instantiated from outside its package
    if (apexClass.Body === HIDDEN_APEX_BODY) {
      return this.fail(t('runBatchClassNotGlobal', { className }));
    }
    if (!isBatchableApexBody(apexClass.Body)) {
      return this.fail(t('runBatchClassNotBatchable', { className }));
    }
    if (hasNoVisibleNoArgConstructor(apexClass.Body, classBareName)) {
      return this.fail(t('runBatchConstructorNotVisible', { className }));
    }

    // 2. Do not launch a batch that is still running, or that has just completed
    const latestJob = await this.findLatestJob(apexClass.Id, conn);
    const existingJobDecision = decideExistingBatchJob(latestJob, options);
    if (existingJobDecision === 'reuse') {
      const message = t('runBatchRecentlyCompleted', { className, jobId: latestJob.Id, minutes: RUN_BATCH_RECENT_JOB_MINUTES });
      uxLog('log', this, c.green(`[DeploymentActions] ${message}`));
      return { statusCode: 'success', output: message };
    }
    if (existingJobDecision === 'follow') {
      const message = t('runBatchAlreadyRunning', { className, jobId: latestJob.Id });
      uxLog('log', this, c.grey(`[DeploymentActions] ${message}`));
      return options.runMode === 'no-wait'
        ? { statusCode: 'success', output: message }
        : this.waitForJob(latestJob.Id, className, options, conn);
    }

    // 3. Launch the batch with anonymous Apex
    uxLog('log', this, c.grey(`[DeploymentActions] ${t('runBatchLaunching', { className, batchSize: options.batchSize })}`));
    // Known before the launch, so the job found afterwards cannot be an older run of the class
    const previousJobId = latestJob?.Id || null;
    const tmpDir = await createTempDir();
    const apexFile = path.join(tmpDir, 'run-batch.apex');
    await fs.writeFile(apexFile, buildRunBatchApex(className, options.batchSize));

    const apexCommand = `sf apex run --file "${apexFile}"${targetOrgFlag}`;
    let res: any;
    try {
      res = await execCommand(apexCommand, null, { fail: false, output: true });
    } finally {
      await fs.remove(tmpDir);
    }
    if (res.status !== 0) {
      // Reached only when execCommand returns instead of throwing (--json commands).
      // Plain commands throw even with fail:false, and executePrePostCommands catches them.
      return { statusCode: 'failed', output: buildActionOutput(res) };
    }

    // 4. Find the job: in the debug log, else the batch job of that class created since the launch
    let jobId = extractBatchJobId(buildActionOutput(res));
    for (let attempt = 1; !jobId && attempt <= RUN_BATCH_JOB_LOOKUP_ATTEMPTS; attempt++) {
      const latestJobId = (await this.findLatestJob(apexClass.Id, conn))?.Id || null;
      jobId = latestJobId !== previousJobId ? latestJobId : null;
      if (!jobId && attempt < RUN_BATCH_JOB_LOOKUP_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RUN_BATCH_JOB_LOOKUP_DELAY_MS));
      }
    }
    if (!jobId) {
      if (options.runMode === 'no-wait') {
        // The Apex ran without error, so the batch is enqueued: nothing more is expected from it
        uxLog('log', this, c.green(`[DeploymentActions] ${t('runBatchLaunched', { className, jobId: '?' })}`));
        return { statusCode: 'success', output: t('runBatchLaunched', { className, jobId: '?' }) };
      }
      return this.fail(t('runBatchJobNotFound', { className }));
    }
    if (options.runMode === 'no-wait') {
      uxLog('log', this, c.green(`[DeploymentActions] ${t('runBatchLaunched', { className, jobId })}`));
      return { statusCode: 'success', output: t('runBatchLaunched', { className, jobId }) };
    }

    // 5. Wait for the job to end
    return this.waitForJob(jobId, className, options, conn);
  }

  private fail(message: string): ActionResult {
    uxLog('error', this, c.red(`[DeploymentActions] ${message}`));
    return { statusCode: 'failed', output: message };
  }

  private async findLatestJob(apexClassId: string, conn: Connection): Promise<any | null> {
    const jobQuery = `SELECT Id, Status, NumberOfErrors, CompletedDate FROM AsyncApexJob WHERE ApexClassId = '${apexClassId}' AND JobType = 'BatchApex' ORDER BY CreatedDate DESC LIMIT 1`;
    const jobResult = await soqlQuery(jobQuery, conn);
    return jobResult.records?.[0] || null;
  }

  private async waitForJob(jobId: string, className: string, options: RunBatchOptions, conn: Connection): Promise<ActionResult> {
    const deadline = Date.now() + options.waitTimeoutMinutes * 60 * 1000;
    const jobQuery = `SELECT Id, Status, NumberOfErrors, JobItemsProcessed, TotalJobItems, ExtendedStatus FROM AsyncApexJob WHERE Id = '${jobId}'`;
    let lastProgress = '';
    let lastLogAt = 0;
    let pollFailures = 0;
    for (; ;) {
      let job: any = null;
      try {
        job = (await soqlQuery(jobQuery, conn)).records?.[0] || {};
        pollFailures = 0;
      } catch (e) {
        pollFailures++;
        if (pollFailures >= RUN_BATCH_MAX_POLL_FAILURES) {
          throw e;
        }
      }
      if (job) {
        const numbers = {
          status: job.Status || '',
          processed: job.JobItemsProcessed || 0,
          total: job.TotalJobItems || 0,
          errors: job.NumberOfErrors || 0,
          extendedStatus: job.ExtendedStatus || '',
        };
        const outcome = evaluateBatchJob(job, options.successEvenIfBatchErrors);
        if (outcome === 'success') {
          const message = t('runBatchSuccess', { className, ...numbers });
          uxLog('log', this, c.green(`[DeploymentActions] ${message}`));
          return { statusCode: 'success', output: message };
        }
        if (outcome === 'successWithErrors') {
          const message = t('runBatchCompletedWithErrorsIgnored', { className, ...numbers });
          uxLog('warning', this, c.yellow(`[DeploymentActions] ${message}`));
          return { statusCode: 'success', output: message };
        }
        if (outcome === 'completedWithErrors') {
          return this.fail(t('runBatchCompletedWithErrors', { className, ...numbers }));
        }
        if (outcome === 'failed') {
          return this.fail(t('runBatchFailed', { className, ...numbers }));
        }
        // Still running: one line each time the numbers move, and at least one every few minutes
        const progress = `${numbers.status}|${numbers.processed}|${numbers.total}|${numbers.errors}`;
        if (progress !== lastProgress || Date.now() - lastLogAt >= RUN_BATCH_HEARTBEAT_MS) {
          lastProgress = progress;
          lastLogAt = Date.now();
          uxLog('log', this, c.grey(`[DeploymentActions] ${t('runBatchWaiting', { className, jobId, ...numbers })}`));
        }
      }
      if (Date.now() >= deadline) {
        return this.fail(t('runBatchTimeout', { className, jobId, minutes: options.waitTimeoutMinutes }));
      }
      await new Promise((resolve) => setTimeout(resolve, RUN_BATCH_POLL_INTERVAL_MS));
    }
  }
}

function isMissing(value: any): boolean {
  return value === undefined || value === null || value === '';
}
