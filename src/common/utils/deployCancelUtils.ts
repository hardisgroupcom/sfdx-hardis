import { Global } from '@salesforce/core';
import c from 'chalk';
import * as path from 'path';
import fs from './fsUtils.js';
import { execSfdxJson, uxLog } from './index.js';
import { t } from './i18n.js';

// Written in the working tree, not in the home folder: on some CI executors (GitLab Docker executor),
// the cancellation hook (after_script) runs in a new container where the home folder of the job is lost
export const RUNNING_DEPLOYMENT_SIMULATION_FILE = path.join('.cache', 'sfdx-hardis', 'running-deployment-simulation.json');

const DEPLOY_JOB_ID_POLL_INTERVAL_MS = 1000;

export interface RunningDeploymentSimulation {
  jobId: string;
  targetUsername: string;
  dryRun: boolean;
  startedAt: string;
}

export type CancelDeploymentSimulationStatus =
  | 'canceled'
  | 'nothing-to-cancel'
  | 'already-completed'
  | 'skipped-not-simulation'
  | 'failed';

const COMPLETED_DEPLOYMENT_STATUSES = ['Succeeded', 'SucceededPartial', 'Failed', 'Canceled'];

export interface CancelDeploymentSimulationResult {
  status: CancelDeploymentSimulationStatus;
  jobId?: string;
  targetUsername?: string;
  message?: string;
}

// Records the job id of the deployment simulation as soon as the Salesforce CLI knows it, so a cancelled CI job
// can cancel it in the org with sf hardis:project:deploy:cancel. Call stop() once the deploy command is over.
// After a failed deploy command, call stop({ removeFile: false }): when the CI job is cancelled, some runners (GitLab)
// kill the deploy command before sfdx-hardis, so a failure can be the cancellation itself, and its hook needs the file.
export function startDeployJobIdWatcher(
  targetUsername: string | undefined,
  dryRun: boolean,
  options: { cacheFile?: string; outputFile?: string; intervalMs?: number } = {}
): { stop: (stopOptions?: { removeFile?: boolean }) => Promise<void> } {
  const cacheFile = options.cacheFile || getSfDeployCacheFile();
  const outputFile = options.outputFile || RUNNING_DEPLOYMENT_SIMULATION_FILE;
  const before = readSfDeployCache(cacheFile);
  let recordedJobId: string | null = null;

  const poll = () => {
    const jobId = findNewDeployJobId(before, readSfDeployCache(cacheFile), targetUsername, dryRun);
    // A retried deploy command gets a new job id: keep the file on the latest one
    if (jobId && jobId !== recordedJobId) {
      try {
        fs.ensureDirSync(path.dirname(outputFile));
        const content: RunningDeploymentSimulation = {
          jobId,
          targetUsername: targetUsername || '',
          dryRun,
          startedAt: new Date().toISOString(),
        };
        fs.writeFileSync(outputFile, JSON.stringify(content, null, 2));
        recordedJobId = jobId;
      } catch {
        // Not blocking: the deployment goes on, it just cannot be cancelled with the CI job
      }
    }
  };

  const timer = setInterval(poll, options.intervalMs ?? DEPLOY_JOB_ID_POLL_INTERVAL_MS);
  // Never keeps the process alive on its own
  timer.unref?.();

  return {
    stop: async (stopOptions: { removeFile?: boolean } = {}) => {
      clearInterval(timer);
      if (stopOptions.removeFile === false) {
        return;
      }
      try {
        await fs.remove(outputFile);
      } catch {
        // Nothing to clean
      }
    },
  };
}

