import { expect } from 'chai';
import DiagnoseUnusedConnectedApps, { parseInactiveDays } from '../../../../../src/commands/hardis/org/diagnose/unused-connected-apps.js';

// Connection that returns one OAuth token last used the given number of days ago
function connWithTokenUsedDaysAgo(days: number): any {
  const lastUsedDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return {
    instanceUrl: 'https://acme.my.salesforce.com',
    query: async () => ({
      done: true,
      records: [{ AppName: 'My App', User: { Name: 'Jane Doe' }, LastUsedDate: lastUsedDate.toISOString() }],
    }),
  };
}

function commandWithDays(inactiveDays: number): any {
  const command = Object.create(DiagnoseUnusedConnectedApps.prototype) as any;
  command.inactiveDays = inactiveDays;
  return command;
}

describe('hardis:org:diagnose:unused-connected-apps', () => {
  describe('parseInactiveDays', () => {
    it('reads a positive integer', () => {
      expect(parseInactiveDays('30')).to.equal(30);
      expect(parseInactiveDays(' 365 ')).to.equal(365);
    });

    it('falls back to 180 days for anything else', () => {
      expect(parseInactiveDays(null)).to.equal(180);
      expect(parseInactiveDays('')).to.equal(180);
      expect(parseInactiveDays('0')).to.equal(180);
      expect(parseInactiveDays('-30')).to.equal(180);
      expect(parseInactiveDays('thirty')).to.equal(180);
    });
  });

  describe('OAuth token check', () => {
    it('keeps the 180 days threshold by default', async () => {
      const connectedApp: any = { Name: 'My App' };
      const res = await commandWithDays(180).checkOAuthToken(connectedApp, connWithTokenUsedDaysAgo(200), false, 'warning', 'Not Found in Login History');
      expect(res.severity).to.equal('warning');
      expect(res.reason).to.equal('Not Found in Login History and OAuth Token > 180 days');
      expect(connectedApp.LastOAuthUsageBy).to.equal('Jane Doe');
    });

    it('uses the configured number of days', async () => {
      const res = await commandWithDays(365).checkOAuthToken({ Name: 'My App' }, connWithTokenUsedDaysAgo(200), false, 'warning', 'Not Found in Login History');
      expect(res.severity).to.equal('log');
      expect(res.reason).to.equal('OAuth Token < 365 days');
    });

    it('reports an app unused for longer than a short threshold', async () => {
      const res = await commandWithDays(30).checkOAuthToken({ Name: 'My App' }, connWithTokenUsedDaysAgo(31), false, 'warning', 'Not Found in Login History');
      expect(res.severity).to.equal('warning');
      expect(res.reason).to.equal('Not Found in Login History and OAuth Token > 30 days');
    });
  });
});
