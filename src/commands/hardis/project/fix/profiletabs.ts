/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { glob } from "glob";
import * as sortArray from "sort-array";
import { uxLog } from "../../../../common/utils";
import { soqlQueryTooling } from "../../../../common/utils/apiUtils";
import { prompts } from "../../../../common/utils/prompts";
import { parseXmlFile, writeXmlFile } from "../../../../common/utils/xmlUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class FixV53Flexipages extends SfdxCommand {
  public static title = "Fix profiles to add tabs that are not retrieved by SF CLI";

  public static description = `Interactive prompts to add tab visibilities that are not retrieved by force:source:pull`;

  public static examples = ["$ sfdx hardis:project:fix:profiletabs"];

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

    // List available tabs in org
    const tabsRequest = "SELECT Label,DurableId,Name,SobjectName FROM TabDefinition ORDER BY Label";
    const tabsResult = await soqlQueryTooling(tabsRequest, this.org.getConnection());
    const choices = tabsResult.records.map((tab) => {
      return {
        title: `${tab.Label} (${tab.Name} on SObject ${tab.SobjectName})}`,
        value: tab.Name,
      };
    });

    // Prompt tabs to add to Profiles
    const promptTabsToAdd = await prompts([
      {
        type: "multiselect",
        name: "tabs",
        message: "Please select the tabs you want to display or hide in Profile(s)",
        choices: choices,
      },
      {
        type: "select",
        name: "visibility",
        message: "Please select the flag you want the tabs to be applied on profiles you will select",
        choices: [
          {
            title: "Visible (DefaultOn)",
            value: "DefaultOn",
          },
          {
            title: "Hidden",
            value: "Hidden",
          },
        ],
      },
    ]);

    const tabsToUpdate = promptTabsToAdd.tabs;
    const visibility = promptTabsToAdd.visibility;

    // Prompt profiles to user
    const globPattern = this.pathToBrowse + `/**/*.profile-meta.xml`;
    const profileSourceFiles = await glob(globPattern, { cwd: this.pathToBrowse });
    const promptProfilesToUpdate = await prompts({
      type: "multiselect",
      name: "profiles",
      message: "Please select the profiles you want to update to apply tabs [" + tabsToUpdate.join(", ") + "] with visibility " + visibility,
      choices: profileSourceFiles.map((profileFile) => {
        return {
          title: profileFile.replace(/\\/g, "/").split("/").pop().replace(".profile-meta.xml", ""),
          value: profileFile,
        };
      }),
    });

    // Apply updates on Profiles
    for (const profileFile of promptProfilesToUpdate.profiles) {
      const profile = await parseXmlFile(profileFile);
      let tabVisibilities = profile.Profile["tabVisibilities"] || [];
      for (const tabName of tabsToUpdate) {
        // Update existing tabVisibility
        if (tabVisibilities.filter((tabVisibility) => tabVisibility.tab[0] === tabName).length > 0) {
          tabVisibilities = tabVisibilities.map((tabVisibility) => {
            if (tabVisibility.tab[0] === tabName) {
              tabVisibility.visibility = [visibility];
            }
            return tabVisibility;
          });
          continue;
        }
        //Add new visibility
        tabVisibilities.push({
          tab: [tabName],
          visibility: [visibility],
        });
      }
      // Sort items by name
      const sortedTabVisibility = sortArray(
        tabVisibilities.map((tabVisibility) => {
          return {
            key: tabVisibility.tab[0],
            value: tabVisibility,
          };
        }),
        {
          by: ["key"],
          order: ["asc"],
        },
      ).map((sorted) => sorted.value);
      profile.Profile["tabVisibilities"] = sortedTabVisibility;
      // Update Profile XML File
      await writeXmlFile(profileFile, profile);
      uxLog(this, c.grey("Updated " + profileFile));
    }

    // Summary
    const msg = `Updated ${c.green(c.bold(promptProfilesToUpdate.profiles.length))} profiles.`;
    uxLog(this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg, updatedNumber: promptProfilesToUpdate.profiles.length };
  }
}
