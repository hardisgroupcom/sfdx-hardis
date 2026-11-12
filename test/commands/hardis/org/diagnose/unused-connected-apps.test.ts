import { expect } from 'chai';
import DiagnoseUnusedConnectedApps, { parseInactiveMonths } from '../../../../../src/commands/hardis/org/diagnose/unused-connected-apps.js';

// Connection that returns one OAuth token last used the given number of months ago
function connWithTokenUsedMonthsAgo(months: number): any {
  const lastUsedDate = new Date();
  lastUsedDate.setMonth(lastUsedDate.getMonth() - months);
  return {
    instanceUrl: 'https://acme.my.salesforce.com',
    query: async () => ({
      done: true,
      records: [{ AppName: 'My App', User: { Name: 'Jane Doe' }, LastUsedDate: lastUsedDate.toISOString() }],
    }),
  };
}

function commandWithMonths(inactiveMonths: number): any {
  const command = Object.create(DiagnoseUnusedConnectedApps.prototype) as any;
  command.inactiveMonths = inactiveMonths;
  return command;
}

describe('hardis:org:diagnose:unused-connected-apps', () => {
  describe('parseInactiveMonths', () => {
    it('reads a positive integer', () => {
      expect(parseInactiveMonths('12')).to.equal(12);
      expect(parseInactiveMonths(' 3 ')).to.equal(3);
    });

    it('falls back to 6 months for anything else', () => {
      expect(parseInactiveMonths(null)).to.equal(6);
      expect(parseInactiveMonths('')).to.equal(6);
      expect(parseInactiveMonths('0')).to.equal(6);
      expect(parseInactiveMonths('-3')).to.equal(6);
      expect(parseInactiveMonths('six')).to.equal(6);
    });
  });

  describe('OAuth token check', () => {
    it('keeps the 6 months threshold by default', async () => {
      const connectedApp: any = { Name: 'My App' };
      const res = await commandWithMonths(6).checkOAuthToken(connectedApp, connWithTokenUsedMonthsAgo(8), false, 'warning', 'Not Found in Login History');
      expect(res.severity).to.equal('warning');
      expect(res.reason).to.equal('Not Found in Login History and OAuth Token > 6 months');
      expect(connectedApp.LastOAuthUsageBy).to.equal('Jane Doe');
    });

    it('uses the configured number of months', async () => {
      const res = await commandWithMonths(12).checkOAuthToken({ Name: 'My App' }, connWithTokenUsedMonthsAgo(8), false, 'warning', 'Not Found in Login History');
      expect(res.severity).to.equal('log');
      expect(res.reason).to.equal('OAuth Token < 12 months');
    });

    it('reports an app unused for longer than a shorter threshold', async () => {
      const res = await commandWithMonths(3).checkOAuthToken({ Name: 'My App' }, connWithTokenUsedMonthsAgo(4), false, 'warning', 'Not Found in Login History');
      expect(res.severity).to.equal('warning');
      expect(res.reason).to.equal('Not Found in Login History and OAuth Token > 3 months');
    });
  });
});
