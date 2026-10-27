import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import { getCurrentGitBranch, uxLog } from '../utils/index.js';
import { CommonPullRequestInfo, GitProvider } from '../gitProvider/index.js';
import { authOrg } from '../utils/authUtils.js';
import { findUserByUsernameLike } from '../utils/orgUtils.js';
import { t } from '../utils/i18n.js';
import type { PipelineContext } from '../utils/pipelineContextUtils.js';
import type { IdenticalActionRef } from '../utils/deploymentActionIdentityUtils.js';

export type ActionWhen = 'pre-deploy' | 'post-deploy';

/** Action types implemented by sfdx-hardis itself. A project custom function id is also valid. */
export type BuiltInActionType =
  | 'command'
  | 'data'
  | 'apex'
  | 'publish-community'
  | 'manual'
  | 'schedule-batch'
  | 'run-batch'
  | 'remove-packagexml-items'
  | 'user-access-policy'
  | 'agent-activate'
  // Org initialization steps only (orgInitSteps), never deployment actions
  | 'install-packages'
  | 'deploy-sources'
  | 'assign-permission-sets';

/** What an org initialization step needs to know about the org it initializes. */
export interface OrgInitContext {
  orgUsername: string;
  orgAlias: string;
  orgType: 'scratch' | 'sandbox';
  projectScratchDef: any;
  debugMode: boolean;
  // Config the run reads (getConfig('user')), so every step sees the same values
  config: any;
}

export interface PrePostCommand {
  id: string;
  label: string;
  // A built-in type, or the id of a custom function declared in customFunctions (project config).
  // Typed as a widened string union so built-in literals still autocomplete and narrow.
  type: BuiltInActionType | (string & {});
  when?: ActionWhen;
  // Known parameters used by action implementations. Additional keys allowed.
  parameters?: {
    apexScript?: string;     // for 'apex' actions
    sfdmuProject?: string;   // for 'data' actions
    communityName?: string;  // for 'publish-community' actions
    instructions?: string;   // for 'manual' actions
    className?: string;      // for 'schedule-batch' and 'run-batch' actions
    cronExpression?: string;  // for 'schedule-batch' actions
    jobName?: string;        // for 'schedule-batch' actions (optional, defaults to <className>_Schedule)
    runMode?: 'wait' | 'no-wait'; // for 'run-batch' actions (optional, defaults to wait)
    batchSize?: number;      // for 'run-batch' actions (optional, defaults to 200)
    waitTimeoutMinutes?: number; // for 'run-batch' actions in wait mode (optional, defaults to 60)
    successEvenIfBatchErrors?: boolean; // for 'run-batch' actions in wait mode (optional, defaults to false)
    permissionSets?: string[]; // for 'assign-permission-sets' org initialization steps
    packageXmlItems?: string[] | string; // for 'remove-packagexml-items' actions (each item: "TypeName:Member1,Member2"; a single string is accepted for a single entry)
    agentName?: string;      // for 'agent-activate' actions
    agentVersion?: string;   // for 'agent-activate' actions (optional, a version number or latest, defaults to latest)
    [key: string]: any;
  };
  command: string;
  context: 'all' | 'check-deployment-only' | 'process-deployment-only';
  // Target branches the action applies to. Mutually exclusive: setting both makes the action invalid.
  // Names are matched exactly (case-insensitive) against the branch the deployment targets.
  // The virtual name "dev-sandboxes" matches any target that is not a declared major branch,
  // which covers hardis:work:backpromote and local deployments to a developer sandbox.
  includeTargetBranches?: string[];
  excludeTargetBranches?: string[];
  allowFailure?: boolean;
  runOnlyOnceByOrg?: boolean;
  customUsername?: string;
  // Pull Request this action was moved from, to fix a definition after its deployment failed.
  // The action keeps the same id: the copy of the original Pull Request no longer runs.
  movedFrom?: number;
  // If command comes from a PR, we attach PR info
  pullRequest?: CommonPullRequestInfo;
  result?: ActionResult;
  // Pipeline variables of the current run, attached by the execution loop before the action runs.
  // Custom function actions pass them to their script as SFDX_HARDIS_* environment variables.
  pipelineContext?: PipelineContext;
  // Org initialization steps (orgInitSteps) only
  enabled?: boolean;
  orgTypes?: ('scratch' | 'sandbox')[];
  runAtPoolFill?: boolean;
  // Attached by the org initialization runner before the step runs
  orgInitContext?: OrgInitContext;
}

