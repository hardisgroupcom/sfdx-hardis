/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { extractRegexMatches, getCurrentGitBranch, isCI, uxLog } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { generateReportPath } from '../../../../common/utils/filesUtils.js';
import { resolveNotebookInput } from '../../../../common/utils/testNotebookInput.js';
import {
  writeNotebookCsv,
  writeNotebookMarkdown,
  writeNotebookXlsx,
  writeTemplate,
} from '../../../../common/utils/testNotebookRender.js';
import { NormalizedTestCase, TestCaseKind } from '../../../../common/utils/testNotebookTypes.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class TicketTestCasesInit extends SfCommand<any> {
  public static title = 'Initialize the test cases of a ticket';

  public static description = `
## Command Behavior

**Writes the test cases of a ticket into a notebook a human can review and correct: an Excel workbook, a CSV, or a markdown table.**

The test cases come **in**, as a \`NormalizedTestCase[]\` JSON payload. That payload is what an AI agent produces after reading the specification and the code, and this command turns it into the artifact a tester actually works in. The point is not that somebody types test cases from scratch: it is that the ones already written get a shape that can be read, corrected, and then sent to a tracker with [hardis:ticket:test-cases:upsert](https://sfdx-hardis.cloudity.com/hardis/ticket/test-cases/upsert/).

It provides:

- **A column set per notebook kind.** The functional notebook carries the advisory SOQL query and the steps; the technical one carries the class and method under test instead; the TMA one drops the module and the priority. The kind is derived from the \`ID\` column, or forced with \`--kind\`.
- **The reviewer's columns left empty:** \`Résultat obtenu\`, \`Commentaire\` and \`Statut\`. Filling them would be answering for the tester.
- **A \`Statut\` column restricted to a value list**, so a campaign can be counted rather than read, plus a per-module summary sheet with the counts by priority.
- **A round trip that holds.** The workbook this command writes is read back by the very same parser, so the corrections a human makes in Excel survive all the way to the tracker.
- **A blank notebook as a fallback.** Without \`--testsjsonfile\`, the command writes the scaffolding with its identifiers pre-filled and its cells empty, for the rare case where nobody has drafted the cases yet.

### Where the test cases come from

Any of these, and the format is read from the file extension rather than sniffed from the content:

| Input | Flag | Typical producer |
|-------|------|------------------|
| Pre-normalized JSON | \`--testsjsonfile\` | An AI agent that read the ticket and the code. **The main path.** |
| An existing notebook | \`--notebook\` | A previous run of this command, or a workbook a tester has filled in |
| Nothing | neither flag | The blank scaffolding fallback |

### Configuration

None. This command reads a file and writes a file: no org, no project, no provider, no secret.

<details markdown="1">
<summary>Technical explanations</summary>

- **Public contract:** \`--testsjsonfile\` accepts a \`NormalizedTestCase[]\` payload, validated field by field with the array index and the field name in the error message, so a generator can be fixed without reading this source. That contract is the seam between the agent that writes the cases and the deterministic code that renders and sends them.
- **Identifier convention:** \`<TICKET>-F01\` functional, \`<TICKET>-T01\` technical, \`<TICKET>-01\` TMA. The ticket and the kind are both derived from the identifier, and an unreadable one raises rather than guessing, because guessing "functional" for a technical case renders the wrong column set.
- **Formula injection guard:** every cell is passed through a guard that prefixes an apostrophe to any value starting with \`=\`, \`+\`, \`-\` or \`@\`. Those are executed by Excel and LibreOffice on open, and a notebook is written by one party and opened by another.
- **CSV shape:** \`;\` delimiter, UTF-8 **with a BOM** so Excel opens the accents on a double click, CRLF line endings, and a summary footer padded to the header width. The reader stops at that footer marker rather than turning the summary rows into malformed test cases.
- **Step rendering:** the steps of a case are rendered into a single cell, numbered, with a separator chosen so the cell can be read back. A real line break in the xlsx, which is also what a tester wants to see; a \`<br>\` in the CSV, because a CSV field has to stay on one physical line.
- **Column width detail:** the priority column is 9.5 characters wide and not 9. ExcelJS treats a width equal to the default column width (9) as "not custom" and omits it on write, so a width of exactly 9 reads back undefined.

</details>

### Agent Mode

Use \`--agent\` to disable all interactive prompts. In agent mode nothing is guessed: when no test cases are supplied, \`--kind\` and \`--ticket-number\` become required and a missing one raises an error naming the flag.

\`\`\`sh
sf hardis:ticket:test-cases:init --testsjsonfile cases.json --agent
\`\`\`

The same applies in CI, where \`isCI\` is true.
`;

  public static examples = [
    '$ sf hardis:ticket:test-cases:init --testsjsonfile cases.json',
    '$ sf hardis:ticket:test-cases:init --testsjsonfile cases.json --format both --outputfile ./DSI-11533.xlsx',
    '$ sf hardis:ticket:test-cases:init --notebook docs/tests/DSI-11533.md --format csv',
    '$ sf hardis:ticket:test-cases:init --agent --kind functional --ticket-number DSI-11533 --modules Opportunite --rows 5',
  ];

  public static flags: any = {
    testsjsonfile: Flags.string({
      char: 'j',
      description: 'NormalizedTestCase[] JSON file holding the test cases to write. The main input',
    }),
    notebook: Flags.string({
      char: 'n',
      description: 'Existing notebook to read the test cases from instead: .md, .xlsx or .csv',
    }),
    'ticket-number': Flags.string({
      description: 'Ticket key the test cases belong to, overriding the one derived from the ID column',
    }),
    kind: Flags.string({
      char: 'k',
      options: ['functional', 'technical', 'tma'],
      description: 'Column set to write. Defaults to the kind derived from the ID column',
    }),
    modules: Flags.string({
      multiple: true,
      description: 'Module names of the blank scaffolding, one group of rows each. Ignored when test cases are supplied',
    }),
    rows: Flags.integer({
      default: 3,
      description: 'Rows per module of the blank scaffolding. Ignored when test cases are supplied',
    }),
    format: Flags.string({
      options: ['xlsx', 'csv', 'md', 'both'],
      default: 'xlsx',
      description: 'Output format. "both" writes the xlsx and the CSV side by side',
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

  // Writing a notebook is independent from any Salesforce project or org.
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(TicketTestCasesInit);
    const hasCases = Boolean(flags.testsjsonfile || flags.notebook);

    return hasCases ? this.writeSuppliedCases(flags) : this.writeBlankScaffolding(flags);
  }

  /** The main path: the cases already exist, they need a shape a human can correct. */
  private async writeSuppliedCases(flags: any): Promise<AnyJson> {
    const cases: NormalizedTestCase[] = await resolveNotebookInput(flags);
    if (cases.length === 0) {
      throw new SfError(t('testCasesNoneFound'));
    }
    // One notebook holds one kind, because the kind decides the column set. Mixing them would
    // silently drop a column: a technical case in a functional payload loses its
    // "Classe / Méthode", and nothing in the produced file would say so. `--kind` forces the
    // column set when that is genuinely what the caller wants.
    const kinds = [...new Set(cases.map((testCase) => testCase.kind))];
    if (!flags.kind && kinds.length > 1) {
      throw new SfError(t('testCasesMixedKinds', { kinds: kinds.join(', ') }));
    }
    const kind: TestCaseKind = (flags.kind as TestCaseKind) || cases[0].kind;

    uxLog('action', this, c.cyan(t('testCasesWriting', { count: cases.length, kind })));

    const writtenFiles: string[] = [];
    if (flags.format === 'xlsx' || flags.format === 'both') {
      writtenFiles.push(await writeNotebookXlsx(await this.targetFor(flags, 'xlsx'), kind, cases));
    }
    if (flags.format === 'csv' || flags.format === 'both') {
      writtenFiles.push(await writeNotebookCsv(await this.targetFor(flags, 'csv'), kind, cases));
    }
    if (flags.format === 'md') {
      writtenFiles.push(await writeNotebookMarkdown(await this.targetFor(flags, 'md'), kind, cases));
    }

    this.announce(writtenFiles);
    uxLog('success', this, c.green(t('testCasesWritten', { count: cases.length, files: writtenFiles.length })));
    return { outputString: `Wrote ${cases.length} test case(s)`, kind, files: writtenFiles };
  }

  /**
   * The fallback: nobody has drafted the cases, so the command writes the scaffolding with
   * its identifiers pre-filled. Kept because a human without an agent must still be able to
   * start, but it is no longer the path the documentation leads with.
   */
  private async writeBlankScaffolding(flags: any): Promise<AnyJson> {
    const nonInteractive = flags.agent === true || isCI;
    const kind = await this.resolveKind(flags.kind, nonInteractive);
    const ticket = await this.resolveTicket(flags['ticket-number'], nonInteractive);
    const modules = flags.modules && flags.modules.length > 0 ? flags.modules : [];
    const rows = flags.rows ?? 3;

    // A prompt must be followed by an action line, or the VS Code UI hides everything after it.
    uxLog('action', this, c.cyan(t('testCasesGeneratingTemplate', { kind, ticket })));

    const format = flags.format === 'both' ? 'xlsx' : flags.format;
    const file = await writeTemplate(await this.targetFor(flags, format), { kind, ticket, modules, rows }, format);

    this.announce([file]);
    uxLog(
      'success',
      this,
      c.green(t('testCasesTemplateGenerated', { count: Math.max(1, rows) * Math.max(1, modules.length), file }))
    );
    return { outputString: `Initialized a blank ${kind} notebook`, kind, ticket, file };
  }

  /**
   * With `--format both`, one `--outputfile` cannot name two files: the extension asked for
   * decides, so the caller gets `cahier.xlsx` and `cahier.csv` rather than one overwriting
   * the other.
   */
  private async targetFor(flags: any, extension: string): Promise<string> {
    const forced = flags.outputfile ? flags.outputfile.replace(/\.(xlsx|csv|md)$/i, '') + '.' + extension : '';
    return generateReportPath('test-cases', forced, { fileExtension: extension });
  }

  private announce(files: string[]): void {
    for (const file of files) {
      uxLog('log', this, c.grey(`- ${file}`));
      WebSocketClient.sendReportFileMessage(file, t('testCasesNotebookReport'), 'report');
    }
    if (files.length === 1) {
      WebSocketClient.requestOpenFile(files[0]);
    }
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
      placeholder: 'DSI-11533',
    });
    const value = (answer?.value || '').trim();
    if (!value) {
      throw new SfError(t('testCasesTicketRequired'));
    }
    return value;
  }
}
