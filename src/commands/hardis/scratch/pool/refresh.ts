/* jscpd:ignore-start */
import { spawn } from 'child_process';
import c from 'chalk';

import which from 'which';
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { addScratchOrgToPool, getPoolStorage, setPoolStorage } from '../../../../common/utils/poolUtils.js';
import { getConfig } from '../../../../config/index.js';
import { execCommand, stripAnsi, uxLog } from '../../../../common/utils/index.js';
import moment from 'moment';
import { authenticateWithSfdxUrlStore } from '../../../../common/utils/orgUtils.js';

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

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It retrieves the \`poolConfig\` from the project's \`.sfdx-hardis.yml\` file to get parameters like \`maxScratchOrgsNumber\`, \`maxScratchOrgsNumberToCreateOnce\`, and \`minScratchOrgRemainingDays\`.
- **Pool Storage Interaction:** It uses \`getPoolStorage\` and \`setPoolStorage\` to interact with the configured storage service (e.g., Salesforce Custom Object, Redis) to retrieve and update the list of scratch orgs in the pool.
- **Expiration Check:** It calculates the remaining days for each scratch org in the pool using moment and flags those below the \`minScratchOrgRemainingDays\` threshold for deletion.
- **Scratch Org Deletion:** For expired orgs, it authenticates to them using \`authenticateWithSfdxUrlStore\` and then executes \`sf org delete scratch\` via \`execCommand\`.
- **Scratch Org Creation:** To replenish the pool, it spawns new child processes that run the \`sf hardis:scratch:create --pool\` command. This allows for parallel creation of multiple scratch orgs.
- **Error Handling:** It includes error handling for scratch org creation failures, logging them and updating the pool storage accordingly.
- **Logging:** Provides detailed logs about the status of scratch orgs (kept, deleted, created, failed creations) and a summary of the refresh operation.
</details>
`;

  public static examples = ['$ sf hardis:scratch:pool:refresh'];

  // public static args = [{name: 'file'}];

  public static flags: any = {
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
        c.yellow('Configuration file must contain a poolConfig property') +
        '\n' +
        c.grey(JSON.stringify(config, null, 2))
      );
      return { outputString: 'Configuration file must contain a poolConfig property' };
    }

    const maxScratchOrgsNumber = config.poolConfig.maxScratchOrgsNumber || 5;
    const maxScratchOrgsNumberToCreateOnce = config.poolConfig.maxScratchOrgsNumberToCreateOnce || 10;
    uxLog("log", this, c.grey('Pool config: ' + JSON.stringify(config.poolConfig)));

    // Get pool storage
    const poolStorage = await getPoolStorage({
      devHubConn: flags['target-dev-hub'].getConnection(),
      devHubUsername: flags['target-dev-hub'].getUsername(),
    });
    let scratchOrgs = poolStorage.scratchOrgs || [];

    /* jscpd:ignore-end */
    // Clean expired orgs
    const minScratchOrgRemainingDays = config.poolConfig.minScratchOrgRemainingDays || 25;
    const scratchOrgsToDelete: any[] = [];
    scratchOrgs = scratchOrgs.filter((scratchOrg) => {
      const expiration = moment(scratchOrg?.authFileJson?.result?.expirationDate);
      const today = moment();
      const daysBeforeExpiration = expiration.diff(today, 'days');
      if (daysBeforeExpiration < minScratchOrgRemainingDays) {
        scratchOrg.daysBeforeExpiration = daysBeforeExpiration;
        scratchOrgsToDelete.push(scratchOrg);
        uxLog(
          "log",
          this,
          c.grey(
            `Scratch org ${scratchOrg?.authFileJson?.result?.instanceUrl} will be deleted as it has only ${daysBeforeExpiration} remaining days (expiration on ${scratchOrg?.authFileJson?.result?.expirationDate})`
          )
        );
        return false;
      }
      uxLog(
        "log",
        this,
        c.grey(
          `Scratch org ${scratchOrg?.authFileJson?.result?.instanceUrl} will be kept as it still has ${daysBeforeExpiration} remaining days (expiration on ${scratchOrg?.authFileJson?.result?.expirationDate})`
        )
      );
      return true;
    });
    // Delete expired orgs and update pool if found
    if (scratchOrgsToDelete.length > 0) {
      poolStorage.scratchOrgs = scratchOrgs;
      await setPoolStorage(poolStorage, {
        devHubConn: flags['target-dev-hub'].getConnection(),
        devHubUsername: flags['target-dev-hub'].getUsername(),
      });
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
            `Scratch org ${c.green(scratchOrgToDelete.scratchOrgUsername)} at ${scratchOrgToDelete?.authFileJson?.result?.instanceUrl
            } has been deleted because only ${scratchOrgToDelete.daysBeforeExpiration} days were remaining.`
          )
        );
      }
    }

    // Create new scratch orgs
    const numberOfOrgsToCreate = Math.min(maxScratchOrgsNumber - scratchOrgs.length, maxScratchOrgsNumberToCreateOnce);
    uxLog("action", this, c.cyan('Creating ' + numberOfOrgsToCreate + ' scratch orgs...'));
    let numberCreated = 0;
    let numberfailed = 0;
    const subProcesses: any[] = [];
    for (let i = 0; i < numberOfOrgsToCreate; i++) {
      // eslint-disable-next-line no-async-promise-executor
      const spawnPromise = new Promise(async (resolve) => {
        // Run scratch:create command asynchronously
        const commandArgs = ['hardis:scratch:create', '--pool', '--json'];
        const sfdxPath = await which('sf');
        const child = spawn(sfdxPath || 'sf', commandArgs, { cwd: process.cwd(), env: process.env });
        uxLog("log", this, '[pool] ' + c.grey(`hardis:scratch:create (${i}) started`));
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
          await addScratchOrgToPool(result.result || result);
          resolve({ code, result: result });
        });
      });
      subProcesses.push(spawnPromise);
    }

    // Await parallel scratch org creations are completed
    const createResults = await Promise.all(subProcesses);
    if (this.debugMode) {
      uxLog("log", this, c.grey('Create results: \n' + JSON.stringify(createResults, null, 2)));
    }

    const colorFunc = numberCreated === numberOfOrgsToCreate ? c.green : numberCreated === 0 ? c.red : c.yellow;
    uxLog(
      "action",
      this,
      '[pool] ' +
      colorFunc(`Created ${c.bold(numberCreated)} scratch orgs (${c.bold(numberfailed)} creations(s) failed)`)
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
