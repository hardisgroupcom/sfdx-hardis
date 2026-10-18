/* jscpd:ignore-start */
import { spawn } from 'child_process';
import c from 'chalk';

import { which } from '../../../../common/utils/whichUtils.js';
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { addScratchOrgToPool, finalizePoolRefresh, listPoolOrgs, preparePoolRefresh, recordPoolFailure, removePoolOrgs } from '../../../../common/utils/poolUtils.js';
import { getConfig } from '../../../../config/index.js';
import { applySfPerformanceEnv, execCommand, stripAnsi, uxLog } from '../../../../common/utils/index.js';
import { dateHelper } from '../../../../common/utils/dateHelper.js';
import { authenticateWithSfdxUrlStore } from '../../../../common/utils/orgUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ScratchPoolRefresh extends SfCommand<any> {
  public static title = 'Refresh scratch org pool';

  public static description = `## Command Behavior

**Refreshes a scratch org pool by creating new scratch orgs to fill the pool and deleting expired ones.**

This command is designed to maintain a healthy and adequately sized scratch org pool, ensuring that developers and CI/CD pipelines always have access to ready-to-use scratch orgs. It automates the lifecycle management of scratch orgs within the pool.

Key functionalities:

- **Expired Org Cleanup:** Identifies and deletes scratch orgs from the pool that are nearing their expiration date (configurable via \`minScratchOrgRemainingDays\` in \`.sfdx-hardis.yml\`).
- **Pool Replenishment:** Creates new scratch orgs to replace expired ones and to reach the \`maxScratchOrgsNumber\` defined in the pool configuration.
- **Parallel Creation:** New scratch orgs are created in parallel using child processes, optimizing the replenishment process.
- **Authentication Handling:** Authenticates to scratch orgs before deletion or creation, ensuring proper access.
- **Dashboard Update (\`gitProvider\` storage):** Records the refresh, the failed creations and the scratch org limits of the Dev Hub, then rebuilds the "Scratch Orgs Pool Dashboard" of the git provider.
- **Housekeeping (\`gitProvider\` storage):** In a CI job, removes the entries encrypted with a previous key before the pool is counted, and deletes their scratch orgs from the Dev Hub when \`SFDX_HARDIS_POOL_PREVIOUS_ENCRYPTION_KEY\` proves they are genuine. A refresh run from a computer keeps them and stops. Comments that the key of the pool did not sign are ignored. Removes the entries of the scratch orgs already taken.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It retrieves the \`poolConfig\` from the project's \`.sfdx-hardis.yml\` file to get parameters like \`maxScratchOrgsNumber\`, \`maxScratchOrgsNumberToCreateOnce\`, and \`minScratchOrgRemainingDays\`.
- **Pool Storage Interaction:** It uses \`listPoolOrgs\`, \`removePoolOrgs\` and \`addScratchOrgToPool\` to interact with the configured storage service (dashboard of the git provider, or Salesforce Custom Object on the Dev Hub). With the \`gitProvider\` storage, the encryption key of the pool (\`SFDX_HARDIS_POOL_ENCRYPTION_KEY\`) is required.
- **Expiration Check:** It calculates the remaining days for each scratch org in the pool using moment and flags those below the \`minScratchOrgRemainingDays\` threshold for deletion.
- **Scratch Org Deletion:** For expired orgs, it authenticates to them using \`authenticateWithSfdxUrlStore\` and then executes \`sf org delete scratch\` via \`execCommand\`.
- **Scratch Org Creation:** To replenish the pool, it spawns new child processes that run the \`sf hardis:scratch:create --pool\` command. This allows for parallel creation of multiple scratch orgs.
- **Error Handling:** It includes error handling for scratch org creation failures, logging them and updating the pool storage accordingly.
- **Logging:** Provides detailed logs about the status of scratch orgs (kept, deleted, created, failed creations) and a summary of the refresh operation.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:scratch:pool:refresh --agent
\`\`\`

In agent mode, all interactive prompts are skipped and default values are used.

`;

  public static examples = ['$ sf hardis:scratch:pool:refresh',
    '$ sf hardis:scratch:pool:refresh --agent',];

  // public static args = [{name: 'file'}];

  public static flags: any = {
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
    'target-dev-hub': requiredHubFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  private debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ScratchPoolRefresh);
    this.debugMode = flags.debug || false;

    // Check pool configuration is defined on project
    const config = await getConfig('project');
    if (config.poolConfig == null) {
      uxLog(
        "warning",
        this,
        c.yellow(t('configFileMustContainPoolConfigProperty')) +
        '\n' +
        c.grey(JSON.stringify(config, null, 2))
      );
      return { outputString: 'Configuration file must contain a poolConfig property' };
    }

    const maxScratchOrgsNumber = config.poolConfig.maxScratchOrgsNumber || 5;
    const maxScratchOrgsNumberToCreateOnce = config.poolConfig.maxScratchOrgsNumberToCreateOnce || 10;
    uxLog("log", this, c.grey(t('poolConfig') + JSON.stringify(config.poolConfig)));

    // Get the scratch orgs of the pool
    const poolOptions = {
      devHubConn: flags['target-dev-hub'].getConnection(),
      devHubUsername: flags['target-dev-hub'].getUsername(),
    };
    await preparePoolRefresh(poolOptions);
    let scratchOrgs = await listPoolOrgs(poolOptions);

    /* jscpd:ignore-end */
    // Clean expired orgs
    const minScratchOrgRemainingDays = config.poolConfig.minScratchOrgRemainingDays || 25;
    const scratchOrgsToDelete: any[] = [];
    scratchOrgs = scratchOrgs.filter((scratchOrg) => {
      const expiration = dateHelper(scratchOrg?.authFileJson?.result?.expirationDate);
      const today = dateHelper();
      const daysBeforeExpiration = expiration.diff(today, 'days');
      if (daysBeforeExpiration < minScratchOrgRemainingDays) {
        scratchOrg.daysBeforeExpiration = daysBeforeExpiration;
        scratchOrgsToDelete.push(scratchOrg);
        uxLog(
          "log",
          this,
          c.grey(
            t('scratchOrgWillBeDeletedDaysRemaining', { instanceUrl: scratchOrg?.authFileJson?.result?.instanceUrl, days: daysBeforeExpiration, expirationDate: scratchOrg?.authFileJson?.result?.expirationDate })
          )
        );
        return false;
      }
      uxLog(
        "log",
        this,
        c.grey(
          t('scratchOrgWillBeKeptDaysRemaining', { instanceUrl: scratchOrg?.authFileJson?.result?.instanceUrl, days: daysBeforeExpiration, expirationDate: scratchOrg?.authFileJson?.result?.expirationDate })
        )
      );
      return true;
    });
    // Delete expired orgs and update pool if found
    if (scratchOrgsToDelete.length > 0) {
      await removePoolOrgs(scratchOrgsToDelete, poolOptions);
      for (const scratchOrgToDelete of scratchOrgsToDelete) {
        // Authenticate to scratch org to delete
        await authenticateWithSfdxUrlStore(scratchOrgToDelete);
        // Delete scratch org
        const deleteCommand = `sf org delete scratch --no-prompt --target-org ${scratchOrgToDelete.scratchOrgUsername}`;
        await execCommand(deleteCommand, this, { fail: false, debug: this.debugMode, output: true });
        uxLog(
          "action",
          this,
          c.cyan(
            t('scratchOrgDeletedDaysRemaining', { username: c.green(scratchOrgToDelete.scratchOrgUsername), instanceUrl: scratchOrgToDelete?.authFileJson?.result?.instanceUrl, days: scratchOrgToDelete.daysBeforeExpiration })
          )
        );
      }
    }

    // Create new scratch orgs
    const numberOfOrgsToCreate = Math.min(maxScratchOrgsNumber - scratchOrgs.length, maxScratchOrgsNumberToCreateOnce);
    uxLog("action", this, c.cyan(t('creating') + numberOfOrgsToCreate + ' scratch orgs...'));
    let numberCreated = 0;
    let numberfailed = 0;
    const subProcesses: any[] = [];
    for (let i = 0; i < numberOfOrgsToCreate; i++) {
      // eslint-disable-next-line no-async-promise-executor
      const spawnPromise = new Promise(async (resolve) => {
        // Run scratch:create command asynchronously
        const commandArgs = ['hardis:scratch:create', '--pool', '--json'];
        const sfdxPath = await which('sf');
        const childEnv = Object.assign({}, process.env);
        applySfPerformanceEnv('sf ' + commandArgs.join(' '), childEnv);
        // On Windows sf is sf.cmd, which Node only spawns through a shell (spawn EINVAL otherwise).
        // The shell finds sf in the PATH: its path, which can hold spaces, is not passed to it.
        const isWindows = process.platform === 'win32';
        const child = spawn(isWindows ? 'sf' : sfdxPath || 'sf', commandArgs, {
          cwd: process.cwd(),
          env: childEnv,
          shell: isWindows,
        });
        uxLog("log", this, '[pool] ' + c.grey(t('hardisScratchCreateStarted', { value: i })));
        // handle errors
        child.on('error', (err) => {
          resolve({ code: 1, result: { error: err } });
        });
        // Store data
        let stdout = '';
        child.stdout.on('data', (data) => {
          stdout += data.toString();
          if (this.debugMode === true) {
            uxLog("other", this, data.toString());
          }
        });
        // Handle end of command
        child.on('close', async (code) => {
          const colorFunc = code === 0 ? c.green : c.red;
          uxLog("action", this, '[pool] ' + colorFunc(`hardis:scratch:create (${i}) exited with code ${c.bold(code)}`));
          if (code !== 0) {
            uxLog("warning", this, `Return code is not 0 (${i}): ` + c.grey(stdout));
            numberfailed++;
          } else {
            numberCreated++;
          }
          let result: any = {};
          stdout = stripAnsi(stdout);
          try {
            result = JSON.parse(stdout);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (e) {
            result = { result: { status: 1, rawLog: stdout } };
            uxLog("warning", this, c.yellow(`Error parsing stdout (${i}): ` + stdout));
          }
          const scratchOrgResult = result.result || result;
          // A storage error must not leave this promise pending: the refresh would never end
          try {
            await addScratchOrgToPool(scratchOrgResult);
            if (scratchOrgResult.status !== 0) {
              // Only the message of the command: its raw output can hold usernames or URLs, and the
              // failure is readable by anyone who can read the pool
              await recordPoolFailure(String(result.message || scratchOrgResult.message || 'Scratch org creation failed, see the log of the job'), poolOptions);
            }
          } catch (e) {
            uxLog("warning", this, c.yellow('[pool] ' + t('poolScratchOrgNotAdded', { message: (e as Error).message })));
            if (code === 0) {
              numberCreated--;
              numberfailed++;
            }
          }
          resolve({ code, result: result });
        });
      });
      subProcesses.push(spawnPromise);
    }

    // Await parallel scratch org creations are completed
    const createResults = await Promise.all(subProcesses);
    if (this.debugMode) {
      uxLog("log", this, c.grey(t('createResults') + JSON.stringify(createResults, null, 2)));
    }

    // Let the storage clean itself and record this refresh
    await finalizePoolRefresh(poolOptions);

    const colorFunc = numberCreated === numberOfOrgsToCreate ? c.green : numberCreated === 0 ? c.red : c.yellow;
    uxLog(
      "action",
      this,
      '[pool] ' +
      colorFunc(t('poolCreatedScratchOrgs', { numberCreated: c.bold(numberCreated), numberFailed: c.bold(numberfailed) }))
    );
    // Return an object to be displayed with --json
    return {
      outputString: 'Refreshed scratch orgs pool',
      createResults: createResults,
      numberCreated: numberCreated,
      numberFailed: numberfailed,
    };
  }
}
