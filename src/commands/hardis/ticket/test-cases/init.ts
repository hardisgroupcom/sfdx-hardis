/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import path from 'path';
import fs from '../../../../common/utils/fsUtils.js';
import { extractRegexMatches, getCurrentGitBranch, isCI, uxLog } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { generateReportPath, isSamePath } from '../../../../common/utils/filesUtils.js';
import {
  deriveTicketAndKind,
  NormalizedTestCase,
  resolveNotebookInput,
  TEST_CASE_KINDS,
  TestCaseKind,
} from '../../../../common/utils/testNotebookUtils.js';
import { buildTemplateCases, NotebookFormat, writeNotebook } from '../../../../common/utils/testNotebookRender.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class TicketTestCasesInit extends SfCommand<any> {
  public static title = 'Initialize the test cases of a ticket';

  public static description = `
## Command Behavior

**Writes the test cases of a ticket into a notebook a tester reviews and fills in: an Excel workbook, a CSV or a markdown table.**

The test cases usually come from a \`NormalizedTestCase[]\` JSON file written by an AI agent that read the specification and the code. This command turns them into a file a human can read and correct, then [hardis:ticket:test-cases:upsert](https://sfdx-hardis.cloudity.com/hardis/ticket/test-cases/upsert/) sends the corrected file to the test management tool.

- **One column set per kind of notebook.** Functional notebooks have the steps and a helper SOQL query, technical notebooks have the Apex class and method under test, maintenance notebooks have no module nor priority. The kind comes from the \`ID\` column, or from \`--kind\`.
- **Tester columns:** \`Actual result\`, \`Comment\` and \`Status\` (a value list: Passed, Failed, Blocked, N/A). They are written empty for new cases, and kept when an existing notebook is converted to another format.
- **A summary** of the cases per module and priority, in its own sheet or under the CSV rows.
- **Readable back:** every file written here is read by \`upsert\`, after a tester corrected it.
- **A blank notebook** when no test case is given, with identifiers already filled.

### Input

The format is read from the file extension:

| Input | Flag | Typical producer |
|-------|------|------------------|
| JSON test cases | \`--testsjsonfile\` | An AI agent that read the ticket and the code |
| An existing notebook (.md, .xlsx, .csv) | \`--notebook\` | A previous run of this command, or a notebook a tester filled in |
| Nothing | neither flag | Blank notebook |

### Output

- Format: \`--format\` (\`xlsx\` by default, \`both\` writes the xlsx and the CSV), or the extension of \`--outputfile\`.
- File: \`--outputfile\`, or \`hardis-report/test-cases-<TICKET>-<KIND>-<DATE>.<ext>\`.
- An existing file is never overwritten silently: the command asks first, and refuses in CI and in agent mode.

### Configuration

None: this command reads a file and writes a file, without org, provider nor secret.

<details markdown="1">
<summary>Technical explanations</summary>

- **JSON contract:** \`id\`, \`title\` and \`expected\` are required. \`module\`, \`priority\` (1, 2 or 3), \`preconditions\`, \`target\`, \`soql\` and \`steps\` (\`[{ "action": "...", "expected": "..." }]\`) are optional. Every problem of an entry is reported at once, with its index.
- **Identifiers:** \`<TICKET>-F01\` functional, \`<TICKET>-T01\` technical, \`<TICKET>-01\` maintenance, with a 2 or 3 digit counter. Letters, digits, \`_\`, \`.\`, \`#\` and \`-\` only. The ticket and the kind are derived from the identifier, and an unreadable one is refused.
- **Steps cell:** one numbered line per step, \`1. Open the record → The record page is displayed\`. The first \`→\` or \`->\` separates the action from its expected result, and a step without arrow has no expected result. An arrow inside an action is written \`=>\`, so it is not read as the separator. Steps are separated by a line break in the xlsx, and by \`<br>\` in the CSV and in markdown.
- **CSV:** \`,\` delimiter, UTF-8 with BOM so Excel reads the accents, CRLF line endings. A cell starting with \`=\`, \`+\`, \`-\` or \`@\` is prefixed with an apostrophe, so a spreadsheet does not run it as a formula. The reader detects \`,\` or \`;\`.
- **Headers:** the reader also accepts the French headers of earlier notebooks (\`Cas de test\`, \`Étapes\`, \`Résultat attendu\`...).

</details>

### Agent Mode

Use \`--agent\` to disable all interactive prompts. Without test cases, \`--kind\` and \`--ticket-number\` are required. An existing output file makes the command fail instead of asking.

\`\`\`sh
sf hardis:ticket:test-cases:init --testsjsonfile cases.json --agent
\`\`\`

The same applies in CI.
`;

  public static examples = [
    '$ sf hardis:ticket:test-cases:init --testsjsonfile cases.json',
    '$ sf hardis:ticket:test-cases:init --testsjsonfile cases.json --format both --outputfile ./PROJ-123.xlsx',
    '$ sf hardis:ticket:test-cases:init --notebook docs/tests/PROJ-123.xlsx --outputfile docs/tests/PROJ-123.md',
    '$ sf hardis:ticket:test-cases:init --kind functional --ticket-number PROJ-123 --modules Opportunity --rows 5 --agent',
    '$ sf hardis:ticket:test-cases:init --testsjsonfile cases.json --agent',
  ];

  public static flags: any = {
    testsjsonfile: Flags.string({
      char: 'j',
      description: 'NormalizedTestCase[] JSON file holding the test cases to write',
    }),
    notebook: Flags.string({
      char: 'n',
      description: 'Existing notebook to read the test cases from: .md, .xlsx or .csv',
    }),
    'ticket-number': Flags.string({
      description: 'Ticket key of a blank notebook. With test cases, sets their carrier ticket',
    }),
    kind: Flags.string({
      char: 'k',
      options: TEST_CASE_KINDS,
      description: 'Column set to write. Defaults to the kind derived from the ID column',
    }),
    modules: Flags.string({
      multiple: true,
      description: 'Module names of a blank notebook, one group of rows each',
    }),
    rows: Flags.integer({
      default: 3,
      description: 'Rows per module of a blank notebook',
    }),
    format: Flags.string({
      options: ['xlsx', 'csv', 'md', 'both'],
      description: 'Output format: xlsx (default), csv, md, or both for xlsx and csv. Defaults to the extension of --outputfile',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Path of the generated notebook',
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

  // Writing a notebook needs no Salesforce project nor org
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(TicketTestCasesInit);
    const nonInteractive = flags.agent === true || isCI;
    const formats = this.resolveFormats(flags);

    let cases: NormalizedTestCase[];
    let kind: TestCaseKind;
    let ticket: string;
    const blank = !flags.testsjsonfile && !flags.notebook;
    if (blank) {
      kind = await this.resolveKind(flags.kind, nonInteractive);
      ticket = await this.resolveTicket(flags['ticket-number'], nonInteractive);
      // Refuses a ticket key whose identifiers could not be read back
      deriveTicketAndKind(`${ticket}-01`);
      cases = buildTemplateCases({ kind, ticket, modules: flags.modules ?? [], rows: flags.rows ?? 3 });
      uxLog('action', this, c.cyan(t('testCasesGeneratingTemplate', { kind, ticket })));
    } else {
      cases = await resolveNotebookInput(flags);
      if (cases.length === 0) {
        throw new SfError(t('testCasesNoneFound'));
      }
      // The kind decides the columns: a technical case in a functional notebook would lose its class
      const kinds = [...new Set(cases.map((testCase) => testCase.kind))];
      if (!flags.kind && kinds.length > 1) {
        throw new SfError(t('testCasesMixedKinds', { kinds: kinds.join(', ') }));
      }
      kind = (flags.kind as TestCaseKind) || cases[0].kind;
      ticket = cases[0].ticket;
      uxLog('action', this, c.cyan(t('testCasesWriting', { count: cases.length, kind })));
    }

    const files: string[] = [];
    for (const format of formats) {
      const target = await this.targetFor(flags, format, formats.length > 1, ticket, kind, nonInteractive);
      files.push(await writeNotebook(target, format, kind, cases, { withSummary: !blank }));
    }

    for (const file of files) {
      uxLog('log', this, c.grey(`- ${file}`));
      WebSocketClient.sendReportFileMessage(file, t('testCasesNotebookReport'), 'report');
    }
    // VS Code opens text files only
    if (files.length === 1 && !files[0].endsWith('.xlsx')) {
      WebSocketClient.requestOpenFile(files[0]);
    }
    uxLog('success', this, c.green(t('testCasesWritten', { count: cases.length, files: files.length })));
    return { outputString: t('testCasesWritten', { count: cases.length, files: files.length }), kind, ticket, blank, files };
  }

  /** `--format` wins, then the extension of `--outputfile`, then xlsx. */
  private resolveFormats(flags: any): NotebookFormat[] {
    const extension = flags.outputfile ? path.extname(flags.outputfile).slice(1).toLowerCase() : '';
    const fromOutput = ['xlsx', 'csv', 'md'].includes(extension) ? extension : '';
    const format = flags.format || fromOutput || 'xlsx';
    if (fromOutput && format !== 'both' && format !== fromOutput) {
      throw new SfError(t('testCasesFormatMismatch', { format, file: flags.outputfile }));
    }
    return format === 'both' ? ['xlsx', 'csv'] : [format as NotebookFormat];
  }

  private async targetFor(
    flags: any,
    format: NotebookFormat,
    severalFormats: boolean,
    ticket: string,
    kind: TestCaseKind,
    nonInteractive: boolean
  ): Promise<string> {
    let target: string;
    if (flags.outputfile) {
      const base = path.extname(flags.outputfile) ? flags.outputfile.slice(0, -path.extname(flags.outputfile).length) : flags.outputfile;
      target = severalFormats || !path.extname(flags.outputfile) ? `${base}.${format}` : flags.outputfile;
      await fs.ensureDir(path.dirname(path.resolve(target)));
    } else {
      const safeTicket = ticket.replace(/[^\w.-]/g, '_');
      target = await generateReportPath(`test-cases-${safeTicket}-${kind}`, '', { withDate: true, withBranchName: false, fileExtension: format });
    }
    if (flags.notebook && isSamePath(target, flags.notebook)) {
      throw new SfError(t('testCasesOutputIsInputNotebook', { file: flags.notebook }));
    }
    if (await fs.pathExists(target)) {
      if (nonInteractive) {
        throw new SfError(t('testCasesOutputExists', { file: target }));
      }
      const answer = await prompts({
        type: 'confirm',
        name: 'value',
        message: t('testCasesConfirmOverwrite', { file: target }),
        description: t('testCasesConfirmOverwriteDescription'),
        initial: false,
      });
      uxLog('action', this, c.cyan(t(answer.value === true ? 'testCasesOverwriting' : 'testCasesOverwriteCancelled', { file: target })));
      if (answer.value !== true) {
        throw new SfError(t('testCasesOutputExists', { file: target }));
      }
    }
    return target;
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
        { title: t('testCasesKindMaintenance'), value: 'maintenance' },
      ],
    });
    return (answer.value as TestCaseKind) || 'functional';
  }

  /** The current branch usually carries the ticket key, so it is proposed. */
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
