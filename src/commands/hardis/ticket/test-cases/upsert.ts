/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { resolveNotebookInput } from '../../../../common/utils/testNotebookInput.js';
import { assertPushable } from '../../../../common/utils/testNotebookGuards.js';
import {
  getInstances,
  pushCases,
  describeRequiredEnvVars,
} from '../../../../common/testManagementProvider/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class TicketTestCasesUpsert extends SfCommand<any> {
  public static title = 'Upsert the test cases of a ticket';

  public static description = `
## Command Behavior

**Sends the test cases of a notebook to Azure DevOps, ServiceNow Test Management or Xray Cloud, creating what does not exist yet and updating what does.**

This is the second half of the chain. [hardis:ticket:test-cases:init](https://sfdx-hardis.cloudity.com/hardis/ticket/test-cases/init/) writes the notebook from the test cases an agent drafted, a human reviews and corrects it in Excel, and this command sends the corrected version to the test management tool the team actually uses. It runs **without any AI involvement**: a notebook committed next to the code plus a CI job keeps the tracker in sync at every merge.

It provides:

- **Upsert, not blind insert.** Every case carries the key \`TESTKIT:<TICKET>:<ID>\`. A second run updates the cases it already created instead of duplicating them, which is what makes the command safe in a pipeline.
- **Refusal of an unfinished notebook.** A case still holding the completion marker, an unsubstituted template token, or a stringified \`null\` blocks the **whole** upsert, listing every offender at once. Sending half a notebook to a client tracker only creates cleanup work.
- **Best effort per case.** One case failing does not abandon the others, and one provider being unreachable does not block the rest. The command returns 0 when everything went through, 2 when some cases failed, and 1 when nothing could even be attempted.
- **A dry run** (\`--dry-run\`) that validates the notebook and probes every provider without writing anything.
- **A CSV and XLSX report** of what was created, updated or failed, with the tracker id and URL of each case.

### Provider detection

Providers turn themselves on from their own environment variables, so there is nothing to declare in the configuration and \`--provider\` is only needed to narrow down to one of them:

| \`--provider\` | Target | What is written |
|----------------|--------|-----------------|
| \`azure-devops\` | Azure DevOps | A Test Case work item, tagged, with its steps as \`Microsoft.VSTS.TCM.Steps\` |
| \`servicenow\` | ServiceNow Test Management 2.0 | A test, its version, and one step record per step |
| \`xray\` | Xray Cloud on Jira | A Jira Test issue with its steps, labelled |

\`--provider\` only ever **narrows**: a provider whose variables are unset stays inactive even when named explicitly, so the flag can never be a way around authentication.

### Configuration

The command reuses the variables sfdx-hardis already documents, read from CI/CD variables or from a local **.env** file:

- **Azure DevOps:** \`SYSTEM_COLLECTIONURI\` + \`SYSTEM_TEAMPROJECT\` + (\`CI_SFDX_HARDIS_AZURE_TOKEN\` or \`SYSTEM_ACCESSTOKEN\`)
- **ServiceNow:** \`SERVICENOW_URL\` + \`SERVICENOW_USERNAME\` + \`SERVICENOW_PASSWORD\`
- **Xray:** \`XRAY_CLIENT_ID\` + \`XRAY_CLIENT_SECRET\` + \`JIRA_HOST\` + \`JIRA_PROJECT_KEY\` + \`JIRA_EMAIL\` + \`JIRA_TOKEN\`, plus \`XRAY_REGION\` (\`us\`, \`eu\` or \`au\`) when the instance is not on the global endpoint

When no provider is active, the command names the variables that would have to be set rather than reporting an empty result.

<details markdown="1">
<summary>Technical explanations</summary>

- **Idempotency key:** \`TESTKIT:<TICKET>:<SHORT ID>\`, the short id being the identifier stripped of its ticket prefix. Cases already sent carry this exact string, so it is covered by a non-regression test.
- **Azure DevOps context inheritance:** \`System.AreaPath\`, \`System.IterationPath\` and \`System.AssignedTo\` are read from the carrier work item and copied onto each case. Without the area path, Azure DevOps rejects the very first case with a 403. The carrier is read once per run, not once per case, and a carrier that cannot be read fails the run before anything is written. An unassigned carrier leaves the cases unassigned: no recipient is ever invented.
- **Carrier work item number:** the last group of digits of the ticket key, so \`DSI-11533\` and \`DSI-2026-11533\` both resolve to work item 11533. A ticket key carrying no digits raises rather than asking the API for item \`NaN\`.
- **Text conversion:** the Azure DevOps description is HTML, so the notebook text is escaped **first** and only then are its \`[label](url)\`, \`\`code\`\` and \`**bold**\` constructs turned into tags. Reversing the two would open an HTML injection. The ServiceNow and Jira descriptions are plain text, so a markdown link is reduced to its bare URL instead of showing literal brackets.
- **Proxy support:** the ServiceNow and Xray calls go through the shared proxy-aware HTTP client, so \`HTTP_PROXY\` / \`HTTPS_PROXY\` / \`NO_PROXY\` are honored.

</details>

### Agent Mode

Use \`--agent\` to disable all interactive prompts. In agent mode the confirmation asked before any write is skipped, so the flags must carry everything: a notebook (\`--notebook\` or \`--testsjsonfile\`) is required, and the provider variables must be set in the environment.

\`\`\`sh
sf hardis:ticket:test-cases:upsert --notebook docs/tests/DSI-11533.xlsx --agent
\`\`\`

The same skip applies in CI, where \`isCI\` is true.

### Known limitations

- **Azure DevOps cases are created isolated:** they are linked to their carrier user story, but attached to no Test Plan and no Test Suite. Adding them to a plan stays a human action.
- **ServiceNow idempotency rests on the title.** Test Management 2.0 exposes no portable correlation field on \`sn_test_management_test\`, so idempotency relies on the \`[TESTKIT:<TICKET>:<ID>]\` prefix of \`short_description\`. Renaming a test case in ServiceNow breaks the match, and the next run creates a duplicate instead of updating it. Keep the prefix in the title.
- **ServiceNow updates do not touch the steps** of an existing test version: replacing them would delete rows a tester may already have executed against.
- **Xray updates do not touch the steps** either: the steps live on the Xray side and the mutation that writes them is \`createTest\`, with no update counterpart, so a corrected step list needs the test to be recreated. The summary, description, priority and labels are updated.
- **No ADF conversion on the Jira description:** it is sent as a plain string, so it renders without formatting.
- **Return codes:** 0 when every case went through, 2 when some failed, 1 when nothing could be attempted.
`;

  public static examples = [
    '$ sf hardis:ticket:test-cases:upsert --notebook docs/tests/DSI-11533.xlsx',
    '$ sf hardis:ticket:test-cases:upsert --notebook docs/tests/DSI-11533.xlsx --dry-run',
    '$ sf hardis:ticket:test-cases:upsert --notebook cahier.xlsx --provider azure-devops',
    '$ sf hardis:ticket:test-cases:upsert --testsjsonfile cases.json --agent',
  ];

  public static flags: any = {
    notebook: Flags.string({
      char: 'n',
      description: 'Notebook to upsert, as reviewed by a human: .md, .xlsx or .csv',
    }),
    testsjsonfile: Flags.string({
      char: 'j',
      description: 'Pre-normalized NormalizedTestCase[] JSON file, for a pipeline that skips the notebook',
    }),
    'ticket-number': Flags.string({
      description: 'Carrier ticket key, overriding the one derived from the ID column',
    }),
    provider: Flags.string({
      char: 'p',
      options: ['azure-devops', 'servicenow', 'xray'],
      description: 'Narrow the upsert to a single provider instead of using every configured one',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'Validate the notebook and probe the providers, write nothing',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path of the generated upsert report',
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

  // Upserting a notebook is independent from any Salesforce project or org: a tester holding
  // only a workbook must be able to run it.
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(TicketTestCasesUpsert);
    const cases = await resolveNotebookInput(flags);
    // A notebook that parses to nothing is a failure, not a no-op. Left unchecked it would
    // report "0 created, 0 updated, 0 failed" in green and exit 0, so a CI job syncing an
    // empty or mis-parsed notebook would stay green while syncing nothing at all.
    if (cases.length === 0) {
      throw new SfError(t('testCasesNoneFound'));
    }
    // An incomplete notebook is refused whole, before any provider is even built.
    assertPushable(cases);

    const providers = getInstances(flags.provider);
    if (providers.length === 0) {
      throw new SfError(t('testCasesNoActiveProvider') + '\n' + describeRequiredEnvVars(flags.provider));
    }

    if (!(await this.confirmUpsert(flags, cases.length, providers.map((provider) => provider.getLabel())))) {
      return { outputString: 'Upsert cancelled', upserted: 0 };
    }

    // Opens the section the provider warnings and the result table belong to: after the
    // confirmation prompt, the VS Code UI hides anything that is not an action line.
    uxLog('action', this, c.cyan(t('pushingTestCases', { count: cases.length })));
    const report = await pushCases(providers, cases, { dryRun: flags['dry-run'], provider: flags.provider });

    const reportFile = await generateReportPath('test-cases-upsert', flags.outputfile, { withDate: true });
    await generateCsvFile(report.rows, reportFile, { fileTitle: 'Test cases upsert' });

    uxLogTable(this, report.rows, ['provider', 'caseId', 'action', 'trackerId', 'url']);
    if (report.exitCode !== 0) {
      uxLog('warning', this, c.yellow(`[TestCasesUpsert] ${report.message}`));
      process.exitCode = report.exitCode;
    } else {
      uxLog('success', this, c.green(`[TestCasesUpsert] ${report.message}`));
    }
    // PushReport is a declared interface, not an index-signature map: cast for the AnyJson result
    return { outputString: report.message, ...report } as unknown as AnyJson;
  }

  /**
   * The consent that used to be a boolean a model typed into a shell string is now an
   * interactive confirmation, with CI and --agent as the two explicit ways to skip it.
   */
  private async confirmUpsert(flags: any, caseCount: number, labels: string[]): Promise<boolean> {
    if (flags['dry-run'] || flags.agent || isCI) {
      return true;
    }
    uxLog('action', this, c.cyan(t('testCasesAboutToPush', { count: caseCount, providers: labels.join(', ') })));
    const answer = await prompts({
      type: 'confirm',
      name: 'value',
      message: t('testCasesConfirmPush', { count: caseCount }),
      description: t('testCasesConfirmPushDescription'),
      initial: false,
    });
    if (answer.value !== true) {
      // A prompt must be followed by an action line, or the VS Code UI shows nothing at all.
      uxLog('action', this, c.cyan(t('testCasesPushCancelled')));
      return false;
    }
    return true;
  }
}
