/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { ensureGitRepository, execCommand, uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { getConfig, setConfig } from '../../../config/index.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { isSfdxProject } from '../../../common/utils/projectUtils.js';
import { PACKAGE_ROOT_DIR } from '../../../settings.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ProjectCreate extends SfCommand<any> {
  public static title = 'Login';

  public static description = 'Create a new SFDX Project';

  public static examples = ['$ sf hardis:project:create'];

  public static flags = {
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
    // Check git repo
    await ensureGitRepository({ clone: true });
    const devHubPrompt = await prompts({
      name: 'orgType',
      type: 'select',
      message: 'To perform implementation, will your project use scratch org or source tracked sandboxes only ?',
      choices: [
        {
          title: 'Scratch orgs only',
          value: 'scratch',
        },
        {
          title: 'Source tracked sandboxes only',
          value: 'sandbox',
        },
        {
          title: 'Source tracked sandboxes and scratch orgs',
          value: 'sandboxAndScratch',
        },
      ],
    });
    if (['scratch', 'sandboxAndScratch'].includes(devHubPrompt.orgType)) {
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
    let projectName = config.projectName;
    if (projectName == null) {
      // User prompts
      const projectRes = await prompts({
        type: 'text',
        name: 'projectName',
        message: 'What is the name of your project ? (example: MyClient)',
      });
      projectName = projectRes.projectName.toLowerCase().replace(' ', '_');
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
    }
    // Copy default project files
    uxLog(this, 'Copying default files...');
    await fs.copy(path.join(PACKAGE_ROOT_DIR, 'defaults/ci', '.'), process.cwd(), { overwrite: false });

    config = await getConfig('project');
    if (config.developmentBranch == null) {
      // User prompts
      const devBranchRes = await prompts({
        type: 'text',
        name: 'devBranch',
        message:
          'What is the name of your default development branch ? (Examples: if you manage RUN and BUILD, it can be integration. If you manage RUN only, it can be preprod)',
        initial: 'integration',
      });
      await setConfig('project', { developmentBranch: devBranchRes.devBranch });
    }

    await setConfig('project', { autoCleanTypes: ['destructivechanges'] });

    // Message instructions
    uxLog(
      this,
      c.cyan(
        'SFDX Project has been created. You can continue the steps in documentation at https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-home/'
      )
    );

    // Trigger commands refresh on VsCode WebSocket Client
    WebSocketClient.sendMessage({ event: 'refreshCommands' });

    // Return an object to be displayed with --json
    return { outputString: 'Created SFDX Project' };
  }
}
