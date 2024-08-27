/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { uxLog } from "../../../../common/utils/index.js";
import { restoreListViewMine } from "../../../../common/utils/orgConfigUtils";
import { getConfig } from "../../../../config/index.js";
import c from "chalk";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class FixListViewMine extends SfCommand<any> {
  public static title = "Fix listviews with ";

  public static description = `Fix listviews whose scope Mine has been replaced by Everything

[![Invalid scope:Mine, not allowed ? Deploy your ListViews anyway !](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-invalid-scope-mine.jpg)](https://nicolas.vuillamy.fr/invalid-scope-mine-not-allowed-deploy-your-listviews-anyway-443aceca8ac7)

List of ListViews can be:

- read from .sfdx-hardis.yml file in property **listViewsToSetToMine**
- sent in argument listviews

Note: property **listViewsToSetToMine** can be auto-generated by command hardis:work:save if .sfdx-hardis.yml contains the following configuration

\`\`\`yaml
autoCleanTypes:
  - listViewsMine
\`\`\`

- Example of sfdx-hardis.yml property \`listViewsToSetToMine\`:

\`\`\`yaml
listViewsToSetToMine:
  - "force-app/main/default/objects/Operation__c/listViews/MyCurrentOperations.listView-meta.xml"
  - "force-app/main/default/objects/Operation__c/listViews/MyFinalizedOperations.listView-meta.xml"
  - "force-app/main/default/objects/Opportunity/listViews/Default_Opportunity_Pipeline.listView-meta.xml"
  - "force-app/main/default/objects/Opportunity/listViews/MyCurrentSubscriptions.listView-meta.xml"
  - "force-app/main/default/objects/Opportunity/listViews/MySubscriptions.listView-meta.xml"
  - "force-app/main/default/objects/Account/listViews/MyActivePartners.listView-meta.xml"
\`\`\`

- If manually written, this could also be:

\`\`\`yaml
listViewsToSetToMine:
  - "Operation__c:MyCurrentOperations"
  - "Operation__c:MyFinalizedOperations"
  - "Opportunity:Default_Opportunity_Pipeline"
  - "Opportunity:MyCurrentSubscriptions"
  - "Opportunity:MySubscriptions"
  - "Account:MyActivePartners"
\`\`\`

Troubleshooting: if you need to run this command from an alpine-linux based docker image, use this workaround in your dockerfile:

\`\`\`dockerfile
# Do not use puppeteer embedded chromium
RUN apk add --update --no-cache chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"
ENV CHROMIUM_PATH="/usr/bin/chromium-browser"
ENV PUPPETEER_EXECUTABLE_PATH="$\\{CHROMIUM_PATH}" // remove \\ before {
\`\`\`
`;

  public static examples = [
    "$ sf hardis:org:fix:listviewmine",
    "$ sf hardis:org:fix:listviewmine --listviews Opportunity:MySubscriptions,Account:MyActivePartners",
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    listviews: Flags.string({
      char: "l",
      description: `Comma-separated list of listviews following format Object:ListViewName\nExample: Contact:MyContacts,Contact:MyActiveContacts,Opportunity:MYClosedOpportunities`,
    }),
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
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected debugMode = false;

  protected listViewsStrings: Array<string> = [];

  /* jscpd:ignore-end */
  public async run(): Promise<AnyJson> {
    this.debugMode = flags.debug || false;

    uxLog(this, c.cyan("Setting back listviews to Mine instead of Everything..."));

    // Identify listviews to process
    if (flags.listviews) {
      // Use input flag
      this.listViewsStrings = flags.listviews.split(",");
    } else {
      // Use property listViewsToSetToMine from .sfdx-hardis.yml config file
      const config = await getConfig("project");
      this.listViewsStrings = config.listViewsToSetToMine || [];
    }

    const result = await restoreListViewMine(this.listViewsStrings, this.org.getConnection(), { debug: this.debugMode });
    return result;
  }
}
