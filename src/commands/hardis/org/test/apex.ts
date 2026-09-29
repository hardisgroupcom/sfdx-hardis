import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from '../../../../common/utils/fsUtils.js';
import * as path from 'path';
import { extractRegexMatchesMultipleGroups, uxLog } from '../../../../common/utils/index.js';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { CONSTANTS, getConfig, getEnvVar, getReportDirectory } from '../../../../config/index.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { generateApexCoverageOutputFile } from '../../../../common/utils/deployUtils.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import { runApexTestsResilient } from '../../../../common/utils/apexTestUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgTestApex extends SfCommand<any> {
  public static title = 'Run apex tests';

  public static description = `Run apex tests in Salesforce org

If following configuration is defined, it will fail if apex coverage target is not reached:

- Env \`APEX_TESTS_MIN_COVERAGE_ORG_WIDE\` or \`.sfdx-hardis\` property \`apexTestsMinCoverageOrgWide\`
- Env \`APEX_TESTS_MIN_COVERAGE_ORG_WIDE\` or \`.sfdx-hardis\` property \`apexTestsMinCoverageOrgWide\`

You can override env var SFDX_TEST_WAIT_MINUTES to wait more than 60 minutes.

## Command Behavior

- Starts the Apex tests asynchronously, then checks every 30 seconds whether the test run is over.
- Network errors while talking to the org (for example \`fetch failed\` during a long nightly run) are retried, so a short outage does not fail the job.
- If the results still cannot be retrieved, the notification says so and no coverage metric is sent, instead of reporting failed tests and a 0% coverage.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-apex-tests/) and can output Grafana, Slack and MsTeams Notifications.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:test:apex --agent
\`\`\`

In agent mode, all interactive prompts are skipped and default values are used.

<details markdown="1">
<summary>Technical explanations</summary>

- Runs \`sf apex run test --test-level <level> --json\` without \`--wait\` to get the test run id.
- Polls \`AsyncApexJob.Status\` until \`Completed\`, \`Failed\` or \`Aborted\`, within \`SFDX_TEST_WAIT_MINUTES\` (default 60).
- Downloads results with \`sf apex get test --test-run-id <id> --code-coverage --result-format human --output-dir <reportDir>\`.
- Transient network errors (\`fetch failed\`, \`ECONNRESET\`, \`ETIMEDOUT\`, \`socket hang up\`...) are retried on every call to the org.

</details>
`;

  public static examples = ['$ sf hardis:org:test:apex',
    '$ sf hardis:org:test:apex --agent',];

  public static flags: any = {
    testlevel: Flags.string({
      char: 'l',
      default: 'RunLocalTests',
      options: ['NoTestRun', 'RunSpecifiedTests', 'RunLocalTests', 'RunAllTestsInOrg'],
      description: messages.getMessage('testLevel'),
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

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  // protected static requiresProject = true;

  protected configInfo: any = {};
  protected testRunOutcome: string;
  protected testRunOutputString: string;
  protected testRunId: string | null = null;
  protected statusMessage: string;
  protected coverageTarget = 75.0;
  protected coverageValue = 0.0;
  protected failingTestClasses: any[] = [];
  private notifSeverity: NotifSeverity = 'log';
  private notifText: string;
  private notifAttachments: any = [];
  private notifAttachedFiles: any = [];
  private orgMarkdown = '';
  private notifButtons: any[] = [];

  /* jscpd:ignore-start */
  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgTestApex);
    const testlevel = flags.testlevel || 'RunLocalTests';
    const debugMode = flags.debug || false;

    this.configInfo = await getConfig('branch');
    const orgInstanceUrl = flags['target-org']?.getConnection()?.instanceUrl || '';
    this.orgMarkdown = await getOrgMarkdown(orgInstanceUrl);
    this.notifButtons = await getNotificationButtons();
    /* jscpd:ignore-end */
    uxLog("action", this, c.cyan(t('runningApexTestsInOrgWithTest', { orgInstanceUrl, testlevel })));
    await this.runApexTests(testlevel, debugMode, flags['target-org']?.getUsername(), flags['target-org']?.getConnection());
    uxLog("action", this, c.cyan(t('apexTestsCompletedWithOutcome', { testRunOutcome: this.testRunOutcome })));
    // No Apex
    if (this.testRunOutcome === 'NoApex') {
      this.notifSeverity = 'log';
      this.statusMessage = 'No Apex found in the org';
      this.notifText = `No Apex found in org ${this.orgMarkdown}`;
      uxLog("log", this, c.grey(this.statusMessage));
    }
    // Failed tests
    else if (this.testRunOutcome === 'Failed') {
      await this.processApexTestsFailure();
    }
    // Tests results could not be retrieved: do not report fake failures or a 0% coverage
    else if (this.testRunOutcome === 'NetworkError') {
      this.processApexTestsNetworkError();
    }
    else if (this.testRunOutcome === 'Passed') {
      uxLog("success", this, c.green(t('apexTestsPassed', { testRunOutcome: this.testRunOutcome })));
    }
    // Get test coverage (and fail if not reached)
    await this.checkOrgWideCoverage();
    await this.checkTestRunCoverage();

    if (this.testRunOutcome !== 'NoApex' && this.testRunOutcome !== 'NetworkError') {
      uxLog("other", this, `Apex coverage: ${this.coverageValue}% (target: ${this.coverageTarget}%)`);
    }

    await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'APEX_TESTS',
      text: this.notifText,
      attachments: this.notifAttachments,
      buttons: this.notifButtons,
      severity: this.notifSeverity,
      attachedFiles: this.notifAttachedFiles,
      logElements: this.failingTestClasses,
      data: {
        metric: this.failingTestClasses.length,
        coverageTarget: this.coverageTarget,
        coverageValue: this.coverageValue,
      },
      // No metrics when results could not be retrieved, so Grafana does not show a fake 0% coverage
      metrics: this.testRunOutcome === 'NetworkError' ? {} : {
        ApexTestsFailingClasses: this.failingTestClasses.length,
        ApexTestsCodeCoverage: this.coverageValue,
      },
    });

    // Handle output message & exit code
    if (this.notifSeverity === 'error') {
      process.exitCode = 1;
      uxLog("error", this, c.red(this.statusMessage));
    } else {
      uxLog("success", this, c.green(this.statusMessage));
    }

    return { orgId: flags['target-org'].getOrgId(), outputString: this.statusMessage, statusCode: process.exitCode };
  }

  private async runApexTests(testlevel: any, debugMode: any, orgUsername: string | null, conn: Connection) {
    const reportDir = await getReportDirectory();
    const testRunRes = await runApexTestsResilient({
      testLevel: testlevel,
      orgUsername,
      conn,
      reportDir,
      waitMinutes: parseInt(getEnvVar("SFDX_TEST_WAIT_MINUTES") || '60', 10),
      debugMode,
      commandThis: this,
    });
    this.testRunOutputString = testRunRes.outputString;
    if (testRunRes.status === 'noApex') {
      this.testRunOutcome = 'NoApex';
      return;
    }
    if (testRunRes.status === 'networkError') {
      this.testRunOutcome = 'NetworkError';
      this.testRunId = testRunRes.testRunId;
      return;
    }
    if (testRunRes.status === 'timeout') {
      this.testRunOutcome = 'Failed';
      this.testRunId = testRunRes.testRunId;
    }
    else {
      // Parse outcome value from logs with Regex
      const outcomeMatch = /Outcome *(.*) */.exec(testRunRes.outputString);
      this.testRunOutcome = outcomeMatch ? outcomeMatch[1].trim() : 'Failed';
      if (testRunRes.commandFailed && this.testRunOutcome === 'Passed') {
        this.testRunOutcome = 'Failed';
      }
    }
    await generateApexCoverageOutputFile();
  }

  private processApexTestsNetworkError() {
    this.notifSeverity = 'error';
    uxLog("warning", this, c.yellow(t('apexTestsNetworkErrorUnableToGetResults', { testRunId: this.testRunId || '-' })));
    const testRunInfo = this.testRunId ? ` Check test run ${this.testRunId} in Setup > Apex Test Execution.` : '';
    this.statusMessage = `Unable to get Apex test results because of network errors: tests may still have run in the org.${testRunInfo}`;
    this.notifText = `Unable to get Apex test results in org ${this.orgMarkdown} because of network errors (tests may still have run in the org).${testRunInfo}`;
  }

  private async processApexTestsFailure() {
    this.notifSeverity = 'error';
    const reportDir = await getReportDirectory();
    // Parse log from external file
    const sfReportFile = path.join(reportDir, '/test-result.txt');
    if (fs.existsSync(sfReportFile)) {
      this.notifAttachedFiles = [sfReportFile];
    }
    // Parse failing test classes
    const failuresRegex = /(.*) Fail (.*)/gm;
    const regexMatches = await extractRegexMatchesMultipleGroups(failuresRegex, this.testRunOutputString);
    for (const match of regexMatches) {
      this.failingTestClasses.push({ name: match[1].trim(), error: match[2].trim() });
    }
    this.notifAttachments = [
      {
        text: this.failingTestClasses
          .map((failingTestClass) => {
            return '- **' + failingTestClass.name + '**: ' + failingTestClass.error;
          })
          .join('\n'),
      },
    ];
    this.statusMessage = `Apex tests failed (${this.failingTestClasses.length}). (Outcome: ${this.testRunOutcome})`;
    this.notifText = `Apex tests failed (**${this.failingTestClasses.length}**) in org ${this.orgMarkdown} (Outcome: ${this.testRunOutcome})`;
    const failedTestsString = this.failingTestClasses
      .map((failingTestClass) => {
        return `- ${failingTestClass.name}: ${failingTestClass.error}`;
      })
      .join('\n');
    uxLog("warning", this, c.yellow(t('failingApexTests') + failedTestsString));
  }

  private async checkOrgWideCoverage() {
    if (this.testRunOutcome === 'NoApex' || this.testRunOutcome === 'NetworkError') {
      return;
    }
    // Safely extract org-wide coverage from output to avoid crashes when regex doesn't match
    const orgWideMatch = (/Org Wide Coverage\s*(.*)/.exec(this.testRunOutputString) || []);
    const coverageOrgWide =
      orgWideMatch[1] && typeof orgWideMatch[1] === 'string'
        ? (Number.isFinite(parseFloat(orgWideMatch[1].replace('%', ''))) ? parseFloat(orgWideMatch[1].replace('%', '')) : 0.0)
        : 0.0;
    if (coverageOrgWide === 0.0) {
      this.notifSeverity = 'error';
      uxLog("warning", this, c.yellow(t('warningUnableToExtractOrgWideCoverage') + this.testRunOutputString));
    }
    const minCoverageOrgWide = parseFloat(
      process.env.APEX_TESTS_MIN_COVERAGE_ORG_WIDE ||
      process.env.APEX_TESTS_MIN_COVERAGE ||
      this.configInfo.apexTestsMinCoverageOrgWide ||
      this.configInfo.apexTestsMinCoverage ||
      75.0
    );
    this.coverageTarget = minCoverageOrgWide;
    this.coverageValue = coverageOrgWide;
    // Do not test if tests failed
    if (this.testRunOutcome !== 'Passed') {
      return;
    }
    // Developer tried to cheat in config ^^
    if (minCoverageOrgWide < 75.0) {
      this.notifSeverity = 'error';
      this.statusMessage = `Don't try to cheat with configuration: Minimum org wide coverage must be 75% ;)`;
      this.notifText = this.statusMessage;
    }
    // Min coverage not reached
    else if (coverageOrgWide < minCoverageOrgWide) {
      this.notifSeverity = 'error';
      this.statusMessage = `Test run coverage (org wide) **${coverageOrgWide}%** should be > to ${minCoverageOrgWide}%`;
      this.notifText = `${this.statusMessage} in ${this.orgMarkdown}`;
    }
    // We are good !
    else {
      this.notifSeverity = 'log';
      this.statusMessage = `Test run coverage (org wide) **${coverageOrgWide}%** is > to ${minCoverageOrgWide}%`;
      this.notifText = `${this.statusMessage} in ${this.orgMarkdown}`;
    }
  }

  private async checkTestRunCoverage() {
    if (this.testRunOutcome === 'NoApex' || this.testRunOutcome === 'NetworkError') {
      return;
    }
    if (this.testRunOutputString.includes('Test Run Coverage')) {
      // const coverageTestRun = parseFloat(testRes.result.summary.testRunCoverage.replace('%', ''));
      const testRunMatch = /Test Run Coverage\s*(.*)/.exec(this.testRunOutputString);
      const coverageTestRunRaw = testRunMatch && testRunMatch[1] ? testRunMatch[1].replace('%', '').trim() : '0';
      const coverageTestRun = parseFloat(coverageTestRunRaw) || 0.0;
      if (coverageTestRun === 0.0) {
        this.notifSeverity = 'error';
        uxLog("warning", this, c.yellow(t('warningUnableToExtractTestRunCoverage') + this.testRunOutputString));
      }
      const minCoverageTestRun = parseFloat(
        process.env.APEX_TESTS_MIN_COVERAGE_TEST_RUN ||
        process.env.APEX_TESTS_MIN_COVERAGE ||
        this.configInfo.apexTestsMinCoverage ||
        this.coverageTarget
      );
      this.coverageTarget = minCoverageTestRun;
      this.coverageValue = coverageTestRun;
      // Do not test if tests failed
      if (this.testRunOutcome !== 'Passed') {
        return;
      }
      // Developer tried to cheat in config ^^
      if (minCoverageTestRun < 75.0) {
        this.notifSeverity = 'error';
        this.statusMessage = `Don't try to cheat with configuration: Minimum test run coverage must be 75% ;)`;
        this.notifText = this.statusMessage;
      }
      // Min coverage not reached
      else if (coverageTestRun < minCoverageTestRun) {
        this.notifSeverity = 'error';
        this.statusMessage = `Test run coverage **${coverageTestRun}%** should be > to ${minCoverageTestRun}%`;
        this.notifText = `${this.statusMessage} in ${this.orgMarkdown}`;
      }
      // We are good !
      else {
        this.notifSeverity = 'log';
        this.statusMessage = `Test run coverage **${coverageTestRun}%** is > to ${minCoverageTestRun}%`;
        this.notifText = `${this.statusMessage} in ${this.orgMarkdown}`;
      }
    }
  }
}