export type ActionResult = {
  // "not-run": the metadata deployment failed, so the action was never attempted.
  // Unlike "skipped", it is never persisted in the Deployment Actions PR comment state,
  // so the action still runs during the next successful deployment.
  statusCode: 'success' | 'failed' | 'skipped' | "manual" | 'not-run';
  output?: string;
  skippedReason?: string;
  // Machine-readable skip cause: skippedReason is user-facing wording that may change,
  // code must branch on this field instead
  skippedCode?: 'already-run-in-org' | 'branch-not-targeted' | 'unresolved-reference' | 'identical-action-already-run'
    | 'context-validation-only' | 'context-deployment-only' | 'stopped-by-failure' | 'deployment-failed';
  // Label of the failed action that stopped this one (stopped-by-failure)
  stoppedByLabel?: string;
  // The action of the same run that already did the work of this one (identical-action-already-run)
  identicalTo?: IdenticalActionRef;
  // Values a custom function returned on the last line of its stdout, consumable by later actions
  // through ${{ actions.<id>.outputs.<name> }}. Raw, so an action can pass a real value on.
  // Stays in memory for the duration of the run and is never reported as is.
  outputs?: Record<string, any>;
  // Same values with the resolved secrets masked. This is the ONLY copy that may leave the
  // process: the job log, the Pull Request comment and the deployment notification all use it,
  // because a Pull Request comment is as public as a chat channel.
  outputsForDisplay?: Record<string, any>;
};

/**
 * Build an action output from an execCommand result.
 *
 * execCommand returns { status, stdout, stderr } for plain commands, but when the command
 * contains --json and is called with fail:false, it returns { status, errorMessage, error }
 * with neither stdout nor stderr. Reading only stdout/stderr then produced an empty output,
 * leaving no way to know why an action failed.
 */
export function buildActionOutput(res: any): string {
  const streams = [res?.stdout, res?.stderr].filter(
    (part) => typeof part === 'string' && part.trim() !== ''
  );
  if (streams.length > 0) {
    // stdout usually ends with a new line: no blank line between the two streams
    return streams.map((part) => part.trimEnd()).join('\n').trim();
  }
  return (res?.errorMessage || (res?.error as Error)?.message || '').trim();
}

export abstract class ActionsProvider {

  public customUsernameToUse: string | null = null;

