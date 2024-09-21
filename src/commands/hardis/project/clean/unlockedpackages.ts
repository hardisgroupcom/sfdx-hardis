/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Connection, Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { uxLog } from "../../../../common/utils";
import { soqlQueryTooling, describeGlobalTooling, toolingRequest } from "../../../../common/utils/apiUtils";
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
    const pkgsRequest = "SELECT SubscriberPackageId, SubscriberPackage.NamespacePrefix, SubscriberPackage.Name, SubscriberPackageVersionId FROM InstalledSubscriberPackage ORDER BY SubscriberPackage.NamespacePrefix";
    const pkgsResult = await soqlQueryTooling(pkgsRequest, this.org.getConnection());
    const choices = pkgsResult.records
      .filter(pkg => pkg.SubscriberPackage.NamespacePrefix == null)
      .map((pkg) => ({
          title: pkg.SubscriberPackage.Name,
          value: pkg.SubscriberPackageId,
          version: pkg.SubscriberPackageVersionId
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
        name: "packageId",
        message: "Please select the package to clean out",
        choices: choices
      }
    ])

    const chosenPackage = choices.filter(id => id.value == promptUlpkgToClean.packageId)[0]

    // Tooling query specific package
    const ulpkgQuery = `SELECT SubjectID, SubjectKeyPrefix FROM Package2Member WHERE SubscriberPackageId='${promptUlpkgToClean.packageId}'`
    const ulpkgQueryResult = await soqlQueryTooling(ulpkgQuery, this.org.getConnection());


    
    //create array of package members, looking up object name from orgPrefixKey
    const ulpkgMembers = ulpkgQueryResult.records.map(member => ({
      SubjectId: member.SubjectId,
      SubjectKeyPrefix: member.SubjectKeyPrefix,
      ObjectName: orgPrefixKey[member.SubjectKeyPrefix]
    })).filter(member => member.ObjectName !== undefined);

    //fetch metadata for package members
    const ulpkgMeta = await Promise.all(ulpkgMembers.map(async (member) => {
        const toolingQuery: [string, Connection, Record<string, unknown>] = [
          `sobjects/${member.ObjectName}/${member.SubjectId}`,
          this.org.getConnection(),
          {}
        ]
        const returnResponse: Record<string, unknown> = await toolingRequest(...toolingQuery)
        return {
          name: returnResponse.Name || returnResponse.DeveloperName,
          fullName: returnResponse.FullName
        }
    }));

    console.log(ulpkgMeta)

    // Create json file

    // Do Clean

    // Summary
    const msg = `Cleaned ${c.green(c.bold(chosenPackage.title))}.`;
    uxLog(this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
