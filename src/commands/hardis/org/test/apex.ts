import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import { execCommand, getCurrentGitBranch, isCI, uxLog } from "../../../../common/utils";
import { canSendNotifications, sendNotification } from "../../../../common/utils/notifUtils";
import { getConfig, getReportDirectory } from "../../../../config";
import { NotifProvider, UtilsNotifs } from "../../../../common/notifProvider";
import { GitProvider } from "../../../../common/gitProvider";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgTestApex extends SfdxCommand {
  public static title = "Run apex tests";

  public static description = `Run apex tests in Salesforce org

If following configuration is defined, it will fail if apex coverage target is not reached:

- Env \`APEX_TESTS_MIN_COVERAGE_ORG_WIDE\` or \`.sfdx-hardis\` property \`apexTestsMinCoverageOrgWide\`
- Env \`APEX_TESTS_MIN_COVERAGE_ORG_WIDE\` or \`.sfdx-hardis\` property \`apexTestsMinCoverageOrgWide\`

You can override env var SFDX_TEST_WAIT_MINUTES to wait more than 60 minutes
`;

  public static examples = ["$ sfdx hardis:org:test:apex"];

  protected static flagsConfig = {
    testlevel: flags.enum({
      char: "l",
      default: "RunLocalTests",
      options: ["NoTestRun", "RunSpecifiedTests", "RunLocalTests", "RunAllTestsInOrg"],
      description: messages.getMessage("testLevel"),
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  // protected static requiresProject = true;

  protected configInfo: any = {};

  /* jscpd:ignore-start */
  public async run(): Promise<AnyJson> {
    const check = this.flags.check || false;
    const testlevel = this.flags.testlevel || "RunLocalTests";
    const debugMode = this.flags.debug || false;

    this.configInfo = await getConfig("branch");
    /* jscpd:ignore-end */
    const reportDir = await getReportDirectory();
    const testCommand =
      "sfdx force:apex:test:run" +
      " --codecoverage" +
      " --resultformat human" +
      ` --outputdir ${reportDir}` +
      ` --wait ${process.env.SFDX_TEST_WAIT_MINUTES || "60"}` +
      ` --testlevel ${testlevel}` +
      (check ? " --checkonly" : "") +
      (debugMode ? " --verbose" : "");
    let testRes;
    let outcome;
    try {
      testRes = await execCommand(testCommand, this, {
        output: true,
        debug: debugMode,
        fail: true,
      });
    } catch (e) {
      if (
        e.message.includes("Toujours fournir une propriété classes, suites, tests ou testLevel") ||
        e.message.includes("Always provide a classes, suites, tests, or testLevel property")
      ) {
        uxLog(this, c.yellow("No Apex classes were found in the project"));
        return { orgId: this.org.getOrgId(), outputString: "No Apex classes were found in the project" };
      }
      uxLog(this, c.red("Error during apex tests: " + e.message));
      testRes = { stdout: "", stderr: e.message };
      outcome = "Failed";
    }
    let message = "";
    const testResStr = testRes.stdout + testRes.stderr;
    outcome = outcome || /Outcome *(.*) */.exec(testResStr)[1].trim();
    const currentGitBranch = await getCurrentGitBranch();
    if (outcome === "Passed") {
      //uxLog(this, c.grey(`Test results:\n${JSON.stringify(testRes.result.summary, null, 2)}`));
      message = "[sfdx-hardis] Successfully run apex tests on org";
      uxLog(this, c.green(message));
      // Check code coverage (orgWide)
      //const coverageOrgWide = parseFloat(testRes.result.summary.orgWideCoverage.replace('%', ''));
      const coverageOrgWide = parseFloat(/Org Wide Coverage *(.*)/.exec(testResStr)[1].replace("%", ""));
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
      if (testResStr.includes("Test Run Coverage")) {
        // const coverageTestRun = parseFloat(testRes.result.summary.testRunCoverage.replace('%', ''));
        const coverageTestRun = parseFloat(/Test Run Coverage *(.*)/.exec(testResStr)[1].replace("%", ""));
        const minCoverageTestRun =
          process.env.APEX_TESTS_MIN_COVERAGE_TEST_RUN ||
          process.env.APEX_TESTS_MIN_COVERAGE ||
          this.configInfo.apexTestsMinCoverage ||
          minCoverageOrgWide;
        if (minCoverageTestRun < 75.0) {
          throw new SfdxError("[sfdx-hardis] Good try, hacker, but minimum org coverage can't be less than 75% :)");
        }
        if (coverageTestRun < minCoverageTestRun) {
          // Send notification
          const linkMarkdown = await this.getBranchMarkdownLink();
          const jobUrl = await GitProvider.getJobUrl();
          const notifButtons = [];
          if (jobUrl) {
            notifButtons.push({ text: "View BackUp Job", url: jobUrl });
          }
          NotifProvider.postNotifications({
            text: `Apex Tests run coverage issue in ${linkMarkdown}\nTest run coverage ${coverageTestRun}% should be > to ${minCoverageTestRun}%`,
            buttons: notifButtons,
            severity: "error",
          });
          // (LEGACY) Send notification if possible
          if (isCI && (await canSendNotifications())) {
            await sendNotification({
              title: `WARNING: Apex Tests run coverage issue in ${currentGitBranch}`,
              text: `Test run coverage ${coverageTestRun}% should be > to ${minCoverageTestRun}%`,
              severity: "warning",
            });
          }
          throw new SfdxError(`[sfdx-hardis][apextest] Test run coverage ${coverageTestRun}% should be > to ${minCoverageTestRun}%`);
        } else {
          uxLog(this, c.cyan(`[apextest] Test run coverage ${c.bold(c.green(coverageTestRun))}% is > to ${c.bold(minCoverageTestRun)}%`));
        }
      }
    } else {
      message = `Org apex tests failure (Outcome: ${outcome} )`;
      uxLog(this, c.red(message));

      let testResultStr;
      const reportDir = await getReportDirectory();
      if (fs.existsSync(reportDir + "/test-result.txt")) {
        testResultStr = await fs.readFile(reportDir + "/test-result.txt", "utf8");
      }
      const linkMarkdown = await this.getBranchMarkdownLink();
      const notifButtons = [];
      const jobUrl = await GitProvider.getJobUrl();
      if (jobUrl) {
        notifButtons.push({ text: "View Apex test Job", url: jobUrl });
      }
      // Send notification
      NotifProvider.postNotifications({
        text: `Apex Tests are failing in ${linkMarkdown}`,
        attachments: [{ text: testResultStr }],
        buttons: notifButtons,
        severity: "error",
      });
      // (LEGACY) Send notification if possible
      if (await canSendNotifications()) {
        await sendNotification({
          title: `WARNING: Apex Tests are failing in ${currentGitBranch}`,
          text: `Outcome: ${outcome},

${testResultStr}`,
          severity: "severe",
        });
      }
      throw new SfdxError("[sfdx-hardis] " + message);
    }

    return { orgId: this.org.getOrgId(), outputString: message };
  }

  public async getBranchMarkdownLink() {
    const branchName = process.env.CI_COMMIT_REF_NAME || (await getCurrentGitBranch({ formatted: true })) || "Missing CI_COMMIT_REF_NAME variable";
    const targetLabel = this.org?.getConnection()?.instanceUrl || branchName;
    const linkMarkdown = UtilsNotifs.markdownLink(targetLabel, targetLabel.replace("https://", "").replace(".my.salesforce.com", ""));
    return linkMarkdown;
  }
}
