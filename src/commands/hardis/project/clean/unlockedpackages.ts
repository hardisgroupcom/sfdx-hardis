/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { uxLog } from "../../../../common/utils";
import { soqlQueryTooling, describeGlobalTooling } from "../../../../common/utils/apiUtils";
import { prompts } from "../../../../common/utils/prompts";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class unlockedpackages extends SfdxCommand {
  public static title = "Clean installed unlocked packages";

  public static description = `Clean installed unlocked packages, such as those installed from unofficialSF`;

  public static examples = ["$ sfdx hardis:project:clean:unlockedpackages"];

  protected static flagsConfig = {
    path: flags.string({
      char: "p",
      default: process.cwd(),
      description: "Root folder",
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
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected pathToBrowse: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    this.pathToBrowse = this.flags.path || process.cwd();
    this.debugMode = this.flags.debug || false;

    /* jscpd:ignore-end */

    // List available unlocked packages in org
    const pkgsRequest = "SELECT SubscriberPackageId, SubscriberPackage.NamespacePrefix, SubscriberPackage.Name FROM InstalledSubscriberPackage ORDER BY SubscriberPackage.NamespacePrefix";
    const pkgsResult = await soqlQueryTooling(pkgsRequest, this.org.getConnection());
    const choices = pkgsResult.records
      .filter(pkg => pkg.SubscriberPackage.NamespacePrefix == null)
      .map((pkg) => ({
          title: pkg.SubscriberPackage.Name,
          value: pkg.SubscriberPackageId
      })
    );

    // Get All Org SObject with prefix key
    const describeObjResult = await describeGlobalTooling(this.org.getConnection());
    const orgPrefixKey = describeObjResult.sobjects.reduce((obj, item) => ({
        ...obj,
        [item.keyPrefix]: item.name
    }), {});

    //Prompt which package to clean up
    const promptUlpkgToClean = await prompts([
      {
        type: "select",
        name: "ulpkg",
        message: "Please select the package to clean out",
        choices: choices
      }
    ])

    const ulpkgToClean = promptUlpkgToClean.ulpkg;

    // Tooling query specific package
    const ulpkgRequest = `SELECT SubjectID, SubjectKeyPrefix FROM Package2Member WHERE SubscriberPackageId='${ulpkgToClean}'`
    const ulpkgQueryResult = await soqlQueryTooling(ulpkgRequest, this.org.getConnection());
    const memberExceptions =[];
    const ulpkgMembers = ulpkgQueryResult.records.map(member => ({
      SubjectId: member.SubjectId,
      SubjectKeyPrefix: member.SubjectKeyPrefix,
      ObjectName: orgPrefixKey[member.SubjectKeyPrefix]
    })).reduce((acc, { ObjectName, SubjectId }) => {
      if (ObjectName) {
        acc[ObjectName] = acc[ObjectName] || [];
        acc[ObjectName].push(SubjectId);
      } else {
        memberExceptions.push(SubjectId);
      }
      return acc;
    }, {});

    console.log(ulpkgMembers);
    console.log(memberExceptions);
    // Create json file

    // Do Clean


    // Summary
    const msg = `Cleaned ${c.green(c.bold(promptUlpkgToClean.ulpkg[0].title))}.`;
    uxLog(this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
