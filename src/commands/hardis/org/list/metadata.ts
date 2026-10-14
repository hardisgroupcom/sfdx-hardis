import { Flags, requiredOrgFlagWithDeprecations, SfCommand } from '@salesforce/sf-plugins-core';
import { AnyJson } from '@salesforce/ts-types';
import { Messages, SfError } from '@salesforce/core';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { uxLogTableWithReport } from '../../../../common/utils/filesUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import { isMetadataType } from '../../../../common/utils/metadataDepsUtils.js';
import { isFolderType, listOrgMetadata } from '../../../../common/utils/metadataListingUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class HardisOrgListMetadata extends SfCommand<any> {
  public static title = 'List metadata components of an org';

  public static description = `
## Command Behavior

**Lists the metadata components of one type in an org, for scripts, agents and user interfaces.**

- **Any listable type:** Pass \`--type\` with a Metadata API type (ApexClass, Flow, CustomField, Layout...). The result holds the API name (\`fullName\`) and the Id of each component, sorted by name.
- **Folder types in two steps:** For Report, Dashboard, Document and EmailTemplate, \`--type\` alone lists the folders. Pass \`--folder\` to list the content of one folder, named \`Folder/Name\`.
- **Cached per org:** The listing is kept 30 days per org Id, and shared with [hardis:doc:metadata-deps](${'https://sfdx-hardis.cloudity.com/hardis/doc/metadata-deps/'}): a listing made by one command serves the other. Pass \`--refresh\` to list the org again.
- **Read-only:** Nothing is written in the org. A type the Metadata API cannot list (a Tooling-only type, a misspelled type) returns \`listable: false\` and no items instead of an error. Any other failure (expired session, network error, API limit) is an error.
- **Output:** Without \`--json\`, a table and a CSV/Excel report. With \`--json\`, only the JSON result: no table and no report file.

The VS Code extension uses it to suggest API names in the Metadata Dependencies panel.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:list:metadata --agent --type ApexClass --target-org myOrgAlias --json
\`\`\`

The command has no prompt: \`--type\` is required, and \`--agent\` only confirms the non-interactive use. Pair it with \`--json\`.

<details markdown="1">
<summary>Technical explanations</summary>

- The components come from the Metadata API \`listMetadata\` call. The folder types are the types marked \`inFolder\` in the metadata registry. Their folders come from \`ReportFolder\`, \`DashboardFolder\`, \`DocumentFolder\`, and both \`EmailFolder\` (Classic) and \`EmailTemplateFolder\` (Lightning) for email templates. \`unfiled$public\` is always offered for Reports, email templates and Documents, because \`listMetadata\` never returns it. \`--folder\` is refused for a type without folders.
- Only the names and the Ids are cached, under \`~/.sfdx/sfdx-hardis-cache/orgs/<orgId>/\`. Flow listings are never cached, because activating another Flow version changes its Id. A failed listing is not cached either. \`NO_CACHE\` disables the cache, \`sf hardis:cache:clear\` empties it.
- The \`--json\` result is \`{ type, folder, kind, items, listable, fromCache }\`, where \`kind\` is \`folders\` or \`components\` and each item is \`{ fullName, id }\`.
</details>
`;

  public static examples = [
    '$ sf hardis:org:list:metadata --type ApexClass --json',
    '$ sf hardis:org:list:metadata --type Report --json',
    '$ sf hardis:org:list:metadata --type Report --folder SalesReports --json',
    '$ sf hardis:org:list:metadata --agent --type CustomField --refresh --target-org myOrgAlias --json',
  ];

  public static flags: any = {
    'target-org': requiredOrgFlagWithDeprecations,
    type: Flags.string({
      required: true,
      description: 'Metadata API type to list (for example ApexClass, CustomField or Report)',
    }),
    folder: Flags.string({
      description: 'Folder to list, for Report, Dashboard, Document and EmailTemplate',
    }),
    refresh: Flags.boolean({
      default: false,
      description: 'List the org again instead of using the cached listing',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
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
  };

  public static requiresProject = false;
  // Called in the background by user interfaces: never opens the VS Code command runner
  public static disableWebsocket = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(HardisOrgListMetadata);
    const type = String(flags.type).trim();
    if (!isMetadataType(type)) {
      throw new SfError(t('metadataDepsInvalidType'));
    }
    if (flags.folder && !isFolderType(type)) {
      throw new SfError(t('listMetadataFolderNotSupported', { type }));
    }
    const listing = await listOrgMetadata(flags['target-org'].getConnection(), {
      type,
      folder: flags.folder,
      refresh: flags.refresh === true,
    });
    if (!listing.listable) {
      uxLog('warning', this, c.yellow(t('listMetadataNotListable', { type })));
    } else if (!this.jsonEnabled()) {
      // With --json the caller reads the result: no table and no report file (the VS Code panel lists
      // names in the background and must not write files in the project)
      const heading =
        listing.kind === 'folders'
          ? t('listMetadataFolders', { type, count: listing.items.length })
          : t('listMetadataComponents', { type, count: listing.items.length });
      uxLog('action', this, c.cyan(heading));
      await uxLogTableWithReport(this, listing.items, ['fullName', 'id'], {
        fileNamePrefix: `list-metadata-${type}${listing.folder ? `-${listing.folder}` : ''}`,
        fileTitle: heading,
      });
    }
    return listing as unknown as AnyJson;
  }
}
