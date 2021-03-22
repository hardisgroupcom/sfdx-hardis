import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, SfdxError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as fs from 'fs-extra';
import { execSfdxJson, uxLog } from '../../../../common/utils';
import { getConfig } from '../../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgTestApex extends SfdxCommand {
  public static title = 'Run apex tests';

  public static description = messages.getMessage('apexTests');

  public static examples = ['$ sfdx hardis:org:test:apex'];

  protected static flagsConfig = {
    testlevel: flags.enum({
      char: 'l',
      default: 'RunLocalTests',
      options: ['NoTestRun', 'RunSpecifiedTests', 'RunLocalTests', 'RunAllTestsInOrg'],
      description: messages.getMessage('testLevel')
    }),
    debug: flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode')
    })
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  // protected static requiresProject = true;

  protected configInfo: any = {};

  /* jscpd:ignore-start */
  public async run(): Promise<AnyJson> {
    const check = this.flags.check || false;
    const testlevel = this.flags.testlevel || 'RunLocalTests';
    const debugMode = this.flags.debug || false;

    this.configInfo = await getConfig('branch');
    /* jscpd:ignore-end */
    await fs.ensureDir('./hardis-report');
    const testCommand = 'sfdx force:apex:test:run' +
      ' --codecoverage' +
      ' --resultformat human' +
      ' --outputdir ./hardis-report' +
      ' --wait 60' +
      ` --testlevel ${testlevel}` +
      (check ? ' --checkonly' : '') +
      (debugMode ? ' --verbose' : '');
    const testRes = await execSfdxJson(testCommand, this, { output: false, debug: debugMode, fail: false });
    let message = '';
    if (debugMode) {
      this.ux.log(c.green(JSON.stringify(testRes.result)));
    }
    if (testRes.status === 0) {
      uxLog(this, c.grey(`Test results:\n${JSON.stringify(testRes.result.summary, null, 2)}`));
      message = '[sfdx-hardis] Successfully run apex tests on org';
      this.ux.log(c.green(message));
      // Check code coverage (orgWide)
      const coverageOrgWide = parseFloat(testRes.result.summary.orgWideCoverage.replace('%', ''));
      const minCoverageOrgWide =
        process.env.APEX_TESTS_MIN_COVERAGE_ORG_WIDE ||
        process.env.APEX_TESTS_MIN_COVERAGE ||
        this.configInfo.apexTestsMinCoverageOrgWide ||
        this.configInfo.apexTestsMinCoverage ||
        75.0;
      if (minCoverageOrgWide < 75.0) {
        throw new SfdxError("[sfdx-hardis] Good try, hacker, but minimum org coverage can't be less than 75% :)");
      }
      if (coverageOrgWide < minCoverageOrgWide) {
        throw new SfdxError(`[sfdx-hardis][apextest] Test run coverage (org wide) ${coverageOrgWide}% should be > to ${minCoverageOrgWide}%`);
      } else {
        uxLog(this, c.cyan(`[apextest] Test run coverage (org wide) ${c.bold(c.green(coverageOrgWide))}% is > to ${c.bold(minCoverageOrgWide)}%`));
      }
      // Check code coverage ()
      const coverageTestRun = parseFloat(testRes.result.summary.testRunCoverage.replace('%', ''));
      const minCoverageTestRun =
        process.env.APEX_TESTS_MIN_COVERAGE_TEST_RUN ||
        process.env.APEX_TESTS_MIN_COVERAGE ||
        this.configInfo.apexTestsMinCoverage ||
        minCoverageOrgWide;
      if (minCoverageTestRun < 75.0) {
        throw new SfdxError("[sfdx-hardis] Good try, hacker, but minimum org coverage can't be less than 75% :)");
      }
      if (coverageTestRun < minCoverageTestRun) {
        throw new SfdxError(`[sfdx-hardis][apextest] Test run coverage ${coverageTestRun}% should be > to ${minCoverageTestRun}%`);
      } else {
        uxLog(this, c.cyan(`[apextest] Test run coverage ${c.bold(c.green(coverageTestRun))}% is > to ${c.bold(minCoverageTestRun)}%`));
      }
    } else {
      message = '[sfdx-hardis] Org apex tests failure';
      uxLog(this, c.red(message));
      uxLog(this, c.red(JSON.stringify(Object.keys(testRes))));
      throw new SfdxError("[sfdx-hardis] " + message);
    }
    return { orgId: this.org.getOrgId(), outputString: message };
  }
}
