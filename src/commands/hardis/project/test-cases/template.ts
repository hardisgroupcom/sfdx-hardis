/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { extractRegexMatches, getCurrentGitBranch, isCI, uxLog } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { generateReportPath } from '../../../../common/utils/filesUtils.js';
import { writeTemplate } from '../../../../common/utils/testNotebookRender.js';
import { TestCaseKind } from '../../../../common/utils/testNotebookTypes.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class TestCasesTemplate extends SfCommand<any> {
  public static title = 'Generate a test cases template';

  public static description = `
## Command Behavior

**Generates an empty test notebook with the expected columns and pre-filled identifiers, so a tester can start writing test cases straight away.**

This is the entry point of the chain: \`template\` produces the blank notebook, a human fills it in, and \`render\` turns it into the deliverable workbook a tester works in. The identifiers it writes follow the convention the parser reads, so nothing has to be fixed by hand between the steps.

It provides:

- **A column set per notebook kind** (\`functional\`, \`technical\`, \`tma\`), the same sets \`render\` uses.
- **Identifiers pre-filled and numbered continuously** across the module groups: \`PROJ-123-F01\`, \`-F02\`, \`-F03\`. They never restart at each module, because two cases sharing an identifier are indistinguishable to anything that reads the notebook back.
- **One group of rows per module** (\`--modules\`), with the module name carried on every row of its group.
- **Three output formats:** a formatted workbook, a CSV, or a markdown table.
- **Interactive guidance:** every missing value is asked for, in the terminal or in the VS Code panel, whichever is running.

### Configuration

None. No org, no project, no provider, no secret.

<details markdown="1">
<summary>Technical explanations</summary>

- **Identifier convention:** \`<TICKET>-F01\` functional, \`<TICKET>-T01\` technical, \`<TICKET>-01\` TMA. A unit test feeds every generated identifier back through the shared derivation, so the loop is closed by construction rather than by inspection.
- **Ticket default:** the current git branch is proposed, its ticket key extracted with the same regex machinery the ticketing providers use.
- **Interactive rendering:** the prompts go through \`prompts.ts\`, which routes to the LWC UI of the VS Code extension when it is running and falls back to the terminal otherwise. There is no interface code in this command.
- **Opening the result:** the generated file is announced with \`requestOpenFile\`. For an \`.xlsx\` the VS Code extension hands it to the default application, so it opens in Excel rather than as XML in the editor.

</details>

### Agent Mode

Use \`--agent\` to disable all interactive prompts. In agent mode nothing is guessed: \`--kind\` and \`--ticket-number\` are required, and a missing one raises an error naming the flag.

\`\`\`sh
sf hardis:project:test-cases:template --agent --kind functional --ticket-number PROJ-123 --modules Devis --rows 2
\`\`\`

The same applies in CI, where \`isCI\` is true.
`;

  public static examples = [
    '$ sf hardis:project:test-cases:template',
    '$ sf hardis:project:test-cases:template --kind functional --ticket-number PROJ-123',
    '$ sf hardis:project:test-cases:template --kind technical --ticket-number PROJ-123 --modules Devis --modules Contrat --rows 5',
    '$ sf hardis:project:test-cases:template --agent --kind functional --ticket-number PROJ-123 --format md',
  ];

  public static flags: any = {
    kind: Flags.string({
      char: 'k',
      options: ['functional', 'technical', 'tma'],
      description: 'Notebook kind, which decides the column set and the identifier prefix',
    }),
    'ticket-number': Flags.string({
      description: 'Carrier ticket key the identifiers are built from. Defaults to the current git branch',
    }),
    modules: Flags.string({
      multiple: true,
      description: 'Module names, one group of rows each',
    }),
    rows: Flags.integer({
      default: 3,
      description: 'Number of empty rows per module',
    }),
    format: Flags.string({
      options: ['xlsx', 'csv', 'md'],
      default: 'xlsx',
      description: 'Output format',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path of the generated notebook',
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
  };

  // Generating a blank notebook is independent from any Salesforce project or org.
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(TestCasesTemplate);
    const nonInteractive = flags.agent === true || isCI;

    const kind = await this.resolveKind(flags.kind, nonInteractive);
    const ticket = await this.resolveTicket(flags['ticket-number'], nonInteractive);
    const modules = flags.modules && flags.modules.length > 0 ? flags.modules : [];
    const rows = flags.rows ?? 3;

    // A prompt must be followed by an action line, or the VS Code UI hides everything after it.
    uxLog('action', this, c.cyan(t('testCasesGeneratingTemplate', { kind, ticket })));

    const extension = flags.format === 'md' ? 'md' : flags.format;
    const target = await generateReportPath('test-cases-template', flags.outputfile, { fileExtension: extension });
    const file = await writeTemplate(target, { kind, ticket, modules, rows }, flags.format);

    uxLog('log', this, c.grey(`- ${file}`));
    WebSocketClient.sendReportFileMessage(file, t('testCasesTemplateReport'), 'report');
    WebSocketClient.requestOpenFile(file);
    uxLog(
      'success',
      this,
      c.green(t('testCasesTemplateGenerated', { count: Math.max(1, rows) * Math.max(1, modules.length), file }))
    );
    return { outputString: `Generated a ${kind} test cases template`, kind, ticket, file };
  }

  private async resolveKind(flagValue: string | undefined, nonInteractive: boolean): Promise<TestCaseKind> {
    if (flagValue) {
      return flagValue as TestCaseKind;
    }
    if (nonInteractive) {
      throw new SfError(t('testCasesKindRequired'));
    }
    const answer = await prompts({
      type: 'select',
      name: 'value',
      message: t('testCasesPromptKind'),
      description: t('testCasesPromptKindDescription'),
      choices: [
        { title: t('testCasesKindFunctional'), value: 'functional' },
        { title: t('testCasesKindTechnical'), value: 'technical' },
        { title: t('testCasesKindTma'), value: 'tma' },
      ],
    });
    return (answer.value as TestCaseKind) || 'functional';
  }

  /**
   * The current branch usually already carries the ticket key, so it is proposed rather than
   * asked blind. Same extraction machinery as the ticketing providers.
   */
  private async resolveTicket(flagValue: string | undefined, nonInteractive: boolean): Promise<string> {
    if (flagValue) {
      return flagValue.trim();
    }
    if (nonInteractive) {
      throw new SfError(t('testCasesTicketRequired'));
    }
    const branch = (await getCurrentGitBranch()) || '';
    const fromBranch = (await extractRegexMatches(/([A-Z][A-Z0-9]+-[0-9]+)/g, branch.toUpperCase()))[0] || '';
    const answer = await prompts({
      type: 'text',
      name: 'value',
      message: t('testCasesPromptTicket'),
      description: t('testCasesPromptTicketDescription'),
      initial: fromBranch,
      placeholder: 'PROJ-123',
    });
    const value = (answer?.value || '').trim();
    if (!value) {
      throw new SfError(t('testCasesTicketRequired'));
    }
    return value;
  }
}
