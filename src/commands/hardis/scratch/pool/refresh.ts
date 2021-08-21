/* jscpd:ignore-start */
import { spawn } from "child_process";
import * as c from 'chalk';
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { getPoolStorage } from "../../../../common/utils/poolUtils";
import { getConfig } from "../../../../config";
import { uxLog } from "../../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ScratchPoolRefresh extends SfdxCommand {
  public static title = "Refresh scratch org pool";

  public static description = "Create enough scratch orgs to fill the pool";

  public static examples = ["$ sfdx hardis:scratch:pool:refresh"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  /* jscpd:ignore-end */
  private debugMode = false;

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;

    // Check pool configuration is defined on project
    const config = await getConfig("project");
    if (config.poolConfig == null) {
      return { outputString: "Configuration file must contain a poolConfig property" }
    }
    const maxScratchsOrgsNumber = config.pullConfig.maxScratchsOrgsNumber || 5;

    // Get pool storage
    const poolStorage = await getPoolStorage();
    const scratchOrgs = poolStorage.scratchOrgs || [];

    // Clean expired orgs
    // Not implemented yet

    // Create new scratch orgs
    const numberOfOrgsToCreate = maxScratchsOrgsNumber - scratchOrgs.length;
    const subProcesses = [];
    for (let i = 0; i < numberOfOrgsToCreate; i++) {
      const spawnPromise = new Promise((resolve) => {
        // Run scratch:create command asynchronously
        const commandArgs = ['hardis:scratch:create', '--pool', '--json'];
        const child = spawn('sfdx',commandArgs);
        uxLog(this, c.grey(`[pool] hardis:scratch:create (${i}) started`));
        // Store data
        let stdout = '';
        child.stdout.on('data', (data) => {
          stdout += data.toString();
          if (this.debugMode === true) {
            console.log(data);
          }
        });
        // Handle end of command
        child.on('close', (code) => {
          uxLog(this, c.grey(`[pool] hardis:scratch:create (${i}) exited with code ${c.bold(code)}`));
          let result: any = {} ;
          try {
            result = JSON.parse(stdout);
          } catch (e) {
            result.rawLog = stdout
          }
          resolve({code,result: result});
        });
      });
      subProcesses.push(spawnPromise);
    }
    // Away parallel scratch org creations are completed
    const createResults = await Promise.all(subProcesses);

    // Return an object to be displayed with --json
    return { outputString: "Refreshed scratch orgs pool", createResult: createResults };
  }
}
