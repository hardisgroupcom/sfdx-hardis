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

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseInstanceUpgrade extends SfCommand<any> {
  public static title = 'Get Instance Upgrade date';

  public static description = `Get the date when the org instance will be upgraded (to Spring, Summer or Winter)
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
      uxLog(this, c.yellow(notifText));
    } else if (daysBeforeUpgrade <= 30) {
      notifSeverity = 'info';
      uxLog(this, c.green(notifText));
    } else {
      uxLog(this, c.green(notifText));
    }

    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
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
