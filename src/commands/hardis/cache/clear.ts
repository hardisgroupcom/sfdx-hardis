/* jscpd:ignore-start */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { clearCache } from "../../../common/cache/index.js";
import { uxLog } from "../../../common/utils/index.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DxSources extends SfCommand<any> {
  public static title = "Clear sfdx-hardis cache";

  public static description = "Clear cache generated by sfdx-hardis";

  public static examples = ["$ sf hardis:cache:clear"];

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
  };  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    await clearCache();
    uxLog(this, "sfdx-hardis cache cleared");
    return {
      message: "sfdx-hardis cache cleared",
    };
  }
}
