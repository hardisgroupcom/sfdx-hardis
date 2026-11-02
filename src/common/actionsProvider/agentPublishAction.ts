import { AuthInfo, Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import { glob } from 'glob';
import * as path from 'path';
import { ActionsProvider, ActionResult, ActionWhen, PrePostCommand, buildActionOutput } from './actionsProvider.js';
import { createTempDir, execSfdxJson, getCurrentGitBranch, uxLog } from '../utils/index.js';
import { AGENT_AUTHORING_BUNDLE_TYPE, AGENT_DOC_URL, activateAgentVersion, listOrgAgentVersions } from '../utils/agentUtils.js';
import { writePackageXmlFile } from '../utils/xmlUtils.js';
import { t } from '../utils/i18n.js';

// A deployment check deploys nothing, and a publication creates a version: it never runs in a check
const AGENT_PUBLISH_CONTEXT: PrePostCommand['context'] = 'process-deployment-only';
const AGENT_PUBLISH_FLAGS = ['agent-name'];
// API names only: they are written in a command line
const AGENT_API_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Publishes the authoring bundle of an agent in the target org with "sf agent publish authoring-bundle",
 * then activates the version the publication created. The org numbers the version, so the version
 * numbers of the orgs of the pipeline never have to match. The replacement rules of the target org are
 * applied to the bundle while it is published, as for a deployment: the built-in rule
 * builtin-agent-running-user writes the running user of that org.
 */
export class AgentPublishAction extends ActionsProvider {
  public getLabel(): string {
    return 'AgentPublishAction';
  }

  // The dependencies of the agent (Flows, Apex, prompt templates) are deployed first
  public getAllowedWhen(): ActionWhen[] | null {
    return ['post-deploy'];
  }

  public getFlagNames(): string[] {
    return AGENT_PUBLISH_FLAGS;
  }

  public async collectParameters(flags: any, headless: boolean, current: PrePostCommand['parameters'] = {}): Promise<Record<string, any>> {
    const collected: Record<string, any> = this.applyFlags({ ...(current || {}) }, flags);
    if (headless) {
      if (!collected.agentName) {
        throw new SfError(t('missingRequiredFlag', { flag: 'agent-name' }));
      }
      return collected;
    }
    // Loaded only when prompting, so running the action never loads the prompt dependencies
    const { promptActionText } = await import('../utils/actionPromptUtils.js');
    if (flags['agent-name'] === undefined) {
      collected.agentName = await promptActionText(t('enterAgentApiName'), collected.agentName || '');
    }
    return collected;
  }

  public applyFlags(parameters: PrePostCommand['parameters'], flags: any): Record<string, any> {
    const updated: Record<string, any> = { ...(parameters || {}) };
    if (flags['agent-name'] !== undefined) updated.agentName = String(flags['agent-name']).trim();
    return updated;
  }

  // The phase is checked by the generic validation, against getAllowedWhen()
  public async getDefinitionErrors(action: Partial<PrePostCommand>): Promise<string[]> {
    return listDefinitionErrors(action, true);
  }

  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    // The execution loop runs it as a deployment-only action whatever its context says
    const errors = listDefinitionErrors(cmd, false);
    const allowedWhen = this.getAllowedWhen() || [];
    if (cmd.when && !allowedWhen.includes(cmd.when)) {
      errors.push(t('actionTypeWrongPhase', { type: cmd.type, when: allowedWhen.join(', ') }));
    }
    if (errors.length > 0) {
      uxLog('error', this, c.red(`[DeploymentActions] ${errors.join('\n')}`));
      return { statusCode: 'failed', skippedReason: errors.join('\n') };
    }
    return null;
  }

  public getIdentityParameters(cmd: PrePostCommand): Record<string, any> | null {
    return { agentName: String(cmd.parameters?.agentName || '').trim().toLowerCase() };
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;

    const agentName = String(cmd.parameters?.agentName || '').trim();
    const outputLines: string[] = [];

    // 1. The bundle of the agent, in the folder that "sf agent publish authoring-bundle" reads
    const bundleFiles = await glob(`**/aiAuthoringBundles/${agentName}/${agentName}.agent`, {
      ignore: ['**/node_modules/**', '**/.sfdx/**', '**/.sf/**'],
      nocase: true,
    });
    if (bundleFiles.length === 0) {
      return this.fail(t('agentBundleNotFoundInProject', { agentName, docUrl: AGENT_DOC_URL }), outputLines);
    }
    const bundleName = path.basename(bundleFiles[0], '.agent');

    // 2. Publish it with the replacement rules of the target org applied
    const conn = await this.getConnection();
    const versionsBefore = new Set(
      (await listOrgAgentVersions(conn)).filter((version) => version.agentName.toLowerCase() === agentName.toLowerCase()).map((version) => version.version)
    );
    const tmpDir = await createTempDir();
    const packageXmlFile = path.join(tmpDir, 'package.xml');
    await writePackageXmlFile(packageXmlFile, { [AGENT_AUTHORING_BUNDLE_TYPE]: [bundleName] });
    const targetBranch = cmd.pipelineContext?.targetBranch || process.env.FORCE_TARGET_BRANCH || (await getCurrentGitBranch()) || null;
    const { runWithReplacementRules } = await import('../replacementRules/engine/ruleEngine.js');
    uxLog('action', this, c.cyan(`[DeploymentActions] ${t('publishingAgent', { agentName: bundleName })}`));
    const publishCommand = `sf agent publish authoring-bundle --api-name ${bundleName} --skip-retrieve --target-org ${conn.getUsername()} --json`;
    const publishRes = await runWithReplacementRules(
      { targetBranch, conn, targetUsername: conn.getUsername(), packageXmlFiles: [packageXmlFile], commandThis: this },
      () => execSfdxJson(publishCommand, this, { fail: false, output: true })
    );
    if (publishRes?.status !== 0) {
      return this.fail(t('agentPublishFailed', { agentName: bundleName, message: buildActionOutput(publishRes) || publishRes?.message || '' }), outputLines);
    }

    // 3. The version the publication created: the org numbers it
    const created = (await listOrgAgentVersions(conn))
      .filter((version) => version.agentName.toLowerCase() === agentName.toLowerCase() && !versionsBefore.has(version.version))
      .sort((a, b) => b.version - a.version)[0];
    if (!created) {
      return this.fail(t('agentPublishCreatedNoVersion', { agentName: bundleName }), outputLines);
    }
    this.logSuccess(t('agentPublished', { agentName: created.agentName, version: created.version }), outputLines);

    // 4. Activate it: Salesforce deactivates the version that was active
    const activation = await activateAgentVersion(conn, created, this);
    if (!activation.success) {
      return this.fail(activation.message, outputLines);
    }
    this.logSuccess(activation.message, outputLines);
    return { statusCode: 'success', output: outputLines.join('\n') };
  }

  private async getConnection(): Promise<Connection> {
    if (this.customUsernameToUse) {
      const authInfo = await AuthInfo.create({ username: this.customUsernameToUse });
      return Connection.create({ authInfo });
    }
    return globalThis.jsForceConn;
  }

  private logSuccess(message: string, outputLines: string[]): void {
    uxLog('log', this, c.green(`[DeploymentActions] ${message}`));
    outputLines.push(message);
  }

  private fail(message: string, outputLines: string[]): ActionResult {
    uxLog('error', this, c.red(`[DeploymentActions] ${message}`));
    return { statusCode: 'failed', output: [...outputLines, message].join('\n') };
  }
}

function listDefinitionErrors(action: Partial<PrePostCommand>, checkContext: boolean): string[] {
  const errors: string[] = [];
  const agentName = String(action.parameters?.agentName || '').trim();
  if (!agentName) {
    errors.push(t('actionValidationAgentActivateNoAgentName'));
  } else if (!AGENT_API_NAME_REGEX.test(agentName)) {
    errors.push(t('actionValidationAgentActivateInvalidAgentName', { name: agentName }));
  }
  if (checkContext && action.context && action.context !== AGENT_PUBLISH_CONTEXT) {
    errors.push(t('actionValidationAgentPublishContext', { context: action.context }));
  }
  return errors;
}
