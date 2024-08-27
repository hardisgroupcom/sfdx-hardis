/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import * as child from "child_process";
import * as fs from "fs-extra";
import * as path from "path";
import { MetadataUtils } from "../../../../../common/metadata-utils/index.js";
import { ensureGitRepository, execCommand, isMonitoringJob, uxLog } from "../../../../../common/utils/index.js";
import LegacyApi from "../../diagnose/legacyapi";
import OrgTestApex from "../../test/apex";
import * as util from "util";
import { PACKAGE_ROOT_DIR } from "../../../../../settings.js";
const exec = util.promisify(child.exec);

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DxSources extends SfCommand<any> {
  public static title = "Retrieve sfdx sources from org";

  public static description = messages.getMessage("retrieveDx");

  public static examples = [
    "$ sf hardis:org:retrieve:sources:metadata",
    "$ SFDX_RETRIEVE_WAIT_MINUTES=200 sf hardis:org:retrieve:sources:metadata",
  ];

  public static flags = {
    folder: Flags.string({
      char: "f",
      default: ".",
      description: messages.getMessage("folder"),
    }),
    packagexml: Flags.string({
      char: "p",
      description: messages.getMessage("packageXml"),
    }),
    includemanaged: Flags.boolean({
      default: false,
      description: "Include items from managed packages",
    }),
    instanceurl: Flags.string({
      char: "r",
      description: messages.getMessage("instanceUrl"),
    }),
    debug: Flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };




  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  // Trigger notification(s) to MsTeams channel
  protected static triggerNotification = true;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const folder = path.resolve(flags.folder || ".");
    const packageXml = path.resolve(flags.packagexml || "package.xml");
    const includeManaged = flags.includemanaged || false;
    this.debugMode = flags.debug || false;

    // Check required pre-requisites
    await ensureGitRepository({ init: true });
    const isMonitoring = await isMonitoringJob();

    // Retrieve metadatas
    let message = "";
    try {
      const filterManagedItems = includeManaged === false;
      await MetadataUtils.retrieveMetadatas(packageXml, folder, false, [], { filterManagedItems: filterManagedItems }, this, this.debugMode);

      // Copy to destination
      await fs.copy(path.join(folder, "unpackaged"), path.resolve(folder));
      // Remove temporary files
      await fs.rm(path.join(folder, "unpackaged"), { recursive: true });

      message = `[sfdx-hardis] Successfully retrieved metadatas in ${folder}`;
      uxLog(this, message);
    } catch (e) {
      if (!isMonitoring) {
        throw e;
      }
      message = "[sfdx-hardis] Error retrieving metadatas";
    }

    // Post actions for monitoring CI job

    if (isMonitoring) {
      try {
        return await this.processPostActions(message);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        uxLog(this, c.yellow("Post actions have failed !"));
      }
      uxLog(this, c.yellow(c.bold("This version of sfdx-hardis monitoring is deprecated and will not be maintained anymore")));
      uxLog(this, c.yellow(c.bold("Switch to new sfdx-hardis monitoring that is enhanced !")));
      uxLog(this, c.yellow(c.bold("Info: https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/")));
    }

    return { orgId: this.org.getOrgId(), outputString: message };
  }

  private async processPostActions(message) {
    uxLog(this, c.cyan("Monitoring repo detected"));

    // Update default .gitlab-ci.yml within the monitoring repo
    const localGitlabCiFile = path.join(process.cwd(), ".gitlab-ci.yml");
    if (fs.existsSync(localGitlabCiFile) && process.env?.AUTO_UPDATE_GITLAB_CI_YML) {
      const localGitlabCiContent = await fs.readFile(localGitlabCiFile, "utf8");
      const latestGitlabCiFile = path.join(PACKAGE_ROOT_DIR, "defaults/monitoring/.gitlab-ci.yml");
      const latestGitlabCiContent = await fs.readFile(latestGitlabCiFile, "utf8");
      if (localGitlabCiContent !== latestGitlabCiContent) {
        await fs.writeFile(localGitlabCiFile, latestGitlabCiContent);
        uxLog(this, c.cyan("Updated .gitlab-ci.yml file"));
      }
    }

    // Also trace updates with sfdx sources, for better readability
    uxLog(this, c.cyan("Convert into sfdx format..."));
    if (fs.existsSync("metadatas")) {
      // Create sfdx project if not existing yet
      if (!fs.existsSync("sfdx-project")) {
        const createCommand = "sf project generate" + ` --name "sfdx-project"`;
        uxLog(this, c.cyan("Creating sfdx-project..."));
        await execCommand(createCommand, this, {
          output: true,
          fail: true,
          debug: this.debugMode,
        });
      }
      // Convert metadatas into sfdx sources
      const mdapiConvertCommand = `sf project convert mdapi --root-dir "../metadatas"`;
      uxLog(this, c.cyan("Converting metadata to source formation into sfdx-project..."));
      uxLog(this, `[command] ${c.bold(c.grey(mdapiConvertCommand))}`);
      const prevCwd = process.cwd();
      process.chdir(path.join(process.cwd(), "./sfdx-project"));
      try {
        const convertRes = await exec(mdapiConvertCommand, {
          maxBuffer: 10000 * 10000,
        });
        if (this.debug) {
          uxLog(this, convertRes.stdout + convertRes.stderr);
        }
      } catch (e) {
        uxLog(this, c.yellow("Error while converting metadatas to sources:\n" + (e as Error).message));
      }
      process.chdir(prevCwd);
    }

    let orgTestRes: any = null;
    let legacyApiRes: any = null;
    const prevExitCode = process.exitCode || 0;
    try {
      // Run test classes
      uxLog(this, c.cyan("Running Apex tests..."));
      orgTestRes = await new OrgTestApex([], this.config)._run();

      // Check usage of Legacy API versions
      uxLog(this, c.cyan("Running Legacy API Use checks..."));
      legacyApiRes = await new LegacyApi([], this.config)._run();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      uxLog(this, c.yellow("Issues found when running Apex tests or Legacy API, please check messages"));
    }
    process.exitCode = prevExitCode;

    // Delete report files
    //const reportFiles = await glob("**/hardis-report/**", { cwd: process.cwd() });
    //reportFiles.map(async (file) => await fs.remove(file));
    return { orgId: this.org.getOrgId(), outputString: message, orgTestRes, legacyApiRes };
  }
}
