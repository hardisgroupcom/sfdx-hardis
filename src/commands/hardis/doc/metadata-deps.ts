import { Flags, requiredOrgFlagWithDeprecations, SfCommand } from '@salesforce/sf-plugins-core';
import { AnyJson } from '@salesforce/ts-types';
import { Messages } from '@salesforce/core';
import { runMetadataDeps } from '../../../common/utils/metadataDepsUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class HardisDocMetadataDeps extends SfCommand<any> {
  public static title = 'Find metadata dependencies';

  public static description = `
## Command Behavior

**Finds which Salesforce metadata components use one selected component.**

Select a common metadata type and API name interactively, or pass \`--type\` and \`--name\`. The command resolves the component to a Salesforce Id, queries Tooling API \`MetadataComponentDependency\`, and reports the inbound (used-by) dependencies.

- **Metadata-aware lookup:** Uses \`Name\` or \`DeveloperName\` according to the metadata type. Custom fields accept \`Object.Field__c\` and are resolved without filtering on the unsupported \`FullName\` field.
- **Direct Id:** Pass \`--id\` to skip lookup, especially for Tooling types that cannot be resolved by name.
- **Dependent type filter:** Pass \`--component-type Flow\` (for example) to keep only one type of dependent component.
- **Large graphs:** Pass \`--bulk\` for Tooling Bulk queries, including Report dependencies and graphs that can exceed 2,000 rows.
- **Reports:** Writes a Used by CSV and an Excel workbook with Summary and Used by sheets under \`hardis-report/metadata-deps/<api-name>-<type>/\`.

\`MetadataComponentDependency\` is a beta Salesforce object. Its coverage depends on the org and Salesforce release. Profiles, Permission Sets, List Views, approval processes, sharing rules and some relationship metadata may be absent from the graph.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:doc:metadata-deps --agent --target-org myOrgAlias --type ApexClass --name MyClass
\`\`\`

In agent mode, pass either \`--id\`, or both \`--type\` and \`--name\`. If lookup returns several records, rerun with \`--id\`. No prompt is displayed.

<details markdown="1">
<summary>Technical explanations</summary>

- The selected component is the \`RefMetadataComponent*\` side of \`MetadataComponentDependency\`; each \`MetadataComponent*\` row is a component that uses it.
- Flow, Aura, LWC, FlexiPage, CustomObject and CustomPermission lookup uses \`DeveloperName\`. Apex and Visualforce lookup uses \`Name\`.
- Custom field lookup splits \`Object.Field__c\`, resolves the object through \`EntityDefinition\`, and filters \`CustomField\` by \`DeveloperName\` plus \`TableEnumOrId\` / \`EntityDefinitionId\`.
- Salesforce does not allow \`RefMetadataComponentType = 'StandardEntity'\`; for this type the command filters by Id only.
</details>
`;

  public static examples = [
    '$ sf hardis:doc:metadata-deps',
    '$ sf hardis:doc:metadata-deps --target-org myOrgAlias --type Flow --name MyFlow',
    '$ sf hardis:doc:metadata-deps --target-org myOrgAlias --type CustomField --name Account.Status__c',
    '$ sf hardis:doc:metadata-deps --target-org myOrgAlias --id 01pxx0000000001AAA --type ApexClass',
    '$ sf hardis:doc:metadata-deps --agent --target-org myOrgAlias --type ApexClass --name MyClass --component-type Flow',
    '$ sf hardis:doc:metadata-deps --agent --target-org myOrgAlias --type Report --id 00Oxx0000000001AAA --bulk',
  ];

  public static flags: any = {
    'target-org': requiredOrgFlagWithDeprecations,
    type: Flags.string({
      description: 'Tooling metadata type of the selected component (for example ApexClass, Flow or CustomField)',
    }),
    name: Flags.string({
      description: 'API name of the selected component (for example MyClass or Account.Status__c)',
    }),
    id: Flags.string({
      description: 'Salesforce Id of the selected component (15 or 18 characters); skips name lookup',
    }),
    'component-type': Flags.string({
      description: 'Only return dependent components of this Tooling metadata type',
    }),
    bulk: Flags.boolean({
      default: false,
      description: 'Use sf data query with Tooling Bulk API for large dependency graphs and Reports',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
  };

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(HardisDocMetadataDeps);
    const targetOrg = flags['target-org'];
    const connection = targetOrg.getConnection();
    const username = targetOrg.getUsername() || connection.getUsername() || '';
    return await runMetadataDeps(
      connection,
      username,
      {
        type: flags.type,
        name: flags.name,
        id: flags.id,
        componentType: flags['component-type'],
        bulk: flags.bulk === true,
        agent: flags.agent === true,
      },
      this
    );
  }
}
