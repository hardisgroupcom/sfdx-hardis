import { Connection } from '@salesforce/core';
import { getCurrentGitBranch, git } from './index.js';
import { GitProvider } from '../gitProvider/index.js';

/**
 * The pipeline variables a deployment action can read: from a custom function script (as
 * SFDX_HARDIS_* environment variables) and from any action field (as ${{ pipeline.<name> }}).
 *
 * Every value is a string, because the primary consumer is an environment variable. A value that
 * is unknown in the current run (the Pull Request group during a local deployment, the org group
 * before authentication) is an empty string rather than missing, so a script can read it without
 * guarding and a ${{ pipeline.x }} reference never fails on a legitimately empty value.
 */
export interface PipelineContext {
  // Git
  targetBranch: string;
  sourceBranch: string;
  currentBranch: string;
  commitSha: string;
  repoUrl: string;
  // Pull Request
  prId: string;
  prTitle: string;
  prUrl: string;
  prAuthor: string;
  prSourceBranch: string;
  prTargetBranch: string;
  // Org
  orgUsername: string;
  orgInstanceUrl: string;
  orgId: string;
  orgAlias: string;
  isProduction: string;
  // Deployment
  checkOnly: string;
  when: string;
  actionId: string;
  actionLabel: string;
  jobUrl: string;
  deploymentId: string;
}

/** camelCase context key -> SFDX_HARDIS_<UPPER_SNAKE> env var name. */
export function buildPipelineEnvVarName(contextKey: string): string {
  return `SFDX_HARDIS_${contextKey.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

export function pipelineContextToEnvVars(context: PipelineContext): Record<string, string> {
  const envVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    envVars[buildPipelineEnvVarName(key)] = String(value ?? '');
  }
  return envVars;
}

/**
 * Build the pipeline context for the current run.
 *
 * Best-effort by design: every source (git provider, git, jsforce connection) is optional and a
 * failure to read one group leaves it empty instead of breaking the deployment. The deployment
 * group is per-action, so it is filled by `withActionContext` rather than here.
 */
export async function buildPipelineContext(options: {
  checkOnly: boolean;
  when: string;
  targetBranch?: string;
  deploymentId?: string;
}): Promise<PipelineContext> {
  const context: PipelineContext = {
    targetBranch: '',
    sourceBranch: '',
    currentBranch: '',
    commitSha: '',
    repoUrl: '',
    prId: '',
    prTitle: '',
    prUrl: '',
    prAuthor: '',
    prSourceBranch: '',
    prTargetBranch: '',
    orgUsername: '',
    orgInstanceUrl: '',
    orgId: '',
    orgAlias: '',
    isProduction: 'false',
    checkOnly: options.checkOnly === true ? 'true' : 'false',
    when: options.when || '',
    actionId: '',
    actionLabel: '',
    jobUrl: '',
    deploymentId: options.deploymentId || '',
  };

  const currentBranch = (await safely(() => getCurrentGitBranch())) || '';
  context.currentBranch = currentBranch;

  const prInfo = await safely(() => GitProvider.getPullRequestInfo({ useCache: true }));
  if (prInfo) {
    context.prId = prInfo.idStr || String(prInfo.idNumber || '');
    context.prTitle = prInfo.title || '';
    context.prUrl = prInfo.webUrl || '';
    context.prAuthor = prInfo.authorName || '';
    context.prSourceBranch = prInfo.sourceBranch || '';
    context.prTargetBranch = prInfo.targetBranch || '';
  }

  context.targetBranch = options.targetBranch || context.prTargetBranch || currentBranch;
  context.sourceBranch = context.prSourceBranch || currentBranch;
  context.commitSha = (await safely(() => git({ output: false }).revparse(['HEAD']))) || '';
  context.repoUrl = (await safely(() => GitProvider.getCurrentBranchUrl())) || '';
  context.jobUrl = (await safely(() => GitProvider.getJobUrl())) || '';

  const connection: Connection | undefined = globalThis.jsForceConn;
  if (connection) {
    context.orgUsername = connection.getUsername() || '';
    context.orgInstanceUrl = connection.instanceUrl || '';
    // getAuthInfoFields is not on the public Connection type but is present at runtime
    const authFields = (connection as any).getAuthInfoFields?.() || {};
    context.orgId = authFields.orgId || '';
    context.orgAlias = authFields.alias || '';
    context.isProduction = isProductionInstanceUrl(connection.instanceUrl) ? 'true' : 'false';
  }

  return context;
}

/**
 * A sandbox or a scratch org always carries a marker in its instance URL, so anything without one
 * is a production org. Erring towards "production" would be safer, but this value only feeds
 * scripts and never gates a destructive operation in sfdx-hardis itself.
 */
function isProductionInstanceUrl(instanceUrl?: string): boolean {
  if (!instanceUrl) {
    return false;
  }
  const lowerUrl = instanceUrl.toLowerCase();
  return !(
    lowerUrl.includes('--') ||
    lowerUrl.includes('sandbox') ||
    lowerUrl.includes('scratch') ||
    lowerUrl.includes('.cs') ||
    lowerUrl.includes('test.salesforce.com')
  );
}

/** Copy of the context carrying the identity of the action about to run. */
export function withActionContext(
  context: PipelineContext,
  action: { id: string; label: string }
): PipelineContext {
  return { ...context, actionId: action.id || '', actionLabel: action.label || '' };
}

async function safely<T>(reader: () => T | Promise<T>): Promise<T | null> {
  try {
    return await reader();
  } catch (_e) {
    return null;
  }
}
