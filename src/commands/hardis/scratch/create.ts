/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { AuthInfo, Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { assert } from "console";
import * as fs from "fs-extra";
import * as moment from "moment";
import * as os from "os";
import * as path from "path";
import { clearCache } from "../../../common/cache";
import { elapseEnd, elapseStart, execCommand, execSfdxJson, getCurrentGitBranch, isCI, uxLog } from "../../../common/utils";
import {
  initApexScripts,
  initOrgData,
  initOrgMetadatas,
  initPermissionSetAssignments,
  installPackages,
  promptUserEmail,
} from "../../../common/utils/orgUtils";
import { addScratchOrgToPool, fetchScratchOrg } from "../../../common/utils/poolUtils";
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

  public static description = `Create and initialize a scratch org or a source-tracked sandbox (config can be defined using \`config/.sfdx-hardis.yml\`):

- **Install packages**
  - Use property \`installedPackages\`
- **Push sources**
- **Assign permission sets**
  - Use property \`initPermissionSets\`
- **Run apex initialization scripts**
  - Use property \`scratchOrgInitApexScripts\`
- **Load data**
  - Use property \`dataPackages\`
  `;

  public static examples = ["$ sf hardis:scratch:create"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    forcenew: flags.boolean({
      char: "n",
      default: false,
      description: messages.getMessage("forceNewScratch"),
    }),
    pool: flags.boolean({
      char: "d",
      default: false,
      description: "Creates the scratch org for a scratch org pool",
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
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdmu", "texei-sfdx-plugin"];

  protected forceNew = false;

  /* jscpd:ignore-end */

  protected debugMode = false;
  protected pool = false;
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
  protected scratchOrgSfdxAuthUrl: string;
  protected authFileJson: any;
  protected projectName: string;
  protected scratchOrgFromPool: any;

  public async run(): Promise<AnyJson> {
    this.pool = this.flags.pool || false;
    this.debugMode = this.flags.debug || false;
    this.forceNew = this.flags.forcenew || false;
    elapseStart(`Create and initialize scratch org`);
    await this.initConfig();
    await this.createScratchOrg();
    try {
      await this.updateScratchOrgUser();
      await installPackages(this.configInfo.installedPackages || [], this.scratchOrgAlias);
      if (this.pool === false) {
        await initOrgMetadatas(this.configInfo, this.scratchOrgUsername, this.scratchOrgAlias, this.projectScratchDef, this.debugMode, {
          scratch: true,
        });
        await initPermissionSetAssignments(this.configInfo.initPermissionSets || [], this.scratchOrgUsername);
        await initApexScripts(this.configInfo.scratchOrgInitApexScripts || [], this.scratchOrgUsername);
        await initOrgData(path.join(".", "scripts", "data", "ScratchInit"), this.scratchOrgUsername);
      }
    } catch (e) {
      elapseEnd(`Create and initialize scratch org`);
      uxLog(this, c.grey("Error: " + e.message + "\n" + e.stack));
      if (isCI && this.scratchOrgFromPool) {
        this.scratchOrgFromPool.failures = this.scratchOrgFromPool.failures || [];
        this.scratchOrgFromPool.failures.push(JSON.stringify(e, null, 2));
        uxLog(this, "[pool] " + c.yellow("Put back scratch org in the scratch orgs pool. ") + c.grey({ result: this.scratchOrgFromPool }));
        await addScratchOrgToPool(this.scratchOrgFromPool, { position: "first" });
      } else if (isCI && this.scratchOrgUsername) {
        await execCommand(`sf org delete scratch --no-prompt --target-org ${this.scratchOrgUsername}`, this, {
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
        c.cyan(`You can connect to your scratch using username ${c.green(this.scratchOrgUsername)} and password ${c.green(this.scratchOrgPassword)}`),
      );
    }
    elapseEnd(`Create and initialize scratch org`);
    // Return an object to be displayed with --json
    return {
      status: 0,
      scratchOrgAlias: this.scratchOrgAlias,
      scratchOrgInfo: this.scratchOrgInfo,
      scratchOrgUsername: this.scratchOrgUsername,
      scratchOrgPassword: this.scratchOrgPassword,
      scratchOrgSfdxAuthUrl: this.scratchOrgSfdxAuthUrl,
      authFileJson: this.authFileJson,
      outputString: "Created and initialized scratch org",
    };
  }

  // Initialize configuration from .sfdx-hardis.yml + .gitbranch.sfdx-hardis.yml + .username.sfdx-hardis.yml
  public async initConfig() {
    this.configInfo = await getConfig("user");
    this.gitBranch = await getCurrentGitBranch({ formatted: true });
    const newScratchName = os.userInfo().username + "-" + this.gitBranch.split("/").pop().slice(0, 15) + "_" + moment().format("YYYYMMDD_hhmm");
    this.scratchOrgAlias =
      process.env.SCRATCH_ORG_ALIAS || (!this.forceNew && this.pool === false ? this.configInfo.scratchOrgAlias : null) || newScratchName;
    if (isCI && !this.scratchOrgAlias.startsWith("CI-")) {
      this.scratchOrgAlias = "CI-" + this.scratchOrgAlias;
    }
    if (this.pool === true) {
      this.scratchOrgAlias = "PO-" + Math.random().toString(36).substr(2, 2) + this.scratchOrgAlias;
    }
    // Verify that the user wants to resume scratch org creation
    if (!isCI && this.scratchOrgAlias !== newScratchName && this.pool === false) {
      const checkRes = await prompts({
        type: "confirm",
        name: "value",
        message: c.cyanBright(
          `You are about to reuse scratch org ${c.green(this.scratchOrgAlias)}. Are you sure that's what you want to do ?\n${c.grey(
            "(if not, run again hardis:work:new or use hardis:scratch:create --forcenew)",
          )}`,
        ),
        default: false,
      });
      if (checkRes.value === false) {
        process.exit(0);
      }
    }
    this.projectName = process.env.PROJECT_NAME || this.configInfo.projectName;
    this.devHubAlias = process.env.DEVHUB_ALIAS || this.configInfo.devHubAlias;

    this.scratchOrgDuration = process.env?.SCRATCH_ORG_DURATION
      ? process.env.SCRATCH_ORG_DURATION // Priority to global variable if defined
      : isCI && this.pool === false
        ? 1 // If CI and not during pool feed job, default is 1 day because the scratch will not be used after the job
        : this.configInfo?.scratchOrgDuration
          ? this.configInfo.scratchOrgDuration // Override default value in scratchOrgDuration
          : 30; // Default value: 30

    this.userEmail = process.env.USER_EMAIL || process.env.GITLAB_USER_EMAIL || this.configInfo.userEmail;

    // If not found, prompt user email and store it in user config file
    if (this.userEmail == null) {
      if (this.pool === true) {
        throw new SfdxError(c.red("You need to define userEmail property in .sfdx-hardis.yml"));
      }
      this.userEmail = await promptUserEmail();
    }
  }

  // Create a new scratch org or reuse existing one
  public async createScratchOrg() {
    // Build project-scratch-def-branch-user.json
    uxLog(this, c.cyan("Building custom project-scratch-def.json..."));
    this.projectScratchDef = JSON.parse(fs.readFileSync("./config/project-scratch-def.json", "utf-8"));
    this.projectScratchDef.orgName = this.scratchOrgAlias;
    this.projectScratchDef.adminEmail = this.userEmail;
    this.projectScratchDef.username = `${this.userEmail.split("@")[0]}@hardis-scratch-${this.scratchOrgAlias}.com`;
    const projectScratchDefLocal = `./config/user/project-scratch-def-${this.scratchOrgAlias}.json`;
    await fs.ensureDir(path.dirname(projectScratchDefLocal));
    await fs.writeFile(projectScratchDefLocal, JSON.stringify(this.projectScratchDef, null, 2));
    // Check current scratch org
    const orgListResult = await execSfdxJson("sf org list", this);
    const hubOrgUsername = this.hubOrg.getUsername();
    const matchingScratchOrgs =
      orgListResult?.result?.scratchOrgs?.filter((org: any) => {
        return org.alias === this.scratchOrgAlias && org.status === "Active" && org.devHubUsername === hubOrgUsername;
      }) || [];
    // Reuse existing scratch org
    if (matchingScratchOrgs?.length > 0 && !this.forceNew && this.pool === false) {
      this.scratchOrgInfo = matchingScratchOrgs[0];
      this.scratchOrgUsername = this.scratchOrgInfo.username;
      uxLog(this, c.cyan(`Reusing org ${c.green(this.scratchOrgAlias)} with user ${c.green(this.scratchOrgUsername)}`));
      return;
    }
    // Try to fetch a scratch org from the pool
    if (this.pool === false && this.configInfo.poolConfig) {
      this.scratchOrgFromPool = await fetchScratchOrg({ devHubConn: this.hubOrg.getConnection(), devHubUsername: this.hubOrg.getUsername() });
      if (this.scratchOrgFromPool) {
        this.scratchOrgAlias = this.scratchOrgFromPool.scratchOrgAlias;
        this.scratchOrgInfo = this.scratchOrgFromPool.scratchOrgInfo;
        this.scratchOrgUsername = this.scratchOrgFromPool.scratchOrgUsername;
        this.scratchOrgPassword = this.scratchOrgFromPool.scratchOrgPassword;
        await setConfig("user", { scratchOrgAlias: this.scratchOrgAlias });
        uxLog(this, "[pool] " + c.cyan(`Fetched org ${c.green(this.scratchOrgAlias)} from pool with user ${c.green(this.scratchOrgUsername)}`));
        if (!isCI) {
          uxLog(this, c.cyan("Now opening org...") + " " + c.yellow("(The org is not ready to work in until this script is completed !)"));
          await execSfdxJson("sf org open", this, {
            fail: true,
            output: false,
            debug: this.debugMode,
          });
          // Trigger a status refresh on VsCode WebSocket Client
          WebSocketClient.sendMessage({ event: "refreshStatus" });
        }
        return;
      }
    }

    // Fix @salesforce/cli bug: remove shape.zip if found
    const tmpShapeFolder = path.join(os.tmpdir(), "shape");
    if (fs.existsSync(tmpShapeFolder) && this.pool === false) {
      await fs.remove(tmpShapeFolder);
      uxLog(this, c.grey("Deleted " + tmpShapeFolder));
    }

    // Create new scratch org
    uxLog(this, c.cyan("Creating new scratch org..."));
    const waitTime = process.env.SCRATCH_ORG_WAIT || "15";
    const createCommand =
      "sf org create scratch --set-default " +
      `--definition-file ${projectScratchDefLocal} ` +
      `--set-alias ${this.scratchOrgAlias} ` +
      `--wait ${waitTime} ` +
      `--target-org ${this.devHubAlias} ` +
      `--duration-days ${this.scratchOrgDuration}`;
    const createResult = await execSfdxJson(createCommand, this, {
      fail: false,
      output: false,
      debug: this.debugMode,
    });
    await clearCache("sf org list");
    assert(createResult.status === 0 && createResult.result, this.buildScratchCreateErrorMessage(createResult));
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

    if (isCI || this.pool === true) {
      // Try to store sfdxAuthUrl for scratch org reuse during CI
      const displayOrgCommand = `sf org display -o ${this.scratchOrgAlias} --verbose`;
      const displayResult = await execSfdxJson(displayOrgCommand, this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
      if (displayResult.result.sfdxAuthUrl) {
        await setConfig("user", {
          scratchOrgSfdxAuthUrl: displayResult.result.sfdxAuthUrl,
        });
        this.scratchOrgSfdxAuthUrl = displayResult.result.sfdxAuthUrl;
      } else {
        // Try to get sfdxAuthUrl with workaround
        try {
          const authInfo = await AuthInfo.create({ username: displayResult.result.username });
          this.scratchOrgSfdxAuthUrl = authInfo.getSfdxAuthUrl();
          displayResult.result.sfdxAuthUrl = this.scratchOrgSfdxAuthUrl;
          await setConfig("user", {
            scratchOrgSfdxAuthUrl: this.scratchOrgSfdxAuthUrl,
          });
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
          uxLog(
            this,
            c.yellow(
              `Unable to fetch sfdxAuthUrl for ${displayResult.result.username}. Only Scratch Orgs created from DevHub using authenticated using sf org login sfdx-url or sf org login web will have access token and enabled for autoLogin\nYou may need to define SFDX_AUTH_URL_DEV_HUB or SFDX_AUTH_URL_devHubAlias in your CI job running sfdx hardis:scratch:pool:refresh`,
            ),
          );
          this.scratchOrgSfdxAuthUrl = null;
        }
      }
      if (this.pool) {
        await setConfig("user", {
          authFileJson: displayResult,
        });
        this.authFileJson = displayResult;
      }
      // Display org URL
      const openRes = await execSfdxJson("sf org open --url-only", this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
      uxLog(this, c.cyan(`Open scratch org with url: ${c.green(openRes?.result?.url)}`));
    } else {
      // Open scratch org for user if not in CI
      await execSfdxJson("sf org open", this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
    }
    uxLog(this, c.cyan(`Created scratch org ${c.green(this.scratchOrgAlias)} with user ${c.green(this.scratchOrgUsername)}`));
  }

  public buildScratchCreateErrorMessage(createResult) {
    if (createResult.status === 0 && createResult.result) {
      return c.green("Scratch create OK");
    } else if (createResult.status === 1 && createResult.errorMessage.includes("Socket timeout occurred while listening for results")) {
      return c.red(
        `[sfdx-hardis] Error creating scratch org. ${c.bold(
          "This is probably a Salesforce error, try again manually or launch again CI job",
        )}\n${JSON.stringify(createResult, null, 2)}`,
      );
    } else if (createResult.status === 1 && createResult.errorMessage.includes("LIMIT_EXCEEDED")) {
      return c.red(
        `[sfdx-hardis] Error creating scratch org. ${c.bold(
          'It seems you have no more scratch orgs available, go delete some in "Active Scratch Orgs" tab in the Dev Hub org',
        )}\n${JSON.stringify(createResult, null, 2)}`,
      );
    }
    return c.red(
      `[sfdx-hardis] Error creating scratch org. Maybe try ${c.yellow(c.bold("sf hardis:scratch:create --forcenew"))} ?\n${JSON.stringify(
        createResult,
        null,
        2,
      )}`,
    );
  }

  // Update scratch org user
  public async updateScratchOrgUser() {
    const config = await getConfig("user");
    // Update scratch org main user
    uxLog(this, c.cyan("Update / fix scratch org user " + this.scratchOrgUsername));
    const userQueryCommand = `sfdx force:data:record:get -s User -w "Username=${this.scratchOrgUsername}" -u ${this.scratchOrgAlias}`;
    const userQueryRes = await execSfdxJson(userQueryCommand, this, { fail: true, output: false, debug: this.debugMode });
    let updatedUserValues = `LastName='SFDX-HARDIS' FirstName='Scratch Org'`;
    if (config.userEmail !== userQueryRes.result.CountryCode) {
      updatedUserValues += ` Email='${config.userEmail}'`;
    }
    // Fix country value is State & Country picklist activated
    if ((this.projectScratchDef.features || []).includes("StateAndCountryPicklist") && userQueryRes.result.CountryCode == null) {
      updatedUserValues += ` CountryCode='${config.defaultCountryCode || "FR"}' Country='${config.defaultCountry || "France"}'`;
    }
    if ((this.projectScratchDef.features || []).includes("MarketingUser") && userQueryRes.result.UserPermissionsMarketingUser === false) {
      // Make sure MarketingUser is checked on scratch org user if it is supposed to be
      updatedUserValues += " UserPermissionsMarketingUser=true";
    }
    const userUpdateCommand = `sfdx force:data:record:update -s User -i ${userQueryRes.result.Id} -v "${updatedUserValues}" -u ${this.scratchOrgAlias}`;
    await execSfdxJson(userUpdateCommand, this, { fail: false, output: true, debug: this.debugMode });
  }
}
