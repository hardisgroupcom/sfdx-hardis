/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import {
  createTempDir,
  execSfdxJson,
  isCI,
  uxLog,
} from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { PACKAGE_ROOT_DIR } from '../../../../settings.js';
import { promptOrg, isProductionOrg } from '../../../../common/utils/orgUtils.js';
import { deployMetadatas } from '../../../../common/utils/deployUtils.js';
import { getApiVersion } from '../../../../config/index.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgConfigureGenericPrompt extends SfCommand<any> {
  public static title = 'Configure Generic Prompt Template';

  public static description = `
## Command Behavior

**Deploys the \`SfdxHardisGenericPrompt\` GenAiPromptTemplate metadata to a Salesforce org, enabling AI prompt integration via sfdx-hardis.**

Key functionalities include:

- **Org Selection:** Prompts the user to select a target org (defaults to the current default org). In agent mode, uses the org provided via \`--target-org\`.
- **Deployment Confirmation:** Asks the user to confirm the deployment before proceeding.
- **Metadata Deployment:** Deploys the \`SfdxHardisGenericPrompt.genAiPromptTemplate-meta.xml\` file to the selected org using the Metadata API.
- **Production Org Handling:** If the target org is a production org, automatically selects a test class to satisfy Salesforce test requirements.
- **Permission Set Assignment:** Checks if the \`EinsteinGPTPromptTemplateUser\` Permission Set exists in the org and optionally assigns it to the current user.

### Agent Mode

When \`--agent\` is specified:
- The org provided via \`--target-org\` is used without prompting for org selection.
- Deployment proceeds without confirmation prompts.
- If the \`EinsteinGPTPromptTemplateUser\` Permission Set exists, it is assigned automatically.

<details markdown="1">
<summary>Technical explanations</summary>

- **Metadata Structure:** At runtime, a temporary MDAPI-format directory is created containing the \`genAiPromptTemplates/\` subdirectory and a \`package.xml\` manifest. The source file is read from \`defaults/utils/SfdxHardisGenericPrompt.genAiPromptTemplate-meta.xml\` in the sfdx-hardis package.
- **Production Org Detection:** Uses \`isProductionOrg()\` to determine if the target org is a production org. For production orgs, \`RunSpecifiedTests\` is used with a test class found by querying \`ApexClass\` via the Tooling API.
- **Test Class Selection:** Checks the \`SFDX_HARDIS_TECH_DEPLOY_TEST_CLASS\` environment variable first, then queries the org for an Apex class with "Test" in its name.
- **Permission Set Check:** Queries the org for the \`EinsteinGPTPromptTemplateUser\` Permission Set before prompting for assignment.
- **Deployment:** Uses \`deployMetadatas()\` from \`deployUtils.ts\` with \`--metadata-dir\` pointing to the temporary MDAPI directory.
</details>
`;

  public static examples = [
    '$ sf hardis:org:configure:generic-prompt',
    '$ sf hardis:org:configure:generic-prompt --agent',
  ];

  public static flags: any = {
    agent: Flags.boolean({ default: false, description: 'Run in non-interactive mode for agents and automation' }),
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

  public static requiresProject = false;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgConfigureGenericPrompt);
    const agentMode = flags.agent === true;
    const debugMode = flags.debug === true;

    // Select org - prompt in interactive mode, use target-org in agent/CI mode
    let orgUsername = flags['target-org'].getUsername() as string;
    if (!isCI && !agentMode) {
      const org = await promptOrg(this, {
        devHub: false,
        setDefault: true,
        scratch: false,
        promptMessage: t('selectOrgToDeployGenericPrompt'),
        defaultOrgUsername: orgUsername,
      });
      orgUsername = org.username;
    }

    // Confirm deployment
    if (!isCI && !agentMode) {
      const confirmDeploy = await prompts({
        type: 'confirm',
        name: 'value',
        initial: true,
        message: c.cyanBright(t('confirmDeployGenericPromptTemplate')),
        description: t('confirmDeployGenericPromptTemplateDescription'),
      });
      if (!confirmDeploy.value) {
        uxLog('warning', this, c.yellow(t('deploymentCancelledByUser')));
        return { outputString: 'Deployment cancelled by user' };
      }
    }

    // Build temporary MDAPI deploy directory
    const tmpDir = await createTempDir();
    try {
      const genAiDir = path.join(tmpDir, 'genAiPromptTemplates');
      await fs.ensureDir(genAiDir);

      // Copy metadata file into MDAPI structure
      const sourceFile = path.join(
        PACKAGE_ROOT_DIR,
        'defaults',
        'utils',
        'SfdxHardisGenericPrompt.genAiPromptTemplate-meta.xml'
      );
      await fs.copy(sourceFile, path.join(genAiDir, 'SfdxHardisGenericPrompt.genAiPromptTemplate-meta.xml'));

      // Create package.xml
      const apiVersion = getApiVersion();
      const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>SfdxHardisGenericPrompt</members>
    <name>GenAiPromptTemplate</name>
  </types>
  <version>${apiVersion}</version>
</Package>`;
      await fs.writeFile(path.join(tmpDir, 'package.xml'), packageXml);

      // Determine test level - production orgs require running Apex tests
      const isProd = await isProductionOrg(orgUsername, { debugMode });
      let testlevel = isProd ? 'RunLocalTests' : 'NoTestRun';
      let runTests: string[] | null = null;

      if (isProd) {
        let uniqueTestClass = process.env.SFDX_HARDIS_TECH_DEPLOY_TEST_CLASS || null;
        if (!uniqueTestClass) {
          const apexQueryRes = await execSfdxJson(
            `sf data query --use-tooling-api --query "SELECT Id, Name FROM ApexClass WHERE Name LIKE '%Test%' OR Name LIKE '%test%' OR Name LIKE '%TEST%' ORDER BY Name LIMIT 1" --target-org ${orgUsername} --json`,
            this,
            { fail: false, output: false, debug: debugMode }
          );
          const apexClasses = apexQueryRes?.result?.records || [];
          if (apexClasses.length > 0) {
            uniqueTestClass = apexClasses[0].Name;
          }
        }
        if (uniqueTestClass) {
          testlevel = 'RunSpecifiedTests';
          runTests = [uniqueTestClass];
          uxLog('log', this, c.grey(t('productionOrgDetectedWillRunTestClass', { testClass: uniqueTestClass })));
        }
      }

      // Deploy
      uxLog('action', this, c.cyan(t('deployingGenericPromptTemplate')));
      await deployMetadatas({
        deployDir: tmpDir,
        testlevel,
        runTests,
        targetUsername: orgUsername,
        debug: debugMode,
      });

      uxLog('success', this, c.green(t('genericPromptTemplateDeploySuccess')));
    } finally {
      await fs.remove(tmpDir).catch(() => {});
    }

    // Check if EinsteinGPTPromptTemplateUser permission set exists in the org
    const psQueryRes = await execSfdxJson(
      `sf data query --query "SELECT Id FROM PermissionSet WHERE Name = 'EinsteinGPTPromptTemplateUser' LIMIT 1" --target-org ${orgUsername} --json`,
      this,
      { fail: false, output: false, debug: debugMode }
    );
    const psExists = (psQueryRes?.result?.records || []).length > 0;

    if (!psExists) {
      uxLog('log', this, c.grey(t('einsteinGptPermSetNotFound')));
      return { outputString: 'Generic Prompt Template configured successfully' };
    }

    // Ask user about permission set assignment
    let shouldAssign = isCI || agentMode;
    if (!isCI && !agentMode) {
      const confirmAssign = await prompts({
        type: 'confirm',
        name: 'value',
        initial: true,
        message: c.cyanBright(t('confirmAssignEinsteinGptPermSet')),
        description: t('confirmAssignEinsteinGptPermSetDescription'),
      });
      shouldAssign = confirmAssign.value === true;
    }

    if (shouldAssign) {
      const assignResult = await execSfdxJson(
        `sf org assign permset --name EinsteinGPTPromptTemplateUser --target-org ${orgUsername} --json`,
        this,
        { fail: false, output: false, debug: debugMode }
      );
      if (
        assignResult?.result?.failures?.length > 0 &&
        !assignResult?.result?.failures[0].message.includes('Duplicate')
      ) {
        uxLog('error', this, c.red(t('errorAssigningPermSetToUser', {
          permSet: 'EinsteinGPTPromptTemplateUser',
          message: assignResult?.result?.failures[0].message,
        })));
      } else {
        uxLog('success', this, c.green(t('einsteinGptPermSetAssignSuccess')));
      }
    }

    return { outputString: 'Generic Prompt Template configured successfully' };
  }
}
