/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { getMonitoringConfigDefaults } from '../../../src/common/monitoring/monitoringDefaults.js';
import { NOTIFICATION_TYPE_EMITTED_SEVERITIES } from '../../../src/common/notifProvider/types.js';

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
      const emitted = NOTIFICATION_TYPE_EMITTED_SEVERITIES[entry.key as keyof typeof NOTIFICATION_TYPE_EMITTED_SEVERITIES];
      // availableThresholds = (emitted severities ∪ {"log"}) + "off"
      const expectedSeverities = new Set<string>([...(emitted as readonly string[]), 'log']);
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
