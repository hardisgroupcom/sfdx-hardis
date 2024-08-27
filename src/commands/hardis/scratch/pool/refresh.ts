/* jscpd:ignore-start */
import { spawn } from "child_process";
import c from "chalk";

import * as which from "which";
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { addScratchOrgToPool, getPoolStorage, setPoolStorage } from "../../../../common/utils/poolUtils.js";
import { getConfig } from "../../../../config/index.js";
import { execCommand, stripAnsi, uxLog } from "../../../../common/utils/index.js";
import moment from "moment";
import { authenticateWithSfdxUrlStore } from "../../../../common/utils/orgUtils.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ScratchPoolRefresh extends SfCommand<any> {
  public static title = "Refresh scratch org pool";

  public static description = "Create enough scratch orgs to fill the pool";

  public static examples = ["$ sf hardis:scratch:pool:refresh"];

  // public static args = [{name: 'file'}];

  public static flags = {
    debug: Flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description: "Skip authentication check when a default username is required",
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
    const config = await getConfig("project");
    if (config.poolConfig == null) {
      uxLog(this, c.yellow("Configuration file must contain a poolConfig property") + "\n" + c.grey(JSON.stringify(config, null, 2)));
      return { outputString: "Configuration file must contain a poolConfig property" };
    }

    const maxScratchOrgsNumber = config.poolConfig.maxScratchOrgsNumber || 5;
    const maxScratchOrgsNumberToCreateOnce = config.poolConfig.maxScratchOrgsNumberToCreateOnce || 10;
    uxLog(this, c.grey("Pool config: " + JSON.stringify(config.poolConfig)));

    // Get pool storage
    const poolStorage = await getPoolStorage({ devHubConn: flags['target-dev-hub'].getConnection(), devHubUsername: flags['target-dev-hub'].getUsername() });
    let scratchOrgs = poolStorage.scratchOrgs || [];

    /* jscpd:ignore-end */
    // Clean expired orgs
    const minScratchOrgRemainingDays = config.poolConfig.minScratchOrgRemainingDays || 25;
    const scratchOrgsToDelete: any[] = [];
    scratchOrgs = scratchOrgs.filter((scratchOrg) => {
      const expiration = moment(scratchOrg?.authFileJson?.result?.expirationDate);
      const today = moment();
      const daysBeforeExpiration = expiration.diff(today, "days");
      if (daysBeforeExpiration < minScratchOrgRemainingDays) {
        scratchOrg.daysBeforeExpiration = daysBeforeExpiration;
        scratchOrgsToDelete.push(scratchOrg);
        uxLog(
          this,
          c.grey(
            `Scratch org ${scratchOrg?.authFileJson?.result?.instanceUrl} will be deleted as it has only ${daysBeforeExpiration} remaining days (expiration on ${scratchOrg?.authFileJson?.result?.expirationDate})`,
          ),
        );
        return false;
      }
      uxLog(
        this,
        c.grey(
          `Scratch org ${scratchOrg?.authFileJson?.result?.instanceUrl} will be kept as it still has ${daysBeforeExpiration} remaining days (expiration on ${scratchOrg?.authFileJson?.result?.expirationDate})`,
        ),
      );
      return true;
    });
    // Delete expired orgs and update pool if found
    if (scratchOrgsToDelete.length > 0) {
      poolStorage.scratchOrgs = scratchOrgs;
      await setPoolStorage(poolStorage, { devHubConn: flags['target-dev-hub'].getConnection(), devHubUsername: flags['target-dev-hub'].getUsername() });
      for (const scratchOrgToDelete of scratchOrgsToDelete) {
        // Authenticate to scratch org to delete
        await authenticateWithSfdxUrlStore(scratchOrgToDelete);
        // Delete scratch org
        const deleteCommand = `sf org delete scratch --no-prompt --target-org ${scratchOrgToDelete.scratchOrgUsername}`;
        await execCommand(deleteCommand, this, { fail: false, debug: this.debugMode, output: true });
        uxLog(
          this,
          c.cyan(
            `Scratch org ${c.green(scratchOrgToDelete.scratchOrgUsername)} at ${scratchOrgToDelete?.authFileJson?.result?.instanceUrl
            } has been deleted because only ${scratchOrgToDelete.daysBeforeExpiration} days were remaining.`,
          ),
        );
      }
    }

    // Create new scratch orgs
    const numberOfOrgsToCreate = Math.min(maxScratchOrgsNumber - scratchOrgs.length, maxScratchOrgsNumberToCreateOnce);
    uxLog(this, c.cyan("Creating " + numberOfOrgsToCreate + " scratch orgs..."));
    let numberCreated = 0;
    let numberfailed = 0;
    const subProcesses: any[] = [];
    for (let i = 0; i < numberOfOrgsToCreate; i++) {
      // eslint-disable-next-line no-async-promise-executor
      const spawnPromise = new Promise(async (resolve) => {
        // Run scratch:create command asynchronously
        const commandArgs = ["hardis:scratch:create", "--pool", "--json"];
        const sfdxPath = await which("sf");
        const child = spawn(sfdxPath || "sf", commandArgs, { cwd: process.cwd(), env: process.env });
        uxLog(this, "[pool] " + c.grey(`hardis:scratch:create (${i}) started`));
        // handle errors
        child.on("error", (err) => {
          resolve({ code: 1, result: { error: err } });
        });
        // Store data
        let stdout = "";
        child.stdout.on("data", (data) => {
          stdout += data.toString();
          if (this.debugMode === true) {
            uxLog(this, data.toString());
          }
        });
        // Handle end of command
        child.on("close", async (code) => {
          const colorFunc = code === 0 ? c.green : c.red;
          uxLog(this, "[pool] " + colorFunc(`hardis:scratch:create (${i}) exited with code ${c.bold(code)}`));
          if (code !== 0) {
            uxLog(this, `Return code is not 0 (${i}): ` + c.grey(stdout));
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
            uxLog(this, c.yellow(`Error parsing stdout (${i}): ` + stdout));
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
      uxLog(this, c.grey("Create results: \n" + JSON.stringify(createResults, null, 2)));
    }

    const colorFunc = numberCreated === numberOfOrgsToCreate ? c.green : numberCreated === 0 ? c.red : c.yellow;
    uxLog(this, "[pool] " + colorFunc(`Created ${c.bold(numberCreated)} scratch orgs (${c.bold(numberfailed)} creations(s) failed)`));
    // Return an object to be displayed with --json
    return { outputString: "Refreshed scratch orgs pool", createResults: createResults, numberCreated: numberCreated, numberFailed: numberfailed };
  }
}
