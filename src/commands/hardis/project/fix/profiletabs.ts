/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { glob } from 'glob';
import sortArray from 'sort-array';
import { uxLog } from '../../../../common/utils/index.js';
import { soqlQueryTooling } from '../../../../common/utils/apiUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { parseXmlFile, writeXmlFile } from '../../../../common/utils/xmlUtils.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class FixV53Flexipages extends SfCommand<any> {
  public static title = 'Fix profiles to add tabs that are not retrieved by SF CLI';

  public static description: string = `
## Command Behavior

**Interactively updates tab visibility settings in Salesforce profiles, addressing a common issue where tab visibilities are not correctly retrieved by \`sf project retrieve start\`.**

This command provides a user-friendly interface to manage tab settings within your profile XML files, ensuring that your local project accurately reflects the intended tab configurations in your Salesforce org.

Key functionalities:

- **Interactive Tab Selection:** Displays a multi-select menu of all available tabs in your org, allowing you to choose which tabs to update.
- **Visibility Control:** Lets you set the visibility for the selected tabs to either \`DefaultOn\` (Visible) or \`Hidden\`.
- **Profile Selection:** Presents a multi-select menu of all .profile-meta.xml files in your project, allowing you to apply the tab visibility changes to specific profiles.
- **XML Updates:** Modifies the <tabVisibilities> section of the selected profile XML files to reflect the chosen tab settings. If a tab visibility setting already exists for a selected tab, it will be updated; otherwise, a new one will be added.
- **Sorted Output:** The <tabVisibilities> in the updated profile XML files are sorted alphabetically for consistency and readability.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Queries (Tooling API):** It queries the \`TabDefinition\` object using \`soqlQueryTooling\` to retrieve a list of all available tabs in the target org.
- **File Discovery:** Uses \`glob\` to find all .profile-meta.xml files within the specified project path.
- **Interactive Prompts:** Leverages the \`prompts\` library to create interactive menus for selecting tabs, visibility settings, and profiles.
- **XML Parsing and Manipulation:** Uses \`parseXmlFile\` to read the content of profile XML files and \`writeXmlFile\` to write the modified content back. It manipulates the \`tabVisibilities\` array within the parsed XML to add or update tab settings.
- **Array Sorting:** Employs the \`sort-array\` library to sort the \`tabVisibilities\` alphabetically by tab name.
- **Logging:** Provides feedback to the user about which profiles have been updated and a summary of the changes.
</details>
`;


  public static examples = ['$ sf hardis:project:fix:profiletabs'];

  public static flags: any = {
    path: Flags.string({
      char: 'p',
      default: process.cwd(),
      description: 'Root folder',
    }),
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
    'target-org': requiredOrgFlagWithDeprecations,
  }; // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected pathToBrowse: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FixV53Flexipages);
    this.pathToBrowse = flags.path || process.cwd();
    this.debugMode = flags.debug || false;

    /* jscpd:ignore-end */

    // List available tabs in org
    const tabsRequest = 'SELECT Label,DurableId,Name,SobjectName FROM TabDefinition ORDER BY Label';
    const tabsResult = await soqlQueryTooling(tabsRequest, (flags['target-org'] as any).getConnection());
    const choices = tabsResult.records.map((tab) => {
      return {
        title: `${tab.Label} (${tab.Name} on SObject ${tab.SobjectName})}`,
        value: tab.Name,
      };
    });

    // Prompt tabs to add to Profiles
    const promptTabsToAdd = await prompts([
      {
        type: 'multiselect',
        name: 'tabs',
        message: 'Please select the tabs you want to display or hide in Profile(s)',
        description: 'Choose which tabs should be configured for profiles',
        choices: choices,
      },
      {
        type: 'select',
        name: 'visibility',
        message: 'Please select the flag you want the tabs to be applied on profiles you will select',
        description: 'Choose the visibility setting for the selected tabs',
        placeholder: 'Select visibility',
        choices: [
          {
            title: 'Visible (DefaultOn)',
            value: 'DefaultOn',
          },
          {
            title: 'Hidden',
            value: 'Hidden',
          },
        ],
      },
    ]);

    const tabsToUpdate = promptTabsToAdd.tabs;
    const visibility = promptTabsToAdd.visibility;

    // Prompt profiles to user
    const globPattern = this.pathToBrowse + `/**/*.profile-meta.xml`;
    const profileSourceFiles = await glob(globPattern, { cwd: this.pathToBrowse, ignore: GLOB_IGNORE_PATTERNS });
    const promptProfilesToUpdate = await prompts({
      type: 'multiselect',
      name: 'profiles',
      message:
        'Please select the profiles you want to update to apply tabs [' +
        tabsToUpdate.join(', ') +
        '] with visibility ' +
        visibility,
      description: 'Choose which profiles should receive the tab visibility updates',
      choices: profileSourceFiles.map((profileFile) => {
        return {
          title: (profileFile.replace(/\\/g, '/').split('/').pop() || '').replace('.profile-meta.xml', ''),
          value: profileFile,
        };
      }),
    });

    // Apply updates on Profiles
    for (const profileFile of promptProfilesToUpdate.profiles) {
      const profile = await parseXmlFile(profileFile);
      let tabVisibilities = profile.Profile['tabVisibilities'] || [];
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
          by: ['key'],
          order: ['asc'],
        }
      ).map((sorted: any) => sorted.value);
      profile.Profile['tabVisibilities'] = sortedTabVisibility;
      // Update Profile XML File
      await writeXmlFile(profileFile, profile);
      uxLog("log", this, c.grey('Updated ' + profileFile));
    }

    // Summary
    const msg = `Updated ${c.green(c.bold(promptProfilesToUpdate.profiles.length))} profiles.`;
    uxLog("action", this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg, updatedNumber: promptProfilesToUpdate.profiles.length };
  }
}
