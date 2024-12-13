import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { execCommand, extractRegexMatchesMultipleGroups, uxLog } from '../../../../common/utils/index.js';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { CONSTANTS, getConfig, getReportDirectory } from '../../../../config/index.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgTestApex extends SfCommand<any> {
  public static title = 'Run apex tests';

  public static description = `Run apex tests in Salesforce org

If following configuration is defined, it will fail if apex coverage target is not reached:

- Env \`APEX_TESTS_MIN_COVERAGE_ORG_WIDE\` or \`.sfdx-hardis\` property \`apexTestsMinCoverageOrgWide\`
- Env \`APEX_TESTS_MIN_COVERAGE_ORG_WIDE\` or \`.sfdx-hardis\` property \`apexTestsMinCoverageOrgWide\`

You can override env var SFDX_TEST_WAIT_MINUTES to wait more than 60 minutes.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-apex-tests/) and can output Grafana, Slack and MsTeams Notifications.
`;

  public static examples = ['$ sf hardis:org:test:apex'];

  public static flags: any = {
    testlevel: Flags.string({
      char: 'l',
      default: 'RunLocalTests',
      options: ['NoTestRun', 'RunSpecifiedTests', 'RunLocalTests', 'RunAllTestsInOrg'],
      description: messages.getMessage('testLevel'),
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
    this.orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    this.notifButtons = await getNotificationButtons();
    /* jscpd:ignore-end */
    await this.runApexTests(testlevel, debugMode);
    // No Apex
    if (this.testRunOutcome === 'NoApex') {
      this.notifSeverity = 'log';
      this.statusMessage = 'No Apex found in the org';
      this.notifText = `No Apex found in org ${this.orgMarkdown}`;
    }
    // Failed tests
    else if (this.testRunOutcome === 'Failed') {
      await this.processApexTestsFailure();
    }
    // Get test coverage (and fail if not reached)
    await this.checkOrgWideCoverage();
    await this.checkTestRunCoverage();

    uxLog(this, `Apex coverage: ${this.coverageValue}% (target: ${this.coverageTarget}%)`);

    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
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
      uxLog(this, c.red(this.statusMessage));
    } else {
      uxLog(this, c.green(this.statusMessage));
    }

    return { orgId: flags['target-org'].getOrgId(), outputString: this.statusMessage, statusCode: process.exitCode };
  }

  private async runApexTests(testlevel: any, debugMode: any) {
    // Run tests with SFDX commands
    const reportDir = await getReportDirectory();
    const testCommand =
      'sf apex run test' +
      ' --code-coverage' +
      ' --result-format human' +
      ` --output-dir ${reportDir}` +
      ` --wait ${process.env.SFDX_TEST_WAIT_MINUTES || '60'}` +
      ` --test-level ${testlevel}` +
      (debugMode ? ' --verbose' : '');
    try {
      const execCommandRes = await execCommand(testCommand, this, {
        output: true,
        debug: debugMode,
        fail: true,
      });
      // Parse outcome value from logs with Regex
      this.testRunOutcome = (/Outcome *(.*) */.exec(execCommandRes.stdout + execCommandRes.stderr) || '')[1].trim();
      this.testRunOutputString = execCommandRes.stdout + execCommandRes.stderr;
    } catch (e) {
      // No Apex in the org
      if (
        (e as Error).message.includes('Toujours fournir une propriété classes, suites, tests ou testLevel') ||
        (e as Error).message.includes('Always provide a classes, suites, tests, or testLevel property')
      ) {
        this.testRunOutcome = 'NoApex';
      } else {
        // Failing Apex tests
        this.testRunOutputString = (e as Error).message;
        this.testRunOutcome = 'Failed';
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
    uxLog(this, c.yellow('Failing tests:'));
    for (const match of regexMatches) {
      this.failingTestClasses.push({ name: match[1].trim(), error: match[2].trim() });
    }
    this.notifAttachments = [
      {
        text: this.failingTestClasses
          .map((failingTestClass) => {
            return '• *' + failingTestClass.name + '*: ' + failingTestClass.error;
          })
          .join('\n'),
      },
    ];
    this.statusMessage = `Apex tests failed (${this.failingTestClasses.length}). (Outcome: ${this.testRunOutcome})`;
    this.notifText = `Apex tests failed (${this.failingTestClasses.length}) in org ${this.orgMarkdown} (Outcome: ${this.testRunOutcome})`;
    console.table(this.failingTestClasses);
  }

  private async checkOrgWideCoverage() {
    const coverageOrgWide = parseFloat(
      (/Org Wide Coverage *(.*)/.exec(this.testRunOutputString) || '')[1].replace('%', '')
    );
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
      this.statusMessage = `Test run coverage (org wide) *${coverageOrgWide}%* should be > to ${minCoverageOrgWide}%`;
      this.notifText = `${this.statusMessage} in ${this.orgMarkdown}`;
    }
    // We are good !
    else {
      this.notifSeverity = 'log';
      this.statusMessage = `Test run coverage (org wide) *${coverageOrgWide}%* is > to ${minCoverageOrgWide}%`;
      this.notifText = `${this.statusMessage} in ${this.orgMarkdown}`;
    }
  }

  private async checkTestRunCoverage() {
    if (this.testRunOutputString.includes('Test Run Coverage')) {
      // const coverageTestRun = parseFloat(testRes.result.summary.testRunCoverage.replace('%', ''));
      const coverageTestRun = parseFloat(
        (/Test Run Coverage *(.*)/.exec(this.testRunOutputString) || '')[1].replace('%', '')
      );
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
        this.statusMessage = `Test run coverage *${coverageTestRun}%* should be > to ${minCoverageTestRun}%`;
        this.notifText = `${this.statusMessage} in ${this.orgMarkdown}`;
      }
      // We are good !
      else {
        this.notifSeverity = 'log';
        this.statusMessage = `Test run coverage *${coverageTestRun}%* is > to ${minCoverageTestRun}%`;
        this.notifText = `${this.statusMessage} in ${this.orgMarkdown}`;
      }
    }
  }
}
