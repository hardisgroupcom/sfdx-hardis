/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { getMonitoringConfigDefaults } from '../../../src/common/monitoring/monitoringDefaults.js';
import { notificationTypesDefault } from '../../../src/common/notifProvider/types.js';

describe('getMonitoringConfigDefaults()', () => {
  const payload = getMonitoringConfigDefaults();

  it('returns the new top-level shape with monitoringCommands, notificationConfig, categories and options', () => {
    expect(payload).to.have.all.keys('monitoringCommands', 'notificationConfig', 'categories', 'options');
    expect(payload.monitoringCommands).to.be.an('array').and.not.empty;
    expect(payload.notificationConfig).to.be.an('array').and.not.empty;
    expect(payload.categories).to.be.an('array').and.not.empty;
    expect(payload.options).to.have.all.keys('frequencies', 'frequencyDays', 'thresholds', 'channels');
  });

  it('exposes the seven scheduled categories', () => {
    const categoryKeys = payload.categories.map((c) => c.key);
    expect(categoryKeys).to.have.members([
      'orgActivity',
      'apexTestsSecurity',
      'userActivity',
      'technicalDebt',
      'orgInfo',
      'licensesPackages',
      'other',
    ]);
    expect(categoryKeys).to.not.include('notifications');
  });

  it('attaches notificationTypes[] to each monitoring command and never carries thresholds', () => {
    for (const cmd of payload.monitoringCommands) {
      expect(cmd.notificationTypes, `command "${cmd.key}" missing notificationTypes`).to.be.an('array').and.not
        .empty;
      expect((cmd as any).notifications, `command "${cmd.key}" leaked a notifications object`).to.be.undefined;
      expect(cmd.command, `command "${cmd.key}" missing command string`).to.be.a('string');
    }
  });

  it('models APEX_FLOW_ERRORS as a single command emitting two notification types', () => {
    const cmd = payload.monitoringCommands.find((c) => c.key === 'APEX_FLOW_ERRORS');
    expect(cmd, 'APEX_FLOW_ERRORS command missing').to.exist;
    expect(cmd!.notificationTypes).to.have.members(['APEX_ERROR', 'FLOW_ERROR']);
    expect(cmd!.command).to.equal('sf hardis:org:monitor:errors');
  });

  it('every notificationTypes entry referenced by a command resolves to a notificationConfig entry', () => {
    const notifKeys = new Set(payload.notificationConfig.map((n) => n.key));
    for (const cmd of payload.monitoringCommands) {
      for (const typeKey of cmd.notificationTypes) {
        expect(
          notifKeys.has(typeKey),
          `command "${cmd.key}" references unknown notification type "${typeKey}"`,
        ).to.be.true;
      }
    }
  });

  it('exposes per-channel thresholds on every notificationConfig entry', () => {
    for (const entry of payload.notificationConfig) {
      expect(entry.notifications).to.have.all.keys('messaging', 'email', 'api');
      expect(entry.category).to.be.a('string');
      expect(entry.title).to.be.a('string');
      expect(entry.description).to.be.a('string');
    }
  });

  it('exposes availableThresholds on every notificationConfig entry, always including "log" and terminated by "off"', () => {
    for (const entry of payload.notificationConfig) {
      expect(entry.availableThresholds, `entry "${entry.key}" missing availableThresholds`).to.be.an('array').and
        .not.empty;
      expect(
        entry.availableThresholds[entry.availableThresholds.length - 1],
        `entry "${entry.key}" availableThresholds must end with "off"`,
      ).to.equal('off');
      expect(
        entry.availableThresholds.includes('log'),
        `entry "${entry.key}" availableThresholds must always include "log"`,
      ).to.be.true;
      const emitted =
        notificationTypesDefault[entry.key as keyof typeof notificationTypesDefault]?.emittedSeverities;
      // availableThresholds = (emitted severities ∪ {"log"}) + "off"
      const expectedSeverities = new Set<string>([...((emitted ?? []) as readonly string[]), 'log']);
      const actualSeverities = entry.availableThresholds.filter((t) => t !== 'off');
      expect(new Set(actualSeverities), `entry "${entry.key}" availableThresholds mismatch`).to.deep.equal(
        expectedSeverities,
      );
    }
  });

  it('defaults the api channel to "log" for every notification type', () => {
    for (const entry of payload.notificationConfig) {
      expect(
        entry.notifications.api,
        `entry "${entry.key}" api channel default must be "log"`,
      ).to.equal('log');
    }
  });

  it('exposes a non-empty colorClass on every category, command and notification entry', () => {
    for (const cat of payload.categories) {
      expect(cat.colorClass, `category "${cat.key}" missing colorClass`).to.be.a('string').and.not.empty;
    }
    for (const cmd of payload.monitoringCommands) {
      expect(cmd.colorClass, `monitoring command "${cmd.key}" missing colorClass`).to.be.a('string').and.not
        .empty;
    }
    for (const entry of payload.notificationConfig) {
      expect(entry.colorClass, `notification "${entry.key}" missing colorClass`).to.be.a('string').and.not
        .empty;
    }
  });

  it('exposes the expected per-notification-type colorClass values', () => {
    const expected: Record<string, string> = {
      AUDIT_TRAIL: 'audit',
      LEGACY_API: 'legacy',
      APEX_ERROR: 'alerts',
      FLOW_ERROR: 'alerts',
      DEPLOYMENT: 'audit',
      DEPLOYMENTS: 'audit',
      BACKUP: 'backup',
      ORG_LIMITS: 'limits',
      UNSECURED_CONNECTED_APPS: 'security',
      ORG_HEALTH_CHECK: 'health',
      ORG_INFO: 'health',
      RELEASE_UPDATES: 'updates',
      RELEASE_NOTES: 'updates',
      LINT_ACCESS: 'metadata-access',
      MISSING_ATTRIBUTES: 'metadata-access',
      MINIMAL_PERMSETS: 'metadata-access',
      UNUSED_METADATAS: 'unused-metadata',
      UNUSED_APEX_CLASSES: 'apex',
      APEX_API_VERSION: 'legacy',
      METADATA_STATUS: 'legacy',
      CONNECTED_APPS: 'connected-apps',
      LICENSES: 'licenses',
      UNUSED_LICENSES: 'licenses',
      UNDERUSED_PERMSETS: 'licenses',
      UNUSED_USERS: 'users',
      ACTIVE_USERS: 'users',
      ACTIVE_USERS_CRM_WEEKLY: 'tests',
      ACTIVE_USERS_EXPERIENCE_MONTHLY: 'tests',
      MONITORING_SUMMARY: 'backup',
      DORA_REPORT: 'health',
      SERVICENOW_REPORT: 'backup',
    };
    const byKey = Object.fromEntries(payload.notificationConfig.map((n) => [n.key, n.colorClass]));
    for (const [key, color] of Object.entries(expected)) {
      expect(byKey[key], `notification "${key}" colorClass`).to.equal(color);
    }
  });

  it('exposes the expected per-category colorClass values', () => {
    const expected: Record<string, string> = {
      orgActivity: 'tests',
      apexTestsSecurity: 'security',
      userActivity: 'users',
      technicalDebt: 'limits',
      orgInfo: 'health',
      licensesPackages: 'licenses',
      other: 'legacy',
    };
    const byKey = Object.fromEntries(payload.categories.map((c) => [c.key, c.colorClass]));
    for (const [key, color] of Object.entries(expected)) {
      expect(byKey[key], `category "${key}" colorClass`).to.equal(color);
    }
  });

  it('exposes an SLDS icon on every category entry', () => {
    const sldsPattern = /^(utility|standard|action|custom|doctype):[a-z0-9_]+$/;
    const expected: Record<string, string> = {
      orgActivity: 'utility:refresh',
      apexTestsSecurity: 'utility:shield',
      userActivity: 'utility:user',
      technicalDebt: 'utility:warning',
      orgInfo: 'utility:info',
      licensesPackages: 'utility:package',
      other: 'utility:apps',
    };
    for (const cat of payload.categories) {
      expect(cat.icon, `category "${cat.key}" missing SLDS icon`).to.match(sldsPattern);
    }
    const byKey = Object.fromEntries(payload.categories.map((c) => [c.key, c.icon]));
    for (const [key, icon] of Object.entries(expected)) {
      expect(byKey[key], `category "${key}" icon`).to.equal(icon);
    }
  });

  it('inherits each monitoring command colorClass from its first notification type', () => {
    const notifColor = Object.fromEntries(
      payload.notificationConfig.map((n) => [n.key, n.colorClass]),
    );
    for (const cmd of payload.monitoringCommands) {
      const firstType = cmd.notificationTypes[0];
      const expectedColor = notifColor[firstType];
      if (expectedColor) {
        expect(cmd.colorClass, `monitoring command "${cmd.key}" colorClass`).to.equal(expectedColor);
      }
    }
  });

  it('exposes an SLDS icon on every notificationConfig and monitoringCommands entry', () => {
    const sldsPattern = /^(utility|standard|action|custom|doctype):[a-z0-9_]+$/;
    for (const entry of payload.notificationConfig) {
      expect(entry.icon, `entry "${entry.key}" missing SLDS icon`).to.match(sldsPattern);
    }
    for (const cmd of payload.monitoringCommands) {
      expect(cmd.icon, `monitoring command "${cmd.key}" missing SLDS icon`).to.match(sldsPattern);
    }
    // Specific regression: MONITORING_SUMMARY had no icon before.
    const summary = payload.notificationConfig.find((n) => n.key === 'MONITORING_SUMMARY');
    expect(summary?.icon, 'MONITORING_SUMMARY must carry an icon').to.equal('utility:dashboard');
  });

  it('keeps every per-channel default within the matching availableThresholds list', () => {
    for (const entry of payload.notificationConfig) {
      const allowed = new Set(entry.availableThresholds);
      for (const channel of ['messaging', 'email', 'api'] as const) {
        const value = entry.notifications[channel];
        expect(
          allowed.has(value),
          `entry "${entry.key}" channel "${channel}" default "${value}" not in availableThresholds`,
        ).to.be.true;
      }
    }
  });

  it('includes the event-based notification types (DEPLOYMENT, BACKUP, RELEASE_NOTES) in notificationConfig', () => {
    const keys = new Set(payload.notificationConfig.map((n) => n.key));
    expect(keys.has('DEPLOYMENT')).to.be.true;
    expect(keys.has('BACKUP')).to.be.true;
    expect(keys.has('RELEASE_NOTES')).to.be.true;
    expect(keys.has('APEX_ERROR')).to.be.true;
    expect(keys.has('FLOW_ERROR')).to.be.true;
  });
});
