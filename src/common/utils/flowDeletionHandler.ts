import { Org, SfError } from '@salesforce/core';
import c from 'chalk';
import fs from 'fs-extra';
import { createTempDir, getCurrentGitBranch, uxLog } from './index.js';
import { getEnvVar } from '../../config/index.js';
import { GitProvider } from '../gitProvider/index.js';
import { setPullRequestData } from './gitUtils.js';
import { t } from './i18n.js';
import {
  buildFlowDeletionMarkdown,
  detectPendingFlowDeletions,
  FlowDeletionOutcome,
  isFailedFlowDeletionStatus,
  mergePendingFlowDeletions,
  PendingFlowDeletion,
  resolveFlowDeletionRetrySettings,
  runFlowDeletionPreflight,
  runFlowDeletionStep,
  stripFlowsFromDestructiveChanges,
  worstFlowDeletionStatus,
  writeFlowDeletionReport,
} from './flowDeletionUtils.js';

// Subset of smartDeploy options the handler reads and rewrites. The handler keeps a reference to the
// caller object, so a manifest it strips is the one the deployment sends to the org.
export type FlowDeletionDeployOptions = {
  targetUsername?: string;
  postDestructiveChanges?: string;
  preDestructiveChanges?: string;
};

export type FlowDeletionHandlerOptions = {
  // Command instance, used for logs, report files and prompts
  commandThis: any;
  checkOnly: boolean;
  // Merged branch configuration (.sfdx-hardis.yml)
  configInfo: any;
  // Org resolved from the --target-org flag
  targetOrg: any;
  smartDeployOptions: FlowDeletionDeployOptions;
};

const MANIFESTS: { key: 'postDestructiveChanges' | 'preDestructiveChanges'; fileName: string }[] = [
  { key: 'postDestructiveChanges', fileName: 'destructiveChangesWithoutFlows.xml' },
  { key: 'preDestructiveChanges', fileName: 'preDestructiveChangesWithoutFlows.xml' },
];

/**
 * Handles the Flow members found in destructive manifests during a Smart Deploy.
 *
 * A Flow can not be deleted reliably by a metadata deployment, so the members are stripped from the
 * manifests sent to the org and deleted through the Tooling API instead: before the constructive
 * deployment for preDestructiveChanges.xml, after it for the others.
 */
export class FlowDeletionHandler {
  private commandThis: any;
  private checkOnly: boolean;
  private configInfo: any;
  private targetOrg: any;
  private smartDeployOptions: FlowDeletionDeployOptions;

  // Flows to delete via the Tooling API, stripped from their destructive manifests
  private pendingPreDeployDeletions: PendingFlowDeletion[] = [];
  private pendingPostDeployDeletions: PendingFlowDeletion[] = [];
  private outcomes: FlowDeletionOutcome[] = [];
  private deleteInterviews = false;
  private conn: any = null;

  constructor(options: FlowDeletionHandlerOptions) {
    this.commandThis = options.commandThis;
    this.checkOnly = options.checkOnly;
    this.configInfo = options.configInfo;
    this.targetOrg = options.targetOrg;
    this.smartDeployOptions = options.smartDeployOptions;
  }

  // True when a Flow deletion still has to run after the constructive deployment
  public get hasPostDeployDeletions(): boolean {
    return this.pendingPostDeployDeletions.length > 0;
  }

  /**
   * Takes the Flows listed in the destructive manifests out of the metadata deploy: they are deleted
   * through the Tooling API instead.
   * On --check, only runs a read-only preflight, and fails the validation when Flow Interviews block a
   * deletion that is not authorized to destroy them.
   */
  public async prepare(): Promise<void> {
    // Needed by the Flow Interview gate
    await this.resolveDeleteInterviewsAuthorization();
    const pendingFlowDeletions = await this.stripFlowsFromManifests();
    if (pendingFlowDeletions.length === 0) {
      return;
    }
    const flowNames = pendingFlowDeletions.map((pending) => pending.flowName);
    uxLog("action", this.commandThis, c.cyan('[FlowDeletion] ' + t('flowDeletionDetectedFlows', { count: flowNames.length, flows: flowNames.join(', ') })));
    uxLog("log", this.commandThis, c.grey('[FlowDeletion] ' + t('flowDeletionStrippedFromDeploy')));

    if (this.checkOnly !== true) {
      return;
    }
    await this.runPreflight(pendingFlowDeletions);
  }