  // quiet: an unknown type returns null without logging an error nor writing cmd.result, for the
  // callers that only read what an action does (identical actions, forecast)
  public static async buildActionInstance(cmd: PrePostCommand, options: { quiet?: boolean } = {}): Promise<ActionsProvider> {
    let actionInstance: any = null;
    const type = cmd.type || 'command';
    if (type === 'command') {
      const CommandAction = await import('./commandAction.js');
      actionInstance = new CommandAction.CommandAction();
    }
    else if (type === 'apex') {
      const ApexAction = await import('./apexAction.js');
      actionInstance = new ApexAction.ApexAction();
    }
    else if (type === 'data') {
      const DataAction = await import('./dataAction.js');
      actionInstance = new DataAction.DataAction();
    }
    else if (type === 'publish-community') {
      const PublishCommunityAction = await import('./publishCommunityAction.js');
      actionInstance = new PublishCommunityAction.PublishCommunityAction();
    }
    else if (type === 'manual') {
      const ManualAction = await import('./manualAction.js');
      actionInstance = new ManualAction.ManualAction();
    }
    else if (type === 'schedule-batch') {
      const ScheduleBatchAction = await import('./scheduleBatchAction.js');
      actionInstance = new ScheduleBatchAction.ScheduleBatchAction();
    }
    else if (type === 'run-batch') {
      const RunBatchAction = await import('./runBatchAction.js');
      actionInstance = new RunBatchAction.RunBatchAction();
    }
    else if (type === 'remove-packagexml-items') {
      const RemovePackageXmlItemsAction = await import('./removePackageXmlItemsAction.js');
      actionInstance = new RemovePackageXmlItemsAction.RemovePackageXmlItemsAction();
    }
    else if (type === 'user-access-policy') {
      const UserAccessPolicyAction = await import('./userAccessPolicyAction.js');
      actionInstance = new UserAccessPolicyAction.UserAccessPolicyAction();
    }
    else if (type === 'agent-activate') {
      const AgentActivateAction = await import('./agentActivateAction.js');
      actionInstance = new AgentActivateAction.AgentActivateAction();
    }
    else if (type === 'install-packages') {
      const InstallPackagesAction = await import('./installPackagesAction.js');
      actionInstance = new InstallPackagesAction.InstallPackagesAction();
    }
    else if (type === 'deploy-sources') {
      const DeploySourcesAction = await import('./deploySourcesAction.js');
      actionInstance = new DeploySourcesAction.DeploySourcesAction();
    }
    else if (type === 'assign-permission-sets') {
      const AssignPermissionSetsAction = await import('./assignPermissionSetsAction.js');
      actionInstance = new AssignPermissionSetsAction.AssignPermissionSetsAction();
    }
    else {
      // Not a built-in type: it must be the id of a project custom function. Resolving it here
      // keeps every unknown-type error in a single place.
      const { getCustomFunctionById } = await import('../utils/customFunctionUtils.js');
      const customFunction = await getCustomFunctionById(type);
      if (customFunction) {
        const CustomFunctionActionModule = await import('./customFunctionAction.js');
        actionInstance = new CustomFunctionActionModule.CustomFunctionAction();
      } else if (!options.quiet) {
        uxLog("error", this, c.yellow(`[DeploymentActions] Action type [${cmd.type}] is not yet implemented for action [${cmd.id}]: ${cmd.label}`));
        cmd.result = {
          statusCode: "failed",
          skippedReason: `Action type [${cmd.type}] is not implemented`
        };
      }
    }
    return actionInstance;
  }

  public getLabel(): string {
    throw new SfError('getLabel should be implemented on this call');
  }

  // Override and return false for action types that must run at every deployment
  // (for example actions that only alter the current deployment context, not the org)
  public supportsRunOnlyOnceByOrg(): boolean {
    return true;
  }

  // Phases an action of this type may run in, or null when it may run in both
  public getAllowedWhen(): ActionWhen[] | null {
    return null;
  }

  // Flags of hardis:project:action:create and update that only this type accepts
  public getFlagNames(): string[] {
    return [];
  }

  /**
   * Parameters of a new or edited action of this type, for hardis:project:action:create and update:
   * from the flags when headless, from prompts seeded with the current values otherwise.
   * null when the type does not collect its parameters itself.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async collectParameters(_flags: any, _headless: boolean, _current: PrePostCommand['parameters']): Promise<Record<string, any> | null> {
    return null;
  }

  // Parameters of the action once the flags of hardis:project:action:update are applied
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public applyFlags(parameters: PrePostCommand['parameters'], _flags: any): PrePostCommand['parameters'] {
    return parameters;
  }

  /**
   * Errors of an action definition of this type, as translated messages (empty when valid), checked
   * when the action is saved. null when the type is checked by the generic validation.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async getDefinitionErrors(_action: Partial<PrePostCommand>, _when?: ActionWhen): Promise<string[] | null> {
    return null;
  }

  /**
   * What the action does, compared to run identical actions once per run: two actions of the same
   * type and phase, run as the same user, with the same identity parameters, do the same thing.
   * null for an action that must never be merged with another one.
   * The parameters as written by default; a type with defaults or paths normalizes them.
   */
  public getIdentityParameters(cmd: PrePostCommand): Record<string, any> | null {
    return { ...(cmd.parameters || {}) };
  }

