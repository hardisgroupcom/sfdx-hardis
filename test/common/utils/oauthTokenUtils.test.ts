import { expect } from 'chai';
import {
  getConnectedAppMigrationStatus,
  listOrgOwnedConnectedAppNames,
  toConnectedAppApiName,
} from '../../../src/common/utils/oauthTokenUtils.js';

describe('oauthTokenUtils', () => {
  const today = new Date('2026-11-15T12:00:00Z');

  describe('getConnectedAppMigrationStatus()', () => {
    it('reports External Client Apps as done or not needed', () => {
      expect(getConnectedAppMigrationStatus('Ext Client App (converted)', '', '2026-11-14', true, today)).to.equal('Done (converted)');
      expect(getConnectedAppMigrationStatus('Ext Client App', '', '2026-11-14', null, today)).to.equal('Not needed');
    });

    it('requires the move for a Connected App of the org used in the last 90 days', () => {
      expect(getConnectedAppMigrationStatus('Connected App', '', '2026-11-01', true, today)).to.equal('Required');
      expect(getConnectedAppMigrationStatus('Connected App', '', '2026-08-20', true, today)).to.equal('Required');
    });

    it('keeps the old behavior when the ownership is unknown', () => {
      expect(getConnectedAppMigrationStatus('Connected App', '', '2026-11-01', null, today)).to.equal('Required');
    });

    it('leaves packaged apps and apps of Salesforce to their vendor', () => {
      expect(getConnectedAppMigrationStatus('Connected App', 'abc', '2026-11-01', true, today)).to.equal('Vendor');
      expect(getConnectedAppMigrationStatus('Connected App', '', '2026-11-01', false, today)).to.equal('Vendor');
    });

    it('reports apps unused for 90 days as not used, whoever owns them', () => {
      expect(getConnectedAppMigrationStatus('Connected App', '', '2026-07-01', true, today)).to.equal('Not used');
      expect(getConnectedAppMigrationStatus('Connected App', 'abc', '2026-07-01', false, today)).to.equal('Not used');
      expect(getConnectedAppMigrationStatus('Connected App', '', '', true, today)).to.equal('Not used');
    });
  });

  describe('toConnectedAppApiName()', () => {
    it('turns a label into the API name Salesforce derives from it', () => {
      expect(toConnectedAppApiName('ClickDeploy.io')).to.equal('clickdeploy_io');
      expect(toConnectedAppApiName('CRM Connector for Customer 360 Audiences')).to.equal('crm_connector_for_customer_360_audiences');
      expect(toConnectedAppApiName('Salesforce SSO to GitLab.com (Production)')).to.equal('salesforce_sso_to_gitlab_com_production');
      expect(toConnectedAppApiName('sfdxMoniv2')).to.equal('sfdxmoniv2');
    });
  });

  describe('listOrgOwnedConnectedAppNames()', () => {
    it('lists the ConnectedApp metadata of the org', async () => {
      const conn: any = {
        metadata: { list: async () => [{ fullName: 'ClickDeploy_io' }, { fullName: 'Pardot_SSO' }] },
      };
      const names = await listOrgOwnedConnectedAppNames(conn);
      expect(Array.from(names || [])).to.deep.equal(['clickdeploy_io', 'pardot_sso']);
    });

    it('accepts a single result object', async () => {
      const conn: any = { metadata: { list: async () => ({ fullName: 'Only_App' }) } };
      expect(Array.from((await listOrgOwnedConnectedAppNames(conn)) || [])).to.deep.equal(['only_app']);
    });

    it('returns null when the metadata cannot be listed', async () => {
      const conn: any = {
        metadata: {
          list: async () => {
            throw new Error('INSUFFICIENT_ACCESS');
          },
        },
      };
      expect(await listOrgOwnedConnectedAppNames(conn)).to.equal(null);
    });
  });
});
