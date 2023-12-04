/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { buildOrgManifest } from "../../../../common/utils/deployUtils";
import { execCommand, filterPackageXml, uxLog } from "../../../../common/utils";
import { MetadataUtils } from "../../../../common/metadata-utils";
import { CONSTANTS } from "../../../../config";
import { NotifProvider } from "../../../../common/notifProvider";
import { MessageAttachment } from "@slack/web-api";
import { getNotificationButtons, getOrgMarkdown } from "../../../../common/utils/notifUtils";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class MonitorBackup extends SfdxCommand {
  public static title = "Backup DX sources";

  public static description = "Retrieve sfdx sources in the context of a monitoring backup";

  public static examples = ["$ sfdx hardis:org:monitor:backup"];

  protected static flagsConfig = {
    outputfile: flags.string({
      char: "o",
      description: "Force the path and name of output report file. Must end with .csv",
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
  protected static requiresProject = true;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdx-essentials"];

  // Trigger notification(s) to MsTeams channel
  protected static triggerNotification = true;

  protected outputFile;
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.outputFile = this.flags.outputfile || null;
    this.debugMode = this.flags.debug || false;

    // Build target org full manifest
    uxLog(this, c.cyan("Building full manifest for org " + c.bold(this.org.getConnection().instanceUrl)) + " ...");
    const packageXmlFullFile = "manifest/package-all-org-items.xml";
    await buildOrgManifest("", packageXmlFullFile, this.org.getConnection());

    // Check if we have package-skip_items.xml
    const packageXmlBackUpItemsFile = "manifest/package-backup-items.xml";
    const packageXmlSkipItemsFile = "manifest/package-skip-items.xml";
    let packageXmlToRemove = null;
    if (fs.existsSync(packageXmlSkipItemsFile)) {
      uxLog(this, c.grey(`${packageXmlSkipItemsFile} has been found and will be use to reduce the content of ${packageXmlFullFile} ...`));
      packageXmlToRemove = packageXmlSkipItemsFile;
    }

    // List namespaces used in the org
    const namespaces = [];
    const installedPackages = await MetadataUtils.listInstalledPackages(null, this);
    for (const installedPackage of installedPackages) {
      if (installedPackage?.SubscriberPackageNamespace !== "" && installedPackage?.SubscriberPackageNamespace != null) {
        namespaces.push(installedPackage.SubscriberPackageNamespace);
      }
    }

    // Apply filters to package.xml
    uxLog(this, c.cyan(`Reducing content of ${packageXmlFullFile} to generate ${packageXmlBackUpItemsFile} ...`));
    await filterPackageXml(packageXmlFullFile, packageXmlBackUpItemsFile, {
      removeNamespaces: namespaces,
      removeStandard: true,
      removeFromPackageXmlFile: packageXmlToRemove,
      updateApiVersion: CONSTANTS.API_VERSION,
    });

    // Retrieve sfdx sources in local git repo
    uxLog(this, c.cyan(`Run the retrieve command for retrieving filtered metadatas ...`));
    try {
      await execCommand(`sfdx force:source:retrieve -x ${packageXmlBackUpItemsFile} -u ${this.org.getUsername()} --wait 120`, this, {
        fail: true,
        output: true,
        debug: this.debugMode,
      });
    } catch (e) {
      const failedPackageXmlContent = await fs.readFile(packageXmlBackUpItemsFile, "utf8");
      uxLog(this, c.yellow("BackUp package.xml that failed to be retrieved:\n" + c.grey(failedPackageXmlContent)));
      uxLog(
        this,
        c.red("Crash during backup. You may exclude more metadata types by updating file manifest/package-skip-items.xml then commit and push it"),
      );
      throw e;
    }

    // Write installed packages
    uxLog(this, c.cyan(`Write installed packages ...`));
    const packageFolder = path.join(process.cwd(), "installedPackages");
    await fs.ensureDir(packageFolder);
    for (const installedPackage of installedPackages) {
      const fileName = (installedPackage.SubscriberPackageName || installedPackage.SubscriberPackageId) + ".json";
      const fileNameNoSep = fileName.replace(/\//g, '_') ; // Handle case when package name contains slashes
      delete installedPackage.Id; // Not needed for diffs
      await fs.writeFile(path.join(packageFolder, fileNameNoSep), JSON.stringify(installedPackage, null, 2));
    }

    const diffFiles = await MetadataUtils.listChangedFiles();

    // Write output file
    this.outputFile = await generateReportPath("backup-updated-files", this.outputFile);
    const diffFilesSimplified = diffFiles.map((diffFile) => {
      return {
        File: diffFile.path.replace("force-app/main/default/", ""),
        ChangeType: diffFile.index === "?" ? "A" : diffFile.index,
        WorkingDir: diffFile.working_dir === "?" ? "" : diffFile.working_dir,
        PrevName: diffFile?.from || "",
      };
    });
    await generateCsvFile(diffFilesSimplified, this.outputFile);

    // Send notifications
    if (diffFiles.length > 0) {
      const orgMarkdown = await getOrgMarkdown(this.org?.getConnection()?.instanceUrl);
      const notifButtons = await getNotificationButtons();
      const attachments: MessageAttachment[] = [
        {
          text: diffFiles
            .map((diffFile) => {
              let flag = "";
              if (diffFile.index && diffFile.index !== " ") {
                flag = ` (${diffFile.index === "?" ? "A" : diffFile.index})`;
              }
              const line = `• ${diffFile.path.replace("force-app/main/default/", "")}` + flag;
              return line;
            })
            .join("\n"),
        },
      ];
      NotifProvider.postNotifications({
        type: "BACKUP",
        text: `Updates detected in ${orgMarkdown}`,
        buttons: notifButtons,
        attachments: attachments,
        severity: "info",
        sideImage: "backup",
      });
    } else {
      uxLog(this, c.grey("No updated metadata for today's backup :)"));
    }

    return { outputString: "BackUp processed on org " + this.org.getConnection().instanceUrl };
  }
}