  /**
   * Perform pre-run validations for the given command.
   * Return null when the command is valid and may proceed.
   * Return an ActionResult when the command must be short-circuited
   * (for example: missing parameters -> failed, or manual -> skipped).
   */
  public async checkValidityIssues(cmd: PrePostCommand): Promise<ActionResult | null> {
    const parametersValidityIssue = await this.checkParameters(cmd);
    if (parametersValidityIssue) {
      return parametersValidityIssue;
    }
    const authValidityIssue = await this.checkAuthCustomUsernameIssues(cmd);
    if (authValidityIssue) {
      return authValidityIssue;
    }
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async checkParameters(_cmd: PrePostCommand): Promise<ActionResult | null> {
    uxLog('warning', this, c.yellow(t('checkparametersIsNotImplementedOn', { getLabel: this.getLabel() })));
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    uxLog('warning', this, c.yellow(t('runIsNotImplementedOn', { getLabel: this.getLabel() })));
    return { statusCode: 'skipped', skippedReason: 'Not implemented' };
  }

  public async checkAuthCustomUsernameIssues(cmd: PrePostCommand): Promise<ActionResult | null> {
    if (this.customUsernameToUse) {
      return null;
    }
    if (cmd.customUsername) {
      const agentMode = globalThis._agentMode === true;
      const conn: Connection = globalThis.jsForceConn;
      const user = await findUserByUsernameLike(cmd.customUsername, conn);
      if (!user) {
        const reason = `Custom username [${cmd.customUsername}] not found`;
        uxLog('error', this, c.red(`[DeploymentActions] ${reason} for action ${cmd.label}`));
        if (agentMode) {
          uxLog('warning', this, c.yellow(`[DeploymentActions] Agent mode: skipping action ${cmd.label} instead of failing`));
          return { statusCode: 'skipped', skippedReason: reason };
        }
        return { statusCode: 'failed', skippedReason: reason };
      }
      let authResult: boolean;
      try {
        const instanceUrl = conn.instanceUrl;
        const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
        let targetBranch = prInfo?.targetBranch;
        if (!targetBranch) {
          targetBranch = await getCurrentGitBranch({ formatted: true }) || undefined;
        }
        uxLog('log', this, c.grey(`[DeploymentActions] Authenticating with custom username [${user.Username}] for action ${cmd.label}, using targetBranch ${targetBranch}...`));
        authResult = await authOrg(targetBranch!, {
          forceUsername: user.Username,
          instanceUrl: instanceUrl,
          setDefault: false,
        });
      } catch (error) {
        const reason = `Error during authentication with custom username [${user.Username}]: ${error}`;
        uxLog('error', this, c.red(`[DeploymentActions] ${reason} for action ${cmd.label}`));
        if (agentMode) {
          uxLog('warning', this, c.yellow(`[DeploymentActions] Agent mode: skipping action ${cmd.label} instead of failing`));
          return { statusCode: 'skipped', skippedReason: reason };
        }
        return { statusCode: 'failed', skippedReason: reason };
      }
      if (authResult === true) {
        this.customUsernameToUse = user.Username;
        uxLog('log', this, c.green(`[DeploymentActions] Authenticated with custom username [${this.customUsernameToUse}] for action ${cmd.label}`));
      }
      else {
        const reason = `Failed to authenticate with custom username [${user.Username}]`;
        uxLog('error', this, c.red(`[DeploymentActions] ${reason} for action ${cmd.label}`));
        if (agentMode) {
          uxLog('warning', this, c.yellow(`[DeploymentActions] Agent mode: skipping action ${cmd.label} instead of failing`));
          return { statusCode: 'skipped', skippedReason: reason };
        }
        return { statusCode: 'failed', skippedReason: reason };
      }
    }
    return null;
  }
}
