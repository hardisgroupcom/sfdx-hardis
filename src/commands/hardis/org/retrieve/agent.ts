/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
import { execSfdxJson, isCI, uxLog } from '../../../../common/utils/index.js';
import { uxLogTableWithReport } from '../../../../common/utils/filesUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { getEnvVar } from '../../../../config/index.js';
import {
  AGENT_DEFINITION_VERSION_TYPE,
  AGENT_DOC_URL,
  AgentVersionInfo,
  buildAgentPackageXmlContent,
  findLegacyAgentEntries,
  findMissingAgentReferences,
  formatAgentVersionFullName,
  hasBotUserReplacementRule,
  isApiVersionAtLeast,
  listOrgAuthoringBundleNames,
  listOrgAgentVersions,
  mergeIntoPackageXml,
  readAgentBotUsers,
  removeLegacyAgentEntries,
  resolveAgentVersion,
} from '../../../../common/utils/agentUtils.js';
import { resolveDeployApiVersion } from '../../../../common/replacementRules/engine/ruleEngine.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class RetrieveAgent extends SfCommand<any> {
  public static title = 'Retrieve an Agentforce agent';

  public static description = `
## Command Behavior

**Retrieves one version of an Agentforce agent from an org, with the components it needs, and adds them to the package.xml of the project.**

From API 68.0, an agent is made of the \`AiAgentDefinition\` and \`AiAgentDefinitionVersion\` metadata types, and the Salesforce CLI retrieves an agent version with its dependencies: its Flow, Apex and prompt template actions.

Key functionalities:

- **Agent and version selection:** Lists the agents of the org and their versions with their status, and proposes the latest version.
- **Retrieval with dependencies:** Retrieves the selected version and what it uses in the local project.
- **package.xml update:** Adds every retrieved component to \`manifest/package.xml\`, always with the whole \`AiAgentDefinition\`: the first deployment of an agent to an org needs it.
- **Migration from the format before API 68.0:** When \`manifest/package.xml\` still holds the agent as \`GenAiPlannerBundle\`, \`Bot\` or \`BotVersion\`, these entries are removed, and the command lists the old folders to delete.
- **Running user warning:** A service agent runs as a user of its org (\`botUser\`). The command warns when the retrieved agent has one: add a replacement rule that writes the user of each org.
- **Missing dependencies report:** Lists the custom objects, custom fields and Data 360 objects that the agent names and that the project does not hold. The CLI does not retrieve them: retrieve them yourself when the target org does not have them.

Then commit the files as usual (for example with [hardis:work:save](https://sfdx-hardis.cloudity.com/hardis/work/save/)). With the cleaning \`autoAddAgentsDeploymentActions\` in \`autoCleanTypes\`, hardis:work:save adds the activation of the new version to the deployment actions of the Pull Request.

The org and the \`sourceApiVersion\` of \`sfdx-project.json\` must be on API 68.0 or above: below, Salesforce returns no agent file. To keep the previous types (\`Bot\`, \`BotVersion\`, \`AiAuthoringBundle\`) while an org of your pipeline is still on API 67.0, see [Agentforce agents in CI/CD](${AGENT_DOC_URL}).

<details markdown="1">
<summary>Technical explanations</summary>

- **Listing:** \`metadata.list\` on \`AiAgentDefinitionVersion\` returns the versions as \`AgentName#Number\`. Their status comes from a SOQL query on \`BotVersion\`, and is left empty when the org does not answer it.
- **Retrieval:** runs \`sf project retrieve start --metadata "AiAgentDefinitionVersion:AgentName#Number" --root-type-with-dependencies AiAgentDefinitionVersion --ignore-conflicts --json\`.
- **package.xml:** the retrieved components are read from the \`files\` of the JSON result and merged into the package.xml. A type already listed with \`*\` is left as is.
- **Missing dependencies:** the retrieved agent files are scanned for names ending with \`__c\`, \`__dlm\`, \`__dll\` or \`__x\`, then compared with the \`objects\` folders of the project. The result is what may be missing: a name found in an instruction text is listed too.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:retrieve:agent --agent --name My_Service_Agent --version latest
\`\`\`

In agent mode:

- \`--name\` is required.
- \`--version\` defaults to \`latest\`, the highest version of the agent in the org.
- No prompt is shown.
`;

  public static examples = [
    '$ sf hardis:org:retrieve:agent',
    '$ sf hardis:org:retrieve:agent --name My_Service_Agent --version 3',
    '$ sf hardis:org:retrieve:agent --agent --name My_Service_Agent',
  ];

  public static flags: any = {
    name: Flags.string({
      char: 'n',
      description: 'API name of the agent to retrieve',
    }),
    version: Flags.string({
      description: 'Version number of the agent to retrieve, or latest (default: latest)',
    }),
    'package-xml': Flags.string({
      description: 'package.xml file to add the retrieved components to',
      default: path.join('manifest', 'package.xml'),
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = true;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(RetrieveAgent);
    this.debugMode = flags.debug || false;
    const headless = isCI || flags.agent === true;
    const conn: Connection = flags['target-org'].getConnection();
    const username = flags['target-org'].getUsername();
    const packageXmlFile = path.resolve(flags['package-xml']);

    // 1. The new agent types only exist from API 68.0
    const orgApiVersion = conn.getApiVersion();
    if (!isApiVersionAtLeast(orgApiVersion)) {
      throw new SfError(t('agentRetrieveRequiresApi68', { org: username, apiVersion: orgApiVersion, docUrl: AGENT_DOC_URL }));
    }
    // sfdx-project.json sourceApiVersion below 68.0 makes the retrieve return nothing
    const retrieveApiVersion = await resolveDeployApiVersion({ conn });
    if (retrieveApiVersion && !isApiVersionAtLeast(retrieveApiVersion)) {
      throw new SfError(t('agentRetrieveSourceApiVersionTooLow', { apiVersion: retrieveApiVersion.toFixed(1), docUrl: AGENT_DOC_URL }));
    }

    // 2. Select the agent and its version
    uxLog('action', this, c.cyan(t('listingAgentsOfOrg', { org: c.green(username) })));
    const versions = await listOrgAgentVersions(conn);
    if (versions.length === 0) {
      // An agent built in Agentforce Builder is only an authoring bundle until a version is committed
      const drafts = await listOrgAuthoringBundleNames(conn);
      if (drafts.length > 0) {
        throw new SfError(t('agentDraftNotCommitted', { org: username, drafts: drafts.join(', ') }));
      }
      throw new SfError(t('noAgentFoundInOrg', { org: username }));
    }
    const agentName = await this.selectAgentName(flags.name, versions, headless);
    const selected = await this.selectAgentVersion(agentName, flags.version, versions, headless);
    if (!selected) {
      throw new SfError(t('agentVersionNotFound', { agentName, version: flags.version, org: username }));
    }
    const fullName = formatAgentVersionFullName(selected.agentName, selected.version);

    // 3. Retrieve the version with its dependencies
    uxLog('action', this, c.cyan(t('retrievingAgentWithDependencies', { agentName: c.bold(selected.agentName), version: selected.version })));
    const retrieveCommand =
      `sf project retrieve start --metadata "${AGENT_DEFINITION_VERSION_TYPE}:${fullName}"` +
      ` --root-type-with-dependencies ${AGENT_DEFINITION_VERSION_TYPE}` +
      ` --target-org ${username}` +
      ' --ignore-conflicts' +
      ` --wait ${getEnvVar('SFDX_RETRIEVE_WAIT_MINUTES') || '60'}` +
      ' --json';
    const retrieveRes = await execSfdxJson(retrieveCommand, this, { fail: true, output: false, debug: this.debugMode });
    const retrievedFiles: any[] = retrieveRes?.result?.files || [];
    const failedFiles = retrievedFiles.filter((file) => file?.state === 'Failed');
    if (failedFiles.length > 0) {
      throw new SfError(t('agentRetrieveFailed', { agentName: selected.agentName, errors: failedFiles.map((file) => file.error || file.fullName).join('\n') }));
    }
    const retrievedComponents = buildAgentPackageXmlContent(retrievedFiles, selected.agentName);
    const componentRows = Object.keys(retrievedComponents).flatMap((type) => retrievedComponents[type].map((member) => ({ Type: type, Member: member })));
    await uxLogTableWithReport(this, componentRows, ['Type', 'Member'], { fileNamePrefix: 'agent-retrieved-components', fileTitle: 'Retrieved agent components' });

    // 4. Add them to the package.xml of the project
    const added = await mergeIntoPackageXml(packageXmlFile, retrievedComponents);
    uxLog('action', this, c.cyan(t('agentComponentsAddedToPackageXml', { count: added.length, packageXml: path.relative(process.cwd(), packageXmlFile) })));

    // The same agent in the format before API 68.0 (GenAiPlannerBundle, Bot, BotVersion) is replaced
    const legacyEntries = (await findLegacyAgentEntries(packageXmlFile)).filter((entry) => entry.agentName.toLowerCase() === selected.agentName.toLowerCase());
    let legacyFolders: string[] = [];
    if (legacyEntries.length > 0) {
      legacyFolders = await removeLegacyAgentEntries(packageXmlFile, legacyEntries);
      uxLog('action', this, c.cyan(t('agentLegacyEntriesRemoved', { agentName: selected.agentName, entries: legacyEntries.map((entry) => `${entry.type}:${entry.member}`).join(', ') })));
      if (legacyFolders.length > 0) {
        uxLog('warning', this, c.yellow(t('agentLegacyFoldersToDelete', { folders: legacyFolders.join('\n') })));
      }
    }

    // 5. List what the agent uses and the CLI does not retrieve
    const agentFiles = retrievedFiles.map((file) => file?.filePath).filter((filePath) => !!filePath);
    const missingReferences = await findMissingAgentReferences(agentFiles);
    if (missingReferences.length > 0) {
      uxLog('warning', this, c.yellow(t('agentMissingDependencies', { count: missingReferences.length })));
      await uxLogTableWithReport(
        this,
        missingReferences.map((reference) => ({ Type: reference.type, Name: reference.name, 'Referenced by': reference.referencedBy })),
        ['Type', 'Name', 'Referenced by'],
        { fileNamePrefix: 'agent-missing-dependencies', fileTitle: 'Components the agent may need' }
      );
      uxLog('warning', this, c.yellow(t('agentMissingDependenciesHint')));
    }

    // 6. A service agent runs as a user of the org it was retrieved from
    const botUsers = await readAgentBotUsers([selected.agentName]);
    const botUserRuleExists = botUsers.length > 0 && (await hasBotUserReplacementRule());
    for (const item of botUserRuleExists ? [] : botUsers) {
      uxLog('warning', this, c.yellow(t('agentBotUserIsOrgSpecific', { agentName: item.agentName, botUser: item.botUser, file: item.file, docUrl: AGENT_DOC_URL })));
    }

    uxLog('success', this, c.green(t('agentRetrieved', { agentName: c.bold(selected.agentName), version: selected.version })));
    return {
      agentName: selected.agentName,
      version: selected.version,
      retrievedComponents: componentRows.map((row) => ({ type: row.Type, name: row.Member })),
      addedToPackageXml: added.map((item) => ({ type: item.type, name: item.member })),
      missingDependencies: missingReferences.map((reference) => ({ ...reference })),
      botUsers: botUsers.map((item) => ({ ...item })),
      legacyEntriesRemoved: legacyEntries.map((entry) => ({ type: entry.type, name: entry.member })),
      legacyFoldersToDelete: legacyFolders,
    };
  }

  private async selectAgentName(nameFlag: string | undefined, versions: AgentVersionInfo[], headless: boolean): Promise<string> {
    if (nameFlag) {
      return nameFlag;
    }
    if (headless) {
      throw new SfError(t('missingRequiredFlag', { flag: 'name' }));
    }
    const agentNames = [...new Set(versions.map((version) => version.agentName))];
    const answer = await prompts({
      type: 'select',
      name: 'agentName',
      message: t('selectAgentToRetrieve'),
      description: t('selectAgentToRetrieveDescription'),
      choices: agentNames.map((name) => ({ title: name, value: name })),
    });
    return answer.agentName;
  }

  private async selectAgentVersion(agentName: string, versionFlag: string | undefined, versions: AgentVersionInfo[], headless: boolean): Promise<AgentVersionInfo | null> {
    if (versionFlag || headless) {
      return resolveAgentVersion(versions, agentName, versionFlag);
    }
    const agentVersions = versions
      .filter((version) => version.agentName.toLowerCase() === agentName.toLowerCase())
      .sort((a, b) => b.version - a.version);
    if (agentVersions.length <= 1) {
      return agentVersions[0] || null;
    }
    const answer = await prompts({
      type: 'select',
      name: 'version',
      message: t('selectAgentVersionToRetrieve', { agentName }),
      description: t('selectAgentVersionToRetrieveDescription'),
      choices: agentVersions.map((version) => ({
        title: version.status ? `${version.version} (${version.status})` : String(version.version),
        value: version.version,
      })),
      initial: 0,
    });
    return agentVersions.find((version) => version.version === answer.version) || null;
  }
}
