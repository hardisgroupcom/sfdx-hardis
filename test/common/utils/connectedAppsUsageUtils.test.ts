import { expect } from 'chai';
import { buildConnectedAppsUsage } from '../../../src/common/utils/connectedAppsUsageUtils.js';
import { anonymizeRows, stripSensitiveValues } from '../../../src/common/utils/anonymizeUtils.js';

describe('connectedAppsUsageUtils', () => {
  describe('buildConnectedAppsUsage()', () => {
    const recentDate = new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0];
    const olderDate = new Date(Date.now() - 10 * 86400000).toISOString().split('T')[0];
    const token = (appName: string, appType: string, username: string, lastUsedDate: string, namespace = '') => ({
      AppName: appName,
      "App Type": appType,
      "User": 'N/A',
      "Username": username,
      "Last Used Date": lastUsedDate,
      "x-Token-Namespace": namespace,
    });

    it('aggregates the tokens of each app, sorted by app name', async () => {
      const conn: any = { metadata: { list: async () => [{ fullName: 'My_App' }] } };
      const rows = await buildConnectedAppsUsage([
        token('My App', 'Connected App', 'b@x.com', olderDate),
        token('My App', 'Connected App', 'a@x.com', recentDate),
        token('Ext App', 'Ext Client App', 'a@x.com', 'N/A'),
        token('Salesforce Mobile', 'Connected App', 'a@x.com', recentDate),
        token('Packaged', 'Connected App', 'a@x.com', recentDate, 'pkg'),
      ], conn);
      expect(stripSensitiveValues(rows)).to.deep.equal([
        { "Connected App": 'Ext App', "App Type": 'Ext Client App', "Last Used Date": 'N/A', "Move to External Client App": 'Not needed', "Usernames": 'a@x.com' },
        { "Connected App": 'My App', "App Type": 'Connected App', "Last Used Date": recentDate, "Move to External Client App": 'Required', "Usernames": 'a@x.com\nb@x.com' },
        { "Connected App": 'Packaged', "App Type": 'Connected App', "Last Used Date": recentDate, "Move to External Client App": 'Vendor', "Usernames": 'a@x.com' },
        { "Connected App": 'Salesforce Mobile', "App Type": 'Connected App', "Last Used Date": recentDate, "Move to External Client App": 'Vendor', "Usernames": 'a@x.com' },
      ]);
    });

    it('recognizes a Connected App of the org from its API name when its label is different', async () => {
      const conn: any = { metadata: { list: async () => [{ fullName: 'DLIntegration' }] } };
      const rows = await buildConnectedAppsUsage(
        [{ ...token('Data Loader Integration', 'Connected App', 'a@x.com', recentDate), "x-Token-AppMenuItemName": 'DLIntegration' }],
        conn
      );
      expect(rows[0]["Move to External Client App"]).to.equal('Required');
    });

    it('anonymizes every username of the Usernames column, which no field rule recognizes', async () => {
      const conn: any = { metadata: { list: async () => [{ fullName: 'My_App' }] } };
      const rows = await buildConnectedAppsUsage(
        [token('My App', 'Connected App', 'b@x.com', olderDate), token('My App', 'Connected App', 'a@x.com', recentDate)],
        conn
      );
      const anonymized = anonymizeRows(rows, 'standard');
      expect(anonymized[0]['Usernames']).to.not.contain('a@x.com');
      expect(anonymized[0]['Usernames']).to.not.contain('b@x.com');
      expect(anonymized[0]['Usernames']).to.match(/user_/);
    });

    it('requires the move of a recently used app when the ConnectedApp metadata cannot be listed', async () => {
      const conn: any = {
        metadata: {
          list: async () => {
            throw new Error('INSUFFICIENT_ACCESS');
          },
        },
      };
      const rows = await buildConnectedAppsUsage([token('Salesforce Mobile', 'Connected App', 'a@x.com', recentDate)], conn);
      expect(rows[0]["Move to External Client App"]).to.equal('Required');
    });
  });
});
