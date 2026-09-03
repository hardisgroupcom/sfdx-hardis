import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from '../../../../common/utils/fsUtils.js';
import * as path from 'path';
import { execCommand, extractRegexMatchesMultipleGroups, uxLog } from '../../../../common/utils/index.js';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { CONSTANTS, getConfig, getEnvVar, getReportDirectory } from '../../../../config/index.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { generateApexCoverageOutputFile } from '../../../../common/utils/deployUtils.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import { buildSfCommandLine, parseSfCliArgs } from '../../../../common/utils/sfCliArgs.js';
import type { SfCliArgs } from '../../../../common/utils/sfCliArgs.js';

// Short forms of the "sf apex run test" flags that sfdx-hardis sets by default, to override them instead of duplicating them
const SF_APEX_TEST_ALIASES = { '-c': '--code-coverage', '-r': '--result-format', '-w': '--wait' };

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgTestApex extends SfCommand<any> {
  public static title = 'Run apex tests';

  public static description = `Run apex tests in Salesforce org

If following configuration is defined, it will fail if apex coverage target is not reached:

- Env \`APEX_TESTS_MIN_COVERAGE_ORG_WIDE\` or \`.sfdx-hardis\` property \`apexTestsMinCoverageOrgWide\`
- Env \`APEX_TESTS_MIN_COVERAGE_ORG_WIDE\` or \`.sfdx-hardis\` property \`apexTestsMinCoverageOrgWide\`

Use \`--wait\` (in minutes, default 60) if the test run of your org takes longer than the default timeout. You can also define the default value with env var \`SFDX_TEST_WAIT_MINUTES\`.

Any flag that is not a sfdx-hardis flag is sent to the underlying \`sf apex run test\` command, and overrides the value used by default by sfdx-hardis. For example \`--detailed-coverage\`, \`--synchronous\`, or \`--tests MyClassTest\`.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-apex-tests/) and can output Grafana, Slack and MsTeams Notifications.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:test:apex --agent
\`\`\`

In agent mode, all interactive prompts are skipped and default values are used.

`;

  public static examples = ['$ sf hardis:org:test:apex',
    '$ sf hardis:org:test:apex --wait 120',
    '$ sf hardis:org:test:apex --detailed-coverage',
    '$ sf hardis:org:test:apex --testlevel RunSpecifiedTests --tests MyClassTest --tests MyOtherClassTest',
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

  // Unknown flags are not errors: they are forwarded to the underlying sf apex run test command
  public static readonly strict = false;
  public static readonly ['--'] = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  // protected static requiresProject = true;

  protected configInfo: any = {};
  protected testRunOutcome: string;
  protected testRunOutputString: string;
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
    const { flags, argv } = await this.parse(OrgTestApex);
    const testlevel = flags.testlevel || 'RunLocalTests';
    const debugMode = flags.debug || false;

    this.configInfo = await getConfig('branch');
    const orgInstanceUrl = flags['target-org']?.getConnection()?.instanceUrl || '';
    this.orgMarkdown = await getOrgMarkdown(orgInstanceUrl);
    this.notifButtons = await getNotificationButtons();
    /* jscpd:ignore-end */
    uxLog("action", this, c.cyan(t('runningApexTestsInOrgWithTest', { orgInstanceUrl, testlevel })));
    const sfCliOverrides = parseSfCliArgs(argv, SF_APEX_TEST_ALIASES);
    await this.runApexTests(testlevel, debugMode, flags['target-org']?.getUsername(), sfCliOverrides);
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
    else if (this.testRunOutcome === 'Passed') {
      uxLog("success", this, c.green(t('apexTestsPassed', { testRunOutcome: this.testRunOutcome })));
    }
    // Get test coverage (and fail if not reached)
    await this.checkOrgWideCoverage();
    await this.checkTestRunCoverage();

    if (this.testRunOutcome !== 'NoApex') {
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
      metrics: {
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

  private async runApexTests(testlevel: any, debugMode: any, orgUsername: string | null, sfCliOverrides: SfCliArgs) {
    // Run tests with SFDX commands
    const reportDir = await getReportDirectory();
    const defaultArgs: SfCliArgs = {
      '--code-coverage': true,
      '--result-format': 'human',
      '--output-dir': reportDir,
      '--test-level': testlevel,
      '--wait': getEnvVar('SFDX_TEST_WAIT_MINUTES') || '60',
    };
    if (orgUsername) {
      defaultArgs['--target-org'] = orgUsername;
    }
    if (debugMode) {
      defaultArgs['--verbose'] = true;
    }
    const testCommand = buildSfCommandLine('sf apex run test', defaultArgs, sfCliOverrides);
    try {
      const execCommandRes = await execCommand(testCommand, this, {
        output: true,
        debug: debugMode,
        fail: true,
      });
      // Parse outcome value from logs with Regex
      this.testRunOutcome = (/Outcome *(.*) */.exec(execCommandRes.stdout + execCommandRes.stderr) || '')[1].trim();
      this.testRunOutputString = execCommandRes.stdout + execCommandRes.stderr;
      await generateApexCoverageOutputFile();
    } catch (e) {
      // No Apex in the org
      const errorMessage = (e as Error).message;
      if (
        errorMessage.includes('Toujours fournir une propriété classes, suites, tests ou testLevel') ||
        errorMessage.includes('Always provide a classes, suites, tests, or testLevel property') ||
        errorMessage.includes('No tests found for category') ||
        errorMessage.includes('Aucun test trouvé pour category') ||
        errorMessage.includes('Error (INVALID_INPUT)')
      ) {
        this.testRunOutcome = 'NoApex';
      } else {
        // Failing Apex tests
        this.testRunOutputString = (e as Error).message;
        this.testRunOutcome = 'Failed';
        await generateApexCoverageOutputFile();
      }
    }
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
    if (this.testRunOutcome === 'NoApex') {
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
    if (this.testRunOutcome === 'NoApex') {
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
