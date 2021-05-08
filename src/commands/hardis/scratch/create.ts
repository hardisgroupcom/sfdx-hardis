/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { assert } from "console";
import * as EmailValidator from "email-validator";
import * as fs from "fs-extra";
import * as glob from "glob-promise";
import * as moment from "moment";
import * as os from "os";
import * as path from "path";
import { MetadataUtils } from "../../../common/metadata-utils";
import { execCommand, execSfdxJson, getCurrentGitBranch, isCI, uxLog } from "../../../common/utils";
import { importData } from "../../../common/utils/dataUtils";
import { deployMetadatas, forceSourceDeploy, forceSourcePush } from "../../../common/utils/deployUtils";
import { prompts } from "../../../common/utils/prompts";
import { WebSocketClient } from "../../../common/websocketClient";
import { getConfig, setConfig } from "../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ScratchCreate extends SfdxCommand {
  public static title = "Create and initialize scratch org";

  public static description = messages.getMessage("scratchCreate");

  public static examples = ["$ sfdx hardis:scratch:create"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    forcenew: flags.boolean({
      char: "n",
      default: false,
      description: messages.getMessage("forceNewScratch"),
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdmu", "texei-sfdx-plugin"];

  protected forceNew = false;

  /* jscpd:ignore-end */

  protected debugMode = false;
  protected configInfo: any;
  protected devHubAlias: string;
  protected scratchOrgAlias: string;
  protected scratchOrgDuration: number;
  protected userEmail: string;

  protected gitBranch: string;
  protected projectScratchDef: any;
  protected scratchOrgInfo: any;
  protected scratchOrgUsername: string;
  protected scratchOrgPassword: string;
  protected projectName: string;

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;
    this.forceNew = this.flags.forcenew || false;

    await this.initConfig();
    await this.createScratchOrg();
    try {
      await this.installPackages();
      await this.initOrgMetadatas();
      await this.initPermissionSetAssignments();
      await this.initApexScripts();
      await this.initOrgData();
    } catch (e) {
      if (isCI && this.scratchOrgUsername) {
        await execCommand(`sfdx force:org:delete --noprompt --targetusername ${this.scratchOrgUsername}`, this, {
          fail: false,
          output: true,
        });
        uxLog(this, c.red("Deleted scratch org as we are in CI and its creation has failed"));
      }
      throw e;
    }

    // Show password to user
    if (this.scratchOrgPassword) {
      uxLog(
        this,
        c.cyan(`You can connect to your scratch using username ${c.green(this.scratchOrgUsername)} and password ${c.green(this.scratchOrgPassword)}`)
      );
    }

    // Return an object to be displayed with --json
    return {
      outputString: "Created and initialized scratch org",
    };
  }

  // Initialize configuration from .sfdx-hardis.yml + .gitbranch.sfdx-hardis.yml + .username.sfdx-hardis.yml
  public async initConfig() {
    this.configInfo = await getConfig("user");
    this.gitBranch = await getCurrentGitBranch({ formatted: true });
    const newScratchName = os.userInfo().username + "-" + this.gitBranch.split("/").pop().slice(0, 15) + "_" + moment().format("YYYY-MM-DD_hh-mm");
    this.scratchOrgAlias = process.env.SCRATCH_ORG_ALIAS || (!this.forceNew ? this.configInfo.scratchOrgAlias : null) || newScratchName;
    if (isCI && !this.scratchOrgAlias.startsWith("CI-")) {
      this.scratchOrgAlias = "CI-" + this.scratchOrgAlias;
    }
    // Verify that the user wants to resume scratch org creation
    if (!isCI && this.scratchOrgAlias !== newScratchName) {
      const checkRes = await prompts({
        type: "confirm",
        message: c.cyanBright(
          `You are about to reuse scratch org ${c.green(this.scratchOrgAlias)}. Are you sure that's what you want to do ?\n${c.grey(
            "(if not, run again hardis:work:new or use hardis:scratch:create --forcenew)"
          )}`
        ),
        default: false,
      });
      if (checkRes === false) {
        process.exit(0);
      }
    }
    this.projectName = process.env.PROJECT_NAME || this.configInfo.projectName;
    this.devHubAlias = process.env.DEVHUB_ALIAS || this.configInfo.devHubAlias;

    this.scratchOrgDuration = process.env.SCRATCH_ORG_DURATION || isCI ? 1 : 30;
    this.userEmail = process.env.USER_EMAIL || process.env.GITLAB_USER_EMAIL || this.configInfo.userEmail;

    // If not found, prompt user email and store it in user config file
    if (this.userEmail == null) {
      const promptResponse = await prompts({
        type: "text",
        name: "value",
        message: c.cyanBright("Please input your email address"),
        validate: (value: string) => EmailValidator.validate(value),
      });
      this.userEmail = promptResponse.value;
      await setConfig("user", {
        userEmail: this.userEmail,
      });
    }
  }

  // Create a new scratch org or reuse existing one
  public async createScratchOrg() {
    // Build project-scratch-def-branch-user.json
    uxLog(this, c.cyan("Building custom project-scratch-def.json..."));
    this.projectScratchDef = JSON.parse(fs.readFileSync("./config/project-scratch-def.json"));
    this.projectScratchDef.orgName = this.scratchOrgAlias;
    this.projectScratchDef.adminEmail = this.userEmail;
    this.projectScratchDef.username = `${this.userEmail.split("@")[0]}@hardis-scratch-${this.scratchOrgAlias}.com`;
    const projectScratchDefLocal = `./config/user/project-scratch-def-${this.scratchOrgAlias}.json`;
    await fs.ensureDir(path.dirname(projectScratchDefLocal));
    await fs.writeFile(projectScratchDefLocal, JSON.stringify(this.projectScratchDef, null, 2));
    // Check current scratch org
    const orgListResult = await execSfdxJson("sfdx force:org:list", this);
    const matchingScratchOrgs =
      orgListResult?.result?.scratchOrgs.filter((org: any) => {
        return org.alias === this.scratchOrgAlias && org.status === "Active";
      }) || [];
    // Reuse existing scratch org
    if (matchingScratchOrgs?.length > 0 && !this.forceNew) {
      this.scratchOrgInfo = matchingScratchOrgs[0];
      this.scratchOrgUsername = this.scratchOrgInfo.username;
      uxLog(this, c.cyan(`Reusing org ${c.green(this.scratchOrgAlias)} with user ${c.green(this.scratchOrgUsername)}`));
      return;
    }

    // Create new scratch org
    uxLog(this, c.cyan("Creating new scratch org..."));
    const createCommand =
      "sfdx force:org:create --setdefaultusername " +
      `--definitionfile ${projectScratchDefLocal} ` +
      `--setalias ${this.scratchOrgAlias} ` +
      `--targetdevhubusername ${this.devHubAlias} ` +
      `-d ${this.scratchOrgDuration}`;
    const createResult = await execSfdxJson(createCommand, this, {
      fail: false,
      output: false,
      debug: this.debugMode,
    });
    assert(
      createResult.status === 0,
      c.red(
        `[sfdx-hardis] Error creating scratch org. Maybe try ${c.yellow(c.bold("sfdx hardis:scratch:create --forcenew"))} ?\n${JSON.stringify(
          createResult,
          null,
          2
        )}`
      )
    );
    this.scratchOrgInfo = createResult.result;
    this.scratchOrgUsername = this.scratchOrgInfo.username;
    await setConfig("user", {
      scratchOrgAlias: this.scratchOrgAlias,
      scratchOrgUsername: this.scratchOrgUsername,
    });
    // Generate password
    const passwordCommand = `sfdx force:user:password:generate --targetusername ${this.scratchOrgUsername}`;
    const passwordResult = await execSfdxJson(passwordCommand, this, {
      fail: true,
      output: false,
      debug: this.debugMode,
    });
    this.scratchOrgPassword = passwordResult.result.password;
    await setConfig("user", {
      scratchOrgPassword: this.scratchOrgPassword,
    });
    // Trigger a status refresh on VsCode WebSocket Client
    WebSocketClient.sendMessage({ event: "refreshStatus" });

    if (isCI) {
      // Try to store sfdxAuthUrl for scratch org reuse during CI
      const displayOrgCommand = `sfdx force:org:display -u ${this.scratchOrgAlias} --verbose`;
      const displayResult = await execSfdxJson(displayOrgCommand, this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
      if (displayResult.sfdxAuthUrl) {
        await setConfig("user", {
          scratchOrgAuthUrl: displayResult.sfdxAuthUrl,
        });
      }
      // Display org URL
      const openRes = await execSfdxJson("sfdx force:org:open --urlonly", this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });    
      uxLog(this, c.cyan(`Open scratch org with url: ${c.green(openRes?.result?.url)}`));
    } else {
      // Open scratch org for user if not in CI
      await execSfdxJson("sfdx force:org:open", this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
    }
    uxLog(this, c.cyan(`Created scratch org ${c.green(this.scratchOrgAlias)} with user ${c.green(this.scratchOrgUsername)}`));
  }

  // Install packages
  public async installPackages() {
    const packages = this.configInfo.installedPackages || [];
    await MetadataUtils.installPackagesOnOrg(packages, this.scratchOrgAlias, this, "scratch");
  }

  // Push or deploy metadatas to the scratch org
  public async initOrgMetadatas() {
    if ((isCI && process.env.CI_SCRATCH_MODE !== "push") || process.env.DEBUG_DEPLOY === "true") {
      // if CI, use force:source:deploy to make sure package.xml is consistent
      uxLog(this, c.cyan(`Deploying project sources to scratch org ${c.green(this.scratchOrgAlias)}...`));
      const packageXmlFile =
        process.env.PACKAGE_XML_TO_DEPLOY || this.configInfo.packageXmlToDeploy || fs.existsSync("./manifest/package.xml")
          ? "./manifest/package.xml"
          : "./config/package.xml";
      await forceSourceDeploy(packageXmlFile, false, "NoTestRun", this.debugMode, this, {
        targetUsername: this.scratchOrgUsername,
      });
    } else {
      // Use push for local scratch orgs
      uxLog(
        this,
        c.cyan(`Pushing project sources to scratch org ${c.green(this.scratchOrgAlias)}... (You can see progress in Setup -> Deployment Status)`)
      );
      const deferSharingCalc = (this.projectScratchDef.features || []).includes("DeferSharingCalc");
      // Suspend sharing calc if necessary
      if (deferSharingCalc) {
        // Deploy to permission set allowing to update SharingCalc
        await deployMetadatas({
          deployDir: path.join(path.join(__dirname, "../../../../defaults/utils/deferSharingCalc", ".")),
          testlevel: "NoTestRun",
          soap: true,
        });
        // Assign to permission set allowing to update SharingCalc
        const assignCommand = `sfdx force:user:permset:assign -n SfdxHardisDeferSharingRecalc -u ${this.scratchOrgUsername}`;
        await execSfdxJson(assignCommand, this, {
          fail: true,
          output: false,
          debug: this.debugMode,
        });
        await execCommand("sfdx texei:sharingcalc:suspend", this, {
          fail: true,
          output: true,
          debug: this.debugMode,
        });
      }
      await forceSourcePush(this.scratchOrgAlias, this.debugMode);
      // Resume sharing calc if necessary
      if (deferSharingCalc) {
        await execCommand("sfdx texei:sharingcalc:resume", this, {
          fail: true,
          output: true,
          debug: this.debugMode,
        });
      }
    }
  }

  // Assign permission sets to user
  public async initPermissionSetAssignments() {
    uxLog(this, c.cyan("Assigning Permission Sets..."));
    const permSets = this.configInfo.initPermissionSets || [];
    for (const permSet of permSets) {
      uxLog(this, c.cyan(`Assigning ${c.bold(permSet.name)} to scratch org user`));
      const assignCommand = `sfdx force:user:permset:assign -n ${permSet.name} -u ${this.scratchOrgUsername}`;
      const assignResult = await execSfdxJson(assignCommand, this, {
        fail: false,
        output: false,
        debug: this.debugMode,
      });
      if (assignResult.status !== 0 && !assignResult.message.includes("Duplicate")) {
        uxLog(this, c.red(`Error assigning to${c.bold(permSet.name)}\n${assignResult.message}`));
      }
    }
  }

  // Run initialization apex scripts
  public async initApexScripts() {
    uxLog(this, c.cyan("Running apex initialization scripts..."));
    const allApexScripts = await glob("**/scripts/**/*.apex");
    const scratchOrgInitApexScripts = this.configInfo.scratchOrgInitApexScripts || [];
    // Build ordered list of apex scripts
    const initApexScripts = scratchOrgInitApexScripts.map((scriptName: string) => {
      const matchingScripts = allApexScripts.filter((apexScript: string) => path.basename(apexScript) === scriptName);
      if (matchingScripts.length === 0) {
        throw new SfdxError(c.red(`[sfdx-hardis][ERROR] Unable to find script ${scriptName}.apex`));
      }
      return matchingScripts[0];
    });
    // Process apex scripts
    for (const apexScript of initApexScripts) {
      const apexScriptCommand = `sfdx force:apex:execute -f "${apexScript}" -u ${this.scratchOrgAlias}`;
      await execCommand(apexScriptCommand, this, {
        fail: true,
        output: true,
        debug: this.debugMode,
      });
    }
  }

  // Loads data in the org
  public async initOrgData() {
    const scratchInitDataFolder = path.join(".", "scripts", "data", "ScratchInit");
    if (fs.existsSync(scratchInitDataFolder)) {
      uxLog(this, c.cyan("Loading scratch org initialization data..."));
      await importData(scratchInitDataFolder, this, {
        targetUsername: this.scratchOrgUsername,
      });
    } else {
      uxLog(this, c.cyan(`No initialization data: Define a sfdmu workspace in ${scratchInitDataFolder} if you need data in your new scratch orgs`));
    }
  }
}
