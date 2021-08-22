/* jscpd:ignore-start */
import * as c from 'chalk';
import * as crypto from 'crypto';
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { getConfig, setConfig } from "../../../../config";
import { prompts } from '../../../../common/utils/prompts';
import axios from 'axios';
import { uxLog } from '../../../../common/utils';
import { setPoolStorage } from '../../../../common/utils/poolUtils';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ScratchPoolConfigure extends SfdxCommand {
  public static title = "Configure scratch org pool";

  public static description = "Configure information to build a scratch org pool";

  public static examples = ["$ sfdx hardis:scratch:pool:configure"];

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

  public async run(): Promise<AnyJson> {

    // Get pool configuration
    const config = await getConfig("project");
    const poolConfig = config.poolConfig || {};

    // Tell user if he/she's about to overwrite existing configuration
    if (config.poolConfig && Object.keys(poolConfig).length > 0) {
      uxLog(this, c.yellow("This command will overwrite existing scratch org pool configuration, are you sure ? If no you may exit this command and directly update .sfdx-hardis.yml"));
    }

    const response = await prompts([
      {
        type: "select",
        name: "storageService",
        message: c.cyanBright("What storage service do you want to use for your scratch orgs pool ?"),
        initial: 0,
        choices: [
          {
            title: "kvdb.io",
            value: "kvdb.io",
          },
          {
            title: "keyvalue.xyz",
            value: "keyvalue.xyz",
          },
          {
            title: "Local file for testing (won't work in CI)",
            value: "localtest"
          },
        ],
      },
      {
        type: "number",
        name: "maxScratchsOrgsNumber",
        message: c.cyanBright("What is the maximum number of scratch orgs in the pool ?"),
        initial: poolConfig.maxScratchsOrgsNumber || 5
      },
    ]);

    // Manage keyvalue.xyz bucket creation
    if (response.storageService === "keyvalue.xyz" && !poolConfig.keyValueXyzApiKey) {
      const projectName = config.projectName || 'default';
      const keyValueUrl = `https://api.keyvalue.xyz/new/pool_${projectName}`;
      const resp = await axios({
        method: "post",
        url: keyValueUrl,
        responseType: "json"
      });
      const keyValueXyzApiKey = resp.data;
      await setConfig("user", { keyValueXyzApiKey: keyValueXyzApiKey });
      uxLog(this, c.cyan("Created new keyvalue.xyz API key and stored in local untracked config"));
      uxLog(this, c.yellow(`In future CI config, set protected variable ${c.bold(c.green('KEY_VALUE_XYZ_API_KEY = ' + keyValueXyzApiKey))}`));
    }

    // Manage kvdb.io bucket creation
    if (response.storageService === "kvdb.io" && !poolConfig.keyValueXyzApiKey) {
      const projectName = config.projectName || 'default';
      const randomSecretKey = crypto.randomBytes(48).toString('hex');
      const kvdbIoUrl = `https://kvdb.io/`;
      const resp = await axios({
        method: "post",
        url: kvdbIoUrl,
        responseType: "json",
        data: {
          email: `${projectName}@hardis-scratch-org-pool.com`,
          secret_key: randomSecretKey
        }
      });
      const kvdbIoBucketId = resp.data;
      await setConfig("user", { kvdbIoSecretKey: randomSecretKey, kvdbIoBucketId: kvdbIoBucketId });
      await setPoolStorage({});
      uxLog(this, c.cyan("Created new kvdb.io bucket and stored in local untracked config"));
      uxLog(this, c.yellow(`In future CI config, set protected variables ${c.bold(c.green('KVDB_IO_SECRET_KEY = ' + randomSecretKey))} and ${c.bold(c.green('KVDB_IO_BUCKET_ID = ' + kvdbIoBucketId))}`));
    }

    // Store updated config
    poolConfig.maxScratchsOrgsNumber = response.maxScratchsOrgsNumber
    poolConfig.storageService = response.storageService;
    await setConfig("project", { poolConfig: poolConfig });

    // Return an object to be displayed with --json
    return { outputString: "Configured scratch orgs pool" };
  }
}
