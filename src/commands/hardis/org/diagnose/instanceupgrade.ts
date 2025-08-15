/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import axios from 'axios';
import moment from 'moment';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseInstanceUpgrade extends SfCommand<any> {
  public static title = 'Get Instance Upgrade date';

  public static description = `
## Command Behavior

**Retrieves and displays the scheduled upgrade date for a Salesforce org's instance.**

This command provides crucial information about when your Salesforce instance will be upgraded to the next major release (Spring, Summer, or Winter). This is vital for release planning, testing, and ensuring compatibility with upcoming Salesforce features.

Key functionalities:

- **Instance Identification:** Determines the Salesforce instance name of your target org.
- **Upgrade Date Retrieval:** Fetches the planned start time of the next major core service upgrade for that instance from the Salesforce Status API.
- **Days Until Upgrade:** Calculates and displays the number of days remaining until the next major upgrade.
- **Severity-Based Logging:** Adjusts the log severity (info, warning) based on the proximity of the upgrade date, providing a visual cue for urgency.
- **Notifications:** Sends notifications to configured channels (e.g., Slack, MS Teams, Grafana) with the upgrade information, making it suitable for automated monitoring.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce SOQL Query:** It first queries the \`Organization\` object in Salesforce to get the \`InstanceName\` of the target org.
- **Salesforce Status API Integration:** It makes an HTTP GET request to the Salesforce Status API (\`https://api.status.salesforce.com/v1/instances/{instanceName}/status\`) to retrieve detailed information about the instance, including scheduled maintenances.
- **Data Parsing:** It parses the JSON response from the Status API to extract the relevant major release upgrade information.
- **Date Calculation:** Uses the \`moment\` library to calculate the difference in days between the current date and the planned upgrade date.
- **Notification Integration:** It integrates with the \`NotifProvider\` to send notifications, including the instance name, upgrade date, and days remaining, along with relevant metrics for monitoring dashboards.
- **User Feedback:** Provides clear messages to the user about the upgrade status and proximity.
</details>
`;

  public static examples = ['$ sf hardis:org:diagnose:instanceupgrade'];

  public static flags: any = {
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseInstanceUpgrade);
    this.debugMode = flags.debug || false;

    // Get instance name
    const orgQuery = 'SELECT FIELDS(all) FROM Organization LIMIT 1';
    const orgQueryRes = await soqlQuery(orgQuery, flags['target-org'].getConnection());
    const orgInfo = orgQueryRes.records[0];
    const instanceName = orgInfo.InstanceName;

    // Get Salesforce instance info
    const instanceStatusUrl = `https://api.status.salesforce.com/v1/instances/${instanceName}/status`;
    const axiosResponse = await axios.get(instanceStatusUrl);
    const instanceInfo = axiosResponse.data;
    const maintenances = instanceInfo.Maintenances || [];
    orgInfo.maintenanceNextUpgrade = {};
    for (const maintenance of maintenances) {
      if (
        maintenance.isCore &&
        maintenance.releaseType === 'Major' &&
        maintenance.serviceKeys.includes('coreService')
      ) {
        orgInfo.maintenanceNextUpgrade = maintenance;
        break;
      }
    }

    // Get number of days before next major upgrade
    const nextUpgradeDate = moment(orgInfo?.maintenanceNextUpgrade?.plannedStartTime);
    const nextMajorUpgradeDateStr = nextUpgradeDate.format("ll");
    const today = moment();
    const daysBeforeUpgrade = today.diff(nextUpgradeDate, 'days');

    // Manage notifications
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    const notifText = `Salesforce instance *${instanceName}* of ${orgMarkdown} will be upgraded on ${nextMajorUpgradeDateStr} (*${daysBeforeUpgrade} days*) to ${orgInfo?.maintenanceNextUpgrade?.name}`;

    // Change severity according to number of days
    if (daysBeforeUpgrade <= 15) {
      notifSeverity = 'warning';
      uxLog("warning", this, c.yellow(notifText));
    } else if (daysBeforeUpgrade <= 30) {
      notifSeverity = 'info';
      uxLog("success", this, c.green(notifText));
    } else {
      uxLog("success", this, c.green(notifText));
    }

    await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'ORG_INFO',
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
