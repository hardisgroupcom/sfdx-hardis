/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { assertPushable, resolveNotebookInput } from '../../../../common/utils/testNotebookUtils.js';
import {
  buildTestManagementProviders,
  describeRequiredSettings,
  pushCases,
  selectTestManagementProvider,
  TEST_MANAGEMENT_PROVIDER_KEYS,
} from '../../../../common/testManagementProvider/index.js';
import { TestManagementProviderRoot } from '../../../../common/testManagementProvider/testManagementProviderRoot.js';
import { getConfig } from '../../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class TicketTestCasesUpsert extends SfCommand<any> {
  public static title = 'Upsert the test cases of a ticket';

  public static description = `
## Command Behavior

**Sends the test cases of a notebook to Azure DevOps, ServiceNow Test Management or Xray Cloud, creating the missing ones and updating the others.**

[hardis:ticket:test-cases:init](https://sfdx-hardis.cloudity.com/hardis/ticket/test-cases/init/) writes the notebook, a tester reviews it, and this command sends the reviewed version to the test management tool. No AI is involved: a notebook committed next to the code and a CI job keep the tool in sync.

- **Upsert:** every case carries the key \`TESTKIT:<TICKET>:<SHORT ID>\`. A second run updates the cases it created instead of duplicating them.
- **Unfinished notebooks are refused:** an empty title or expected result, a \`TO BE COMPLETED\` marker, a template token such as \`{SCENARIO_TITLE}\` or a literal \`null\` blocks the whole upsert, and every problem is listed at once.
- **Updates keep what the team changed in the tool:** assignee, area, iteration and labels added by hand stay, and a column the notebook does not have (priority, steps...) is not sent.
- **Best effort per case:** one case failing does not stop the others. Exit code 0 when everything went through, 2 when some cases failed, 1 when nothing could be attempted.
- **Dry run** (\`--dry-run\`): checks the notebook, the connection and the carrier tickets, and tells which cases would be created or updated, without writing anything.
- **Report:** a CSV and XLSX file with the action, tracker id and URL of each case.

### Choosing the test management tool

The tool is never guessed from the environment variables that happen to be set, because the sfdx-hardis CI templates already set the Azure DevOps ones on every Azure pipeline:

1. \`--provider\` (\`azure-devops\`, \`servicenow\` or \`xray\`)
2. else the \`testCasesProvider\` property of \`config/.sfdx-hardis.yml\`
3. else, in an interactive session, a prompt listing the configured tools. In CI and in agent mode the command fails instead.

### Configuration

The variables sfdx-hardis already uses for these tools, from CI/CD variables or a local **.env** file:

| Tool | What is written | Settings |
|------|-----------------|----------|
| \`azure-devops\` | A Test Case work item with its steps, tagged and linked to its user story | \`CI_SFDX_HARDIS_AZURE_TOKEN\` (or \`SYSTEM_ACCESSTOKEN\` or \`AZURE_DEVOPS_EXT_PAT\`), plus \`SYSTEM_COLLECTIONURI\` and \`SYSTEM_TEAMPROJECT\`, read from the git remote when unset |
| \`servicenow\` | A Test Management 2.0 test, its version and its steps | \`SERVICENOW_URL\`, \`SERVICENOW_USERNAME\`, \`SERVICENOW_PASSWORD\` |
| \`xray\` | A Jira Test issue with its steps, labelled and linked to its story | \`XRAY_CLIENT_ID\`, \`XRAY_CLIENT_SECRET\`, \`JIRA_HOST\` (or \`jiraHost\` config), \`JIRA_PROJECT_KEY\`, \`JIRA_EMAIL\`, \`JIRA_TOKEN\`, and \`XRAY_REGION\` (\`us\`, \`eu\` or \`au\`) when not on the global endpoint |

<details markdown="1">
<summary>Technical explanations</summary>

- **Idempotency key:** \`TESTKIT:<TICKET>:<SHORT ID>\`, the ticket being the one of the identifier, so \`--ticket-number\` never changes it. Azure DevOps stores it as a tag, Xray as a label, ServiceNow as a \`[TESTKIT:...]\` prefix of the test short description. Every search result is checked against the exact key before it is updated.
- **Carrier ticket:** the ticket of the identifier, or \`--ticket-number\`. Azure DevOps uses its last group of digits as work item number (\`PROJ-2026-14545\` gives 14545), and reads that work item before any write: a missing one refuses the run. A new test case inherits its area, iteration and assignee; an unassigned story leaves the test case unassigned.
- **Descriptions** are written in English whatever the language of sfdx-hardis, so runs from different machines do not rewrite each other. Azure DevOps descriptions are HTML: the text is escaped first, then links, \`code\` and \`**bold**\` become tags. ServiceNow and Jira descriptions are plain text, where a markdown link becomes its URL.
- **ServiceNow steps:** Test Management 2.0 has no expected result field on \`sn_test_management_step\`, so the expected result is written in the step text, after \`Expected result:\`.
- **Proxy:** ServiceNow and Xray calls go through the proxy-aware HTTP client (\`HTTP_PROXY\`, \`HTTPS_PROXY\`, \`NO_PROXY\`).

</details>

### Agent Mode

Use \`--agent\` to disable all interactive prompts: the confirmation before writing is skipped, and the tool must come from \`--provider\` or from the \`testCasesProvider\` configuration.

\`\`\`sh
sf hardis:ticket:test-cases:upsert --notebook docs/tests/PROJ-123.xlsx --provider xray --agent
\`\`\`

The same applies in CI.

### Known limitations

- **Azure DevOps test cases are not added to a Test Plan nor a Test Suite.**
- **ServiceNow matching uses the title prefix:** removing \`[TESTKIT:...]\` from a test short description in ServiceNow makes the next run create a duplicate.
- **ServiceNow and Xray updates do not change the steps:** ServiceNow steps may already have been run, and Xray has no mutation to update the steps of a test.
- **Jira descriptions have no formatting:** they are sent as plain text.
- **A partial create is not repaired by a rerun:** a failed story link, reported with the tracker id, has to be added by hand, and a ServiceNow test whose version or steps failed, reported with its URL, has to be completed or deleted by hand.
`;

  public static examples = [
    '$ sf hardis:ticket:test-cases:upsert --notebook docs/tests/PROJ-123.xlsx',
    '$ sf hardis:ticket:test-cases:upsert --notebook docs/tests/PROJ-123.xlsx --provider azure-devops --dry-run',
    '$ sf hardis:ticket:test-cases:upsert --testsjsonfile cases.json --provider xray --agent',
    '$ sf hardis:ticket:test-cases:upsert --notebook docs/tests/PROJ-123.xlsx --agent',
  ];

  public static flags: any = {
    notebook: Flags.string({
      char: 'n',
      description: 'Notebook to upsert: .md, .xlsx or .csv',
    }),
    testsjsonfile: Flags.string({
      char: 'j',
      description: 'NormalizedTestCase[] JSON file, for a pipeline that skips the notebook',
    }),
    'ticket-number': Flags.string({
      description: 'Carrier ticket the test cases are linked to, instead of the one of their ID',
    }),
    provider: Flags.string({
      char: 'p',
      options: TEST_MANAGEMENT_PROVIDER_KEYS,
      description: 'Test management tool to send the test cases to. Defaults to the testCasesProvider configuration',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'Check the notebook and the tool, and list what would be created or updated, without writing',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Path of the generated upsert report',
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

  // A tester holding only a notebook must be able to run it
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(TicketTestCasesUpsert);
    const nonInteractive = flags.agent === true || isCI;
    const cases = await resolveNotebookInput(flags);
    // A notebook read as empty must fail, or a CI job would stay green while syncing nothing
    if (cases.length === 0) {
      throw new SfError(t('testCasesNoneFound'));
    }
    assertPushable(cases);

    const provider = await this.resolveProvider(flags.provider, nonInteractive);
    if (!(await this.confirmUpsert(flags, nonInteractive, cases.length, provider.getLabel()))) {
      return { outputString: t('testCasesPushCancelled'), upserted: 0 };
    }

    uxLog('action', this, c.cyan(t('pushingTestCases', { count: cases.length })));
    const report = await pushCases(provider, cases, { dryRun: flags['dry-run'] });

    // Every row gets every column: the report header is built from the first row
    const rows = report.rows.map((row) => ({
      provider: row.provider,
      caseId: row.caseId,
      action: row.action,
      trackerId: row.trackerId ?? '',
      url: row.url ?? '',
      error: row.error ?? '',
    }));
    uxLogTable(this, rows, ['provider', 'caseId', 'action', 'trackerId', 'url', 'error']);
    const reportFile = await generateReportPath('test-cases-upsert', flags.outputfile, { withDate: true });
    await generateCsvFile(rows, reportFile, { fileTitle: t('testCasesUpsertReport') });

    if (report.exitCode !== 0) {
      uxLog('warning', this, c.yellow(report.message));
      process.exitCode = report.exitCode;
    } else {
      uxLog('success', this, c.green(report.message));
    }
    return { outputString: report.message, ...report } as unknown as AnyJson;
  }

  /** --provider, then the testCasesProvider configuration, then a prompt in interactive sessions. */
  private async resolveProvider(flagValue: string | undefined, nonInteractive: boolean): Promise<TestManagementProviderRoot> {
    const config = await getConfig('user');
    const providers = await buildTestManagementProviders(config);
    let key = flagValue || config.testCasesProvider;
    if (!key) {
      const configured = providers.filter((descriptor) => descriptor.provider.isActive);
      if (configured.length === 0) {
        throw new SfError(t('testCasesNoActiveProvider') + '\n' + describeRequiredSettings(providers));
      }
      if (nonInteractive) {
        throw new SfError(t('testCasesProviderRequired', { providers: configured.map((descriptor) => descriptor.key).join(', ') }));
      }
      const answer = await prompts({
        type: 'select',
        name: 'value',
        message: t('testCasesPromptProvider'),
        description: t('testCasesPromptProviderDescription'),
        choices: configured.map((descriptor) => ({ title: descriptor.provider.getLabel(), value: descriptor.key })),
      });
      key = answer.value;
      uxLog('action', this, c.cyan(t('testCasesProviderSelected', { provider: key })));
    }
    return selectTestManagementProvider(providers, String(key));
  }

  /** Confirmation before writing, skipped in dry run, in CI and in agent mode. */
  private async confirmUpsert(flags: any, nonInteractive: boolean, caseCount: number, label: string): Promise<boolean> {
    if (flags['dry-run'] || nonInteractive) {
      return true;
    }
    uxLog('action', this, c.cyan(t('testCasesAboutToPush', { count: caseCount, providers: label })));
    const answer = await prompts({
      type: 'confirm',
      name: 'value',
      message: t('testCasesConfirmPush', { count: caseCount }),
      description: t('testCasesConfirmPushDescription'),
      initial: false,
    });
    if (answer.value !== true) {
      uxLog('action', this, c.cyan(t('testCasesPushCancelled')));
      return false;
    }
    return true;
  }
}
