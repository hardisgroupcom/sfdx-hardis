/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as ora from "ora";
import * as path from "path";

import { execCommand, uxLog } from "../../../common/utils";
import { prompts } from "../../../common/utils/prompts";
import { MetadataUtils } from "../../../common/metadata-utils";
import { glob } from "glob";
import { GLOB_IGNORE_PATTERNS } from "../../../common/utils/projectUtils";
import { applyAllReplacementsDefinitions } from "../../../common/utils/xmlUtils";

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

  public static examples = ["$ sf hardis:misc:purge-references"];

  protected static flagsConfig = {
    references: flags.string({
      char: "r",
      description: "Comma-separated list of references to find in metadatas",
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
  private ignorePatterns: string[] = GLOB_IGNORE_PATTERNS;
  protected referenceStrings: string[] = [];
  protected referenceStringsLabel: string;
  protected allMatchingSourceFiles: string[] = [];
  protected spinner: ora.Ora;

  public async run(): Promise<AnyJson> {
    uxLog(this, c.yellow(c.bold(PurgeRef.description)));

    // Collect input parameters
    this.referenceStrings = (this.flags?.references || "").split(",");
    if (this.referenceStrings.length == 1 && this.referenceStrings[0] === "") {
      const refPromptResult = await prompts({
        type: "text",
        message: "Please input a comma-separated list of strings that you want to purge (example: Affaire__c)",
      });
      this.referenceStrings = refPromptResult.value.split(",");
    }
    if (this.referenceStrings.length == 1 && this.referenceStrings[0] === "") {
      throw new SfError("You must input at least one string to check for references");
    }
    for (const refString of this.referenceStrings) {
      if (refString.endsWith("__c") && !this.referenceStrings.includes(refString.replace("__c", "__r"))) {
        this.referenceStrings.push(refString.replace("__c", "__r"));
      }
    }
    this.referenceStringsLabel = this.referenceStrings.join(",");

    // Retrieve metadatas if necessary
    const retrieveNeedRes = await prompts({
      type: "select",
      message: `Are your local sources up to date with target org ${this.org.getUsername()}, or do you need to retrieve some of them ?`,
      choices: [
        { value: true, title: "My local sfdx sources are up to date with the target org" },
        { value: false, title: "I need to retrieve metadatas :)" },
      ],
    });
    if (retrieveNeedRes.value === false) {
      const metadatas = await MetadataUtils.promptMetadataTypes();
      const metadataArg = metadatas.map((metadataType: any) => metadataType.xmlName).join(" ");
      await execCommand(`sf project retrieve start --ignore-conflicts --metadata ${metadataArg}`, this, { fail: true });
    }

    // Find sources that contain references
    this.spinner = ora({ text: `Browsing sources to find references to ${this.referenceStringsLabel}...`, spinner: "moon" }).start();
    const packageDirectories = this.project.getPackageDirectories();
    this.allMatchingSourceFiles = [];
    for (const packageDirectory of packageDirectories) {
      const sourceFiles = await glob("*/**/*.{cls,trigger,xml}", { ignore: this.ignorePatterns, cwd: packageDirectory.fullPath });
      const matchingSourceFiles = sourceFiles
        .filter((sourceFile) => {
          sourceFile = path.join(packageDirectory.path, sourceFile);
          const fileContent = fs.readFileSync(sourceFile, "utf8");
          return this.referenceStrings.some((refString) => fileContent.includes(refString));
        })
        .map((sourceFile) => path.join(packageDirectory.path, sourceFile));
      this.allMatchingSourceFiles.push(...matchingSourceFiles);
    }
    this.spinner.succeed(`Found ${this.allMatchingSourceFiles.length} sources with references`);
    this.allMatchingSourceFiles.sort();
    uxLog(this, "Matching files:\n" + c.grey(this.allMatchingSourceFiles.join("\n")));

    // Handling Apex classes
    await applyAllReplacementsDefinitions(this.allMatchingSourceFiles, this.referenceStrings, this.getAllReplacements());

    return { message: "Command completed" };
  }

  private getAllReplacements() {
    return [
      // Apex
      {
        extensions: [".cls", ".trigger"],
        label: "Apex",
        type: "code",
        replaceMode: ["line"],
        refRegexes: [
          // , REF ,
          { regex: `,{{REF}},`, replace: "," },
          { regex: `, {{REF}},`, replace: "," },
          { regex: `,{{REF}} ,`, replace: "," },
          { regex: `, {{REF}} ,`, replace: "," },
          // , REF = xxx ,
          { regex: `,{{REF}}[ |=].+\\,`, replace: "," },
          { regex: `, {{REF}}[ |=].+\\,`, replace: "," },
          { regex: `,{{REF}}[ |=].+\\, `, replace: "," },
          { regex: `, {{REF}}[ |=].+\\ ,`, replace: "," },
          // , REF = xxx )
          { regex: `,{{REF}}[ |=].+\\)`, replace: ")" },
          { regex: `, {{REF}}[ |=].+\\)`, replace: ")" },
          // REF = xxx ,
          { regex: `{{REF}}[ |=].+\\)`, replace: ")" },
        ],
      }
    ];
  }
}