  /**
   * Deletes the Flows stripped from the deployment, via the Tooling API. Real deploy only, before or
   * after the metadata deployment according to the source destructive manifest.
   */
  public async execute(phase: 'pre' | 'post'): Promise<void> {
    const pendingFlowDeletions =
      phase === 'pre' ? this.pendingPreDeployDeletions : this.pendingPostDeployDeletions;
    if (pendingFlowDeletions.length === 0) {
      return;
    }
    const conn = await this.getConnection();
    try {
      const outcomes = await runFlowDeletionStep(
        pendingFlowDeletions,
        conn,
        this.commandThis,
        this.deleteInterviews,
        phase,
        resolveFlowDeletionRetrySettings(this.commandThis, this.configInfo)
      );
      this.outcomes.push(...outcomes);
      await writeFlowDeletionReport(outcomes, this.commandThis, this.outcomes);
      setPullRequestData({
        flowDeletionMarkdownBody: buildFlowDeletionMarkdown(this.outcomes),
      });
      const worstStatus = worstFlowDeletionStatus(outcomes);
      if (isFailedFlowDeletionStatus(worstStatus)) {
        const failedMessages = outcomes
          .filter((outcome) => isFailedFlowDeletionStatus(outcome.status))
          .map((outcome) => outcome.message);
        throw new SfError(`[FlowDeletion] ${worstStatus}\n` + failedMessages.join('\n'));
      }
    } catch (e) {
      setPullRequestData({
        status: 'invalid',
        deployStatus: 'invalid',
        title: `❌ ${t('flowDeletionMarkdownTitle')}`,
      });
      await GitProvider.managePostPullRequestComment(false);
      throw e;
    }
  }

  // Authorization to destroy the Flow Interviews blocking a Flow deletion. Off by default: deleting
  // an interview destroys in-flight process state and is irreversible.
  private async resolveDeleteInterviewsAuthorization(): Promise<void> {
    const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
    // Without PR info (major org deploy), the checked-out branch is the target branch.
    const branchName = prInfo?.targetBranch || (await getCurrentGitBranch());
    this.deleteInterviews =
      prInfo?.customBehaviors?.flowDeleteInterviews === true ||
      this.configInfo?.flowDeleteInterviews === true ||
      getEnvVar('FLOW_DELETE_INTERVIEWS') === 'true' ||
      (branchName != null && getEnvVar('FLOW_DELETE_INTERVIEWS_' + branchName) === 'true');
  }

  // Rewrites the destructive manifests of smartDeployOptions without their Flow members, and returns
  // all the Flows to delete outside the deployment.
  private async stripFlowsFromManifests(): Promise<PendingFlowDeletion[]> {
    const tmpDir = await createTempDir();
    for (const manifest of MANIFESTS) {
      const manifestFile = this.smartDeployOptions[manifest.key];
      if (!manifestFile || !fs.existsSync(manifestFile)) {
        continue;
      }
      const { pendingFlowDeletions, hasWildcard } = await detectPendingFlowDeletions(manifestFile);
      if (hasWildcard) {
        throw new SfError('[FlowDeletion] ' + t('flowDeletionWildcardRefused'));
      }
      if (pendingFlowDeletions.length === 0) {
        continue;
      }
      if (manifest.key === 'preDestructiveChanges') {
        this.pendingPreDeployDeletions = mergePendingFlowDeletions(
          this.pendingPreDeployDeletions,
          pendingFlowDeletions
        );
      } else {
        this.pendingPostDeployDeletions = mergePendingFlowDeletions(
          this.pendingPostDeployDeletions,
          pendingFlowDeletions
        );
      }
      const strippedFile = await stripFlowsFromDestructiveChanges(manifestFile, tmpDir, manifest.fileName);
      if (strippedFile) {
        this.smartDeployOptions[manifest.key] = strippedFile;
      }
    }
    return mergePendingFlowDeletions(this.pendingPreDeployDeletions, this.pendingPostDeployDeletions);
  }

  // Read-only report of what a real deployment would do, and validation failure when Flow Interviews
  // block a deletion that is not authorized to destroy them.
  private async runPreflight(pendingFlowDeletions: PendingFlowDeletion[]): Promise<void> {
    const conn = await this.getConnection();
    const outcomes = await runFlowDeletionPreflight(pendingFlowDeletions, conn, this.commandThis, this.deleteInterviews);
    await writeFlowDeletionReport(outcomes, this.commandThis);
    setPullRequestData({ flowDeletionMarkdownBody: buildFlowDeletionMarkdown(outcomes) });
    if (isFailedFlowDeletionStatus(worstFlowDeletionStatus(outcomes))) {
      const blockedMessages = outcomes
        .filter((outcome) => isFailedFlowDeletionStatus(outcome.status))
        .map((outcome) => outcome.message);
      setPullRequestData({ status: 'invalid', deployStatus: 'invalid', title: `❌ ${t('flowDeletionMarkdownTitle')}` });
      await GitProvider.managePostPullRequestComment(this.checkOnly);
      throw new SfError('[FlowDeletion] ' + blockedMessages.join('\n'));
    }
  }

  // The deployment targets smartDeployOptions.targetUsername, which branch config or interactive
  // selection may have set to another org than --target-org. Flow deletion is irreversible, so it
  // must connect to the deployment org, not to the flag org.
  private async getConnection(): Promise<any> {
    if (this.conn) {
      return this.conn;
    }
    const deployUsername = this.smartDeployOptions?.targetUsername || null;
    if (!deployUsername || deployUsername === this.targetOrg?.getUsername()) {
      this.conn = this.targetOrg?.getConnection();
      return this.conn;
    }
    const deployOrg = await Org.create({ aliasOrUsername: deployUsername });
    this.conn = deployOrg.getConnection();
    uxLog('log', this.commandThis, c.grey('[FlowDeletion] ' + t('flowDeletionUsingDeploymentOrg', { username: deployUsername })));
    return this.conn;
  }
}
