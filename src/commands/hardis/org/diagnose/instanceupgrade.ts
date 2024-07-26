/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import axios from "axios";
import * as c from "chalk";
import { isCI, uxLog } from "../../../../common/utils";
import { soqlQuery } from "../../../../common/utils/apiUtils";
import { NotifProvider, NotifSeverity } from "../../../../common/notifProvider";
import { getNotificationButtons, getOrgMarkdown, getSeverityIcon } from "../../../../common/utils/notifUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DiagnoseInstanceUpgrade extends SfdxCommand {
  public static title = "Get Instance Upgrade date";

  public static description = `Get the date when the org instance will be upgraded (to Spring, Summer or Winter)
  `;

  public static examples = [
    "$ sfdx hardis:org:diagnose:instanceupgrade"
  ];

  protected static flagsConfig = {
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
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected debugMode = false;


  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;

    // Get instance name
    const orgQuery = "SELECT FIELDS(all) FROM Organization LIMIT 1";
    const orgQueryRes = await soqlQuery(orgQuery, this.org.getConnection());
    const instanceName = orgQueryRes.records[0].InstanceName;

    const instanceStatusUrl = `https://api.status.salesforce.com/v1/instances/${instanceName}/status`
    const axiosResponse = await axios.get(instanceStatusUrl);
    const instanceInfo = axiosResponse.data;
    const maintenances = instanceInfo.Maintenances || [];
    let maintenanceNextUpgrade;
    for (const maintenance of maintenances) {
      if (maintenance.isCore &&
        maintenance.releaseType === "Major" &&
        maintenance.serviceKeys.includes("coreService")) {
        maintenanceNextUpgrade = maintenance;
        break;
      }
    }


    // Manage notifications
    const orgMarkdown = await getOrgMarkdown(this.org?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = "log";
    let notifText = `No suspect Setup Audit Trail records has been found in ${orgMarkdown}`;
    let notifAttachments = [];

    globalThis.jsForceConn = this?.org?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
      type: "AUDIT_TRAIL",
      text: notifText,
      attachments: notifAttachments,
      buttons: notifButtons,
      severity: notifSeverity,
      logElements: this.auditTrailRecords,
      data: { metric: suspectRecords.length },
    });

    // Return an object to be displayed with --json
    return {
      message: msg,
      date: upgradeDate
    };
  }
}
