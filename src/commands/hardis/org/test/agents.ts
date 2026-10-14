import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { getSeverityIcon } from '../../../../common/utils/notifUtils.js';
import { prepareOrgNotificationContext } from '../../../../common/utils/orgNotificationContext.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { CONSTANTS } from '../../../../config/index.js';
import { t } from '../../../../common/utils/i18n.js';
import {
  AgentTestAssertionResult,
  AgentTestRunSummary,
  listAgentTestDefinitions,
  runAgentTest,
} from '../../../../common/utils/agentTestUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgTestAgents extends SfCommand<any> {
  public static title = 'Run agent tests';

  public static description = `Run Agentforce agent tests (AiEvaluationDefinition metadata) in a Salesforce org.

## Command Behavior

- **Discovers all agent tests:** Lists every AiEvaluationDefinition available in the org using \`sf agent test list\`.
- **Runs each test:** Executes \`sf agent test run\` for each definition and waits for completion (override the wait with env var \`SFDX_TEST_WAIT_MINUTES\`, default 60 minutes).
- **Aggregates results:** Reports pass/fail at the test-case and assertion level. The command fails (exit code 1) if any assertion does not pass.
- **CSV report:** Generates a report listing every assertion with its expected and actual values.
- **Notifications:** Sends alerts to Grafana, Slack and MS Teams when agent tests fail.

Use \`--tests\` to run only specific agent tests (comma-separated API names) instead of all of them. In interactive mode (not \`--agent\`, not in CI), a prompt lets you unselect the agent tests you want to skip, with all of them selected by default.

This command requires the \`@salesforce/plugin-agent\` Salesforce CLI plugin. Install it with \`sf plugins install @salesforce/plugin-agent\`.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-agent-tests/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

- Calls \`sf agent test list --json\` to enumerate AiEvaluationDefinition components, then \`sf agent test run --api-name <name> --wait <minutes> --json\` for each one (synchronous, no polling).
- Parses the \`testCases[].testResults[]\` array of each run: an assertion passes when its \`result\` is \`PASS\`; a test case passes when all its assertions pass.
- A run whose overall status is not \`COMPLETED\` is treated as an error and flips the notification severity.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:test:agents --agent
\`\`\`

In agent mode the command runs fully automatically. There are no interactive prompts; the wait time defaults to \`SFDX_TEST_WAIT_MINUTES\` (60 minutes) and all agent tests found in the org are run unless \`--tests\` is provided.
`;

  public static examples = [
    '$ sf hardis:org:test:agents',
    '$ sf hardis:org:test:agents --tests Mercury_Referral_Agent_Eval',
    '$ sf hardis:org:test:agents --outputfile ./reports/agent-tests.csv',
    '$ sf hardis:org:test:agents --agent',
  ];

  public static flags: any = {
    tests: Flags.string({
      char: 't',
      description: 'Comma-separated list of agent test API names to run. Runs all tests found in the org when not provided.',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
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
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = false;

  protected debugMode = false;
  protected outputFile: any = null;
  protected outputFilesRes: any = {};

  /* jscpd:ignore-start */
  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgTestAgents);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;
    const agentMode = flags.agent === true;
    const conn = flags['target-org'].getConnection();
    const orgUsername = flags['target-org']?.getUsername() || null;
    const orgInstanceUrl = conn?.instanceUrl || '';
    const { orgMarkdown, notifButtons } = await prepareOrgNotificationContext(conn);
    /* jscpd:ignore-end */

    uxLog('action', this, c.cyan(t('runningAgentTestsInOrg', { orgInstanceUrl })));

    // Discover agent test definitions (throws AgentPluginMissingError with an actionable message if the plugin is absent)
    const definitions = await listAgentTestDefinitions(orgUsername, this, this.debugMode);

    // No agent tests in the org: mirror the apex "NoApex" path (informational, no failure)
    if (definitions.length === 0) {
      const statusMessage = t('noAgentTestsFound');
      uxLog('log', this, c.grey(statusMessage));
      await NotifProvider.postNotifications({
        type: 'AGENT_TESTS',
        text: `${statusMessage} (${orgMarkdown})`,
        buttons: notifButtons,
        severity: 'log',
        logElements: [],
        data: { metric: 0 },
        metrics: { AgentTestsFailingCases: 0, AgentTestsTotalCases: 0 },
      });
      return { orgId: flags['target-org'].getOrgId(), outputString: statusMessage, statusCode: 0 };
    }

    // Select which agent tests to run: --tests flag, then interactive prompt, else all
    let definitionsToRun = definitions;
    if (flags.tests) {
      // Explicit --tests flag: run only the named definitions
      const requested = (flags.tests as string).split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      const availableNames = definitions.map((d) => d.apiName);
      for (const name of requested) {
        if (!availableNames.includes(name)) {
          uxLog('warning', this, c.yellow(t('agentTestDefinitionNotFound', { definition: name })));
        }
      }
      definitionsToRun = definitions.filter((d) => requested.includes(d.apiName));
    } else if (!isCI && !agentMode) {
      // Interactive mode: let the user unselect the agent tests to skip (all selected by default)
      const promptRes = await prompts({
        type: 'multiselect',
        name: 'value',
        message: t('selectAgentTestsToRun'),
        description: t('unselectAgentTestsToSkip'),
        choices: definitions.map((d) => ({ title: d.apiName, value: d.apiName, selected: true })),
      });
      const selected: string[] = promptRes.value || [];
      if (selected.length === 0) {
        const statusMessage = t('noAgentTestsSelected');
        uxLog('action', this, c.cyan(statusMessage));
        return { orgId: flags['target-org'].getOrgId(), outputString: statusMessage, statusCode: 0 };
      }
      definitionsToRun = definitions.filter((d) => selected.includes(d.apiName));
    }

    // Run each agent test definition
    const summaries: AgentTestRunSummary[] = [];
    for (const definition of definitionsToRun) {
      const summary = await runAgentTest(definition.apiName, orgUsername, this, this.debugMode);
      if (summary.parseError) {
        uxLog('warning', this, c.yellow(t('warningUnableToParseAgentTestResults', { definition: summary.definition }) + (summary.rawError || '')));
      }
      summaries.push(summary);
    }

    // Aggregate results
    const allAssertions: AgentTestAssertionResult[] = summaries.flatMap((s) => s.assertions);
    const totalCases = summaries.reduce((acc, s) => acc + s.totalCases, 0);
    const passedCases = summaries.reduce((acc, s) => acc + s.passedCases, 0);
    const failedCases = summaries.reduce((acc, s) => acc + s.failedCases, 0);
    const failedAssertions = summaries.reduce((acc, s) => acc + s.failedAssertions, 0);
    const hasError = summaries.some((s) => s.outcome === 'Error');
    const hasFailure = failedCases > 0 || failedAssertions > 0 || hasError;

    uxLog('action', this, c.cyan(t('agentTestsCompletedWithOutcome', { passed: passedCases, total: totalCases })));

    // Display failing assertions
    const failingAssertions = allAssertions.filter((a) => a.Result !== 'PASS');
    if (failingAssertions.length > 0) {
      uxLog('warning', this, c.yellow(t('failingAgentTests')));
      uxLogTable(this, failingAssertions);
    } else if (!hasError) {
      uxLog('success', this, c.green(t('agentTestsPassed', { total: totalCases })));
    }

    // Generate CSV report
    this.outputFile = await generateReportPath('agent-tests', this.outputFile);
    this.outputFilesRes = await generateCsvFile(allAssertions, this.outputFile, {
      fileTitle: 'Agent Tests Results',
    });

    // Notifications
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `All agent tests passed (**${passedCases}/${totalCases}** test cases) in ${orgMarkdown}`;
    const notifAttachments: any[] = [];
    if (hasFailure) {
      notifSeverity = 'error';
      notifText = `Agent tests failed (**${failedCases}/${totalCases}** test cases) in ${orgMarkdown}`;
      const detailText = failingAssertions
        .slice(0, 20)
        .map((a) => `- **${a.Definition}** (test ${a.TestCaseNumber}) ${a.Expectation}: expected \`${a.ExpectedValue}\`, got \`${a.ActualValue}\``)
        .join('\n');
      if (detailText) {
        notifAttachments.push({
          text: failingAssertions.length > 20 ? `${detailText}\n... and ${failingAssertions.length - 20} more` : detailText,
        });
      }
    }

    const logElements = failingAssertions.map((a) => ({
      ...a,
      severity: 'error',
      severityIcon: getSeverityIcon('error'),
    }));

    await NotifProvider.postNotifications({
      type: 'AGENT_TESTS',
      text: notifText,
      attachments: notifAttachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: logElements,
      data: { metric: failedCases },
      metrics: {
        AgentTestsFailingCases: failedCases,
        AgentTestsTotalCases: totalCases,
        AgentTestsFailingAssertions: failedAssertions,
      },
    });

    // Handle output message & exit code
    if (hasFailure) {
      process.exitCode = 1;
      uxLog('error', this, c.red(`Agent tests failed (${failedCases}/${totalCases} test cases)`));
    } else {
      uxLog('success', this, c.green(`Agent tests passed (${passedCases}/${totalCases} test cases)`));
    }

    return {
      orgId: flags['target-org'].getOrgId(),
      outputString: notifText,
      statusCode: process.exitCode,
      totalCases,
      passedCases,
      failedCases,
      failedAssertions,
      outputFile: this.outputFile,
    };
  }
}
