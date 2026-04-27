/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { ensureGitRepository, execCommand, uxLog } from '../../../common/utils/index.js';
import { parseXmlFile, writeXmlFile } from '../../../common/utils/xmlUtils.js';
import { prompts } from '../../../common/utils/prompts.js';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { CONSTANTS, getConfig, promptForProjectName, setConfig } from '../../../config/index.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { isSfdxProject } from '../../../common/utils/projectUtils.js';
import { PACKAGE_ROOT_DIR } from '../../../settings.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ProjectCreate extends SfCommand<any> {
  public static title = 'Login';

  public static description = `Create a new SFDX Project

## Command Behavior

**Creates and initializes a new Salesforce DX project with sfdx-hardis configuration.**

This command automates the setup of a new SFDX project, including git repository initialization, DevHub connection, project naming, development branch configuration, and default auto-clean types.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Git Repository:** Ensures a git repository exists or clones one.
- **DevHub Selection:** Prompts for the type of development orgs (scratch, sandbox, or both) and connects to DevHub if needed.
- **Project Generation:** Creates a new SFDX project using \`sf project generate\` if one doesn't already exist.
- **Default Files:** Copies default CI/CD configuration files from the package defaults.
- **Configuration:** Sets project name, development branch, and auto-clean types in \`.sfdx-hardis.yml\`.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:create --agent --orgtype scratch --projectname MyProject --devbranch integration
\`\`\`

In agent mode, the following flags are **required** (no defaults are applied):

- \`--orgtype\`: type of development orgs (\`scratch\`, \`sandbox\`, or \`sandboxAndScratch\`).
- \`--projectname\`: name of the SFDX project.
- \`--devbranch\`: name of the default development branch.

Optional flag:

- \`--minimizeprofiles\`: activates the \`minimizeProfiles\` auto-clean type. **Only use this if the project is Permission Set-based**: it removes from profiles any attribute (object access, field access, etc.) that is already granted by a Permission Set. Omitted by default in agent mode; always activated in interactive mode.
`;

  public static examples = [
    '$ sf hardis:project:create',
    '$ sf hardis:project:create --agent --orgtype scratch --projectname MyProject --devbranch integration',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    orgtype: Flags.string({
      description: 'Type of development orgs: scratch, sandbox, or sandboxAndScratch (required with --agent)',
      options: ['scratch', 'sandbox', 'sandboxAndScratch'],
    }),
    projectname: Flags.string({
      description: 'Name of the SFDX project (required with --agent)',
    }),
    devbranch: Flags.string({
      description: 'Name of the default development branch (required with --agent)',
    }),
    minimizeprofiles: Flags.boolean({
      default: false,
      description: 'Activate the minimizeProfiles auto-clean type. Use only for Permission Set-based projects: removes from profiles any attribute (object/field access, etc.) already granted by a Permission Set. Off by default in agent mode; always on in interactive mode.',
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
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ProjectCreate);
    this.debugMode = flags.debug || false;
    const agentMode = flags.agent === true;
    // Check git repo
    await ensureGitRepository({ clone: true });
    let orgType: string;
    if (!agentMode) {
      const devHubPrompt = await prompts({
        name: 'orgType',
        type: 'select',
        message: t('toPerformImplementationWillYourProjectUse'),
        description: t('chooseTypeOfDevelopmentOrgs'),
        placeholder: t('selectOrgType'),
        choices: [
          {
            title: t('scratchOrgsOnly'),
            value: 'scratch',
          },
          {
            title: t('sourceTrackedSandboxesOnly'),
            value: 'sandbox',
          },
          {
            title: t('sourceTrackedSandboxesAndScratchOrgs'),
            value: 'sandboxAndScratch',
          },
        ],
      });
      orgType = devHubPrompt.orgType;
    } else {
      if (!flags.orgtype) {
        throw new SfError('In agent mode, --orgtype is required. Allowed values: scratch, sandbox, sandboxAndScratch.');
      }
      orgType = flags.orgtype;
    }
    if (['scratch', 'sandboxAndScratch'].includes(orgType)) {
      // Connect to DevHub
      await this.config.runHook('auth', {
        checkAuth: true,
        Command: this,
        devHub: true,
        scratch: false,
      });
    }
    // Project name
    let config = await getConfig('project');
    let projectName: string;
    let setProjectName = false;
    if (agentMode) {
      if (!flags.projectname) {
        throw new SfError('In agent mode, --projectname is required.');
      }
      projectName = flags.projectname;
      setProjectName = true;
    } else if (config.projectName != null) {
      projectName = config.projectName;
    } else {
      // User prompts
      projectName = await promptForProjectName();
      setProjectName = true;
    }

    // Create sfdx project only if not existing
    if (!isSfdxProject()) {
      const createCommand = 'sf project generate' + ` --name "${projectName}"` + ' --manifest';
      await execCommand(createCommand, this, {
        output: true,
        fail: true,
        debug: this.debugMode,
      });

      // Move project files at root
      await fs.copy(path.join(process.cwd(), projectName), process.cwd(), {
        overwrite: false,
      });
      await fs.rm(path.join(process.cwd(), projectName), { recursive: true });

      // Clean generated manifest/package.xml: keep only API version
      const manifestPackageXml = path.join(process.cwd(), 'manifest', 'package.xml');
      if (await fs.pathExists(manifestPackageXml)) {
        const parsedXml = await parseXmlFile(manifestPackageXml);
        if (parsedXml?.Package) {
          parsedXml.Package.types = [];
          await writeXmlFile(manifestPackageXml, parsedXml);
          uxLog("log", this, c.grey(t('cleanedManifestPackageXml')));
        }
      }
    }
    // Copy default project files
    uxLog("action", this, t('copyingDefaultFiles'));
    await fs.copy(path.join(PACKAGE_ROOT_DIR, 'defaults/ci', '.'), process.cwd(), { overwrite: false });

    if (setProjectName) {
      await setConfig('project', { projectName: projectName });
    }

    config = await getConfig('project');
    if (config.developmentBranch == null) {
      if (agentMode) {
        if (!flags.devbranch) {
          throw new SfError('In agent mode, --devbranch is required.');
        }
        await setConfig('project', { developmentBranch: flags.devbranch });
      } else {
        // User prompts
        const devBranchRes = await prompts({
          type: 'text',
          name: 'devBranch',
          message: t('whatIsNameOfDefaultDevelopmentBranch'),
          initial: 'integration',
          description: t('enterNameOfMainDevelopmentBranch'),
          placeholder: t('exIntegration'),
        });
        await setConfig('project', { developmentBranch: devBranchRes.devBranch });
      }
    }

    // Initialize autoCleanTypes
    const defaultAutoCleanTypes = ['destructivechanges', 'flowPositions'];
    if (!agentMode || flags.minimizeprofiles) {
      defaultAutoCleanTypes.push('minimizeProfiles');
    }
    await setConfig('project', {
      autoCleanTypes: defaultAutoCleanTypes
    });
    uxLog("warning", this, c.yellow(t('autocleantypesHasBeenActivatedOnTheNew', { defaultAutoCleanTypes: defaultAutoCleanTypes.join(",") })));
    uxLog("warning", this, c.bold(c.yellow(t('ifInstallCiCdOnExistingOrgMinimizeProfiles'))));
    // Message instructions
    uxLog(
      "action",
      this,
      c.cyan(
        t('sfdxProjectCreatedContinueSteps', { docUrl: CONSTANTS.DOC_URL_ROOT + '/salesforce-ci-cd-setup-home/' })
      )
    );

    // Trigger commands refresh on VS Code WebSocket Client
    WebSocketClient.sendRefreshCommandsMessage();

    // Return an object to be displayed with --json
    return { outputString: 'Created SFDX Project' };
  }

}
