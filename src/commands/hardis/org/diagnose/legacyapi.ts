/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import axios from "axios";
import * as fs from 'fs-extra'
import * as c from 'chalk';
import * as os from 'os';
import path = require("path");
import { execCommand, uxLog } from "../../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class LegacyApi extends SfdxCommand {
  public static title = "Check for legacy API use";

  public static description = "Checks if an org uses a deprecated API version\nMore info at https://help.salesforce.com/s/articleView?id=000351312&language=en_US&mode=1&type=1";

  public static examples = ["$ sfdx hardis:org:diagnose:legacyapi"];

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
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected debugMode = false;
  protected apexSCannerCodeUrl = 'https://raw.githubusercontent.com/pozil/legacy-api-scanner/main/legacy-api-scanner.apex';

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;


    // Get Legacy API scanner apex code
    const tmpApexFile = path.join(os.tmpdir(), new Date().toJSON().slice(0, 10), 'legacy-api-scanner.apex');
    if (!fs.existsSync(tmpApexFile)) {
      uxLog(this, c.grey("Downloaded latest legacy API scanner script from " + this.apexSCannerCodeUrl));
      await fs.ensureDir(path.dirname(tmpApexFile));
      const response = await axios({
        method: "get",
        url: this.apexSCannerCodeUrl,
        responseType: "stream"
      });
      response.data.pipe(fs.createWriteStream(tmpApexFile));
    }

    // Execute apex code
    const apexScriptCommand = `sfdx force:apex:execute -f "${tmpApexFile}" -u ${this.org.getUsername()}`;
    const apexScriptLog = await execCommand(apexScriptCommand, this, {
      fail: true,
      output: true,
      debug: this.debugMode,
    });

    let msg = "No deprecated API call has been found in the latest 99 ApiTotalUsage logs";
    let statusCode = 0;
    if (apexScriptLog.stdout.match(/USER_DEBUG .* Found legacy API versions in logs/gm)) {
      msg = "Found legacy API versions in logs";
      statusCode = 1;
      uxLog(this, c.red(c.bold(msg)));
    }
    else {
      uxLog(this, c.green(msg));
    }

    // Return an object to be displayed with --json
    return { status: statusCode, message: msg };
  }
}
