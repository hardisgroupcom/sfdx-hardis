/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { SfError } from '@salesforce/core';
import c from 'chalk';
import { MetadataUtils } from '../../../common/metadata-utils/index.js';
import { isCI, uxLog } from '../../../common/utils/index.js';
import { promptOrgUsernameDefault } from '../../../common/utils/orgUtils.js';
import { wrapSfdxCoreCommand } from '../../../common/utils/wrapUtils.js';

export class SourceRetrieve extends SfCommand<any> {
  public static readonly description = `
## Command Behavior

**A wrapper command for Salesforce CLI's \`sf project retrieve start\` (formerly \`sfdx force:source:retrieve\`), with enhanced interactive features.**

This command facilitates the retrieval of metadata from a Salesforce org into your local project. It provides an assisted experience, especially when no specific retrieval constraints are provided.

Key features:

- **Assisted Metadata Selection:** If no \`sourcepath\`, \`manifest\`, \`metadata\`, or \`packagenames\` flags are specified, an interactive menu will prompt you to select the metadata types you wish to retrieve.
- **Assisted Org Selection:** If no target org is specified, an interactive menu will guide you to choose an org for the retrieval operation.
- **Backward Compatibility:** While this command wraps the newer \`sf project retrieve start\`, it maintains compatibility with the older \`sfdx force:source:retrieve\` flags.

**Important Note:** The underlying Salesforce CLI command \`sfdx force:source:retrieve\` is being deprecated by Salesforce in November 2024. It is recommended to migrate to \`sf project retrieve start\` for future compatibility. See [Salesforce CLI Migration Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_mig_deploy_retrieve.htm) for more information.

<details markdown="1">
<summary>Technical explanations</summary>

This command acts as an intelligent wrapper around the Salesforce CLI's source retrieval functionality:

- **Command Wrapping:** It uses the \`wrapSfdxCoreCommand\` utility to execute the \`sfdx force:source:retrieve\` (or its equivalent \`sf project retrieve start\`) command, passing through all relevant flags and arguments.
- **Interactive Prompts:** It leverages \`MetadataUtils.promptMetadataTypes()\` and \`promptOrgUsernameDefault()\` to provide interactive menus for metadata and org selection when the user does not provide them as flags.
- **Argument Transformation:** It dynamically constructs the command-line arguments for the underlying Salesforce CLI command based on user selections and provided flags.
- **Error Handling:** It includes basic error handling, such as prompting the user to re-select an org if an issue occurs during org selection.
- **Deprecation Warning:** It explicitly logs warnings about the deprecation of \`sfdx force:source:retrieve\` to inform users about upcoming changes.
</details>
`;
  public static readonly examples = [];
  public static readonly requiresProject = true;
  public static readonly flags: any = {
    apiversion: Flags.orgApiVersion({
      /* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
      // @ts-ignore force char override for backward compat
      char: 'a',
    }),
    sourcepath: Flags.string({
      char: 'p',
      description: 'sourcePath',
      longDescription: 'sourcePath',
      exclusive: ['manifest', 'metadata'],
      multiple: true,
    }),
    wait: Flags.integer({
      char: 'w',
      description: 'wait',
    }),
    manifest: Flags.directory({
      char: 'x',
      description: 'manifest',
      exclusive: ['metadata', 'sourcepath'],
    }),
    metadata: Flags.string({
      char: 'm',
      description: 'metadata',
      longDescription: 'metadata',
      exclusive: ['manifest', 'sourcepath'],
      multiple: true,
    }),
    packagenames: Flags.string({
      char: 'n',
      description: 'packagenames',
      multiple: true,
    }),
    tracksource: Flags.boolean({
      char: 't',
      description: 'tracksource',
    }),
    forceoverwrite: Flags.boolean({
      char: 'f',
      description: 'forceoverwrite',
      dependsOn: ['tracksource'],
    }),
    verbose: Flags.boolean({
      description: 'verbose',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: 'debugMode',
    }),
    websocket: Flags.string({
      description: 'websocket',
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public async run(): Promise<any> {
    const { flags } = await this.parse(SourceRetrieve);
    uxLog("error", this, c.red('This command will be removed by Salesforce in November 2024.'));
    uxLog("error", this, c.red('Please migrate to command sf hardis project retrieve start'));
    uxLog(
      "error",
      this,
      c.red(
        'See https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_mig_deploy_retrieve.htm'
      )
    );
    const args = this.argv;
    // Manage user selection for metadatas
    if (!isCI && !flags.sourcepath && !flags.manifest && !flags.metadata && !flags.packagenames) {
      const metadatas = await MetadataUtils.promptMetadataTypes();
      const metadataArg = metadatas.map((metadataType: any) => metadataType.xmlName).join(',');
      args.push(...['-m', `"${metadataArg}"`]);
    }
    // Manage user selection for org
    if (!isCI && !flags['target-org']) {
      let orgUsername = (flags['target-org'] as any).getUsername();
      orgUsername = await promptOrgUsernameDefault(this, orgUsername, { devHub: false, setDefault: false });
      if (orgUsername) {
        args.push(...['--target-org', `"${orgUsername}"`]);
      } else {
        throw new SfError(c.yellow('For technical reasons, run again this command and select your org in the list 😊'));
      }
    }
    return await wrapSfdxCoreCommand('sfdx force:source:retrieve', args, this, flags.debug);
  }
}
/* jscpd:ignore-end */
