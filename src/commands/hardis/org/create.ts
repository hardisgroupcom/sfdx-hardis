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
import { elapseEnd, elapseStart, execCommand, execSfdxJson, getCurrentGitBranch, uxLog } from "../../../common/utils";
import { importData } from "../../../common/utils/dataUtils";
import { prompts } from "../../../common/utils/prompts";
import { WebSocketClient } from "../../../common/websocketClient";
import { getConfig, setConfig } from "../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class SandboxCreate extends SfdxCommand {
  public static title = "Create sandbox org";

  public static description = "Create and initialize sandbox org"

  public static examples = ["$ sfdx hardis:org:create"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
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
  protected static requiresSfdxPlugins = ["sfdmu"];

  /* jscpd:ignore-end */

  protected debugMode = false;
  protected configInfo: any;
  protected devHubAlias: string;
  protected sandboxOrgAlias: string;
  protected userEmail: string;

  protected gitBranch: string;
  protected projectSandboxDef: any;
  protected sandboxOrgInfo: any;
  protected sandboxOrgUsername: string;
  protected sandboxOrgPassword: string;
  protected sandboxOrgSfdxAuthUrl: string;
  protected authFileJson: any;
  protected projectName: string;
  protected sandboxOrgFromPool: any;

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;
    elapseStart(`Create and initialize sandbox org`);
    await this.initConfig();
    await this.createSandboxOrg();
    try {
      await this.updateSandboxOrgUser();
      await this.initPermissionSetAssignments();
      await this.initApexScripts();
      await this.initOrgData();
    } catch (e) {
      elapseEnd(`Create and initialize sandbox org`);
      uxLog(this, c.grey("Error: " + e.message + "\n" + e.stack));
      throw e;
    }

    // Show password to user
    if (this.sandboxOrgPassword) {
      uxLog(
        this,
        c.cyan(`You can connect to your sandbox using username ${c.green(this.sandboxOrgUsername)} and password ${c.green(this.sandboxOrgPassword)}`)
      );
    }
    elapseEnd(`Create and initialize sandbox org`);
    // Return an object to be displayed with --json
    return {
      status: 0,
      sandboxOrgAlias: this.sandboxOrgAlias,
      sandboxOrgInfo: this.sandboxOrgInfo,
      sandboxOrgUsername: this.sandboxOrgUsername,
      sandboxOrgPassword: this.sandboxOrgPassword,
      sandboxOrgSfdxAuthUrl: this.sandboxOrgSfdxAuthUrl,
      authFileJson: this.authFileJson,
      outputString: "Created and initialized sandbox org",
    };
  }

  // Initialize configuration from .sfdx-hardis.yml + .gitbranch.sfdx-hardis.yml + .username.sfdx-hardis.yml
  public async initConfig() {
    this.configInfo = await getConfig("user");
    this.gitBranch = await getCurrentGitBranch({ formatted: true });
    const newSandboxName = os.userInfo().username + "-" + this.gitBranch.split("/").pop().slice(0, 15) + "_" + moment().format("YYYYMMDD_hhmm");
    this.sandboxOrgAlias = process.env.SANDBOX_ORG_ALIAS || newSandboxName;

    this.projectName = process.env.PROJECT_NAME || this.configInfo.projectName;
    this.devHubAlias = process.env.DEVHUB_ALIAS || this.configInfo.devHubAlias;

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

  // Create a new sandbox org or reuse existing one
  public async createSandboxOrg() {
    // Build project-sandbox-def-branch-user.json
    uxLog(this, c.cyan("Building custom project-sandbox-def.json..."));
    if (fs.existsSync("./config/project-sandbox-def.json")) {
      this.projectSandboxDef = JSON.parse(fs.readFileSync("./config/project-sandbox-def.json"));
    }
    else {
      this.projectSandboxDef = {
        sandboxName: "",
        description: "SFDX Hardis developer sandbox",
        licenseType: "Developer"
      };
    }
    this.projectSandboxDef.sandboxName = os.userInfo().username ;
    const projectSandboxDefLocal = `./config/user/project-sandbox-def-${this.sandboxOrgAlias}.json`;
    await fs.ensureDir(path.dirname(projectSandboxDefLocal));
    await fs.writeFile(projectSandboxDefLocal, JSON.stringify(this.projectSandboxDef, null, 2));

    // Fix sfdx-cli bug: remove shape.zip if found
    const tmpShapeFolder = path.join(os.tmpdir(), "shape");
    if (fs.existsSync(tmpShapeFolder)) {
      await fs.remove(tmpShapeFolder);
      uxLog(this, c.grey("Deleted " + tmpShapeFolder));
    }

    // Create new sandbox org
    uxLog(this, c.cyan("Creating new sandbox org..."));
    const waitTime = process.env.SANDBOX_ORG_WAIT || "30";
    const createCommand =
      "sfdx force:org:create --setdefaultusername " +
      "--type sandbox " +
      `--definitionfile ${projectSandboxDefLocal} ` +
      `--setalias ${this.sandboxOrgAlias} ` +
      `--wait ${waitTime} ` +
      `--targetusername ${this.devHubAlias} `;
    const createResult = await execSfdxJson(createCommand, this, {
      fail: false,
      output: false,
      debug: this.debugMode,
    });
    assert(createResult.status === 0 && createResult.result, this.buildSandboxCreateErrorMessage(createResult));
    this.sandboxOrgInfo = createResult.result;
    this.sandboxOrgUsername = this.sandboxOrgInfo.username;
    await setConfig("user", {
      sandboxOrgAlias: this.sandboxOrgAlias,
      sandboxOrgUsername: this.sandboxOrgUsername,
    });
    // Generate password
    const passwordCommand = `sfdx force:user:password:generate --targetusername ${this.sandboxOrgUsername}`;
    const passwordResult = await execSfdxJson(passwordCommand, this, {
      fail: true,
      output: false,
      debug: this.debugMode,
    });
    this.sandboxOrgPassword = passwordResult.result.password;
    await setConfig("user", {
      sandboxOrgPassword: this.sandboxOrgPassword,
    });
    // Trigger a status refresh on VsCode WebSocket Client
    WebSocketClient.sendMessage({ event: "refreshStatus" });

    // Open sandbox org for user if not in CI
    await execSfdxJson("sfdx force:org:open", this, {
      fail: true,
      output: false,
      debug: this.debugMode,
    });
    uxLog(this, c.cyan(`Created sandbox org ${c.green(this.sandboxOrgAlias)} with user ${c.green(this.sandboxOrgUsername)}`));
  }

  public buildSandboxCreateErrorMessage(createResult) {
    if (createResult.status === 0 && createResult.result) {
      return c.green("Sandbox create OK");
    } else if (createResult.status === 1 && createResult.errorMessage.includes("Socket timeout occurred while listening for results")) {
      return c.red(
        `[sfdx-hardis] Error creating sandbox org. ${c.bold(
          "This is probably a Salesforce error, try again manually or launch again CI job"
        )}\n${JSON.stringify(createResult, null, 2)}`
      );
    }
    return c.red(
      `[sfdx-hardis] Error creating sandbox org. Maybe try ${c.yellow(c.bold("sfdx hardis:sandbox:create --forcenew"))} ?\n${JSON.stringify(
        createResult,
        null,
        2
      )}`
    );
  }

  // Update sandbox org user
  public async updateSandboxOrgUser() {
    const config = await getConfig("user");
    // Update sandbox org main user
    uxLog(this, c.cyan("Update / fix sandbox org user " + this.sandboxOrgUsername));
    const userQueryCommand = `sfdx force:data:record:get -s User -w "Username=${this.sandboxOrgUsername}" -u ${this.sandboxOrgAlias}`;
    const userQueryRes = await execSfdxJson(userQueryCommand, this, { fail: true, output: false, debug: this.debugMode });
    let updatedUserValues = `LastName='SFDX-HARDIS' FirstName='Sandbox Org'`;
    // Fix country value is State & Country picklist activated
    if ((this.projectSandboxDef.features || []).includes("StateAndCountryPicklist") && userQueryRes.result.CountryCode == null) {
      updatedUserValues += ` CountryCode='${config.defaultCountryCode || "FR"}' Country='${config.defaultCountry || "France"}'`;
    }
    if ((this.projectSandboxDef.features || []).includes("MarketingUser") && userQueryRes.result.UserPermissionsMarketingUser === false) {
      // Make sure MarketingUser is checked on sandbox org user if it is supposed to be
      updatedUserValues += " UserPermissionsMarketingUser=true";
    }
    const userUpdateCommand = `sfdx force:data:record:update -s User -i ${userQueryRes.result.Id} -v "${updatedUserValues}" -u ${this.sandboxOrgAlias}`;
    await execSfdxJson(userUpdateCommand, this, { fail: false, output: true, debug: this.debugMode });
  }

  // Assign permission sets to user
  public async initPermissionSetAssignments() {
    uxLog(this, c.cyan("Assigning Permission Sets..."));
    const permSets = this.configInfo.initPermissionSets || [];
    for (const permSet of permSets) {
      uxLog(this, c.cyan(`Assigning ${c.bold(permSet.name || permSet)} to sandbox org user`));
      const assignCommand = `sfdx force:user:permset:assign -n ${permSet.name || permSet} -u ${this.sandboxOrgUsername}`;
      const assignResult = await execSfdxJson(assignCommand, this, {
        fail: false,
        output: false,
        debug: this.debugMode,
      });
      if (assignResult?.result?.failures?.length > 0 && !assignResult?.result?.failures[0].message.includes("Duplicate")) {
        uxLog(this, c.red(`Error assigning to ${c.bold(permSet.name || permSet)}\n${assignResult?.result?.failures[0].message}`));
      }
    }
  }

  // Run initialization apex scripts
  public async initApexScripts() {
    uxLog(this, c.cyan("Running apex initialization scripts..."));
    const allApexScripts = await glob("**/scripts/**/*.apex");
    const sandboxOrgInitApexScripts = this.configInfo.sandboxOrgInitApexScripts || [];
    // Build ordered list of apex scripts
    const initApexScripts = sandboxOrgInitApexScripts.map((scriptName: string) => {
      const matchingScripts = allApexScripts.filter((apexScript: string) => path.basename(apexScript) === scriptName);
      if (matchingScripts.length === 0) {
        throw new SfdxError(c.red(`[sfdx-hardis][ERROR] Unable to find script ${scriptName}.apex`));
      }
      return matchingScripts[0];
    });
    // Process apex scripts
    for (const apexScript of initApexScripts) {
      const apexScriptCommand = `sfdx force:apex:execute -f "${apexScript}" -u ${this.sandboxOrgAlias}`;
      await execCommand(apexScriptCommand, this, {
        fail: true,
        output: true,
        debug: this.debugMode,
      });
    }
  }

  // Loads data in the org
  public async initOrgData() {
    // SandboxInit folder (accounts, etc...)
    const sandboxInitDataFolder = path.join(".", "scripts", "data", "SandboxInit");
    if (fs.existsSync(sandboxInitDataFolder)) {
      uxLog(this, c.cyan("Loading sandbox org initialization data..."));
      await importData(sandboxInitDataFolder, this, {
        targetUsername: this.sandboxOrgUsername,
      });
    } else {
      uxLog(this, c.cyan(`No initialization data: Define a sfdmu workspace in ${sandboxInitDataFolder} if you need data in your new sandbox orgs`));
    }

    // Import data packages
    const config = await getConfig("user");
    const dataPackages = config.dataPackages || [];
    for (const dataPackage of dataPackages) {
      if (dataPackage.importInSandboxOrgs === true) {
        await importData(dataPackage.dataPath, this, {
          targetUsername: this.sandboxOrgUsername,
        });
      } else {
        uxLog(this, c.grey(`Skipped import of ${dataPackage.dataPath} as importInSandboxOrgs is not defined to true in .sfdx-hardis.yml`));
      }
    }
  }
}
