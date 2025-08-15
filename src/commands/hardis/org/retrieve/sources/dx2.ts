/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';

import { execCommand, uxLog } from '../../../../../common/utils/index.js';
import { promptOrg } from '../../../../../common/utils/orgUtils.js';
import { prompts } from '../../../../../common/utils/prompts.js';
import { PACKAGE_ROOT_DIR } from '../../../../../settings.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DxSources2 extends SfCommand<any> {
  public static title = 'Retrieve sfdx sources from org (2)';

  public static description = `
## Command Behavior

**Retrieves Salesforce metadata from an org into SFDX source format, offering flexible input options for specifying metadata to retrieve.**

This command provides an alternative and enhanced way to pull metadata from any Salesforce org into your local SFDX project. It's particularly useful when you need fine-grained control over which metadata components are retrieved, either by providing a custom \`package.xml\` or by using predefined templates.

Key functionalities:

- **\`package.xml\` Input:** You can specify the path to a \`package.xml\` file using the \`--packagexml\` flag, which defines the exact metadata components to retrieve.
- **Template-Based Retrieval:** Use the \`--template\` flag to leverage predefined \`package.xml\` templates provided by sfdx-hardis (e.g., \`wave\` for CRM Analytics metadata), simplifying common retrieval scenarios.
- **Interactive Input:** If neither \`--packagexml\` nor \`--template\` is provided, the command will interactively prompt you to select a \`package.xml\` file or a template.
- **Target Org Selection:** Allows you to specify the Salesforce org from which to retrieve the sources. If not provided, it will prompt for selection.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Org Selection:** It uses \`promptOrg\` to guide the user in selecting the target Salesforce org if not provided via flags.
- **\`package.xml\` Resolution:** It determines the \`package.xml\` to use based on the provided flags (\`--packagexml\` or \`--template\`). If a template is used, it resolves the path to the corresponding template file within the sfdx-hardis installation.
- **File System Operations:** It checks if the specified \`package.xml\` file exists. If the file is outside the current project directory, it copies it to a temporary location within the project to ensure proper handling by the Salesforce CLI.
- **Salesforce CLI Retrieval:** It executes the \`sf project retrieve start\` command, passing the resolved \`package.xml\` path and the target username to retrieve the sources.
- **User Feedback:** Provides clear messages to the user about the retrieval process and its success.
</details>
`;

  public static examples = ['$ sf hardis:org:retrieve:sources:dx2'];

  public static flags: any = {
    packagexml: Flags.string({
      char: 'x',
      description: 'Path to package.xml file',
    }),
    template: Flags.string({
      char: 't',
      description: 'sfdx-hardis package.xml Template name. ex: wave',
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
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DxSources2);
    let packageXml = flags.packagexml || null;
    let targetUsername = flags['target-org']?.getUsername() || null;
    const template = flags.template || null;
    this.debugMode = flags.debug || false;

    // Prompt for organization if not sent
    if (targetUsername == null) {
      const org = await promptOrg(this, { setDefault: false });
      targetUsername = org.username;
    }

    // Use package.xml template provided by sfdx-hardis
    if (template) {
      packageXml = path.join(PACKAGE_ROOT_DIR, `ref`, `${template}-package.xml`);
    }

    // Prompt for package.xml if not sent
    if (packageXml === null) {
      const packageXmlRes = await prompts({
        message: c.cyanBright('Please input the path to the package.xml file'),
        description: 'Specify the package.xml file that defines which metadata to retrieve from the org',
        placeholder: 'Ex: manifest/package.xml',
        type: 'text',
        name: 'value',
      });
      packageXml = packageXmlRes.value;
    }

    // Check package.xml file exists
    if (!fs.existsSync(packageXml || '')) {
      throw new SfError(c.red('Package.xml file not found at ' + packageXml));
    }
    // Copy package.xml in /tmp if provided value is not within project
    if (!path.resolve(packageXml || '').includes(path.resolve(process.cwd()))) {
      const packageXmlTmp = path.join(process.cwd(), 'tmp', 'retrievePackage.xml');
      await fs.ensureDir(path.dirname(packageXmlTmp));
      await fs.copy(packageXml || '', packageXmlTmp);
      uxLog("log", this, c.grey(`Copied ${packageXml} to ${packageXmlTmp}`));
      packageXml = path.relative(process.cwd(), packageXmlTmp);
    }

    // Retrieve sources
    const retrieveCommand = 'sf project retrieve start' + ` -x "${packageXml}"` + ` -o ${targetUsername}`;
    await execCommand(retrieveCommand, this, { fail: false, debug: this.debugMode, output: true });

    // Set bac initial cwd
    const message = `[sfdx-hardis] Successfully retrieved sfdx sources from ${c.bold(targetUsername)} using ${c.bold(
      packageXml
    )}`;
    uxLog("success", this, c.green(message));
    return { outputString: message };
  }
}