// Cancels in the org the deployment simulation recorded by the current CI job. Never throws: it runs in cleanup hooks.
export async function cancelRunningDeploymentSimulation(
  commandThis: any,
  options: { file?: string; debug?: boolean; execSfdxJsonFn?: typeof execSfdxJson } = {}
): Promise<CancelDeploymentSimulationResult> {
  const execFn = options.execSfdxJsonFn || execSfdxJson;
  const running = readRunningDeploymentSimulation(options.file);
  if (!running) {
    uxLog('action', commandThis, c.cyan(t('noRunningDeploymentSimulationToCancel')));
    return { status: 'nothing-to-cancel' };
  }
  // The job was killed before the watcher could delete the file: delete it now, so a workspace kept
  // between runs (self-hosted agents) never cancels the job id of an older run
  await removeRunningDeploymentSimulationFile(options.file);
  const { jobId, targetUsername } = running;
  if (running.dryRun !== true) {
    uxLog('warning', commandThis, c.yellow(t('deploymentIsNotASimulationNotCancelled', { jobId })));
    return { status: 'skipped-not-simulation', jobId, targetUsername };
  }

  uxLog('action', commandThis, c.cyan(t('cancellingDeploymentSimulation', { jobId, username: targetUsername || '-' })));
  const cancelCommand =
    `sf project deploy cancel --job-id ${jobId} --async` + (targetUsername ? ` --target-org ${targetUsername}` : '');
  let message = '';
  try {
    const cancelRes = await execFn(cancelCommand, commandThis, {
      fail: false,
      output: false,
      debug: options.debug === true,
    });
    if (cancelRes?.status === 0) {
      uxLog('success', commandThis, c.green(t('deploymentSimulationCancelled', { jobId, username: targetUsername || '-' })));
      return { status: 'canceled', jobId, targetUsername };
    }
    message = cancelRes?.message || cancelRes?.name || JSON.stringify(cancelRes);
  } catch (e) {
    message = (e as Error).message;
  }
  // Most frequent reason: the simulation was already completed (the file is kept after a failed simulation)
  const completedStatus = await getCompletedDeploymentStatus(jobId, targetUsername, commandThis, execFn, options.debug === true);
  if (completedStatus) {
    uxLog('action', commandThis, c.cyan(t('deploymentSimulationAlreadyCompleted', { jobId, status: completedStatus })));
    return { status: 'already-completed', jobId, targetUsername, message: completedStatus };
  }
  uxLog('warning', commandThis, c.yellow(t('unableToCancelDeploymentSimulation', { jobId, message })));
  return { status: 'failed', jobId, targetUsername, message };
}

// Salesforce CLI keeps one entry per deployment it started, keyed by job id, written as soon as the deployment is accepted by the org
export function getSfDeployCacheFile(): string {
  return path.join(Global.SF_DIR, 'deploy-cache.json');
}

export function readSfDeployCache(cacheFile: string = getSfDeployCacheFile()): Record<string, any> {
  try {
    if (!fs.existsSync(cacheFile)) {
      return {};
    }
    const content = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return content && typeof content === 'object' && !Array.isArray(content) ? content : {};
  } catch {
    // File being written by the Salesforce CLI, or format changed: next poll will try again
    return {};
  }
}

// Returns the id of the deployment that appeared in the Salesforce CLI deploy cache since the "before" snapshot
export function findNewDeployJobId(
  before: Record<string, any>,
  after: Record<string, any>,
  targetUsername: string | undefined,
  dryRun: boolean
): string | null {
  const newEntries = Object.entries(after).filter(
    ([jobId, entry]) =>
      !(jobId in before) && entry && typeof entry === 'object' && (entry['dry-run'] === true) === dryRun
  );
  if (newEntries.length === 0) {
    return null;
  }
  // Prefer the entries on the target org. If none matches (the org was given as an alias), keep them all:
  // the cache only contains the deployments started from this job container. Jobs run without a container
  // on a shared host (GitLab shell executor, self-hosted runners) share it: see the command documentation
  const sameOrgEntries = newEntries.filter(([, entry]) => targetUsername && entry['target-org'] === targetUsername);
  const candidates = sameOrgEntries.length > 0 ? sameOrgEntries : newEntries;
  candidates.sort(([, a], [, b]) => String(b?.timestamp || '').localeCompare(String(a?.timestamp || '')));
  return candidates[0][0];
}

export function readRunningDeploymentSimulation(file: string = RUNNING_DEPLOYMENT_SIMULATION_FILE): RunningDeploymentSimulation | null {
  try {
    if (!fs.existsSync(file)) {
      return null;
    }
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    return content?.jobId ? (content as RunningDeploymentSimulation) : null;
  } catch {
    return null;
  }
}

// Returns the final status of the deployment when it is already completed, null when it still runs or is unknown
async function getCompletedDeploymentStatus(
  jobId: string,
  targetUsername: string | undefined,
  commandThis: any,
  execFn: typeof execSfdxJson,
  debug: boolean
): Promise<string | null> {
  const reportCommand = `sf project deploy report --job-id ${jobId}` + (targetUsername ? ` --target-org ${targetUsername}` : '');
  try {
    const reportRes = await execFn(reportCommand, commandThis, { fail: false, output: false, debug });
    const status = reportRes?.result?.status || reportRes?.data?.status || null;
    return status && COMPLETED_DEPLOYMENT_STATUSES.includes(status) ? status : null;
  } catch {
    return null;
  }
}

async function removeRunningDeploymentSimulationFile(file: string = RUNNING_DEPLOYMENT_SIMULATION_FILE): Promise<void> {
  try {
    await fs.remove(file);
  } catch {
    // Nothing to clean
  }
}
