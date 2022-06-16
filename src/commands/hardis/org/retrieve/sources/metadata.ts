/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { MetadataUtils } from "../../../../../common/metadata-utils";
import { ensureGitRepository, isCI, isMonitoringJob, uxLog } from "../../../../../common/utils";
import { canSendNotifications, sendNotification } from "../../../../../common/utils/notifUtils";
import LegacyApi from "../../diagnose/legacyapi";
import OrgTestApex from "../../test/apex";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DxSources extends SfdxCommand {
  public static title = "Retrieve sfdx sources from org";

  public static description = messages.getMessage("retrieveDx");

  public static examples = ["$ sfdx hardis:org:retrieve:sources:metadata"];

  protected static flagsConfig = {
    folder: flags.string({
      char: "f",
      default: ".",
      description: messages.getMessage("folder"),
    }),
    packagexml: flags.string({
      char: "p",
      description: messages.getMessage("packageXml"),
    }),
    instanceurl: flags.string({
      char: "r",
      description: messages.getMessage("instanceUrl"),
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
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdx-essentials"];

  // Trigger notification(s) to MsTeams channel
  protected static triggerNotification = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const folder = path.resolve(this.flags.folder || ".");
    const packageXml = path.resolve(this.flags.packagexml || "package.xml");
    const debug = this.flags.debug || false;

    // Check required pre-requisites
    await ensureGitRepository({ init: true });
    const isMonitoring = await isMonitoringJob();

    // Retrieve metadatas
    let message = "";
    try {
      await MetadataUtils.retrieveMetadatas(packageXml, folder, false, [], {}, this, debug);

      // Copy to destination
      await fs.copy(path.join(folder, "unpackaged"), path.resolve(folder));
      // Remove temporary files
      await fs.rmdir(path.join(folder, "unpackaged"), { recursive: true });

      message = `[sfdx-hardis] Successfully retrieved metadatas in ${folder}`;
      uxLog(this, message);
    } catch (e) {
      if (!isMonitoring) {
        throw e;
      }
      if (isCI && (await canSendNotifications())) {
        await sendNotification({
          title: `Crash while retrieving metadatas`,
          text: e.message,
          severity: "warning",
        });
      }
      message = "[sfdx-hardis] Error retrieving metadatas";
    }

    // Post actions for monitoring CI job

    if (isMonitoring) {
      try {
        return await this.processPostActions(message);
      } catch (e) {
        uxLog(this, c.yellow("Post actions have failed !"));
      }
    }

    return { orgId: this.org.getOrgId(), outputString: message };
  }

  private async processPostActions(message) {
    uxLog(this, c.cyan("Monitoring repo detected"));

    // Update default .gitlab-ci.yml within the monitoring repo
    const localGitlabCiFile = path.join(process.cwd(), ".gitlab-ci.yml");
    if (fs.existsSync(localGitlabCiFile) && process.env?.AUTO_UPDATE_GITLAB_CI_YML) {
      const localGitlabCiContent = await fs.readFile(localGitlabCiFile, "utf8");
      const latestGitlabCiFile = path.join(__dirname, "../../../../../../defaults/monitoring/.gitlab-ci.yml");
      const latestGitlabCiContent = await fs.readFile(latestGitlabCiFile, "utf8");
      if (localGitlabCiContent !== latestGitlabCiContent) {
        await fs.writeFile(localGitlabCiFile, latestGitlabCiContent);
        uxLog(this, c.cyan("Updated .gitlab-ci.yml file"));
      }
    }

    // Run test classes
    uxLog(this, c.cyan("Running Apex tests..."));
    const orgTestRes: any = await new OrgTestApex([], this.config)._run();

    // Check usage of Legacy API versions
    uxLog(this, c.cyan("Running Legacy API Use checks..."));
    const legacyApiRes: any = await new LegacyApi([], this.config)._run();

    // Delete report files
    //const reportFiles = await glob("**/hardis-report/**", { cwd: process.cwd() });
    //reportFiles.map(async (file) => await fs.remove(file));
    return { orgId: this.org.getOrgId(), outputString: message, orgTestRes, legacyApiRes };
  }
}
