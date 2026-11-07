import c from 'chalk';
import { glob } from 'glob';
import * as path from 'path';
import { ActionResult, ActionWhen, PrePostCommand, buildActionOutput } from './actionsProvider.js';
import { AgentActionBase } from './agentActionBase.js';
import { createTempDir, execSfdxJson, git, uxLog } from '../utils/index.js';
import { AGENT_AUTHORING_BUNDLE_TYPE, AGENT_DOC_URL, AgentVersionInfo, activateAgentVersion, listOrgAgentVersions } from '../utils/agentUtils.js';
import { AGENT_FILES_IGNORE } from '../utils/agentBundleUtils.js';
import { writePackageXmlFile } from '../utils/xmlUtils.js';
import { t } from '../utils/i18n.js';

// A deployment check deploys nothing, and a publication creates a version: it never runs in a check
const AGENT_PUBLISH_CONTEXT: PrePostCommand['context'] = 'process-deployment-only';

/**
 * Publishes the authoring bundle of an agent in the target org with "sf agent publish authoring-bundle",
 * then activates the version the publication created. The org numbers the version, so the version
 * numbers of the orgs of the pipeline never have to match. The replacement rules of the target org are
 * applied to the bundle while it is published, as for a deployment: the built-in rule
 * builtin-agent-running-user writes the running user of that org.
 */
export class AgentPublishAction extends AgentActionBase {
  public getLabel(): string {
    return 'AgentPublishAction';
  }

  // The dependencies of the agent (Flows, Apex, prompt templates) are deployed first
  public getAllowedWhen(): ActionWhen[] | null {
    return ['post-deploy'];
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;

    const agentName = String(cmd.parameters?.agentName || '').trim();
    const outputLines: string[] = [];

    // 1. The bundle of the agent, in the folder that "sf agent publish authoring-bundle" reads
    const bundleFiles = await glob(`**/aiAuthoringBundles/${agentName}/${agentName}.agent`, { ignore: AGENT_FILES_IGNORE, nocase: true });
    if (bundleFiles.length === 0) {
      return this.fail(t('agentBundleNotFoundInProject', { agentName, docUrl: AGENT_DOC_URL }), outputLines);
    }
    const bundleName = path.basename(bundleFiles[0], '.agent');

    // 2. A previous run published the bundle and failed to activate the version: activate that one, as a
    // new publication would create one more version at each run
    const conn = await this.getConnection();
    const agentVersions = (await listOrgAgentVersions(conn)).filter((version) => version.agentName.toLowerCase() === agentName.toLowerCase());
    const unfinished = findUnfinishedPublication(agentVersions, await readBundleLastChangeDate(path.dirname(bundleFiles[0])));
    if (unfinished) {
      uxLog('action', this, c.cyan(`[DeploymentActions] ${t('agentPublishResumesActivation', { agentName: unfinished.agentName, version: unfinished.version })}`));
      return this.activate(conn, unfinished, outputLines);
    }

    // 3. Publish it with the replacement rules of the target org applied
    const versionsBefore = new Set(agentVersions.map((version) => version.version));
    const tmpDir = await createTempDir();
    const packageXmlFile = path.join(tmpDir, 'package.xml');
    await writePackageXmlFile(packageXmlFile, { [AGENT_AUTHORING_BUNDLE_TYPE]: [bundleName] });
    const { resolveReplacementRulesTargetBranch, runWithReplacementRules } = await import('../replacementRules/engine/ruleEngine.js');
    const targetBranch = await resolveReplacementRulesTargetBranch(cmd.pipelineContext?.targetBranch || null);
    uxLog('action', this, c.cyan(`[DeploymentActions] ${t('publishingAgent', { agentName: bundleName })}`));
    const publishCommand = `sf agent publish authoring-bundle --api-name ${bundleName} --skip-retrieve --target-org ${conn.getUsername()} --json`;
    const publishRes = await runWithReplacementRules(
      { targetBranch, conn, targetUsername: conn.getUsername(), packageXmlFiles: [packageXmlFile], commandThis: this },
      () => execSfdxJson(publishCommand, this, { fail: false, output: true })
    );
    if (publishRes?.status !== 0) {
      return this.fail(t('agentPublishFailed', { agentName: bundleName, message: buildActionOutput(publishRes) || publishRes?.message || '' }), outputLines);
    }

    // 4. The version the publication created: the org numbers it
    const created = (await listOrgAgentVersions(conn))
      .filter((version) => version.agentName.toLowerCase() === agentName.toLowerCase() && !versionsBefore.has(version.version))
      .sort((a, b) => b.version - a.version)[0];
    if (!created) {
      return this.fail(t('agentPublishCreatedNoVersion', { agentName: bundleName }), outputLines);
    }
    this.logSuccess(t('agentPublished', { agentName: created.agentName, version: created.version }), outputLines);

    return this.activate(conn, created, outputLines);
  }

  protected listDefinitionErrors(action: Partial<PrePostCommand>, checkContext: boolean): string[] {
    const errors = super.listDefinitionErrors(action, checkContext);
    if (checkContext && action.context && action.context !== AGENT_PUBLISH_CONTEXT) {
      errors.push(t('actionValidationAgentPublishContext', { context: action.context }));
    }
    return errors;
  }

  // Salesforce deactivates the version that was active
  private async activate(conn: any, version: AgentVersionInfo, outputLines: string[]): Promise<ActionResult> {
    const activation = await activateAgentVersion(conn, version, this);
    if (!activation.success) {
      return this.fail(activation.message, outputLines);
    }
    return this.succeed(activation.message, outputLines);
  }
}

/**
 * The latest version of the agent when the org published it after the last change of the bundle and
 * it is still inactive: the activation that followed its publication failed. null when the bundle
 * changed since (a version rolled back in the org is older than the change, the new bundle must be
 * published), and when the org or git do not tell the dates and statuses.
 */
export function findUnfinishedPublication(agentVersions: AgentVersionInfo[], bundleChangedAt: Date | null): AgentVersionInfo | null {
  if (agentVersions.length === 0 || !bundleChangedAt) {
    return null;
  }
  const latest = agentVersions.reduce((highest, version) => (version.version > highest.version ? version : highest));
  const createdAt = latest.createdDate ? Date.parse(latest.createdDate) : NaN;
  if (!latest.status || latest.status.toLowerCase() === 'active' || Number.isNaN(createdAt)) {
    return null;
  }
  return createdAt > bundleChangedAt.getTime() ? latest : null;
}

// Date of the last commit that changed the bundle folder. null when it has changes not committed yet,
// or when git does not tell
async function readBundleLastChangeDate(bundleFolder: string): Promise<Date | null> {
  try {
    const gitClient = git({ output: false, displayCommand: false });
    if ((await gitClient.raw(['status', '--porcelain', '--', bundleFolder])).trim() !== '') {
      return null;
    }
    const committedAt = (await gitClient.raw(['log', '-1', '--format=%cI', '--', bundleFolder])).trim();
    return committedAt ? new Date(committedAt) : null;
  } catch {
    return null;
  }
}
