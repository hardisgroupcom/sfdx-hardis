/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { generateReportPath } from '../../../../common/utils/filesUtils.js';
import { resolveNotebookInput } from '../../../../common/utils/testNotebookInput.js';
import { writeNotebookCsv, writeNotebookXlsx } from '../../../../common/utils/testNotebookRender.js';
import { TestCaseKind } from '../../../../common/utils/testNotebookTypes.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class TestCasesRender extends SfCommand<any> {
  public static title = 'Render test cases';

  public static description = `
## Command Behavior

**Turns a test notebook into the deliverable a tester actually works in: a formatted Excel workbook, or a CSV Excel opens cleanly on a double click.**

The input can be a markdown table, an existing workbook, a CSV, or a pre-normalized JSON payload. The output is a workbook whose result columns are left empty, for a human to fill in during the test campaign.

It provides:

- **A column set per notebook kind.** The functional notebook carries the query and the steps; the technical one carries the class and method under test instead; the TMA one drops the module and the priority. The kind is derived from the \`ID\` column, or forced with \`--kind\`.
- **The tester's columns left empty:** \`Résultat obtenu\`, \`Commentaire\` and \`Statut\`. Pre-filling them would be answering for the tester.
- **A \`Statut\` column restricted to a value list**, so a campaign can be counted instead of being read.
- **Readable formatting:** frozen bold header on a grey fill, wrapped cells aligned to the top, an autofilter, and a per-module summary sheet with the counts by priority.
- **A round trip that holds.** The workbook this command writes is read back by the very same parser, once the tester has filled in the result columns, so a finished campaign can be re-read without anything being retyped.

### Configuration

None. This command reads a file and writes a file: no org, no project, no provider, no secret.

<details markdown="1">
<summary>Technical explanations</summary>

- **Formula injection guard:** every cell is passed through a guard that prefixes an apostrophe to any value starting with \`=\`, \`+\`, \`-\` or \`@\`. Those are executed by Excel and LibreOffice on open, and a notebook is written by one human and opened by another.
- **CSV shape:** \`;\` delimiter, UTF-8 **with a BOM** so Excel opens the accents on a double click, CRLF line endings, and a summary footer padded to the header width. The reader stops at that footer marker rather than turning the summary rows into malformed test cases.
- **Step rendering:** the steps of a case are rendered into a single cell, numbered, with a separator chosen so the cell can be read back. A real line break in the xlsx, which is also what a tester wants to see; a \`<br>\` in the CSV, because a CSV field has to stay on one physical line.
- **Why not the report writer:** \`generateCsvFile\` writes comma delimited reports with no BOM and decorates them with an Excel table whose theme rewrites the rows. A test notebook needs the opposite shape, and going through the report writer would break the round trip. The report path helper and the IDE notification are reused; the workbook is written directly with ExcelJS.
- **Column width detail:** the priority column is 9.5 characters wide and not 9. ExcelJS treats a width equal to the default column width (9) as "not custom" and omits it on write, so a width of exactly 9 reads back undefined.

</details>
`;

  public static examples = [
    '$ sf hardis:project:test-cases:render --notebook docs/tests/PROJ-123.md',
    '$ sf hardis:project:test-cases:render --notebook docs/tests/PROJ-123.md --format csv',
    '$ sf hardis:project:test-cases:render --notebook cahier.md --format both --outputfile ./PROJ-123.xlsx',
    '$ sf hardis:project:test-cases:render --testsjsonfile cases.json --kind technical',
  ];

  public static flags: any = {
    notebook: Flags.string({
      char: 'n',
      description: 'Notebook file to render: .md, .xlsx or .csv',
    }),
    testsjsonfile: Flags.string({
      description: 'Pre-normalized NormalizedTestCase[] JSON file',
    }),
    'ticket-number': Flags.string({
      description: 'Carrier ticket key, overriding the one derived from the ID column',
    }),
    kind: Flags.string({
      char: 'k',
      options: ['functional', 'technical', 'tma'],
      description: 'Column set to render. Defaults to the kind derived from the ID column',
    }),
    format: Flags.string({
      options: ['xlsx', 'csv', 'both'],
      default: 'xlsx',
      description: 'Output format',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path of the generated notebook',
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

  // Rendering a notebook is independent from any Salesforce project or org.
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(TestCasesRender);
    const cases = await resolveNotebookInput(flags);
    // Every case of one notebook shares its kind, so the first one decides unless forced.
    const kind: TestCaseKind = (flags.kind as TestCaseKind) || cases[0]?.kind || 'functional';

    uxLog('action', this, c.cyan(t('testCasesRendering', { count: cases.length, kind })));

    const writtenFiles: string[] = [];
    if (flags.format === 'xlsx' || flags.format === 'both') {
      const target = await generateReportPath('test-cases', this.outputFileFor(flags, '.xlsx'), {
        fileExtension: 'xlsx',
      });
      writtenFiles.push(await writeNotebookXlsx(target, kind, cases));
    }
    if (flags.format === 'csv' || flags.format === 'both') {
      const target = await generateReportPath('test-cases', this.outputFileFor(flags, '.csv'), {
        fileExtension: 'csv',
      });
      writtenFiles.push(await writeNotebookCsv(target, kind, cases));
    }

    for (const file of writtenFiles) {
      uxLog('log', this, c.grey(`- ${file}`));
      WebSocketClient.sendReportFileMessage(file, t('testCasesNotebookReport'), 'report');
    }
    uxLog('success', this, c.green(t('testCasesRendered', { count: cases.length, files: writtenFiles.length })));
    return { outputString: `Rendered ${cases.length} test case(s)`, kind, files: writtenFiles };
  }

  /**
   * With `--format both`, one `--outputfile` cannot name two files: the extension asked for
   * decides, so the user gets `cahier.xlsx` and `cahier.csv` rather than one overwriting the
   * other.
   */
  private outputFileFor(flags: any, extension: string): string {
    if (!flags.outputfile) {
      return '';
    }
    return flags.outputfile.replace(/\.(xlsx|csv)$/i, '') + extension;
  }
}
