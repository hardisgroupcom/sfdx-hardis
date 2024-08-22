/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as moment from "moment";
import * as ora from "ora";
import * as path from "path";
import * as readline from "readline";

import { stripAnsi, uxLog } from "../../../common/utils";
import { countLinesInFile } from "../../../common/utils/filesUtils";
import { getRecordTypeId } from "../../../common/utils/orgUtils";
import { prompts } from "../../../common/utils/prompts";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class PurgeRef extends SfdxCommand {
  public static title = "Purge References";

  public static description = `Purge references to any string in org metadatas before a deployment.

For example, this can be handy if you need to change the type of a custom field from Master Detail to Lookup.

USE WITH EXTREME CAUTION AND CAREFULLY READ THE MESSAGES !`;

  public static examples = [
    "$ sf hardis:misc:purge-references",
  ];

  protected static flagsConfig = {
    references: flags.string({
      char: "r",
      description: "Comma-separated list of references to find in metadatas",
      required: true,
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  /* jscpd:ignore-end */
  protected referenceStrings: string[] = [];

  public async run(): Promise<AnyJson> {
    uxLog(this, c.yellow(c.bold(PurgeRef.description)));
    // Collect input parameters
    this.referenceStrings = (this.flags.references || "").split(",");
    if (this.referenceStrings.length === 0) {
      const refPromptResult = await prompts({
        type: "text",
        message: "Please input a comma-separated list of strings that you want to purge (example: Affaire__c)",
      });
      this.referenceStrings = refPromptResult.value.split(",");
    }
    if (this.referenceStrings.length === 0) {
      throw new SfdxError("You must input at least one string to check for references");
    }

    // Retrieve metadatas if necessary
    const retrieveNeedRes = await prompts({
      type: "confirm",
      message: `Are your local sources up to date with target org ${this.org.getUsername()}, or do you need to retrieve some of them ?`,
    });
    this.referenceStrings = refPromptResult.value.split(",");    

    return {};
  }
}
