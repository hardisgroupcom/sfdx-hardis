/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { isCI, uxLog } from '../../../common/utils/index.js';
import c from 'chalk';
import fs from 'fs-extra';
import { MegaLinterRunner } from 'mega-linter-runner/lib/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class Lint extends SfCommand<any> {
  public static title = 'Lint';

  public static description = `## Command Behavior

**Applies syntactic analysis (linting) to your repository sources using Mega-Linter, ensuring code quality and adherence to coding standards.**

This command integrates Mega-Linter, a comprehensive linter orchestrator, into your Salesforce DX project. It helps identify and fix code style violations, potential bugs, and other issues across various file types relevant to Salesforce development.

Key functionalities:

- **Automated Linting:** Runs a suite of linters configured for Salesforce projects.
- **Fixing Issues (\`--fix\` flag):** Automatically attempts to fix detected linting issues, saving manual effort.
- **Configuration Management:** If \`.mega-linter.yml\` is not found, it guides you through the initial setup of Mega-Linter, prompting for the Salesforce flavor.
- **CI/CD Integration:** Designed to be used in CI/CD pipelines to enforce code quality gates.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Mega-Linter Integration:** It leverages the \`mega-linter-runner\` library to execute Mega-Linter.
- **Configuration Check:** Before running, it checks for the presence of \`.mega-linter.yml\`. If not found and not in a CI environment, it initiates an interactive setup process using \`MegaLinterRunner().run({ install: true })\`.
- **Linter Execution:** It calls \`MegaLinterRunner().run(megaLinterOptions)\` with the \`salesforce\` flavor and the \`fix\` flag (if provided).
- **Exit Code Handling:** The \`process.exitCode\` is set based on the Mega-Linter's exit status, allowing CI/CD pipelines to react to linting failures.
- **User Feedback:** Provides clear messages about the success or failure of the linting process.
</details>
`;

  public static examples = ['$ sf hardis:project:lint', '$ sf hardis:project:lint --fix'];

  public static flags: any = {
    fix: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Apply linters fixes',
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
    'target-org': optionalOrgFlagWithDeprecations,
  };

  public static requiresProject = false;

  protected fix = false;
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(Lint);
    this.fix = flags.fix || false;
    this.debugMode = flags.debug || false;

    // Check if Mega-Linter is configured
    if (!fs.existsSync('.mega-linter.yml')) {
      if (isCI) {
        throw new SfError(
          c.red(
            '[sfdx-hardis] You must run sf hardis:project:lint locally to install Mega-Linter configuration before being able to run it from CI'
          )
        );
      } else {
        // Configure Mega-Linter (yeoman generator)
        uxLog(
          "action",
          this,
          c.cyan('Mega-Linter needs to be configured. Please select Salesforce flavor in the following wizard')
        );
        const megaLinter = new MegaLinterRunner();
        const installRes = megaLinter.run({ install: true });
        console.assert(installRes.status === 0, 'Mega-Linter configuration incomplete');
      }
    }

    // Run MegaLinter
    const megaLinter = new MegaLinterRunner();
    const megaLinterOptions = { flavor: 'salesforce', fix: this.fix };
    const res = await megaLinter.run(megaLinterOptions);
    process.exitCode = res.status;

    if (res.status === 0) {
      uxLog("success", this, c.green(`Mega-Linter has been successful`));
    } else {
      uxLog("error", this, c.red(`Mega-Linter found error(s)`));
    }

    // Return an object to be displayed with --json
    return { outputString: 'Linted project sources', linterStatusCode: res.status };
  }
}
