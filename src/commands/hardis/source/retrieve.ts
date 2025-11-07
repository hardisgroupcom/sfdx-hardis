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
    sourcepath: Flags.string({ // deprecated, replaced by sourcedir
      char: 'p',
      description: 'sourcePath',
      longDescription: 'sourcePath',
      exclusive: ['manifest', 'metadata'],
      multiple: true,
    }),
    sourcedir: Flags.string({
      char: 'd',
      description: 'sourceDir',
      longDescription: 'sourceDir',
      exclusive: ['manifest', 'metadata'],
      multiple: true,
    }),
    manifest: Flags.directory({
      char: 'x',
      description: 'manifest',
      exclusive: ['metadata', 'sourcepath', 'sourcedir'],
    }),
    metadata: Flags.string({
      char: 'm',
      description: 'metadata',
      longDescription: 'metadata',
      exclusive: ['manifest', 'sourcepath', 'sourcedir'],
      multiple: true,
    }),
    packagenames: Flags.string({
      char: 'n',
      aliases: ['package-name'],
      description: 'packagenames',
      multiple: true,
    }),
    tracksource: Flags.boolean({ // deprecated
      char: 't',
      description: 'tracksource',
    }),
    forceoverwrite: Flags.boolean({ // deprecated
      char: 'f',
      description: 'forceoverwrite',
      dependsOn: ['tracksource'],
    }),
    ignoreconflicts: Flags.boolean({
      char: 'c',
      description: 'ignoreconflicts'
    }),
    verbose: Flags.boolean({
      description: 'verbose',
    }),
    debug: Flags.boolean({
      // char: 'd', // deprecated, used by sourcedir, force --debug instead
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
    const args = this.argv;

    if(args.includes('-d')){
      uxLog("warning", this, c.red('The -d flag is deprecated for debug mode. Please use --debug instead.'));
    }
    if(flags.tracksource) {
      uxLog("error", this, c.red('The --tracksource flag is not supported anymore.'));
      process.exitCode = 1;
    }
    if(flags.forceoverwrite) {
      uxLog("warning", this, c.red('The --forceoverwrite (-f) flag is not supported anymore. It is being automatically replaced by --ignore-conflicts (-c). Please use it going forward.'));
      flags.ignoreconflicts = true;
      if(args.includes('--forceoverwrite')) {
        args.splice(args.indexOf('--forceoverwrite'), 1);
        args.push('--ignore-conflicts');
      }
      if(args.includes('-f')) {
        args.splice(args.indexOf('-f'), 1);
        args.push('-c');
      }
      delete flags.forceoverwrite;
    }
    if(flags.packagenames) {
      uxLog("warning", this, c.red('The --packagenames flag is not supported anymore. It is being automatically replaced by --package-names. Please use it going forward.'));
      flags['package-name'] = flags.packagenames;
      if(args.includes('--packagenames')) {
        args.splice(args.indexOf('--packagenames'), 1);
        args.push('--package-names');
      }
      delete flags.packagenames;
    }
    if(flags.sourcepath) {
      uxLog("warning", this, c.red('The --sourcepath (-p) flag is not supported anymore. It is being automatically replaced by --source-dir (-d). Please use it going forward.'));
      flags['source-dir'] = flags.sourcepath;
      if(args.includes('--sourcepath')) {
        args.splice(args.indexOf('--sourcepath'), 1);
        args.push('--source-dir');
      }
      if(args.includes('-p')) {
        args.splice(args.indexOf('-p'), 1);
        args.push('--source-dir'); // wrap utils considers -d for debug only
      }
      delete flags.sourcepath;
    }
    if(flags.apiversion){
      uxLog("warning", this, c.red('The --apiversion flag is not supported anymore. It is being automatically replaced by --api-version. Please use it going forward.'));
      flags['api-version'] = flags.apiversion;
      if(args.includes('--apiversion')) {
        args.splice(args.indexOf('--apiversion'), 1);
        args.push('--api-version');
      }
      delete flags.apiversion;
    }
    if(flags.targetusername){
      uxLog("warning", this, c.red('The --target-username (-u) flag is not supported anymore. It is being automatically replaced by --target-org (-o). Please use it going forward.'));
      flags['target-org'] = flags.targetusername;
      if(args.includes('--targetusername')) {
        args.splice(args.indexOf('--targetusername'), 1);
        args.push('--target-org');
      }
      if(args.includes('-u')) {
        args.splice(args.indexOf('-u'), 1);
        args.push('-o');
      }
      delete flags.targetusername;
    }
    uxLog("error", this, c.red('This command will be removed by Salesforce in November 2024.'));
    uxLog("error", this, c.red('Please migrate to command sf hardis project retrieve start'));
    uxLog(
      "error",
      this,
      c.red(
        'See https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_mig_deploy_retrieve.htm'
      )
    );

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
    return await wrapSfdxCoreCommand('sf project retrieve start', args, this, flags.debug);
  }
}
/* jscpd:ignore-end */