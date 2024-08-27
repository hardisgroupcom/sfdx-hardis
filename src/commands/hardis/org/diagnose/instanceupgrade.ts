/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import axios from "axios";
import * as moment from "moment";
import * as c from "chalk";
import { uxLog } from "../../../../common/utils/index.js";
import { soqlQuery } from "../../../../common/utils/apiUtils";
import { NotifProvider, NotifSeverity } from "../../../../common/notifProvider";
import { getNotificationButtons, getOrgMarkdown } from "../../../../common/utils/notifUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DiagnoseInstanceUpgrade extends SfCommand {
  public static title = "Get Instance Upgrade date";

  public static description = `Get the date when the org instance will be upgraded (to Spring, Summer or Winter)
  `;

  public static examples = ["$ sf hardis:org:diagnose:instanceupgrade"];

  protected static flagsConfig = {
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
    const orgInfo = orgQueryRes.records[0];
    const instanceName = orgInfo.InstanceName;

    // Get Salesforce instance info
    const instanceStatusUrl = `https://api.status.salesforce.com/v1/instances/${instanceName}/status`;
    const axiosResponse = await axios.get(instanceStatusUrl);
    const instanceInfo = axiosResponse.data;
    const maintenances = instanceInfo.Maintenances || [];
    orgInfo.maintenanceNextUpgrade = {};
    for (const maintenance of maintenances) {
      if (maintenance.isCore && maintenance.releaseType === "Major" && maintenance.serviceKeys.includes("coreService")) {
        orgInfo.maintenanceNextUpgrade = maintenance;
        break;
      }
    }

    // Get number of days before next major upgrade
    const nextUpgradeDate = moment(orgInfo?.maintenanceNextUpgrade?.plannedStartTime);
    const nextMajorUpgradeDateStr = nextUpgradeDate.format();
    const today = moment();
    const daysBeforeUpgrade = nextUpgradeDate.diff(today, "days");

    // Manage notifications
    const orgMarkdown = await getOrgMarkdown(this.org?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = "log";
    const notifText = `Salesforce instance ${instanceName} of ${orgMarkdown} will be upgraded on ${nextMajorUpgradeDateStr} (${daysBeforeUpgrade} days) to ${orgInfo?.maintenanceNextUpgrade?.name}`;

    // Change severity according to number of days
    if (daysBeforeUpgrade <= 15) {
      notifSeverity = "warning";
      uxLog(this, c.yellow(notifText));
    } else if (daysBeforeUpgrade <= 30) {
      notifSeverity = "info";
      uxLog(this, c.green(notifText));
    } else {
      uxLog(this, c.green(notifText));
    }

    globalThis.jsForceConn = this?.org?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
      type: "ORG_INFO",
      text: notifText,
      attachments: [],
      buttons: notifButtons,
      severity: notifSeverity,
      logElements: [orgInfo],
      data: {
        metric: daysBeforeUpgrade,
      },
      metrics: {
        DayBeforeUpgrade: daysBeforeUpgrade,
      },
    });

    // Return an object to be displayed with --json
    return {
      message: notifText,
      nextUpgradeDate: nextUpgradeDate.format(),
      orgInfo: orgInfo,
      instanceInfo: instanceInfo,
    };
  }
}
