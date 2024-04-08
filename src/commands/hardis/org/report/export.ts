/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from 'fs-extra';
import * as path from "path";
import { uxLog } from "../../../../common/utils";
import { soqlQuery } from "../../../../common/utils/apiUtils";
import { PuppeteerWrapper } from "../../../../common/utils/puppeteerUtils";
import { getReportDirectory } from "../../../../config";


// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ReportExport extends SfdxCommand {
    public static title = "Export report";

    public static description = `Exports a report and sends it to a list of emails

- You can set --reportname using EXPORT_REPORT_NAME environment variable

- You can set --emails using EXPORT_REPORT_EMAILS environment variable (comma-separated)

`;

    public static examples = [
        "$ sfdx hardis:org:report:export",
        "$ sfdx hardis:org:report:export --reportname MyReport --emails nicolas.vuillamy@cloudity.com,samuel.bouleau@cloudity.com"
    ];

    protected static flagsConfig = {
        reportname: flags.string({
            char: "r",
            description: "Name of the report to extract as file",
        }),
        emails: flags.string({
            char: "e",
            description: "Comma separated list of emails that must receive the report export",
        }),
        format: flags.enum({
            char: "f",
            options: ["xls", "xlsx", "csv", "localecsv"],
            description: "Format of output",
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
    protected static requiresProject = false;

    // Trigger notification(s) to MsTeams channel
    protected static triggerNotification = true;

    protected format: string;
    protected reportName: string;
    protected emails: string[];
    protected reportFile: any = {};
    protected debugMode = false;

    /* jscpd:ignore-end */

    public async run(): Promise<AnyJson> {
        this.format = this.flags.format || "xslx";
        this.reportName = process.env.EXPORT_REPORT_NAME || this.flags.reportname || null;
        this.emails = process.env?.EXPORT_REPORT_EMAILS ? process.env.EXPORT_REPORT_EMAILS.split(",") :
            this.flags.emails ? this.flags.emails.split(",") :
                [];
        this.debugMode = this.flags.debug || false;

        // Find report record
        this.checkReportName();
        const reportRecord = await this.findReportFromName();

        // Start process
        uxLog(this, c.cyan(`Initializing export of report ${c.bold(this.reportName)} from ` + c.bold(this.org.getConnection().instanceUrl)) + " ...");
        const puppet = new PuppeteerWrapper(
            this.org.getConnection().instanceUrl,
            this.org.getConnection().accessToken,
            { debug: this.debugMode }
        );
        await puppet.start();
        try {
            await this.downloadReport(puppet, reportRecord);
        } catch (e) {
            await puppet.browser.close();
            throw e;
        }

        uxLog(this, c.cyan(`Downloaded report file: ${c.bold(this.reportFile)}`))

        return { outputString: "Report exported from" + this.org.getConnection().instanceUrl };
    }

    private async downloadReport(puppet: PuppeteerWrapper, reportRecord: any) {
        const page = await puppet.login();

        // Visit report URL
        const reportUiUrl = `${this.org.getConnection().instanceUrl}/lightning/r/Report/${reportRecord.Id}/view`;
        uxLog(this, c.grey("Opening report url: " + reportUiUrl));
        await page.goto(reportUiUrl);
        await page.waitForNavigation();

        // Click on contextual button
        uxLog(this, c.grey("Checking for contextual button..."));

        const elementHandle = await page.waitForSelector('iframe');
        const frame = await elementHandle.contentFrame();
        const dropdownButton = await frame.waitForSelector(".more-actions-button");
        await dropdownButton.click();

        // Open export popup
        uxLog(this, c.grey("Clicking Export action..."));
        const exportButton = await frame.waitForSelector(".report-action-ReportExportAction");
        await exportButton.click();

        // Click on Details
        const detailsOnlyButton = await page.waitForXPath("//span[contains(text(), 'Details Only')]");
        await detailsOnlyButton.click();

        // Select output format
        const formatLabel = await page.waitForXPath(`"//label[contains(text(), 'Format')]"`);
        const labelSibling = await formatLabel.$x("following-sibling::*");
        const selectItem = await labelSibling[0].waitForSelector("select");
        await selectItem.select(this.format);

        // Wait for the selection to be completed
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Set download folder
        const downloadFolder = path.join(await getReportDirectory(), "downloaded-reports");
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadFolder,
        });

        // Click on Export
        const processExportButton = await page.waitForXPath("//button[contains(@title, 'Export')]");
        await processExportButton.click();

        // Wait for download progress
        uxLog(this, c.grey(`Downloading report...`));
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                resolve("Download timeout reached");
            }, 60000);
            client.on('Page.downloadProgress', e => {
                if (e.state === 'completed') {
                    clearTimeout(timeout);
                    resolve(true);
                } else if (e.state === 'canceled') {
                    clearTimeout(timeout);
                    reject();
                }
            });
        });

        // Return file name
        try {
            this.reportFile = fs.readdirSync(downloadFolder)
                .map(name => ({ name, ctime: fs.statSync(name).ctime }))
                .sort((a: any, b: any) => b.ctime - a.ctime)[0].name;
        } catch {
            throw new SfdxError("Unable to find downloaded report");
        }
    }

    private async findReportFromName() {
        const reportQueryRes = await soqlQuery(`SELECT Id,Name FROM Report WHERE Name='${this.reportName}'`, this.org.getConnection());
        const reports = reportQueryRes?.records || [];

        // Check report name is present
        if (reports.length === 0) {
            throw new SfdxError(
                `No report has been found with name ${this.reportName}.
Either it does not exist, either current user has no rights to access it.`
            );
        }
        // Check report name is unique
        if (reports.length > 1) {
            throw new SfdxError(
                `Multiple reports have been found with name ${this.reportName}.To use this command, the report name must be unique.`
            );
        }
        return reports[0];
    }

    private checkReportName() {
        if (this.reportName === null) {
            throw new SfdxError("You need to define a report name using --reportname or EXPORT_REPORT_NAME");
        }
    }
}
