/**
 * Integration tests for personal-data anonymization in monitoring commands, against a real
 * Salesforce org (see anonymizeUtils.ts and the unit suite anonymizeUtils.test.ts).
 *
 * Runs only via `yarn test:nuts:org`, with a Dev Hub authenticated by the testkit.
 * Scenarios share the scratch org created by the nut-org session. Each scenario runs a real
 * monitoring command with the API notifications written to an NDJSON file
 * (NOTIF_API_LOGS_JSON_FILE), then asserts what reaches the notification payload and the
 * generated CSV report at each anonymization level:
 * - standard: end-user identity pseudonymized (user_ / id_ / ip_ hashes)
 * - strict: technical actor fields (DeployedBy...) pseudonymized too
 * - off: raw values kept
 */
import { expect } from 'chai';
import fs from '../../src/common/utils/fsUtils.js';
import * as path from 'path';
import {
  getSharedNutOrgSession,
  NutOrgContext,
  queryRecords,
  queryTooling,
  runHardis,
} from './helpers/nutOrgProject.js';

interface NotifLogEntry {
  type: string;
  severity: string;
  _title?: string;
  _logElements: any[];
  [key: string]: any;
}

describe('anonymization of monitoring commands against a real org', () => {
  let ctx: NutOrgContext;
  /** Username and display name of the scratch org administrator: the personal data to track */
  let adminUsername: string;
  let adminName: string;

  before(async function () {
    this.timeout(1800000);
    ctx = await getSharedNutOrgSession();
    const admins = queryRecords(
      ctx,
      "SELECT Id, Username, Name FROM User WHERE Profile.Name = 'System Administrator' AND IsActive = true ORDER BY CreatedDate ASC LIMIT 1"
    );
    expect(admins.length, 'the scratch org must have an active System Administrator').to.equal(1);
    adminUsername = admins[0].Username;
    adminName = admins[0].Name;
  });

  /**
   * Run a monitoring command with a forced anonymization level and the API notifications
   * captured in an NDJSON file, and return the parsed entries plus the raw file content.
   * The exit code is not asserted: diagnose commands may exit non-zero on findings, and the
   * assertions below are on what reached the notification payload and the report files.
   */
  function runMonitoringCommand(
    command: string,
    level: 'off' | 'standard' | 'strict',
    logName: string
  ): { entries: NotifLogEntry[]; ndjson: string; output: string } {
    const logsFile = path.join(ctx.projectDir, 'hardis-report', `notif-${logName}.ndjson`);
    fs.removeSync(logsFile);
    const result = runHardis(ctx, command, {
      timeout: 1800000,
      env: {
        SFDX_HARDIS_ANONYMIZE: level,
        NOTIF_API_LOGS_JSON_FILE: logsFile,
        SFDX_HARDIS_LANG: 'en',
        NO_OPEN: 'true',
      },
    });
    const output = `${result.shellOutput.stdout || ''}${result.shellOutput.stderr || ''}`;
    expect(fs.existsSync(logsFile), `the command should have written API notification logs to ${logsFile}\n${output.slice(-3000)}`).to.equal(true);
    const ndjson = fs.readFileSync(logsFile, 'utf8');
    const entries = ndjson
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as NotifLogEntry);
    expect(entries.length, 'at least one notification entry should have been written').to.be.greaterThan(0);
    return { entries, ndjson, output };
  }

  describe('ACTIVE_USERS (hardis:org:diagnose:unusedusers --returnactiveusers)', () => {
    const buildCommand = (outputFile: string) =>
      `hardis:org:diagnose:unusedusers --returnactiveusers --days 365 --licensetypes all-crm --agent ` +
      `--outputfile "${outputFile}" --target-org ${ctx.orgAlias}`;

    it('pseudonymizes usernames and user Ids at standard level, in the notification and in the CSV report', function () {
      this.timeout(1800000);
      const outputFile = path.join(ctx.projectDir, 'hardis-report', 'nut-active-users-standard.csv');
      const { entries, ndjson } = runMonitoringCommand(buildCommand(outputFile), 'standard', 'active-users-standard');

      // The scratch org admin logged in during org creation, so the report cannot be empty
      const entry = entries.find((e) => e._logElements?.length > 0);
      expect(entry, 'the active users notification should carry log elements').to.not.equal(undefined);
      for (const row of (entry as NotifLogEntry)._logElements) {
        expect(row.Username, JSON.stringify(row)).to.match(/^user_[0-9a-f]{10}$/);
        expect(row.Id, JSON.stringify(row)).to.match(/^id_[0-9a-f]{10}$/);
      }
      expect(ndjson, 'the admin username must not reach the API channel').to.not.include(adminUsername);

      // The CSV file on disk is the artifact attached to emails: it must be anonymized too
      const csvContent = fs.readFileSync(outputFile, 'utf8');
      expect(csvContent, 'the admin username must not reach the CSV report').to.not.include(adminUsername);
      expect(csvContent, 'the CSV report should contain pseudonyms').to.match(/user_[0-9a-f]{10}/);
      expect(csvContent, 'the marker key must never appear in reports').to.not.include('_sensitiveValues');
    });

    it('keeps raw values when anonymization is off', function () {
      this.timeout(1800000);
      const outputFile = path.join(ctx.projectDir, 'hardis-report', 'nut-active-users-off.csv');
      const { ndjson } = runMonitoringCommand(buildCommand(outputFile), 'off', 'active-users-off');
      expect(ndjson, 'with anonymization off, the admin username stays readable').to.include(adminUsername);
      const csvContent = fs.readFileSync(outputFile, 'utf8');
      expect(csvContent, 'with anonymization off, the CSV keeps raw usernames').to.include(adminUsername);
    });
  });

  describe('MFA_CONFIG (hardis:org:diagnose:mfa)', () => {
    it('pseudonymizes usernames in Item and display names inside Details at standard level', function () {
      this.timeout(1800000);
      const { entries, ndjson } = runMonitoringCommand(
        `hardis:org:diagnose:mfa --agent --target-org ${ctx.orgAlias}`,
        'standard',
        'mfa-standard'
      );
      // Issue #2097: Item / Details escaped the old leaf-key heuristic
      expect(ndjson, 'the admin username must not reach the API channel (issue #2097)').to.not.include(adminUsername);

      const entry = entries.find((e) => e.type === 'MFA_CONFIG');
      expect(entry, 'an MFA_CONFIG notification should have been written').to.not.equal(undefined);
      // The System Administrator is a privileged user, so the audit produces at least one user row.
      // Item holds a settings key on settings rows and a pseudonym on user rows, never a raw username.
      const privilegedRows = (entry as NotifLogEntry)._logElements.filter(
        (row) => row.CheckKey === 'privilegedUsersAudit' && row.Item !== '-'
      );
      expect(privilegedRows.length, 'the privileged users audit should list the admin').to.be.greaterThan(0);
      for (const row of privilegedRows) {
        expect(row.Item, JSON.stringify(row)).to.match(/^(user|id)_[0-9a-f]{10}$/);
        expect(row.Details, JSON.stringify(row)).to.not.include(adminName);
      }

      // The generated CSV report (auto-named mfa-config-*.csv) must be anonymized too
      const reportDir = path.join(ctx.projectDir, 'hardis-report');
      const mfaCsvFiles = fs.readdirSync(reportDir).filter((file) => file.startsWith('mfa-config') && file.endsWith('.csv'));
      expect(mfaCsvFiles.length, `an mfa-config CSV should exist in ${reportDir}`).to.be.greaterThan(0);
      for (const file of mfaCsvFiles) {
        const csvContent = fs.readFileSync(path.join(reportDir, file), 'utf8');
        expect(csvContent, `the admin username must not reach ${file}`).to.not.include(adminUsername);
        expect(csvContent, 'the marker key must never appear in reports').to.not.include('_sensitiveValues');
      }
    });
  });

  describe('DEPLOYMENTS (hardis:org:diagnose:deployments)', () => {
    before(function () {
      // The scratch org creation deploys the fixture sources, so DeployRequest records normally
      // exist. Skip rather than fail if the org really has none (nothing to assert on).
      const deployments = queryTooling(ctx, 'SELECT Id FROM DeployRequest LIMIT 1');
      if (deployments.length === 0) {
        this.skip();
      }
    });

    it('keeps the DeployedBy actor readable at standard level', function () {
      this.timeout(1800000);
      const outputFile = path.join(ctx.projectDir, 'hardis-report', 'nut-deployments-standard.csv');
      const { entries } = runMonitoringCommand(
        `hardis:org:diagnose:deployments --outputfile "${outputFile}" --agent --target-org ${ctx.orgAlias}`,
        'standard',
        'deployments-standard'
      );
      const entry = entries.find((e) => e._logElements?.length > 0);
      expect(entry, 'the deployments notification should carry log elements').to.not.equal(undefined);
      const deployedByValues = (entry as NotifLogEntry)._logElements.map((row) => row.DeployedBy);
      expect(deployedByValues, `DeployedBy should stay readable at standard level (actor field): ${deployedByValues.join(', ')}`).to.include(adminName);
    });

    it('pseudonymizes the DeployedBy actor at strict level', function () {
      this.timeout(1800000);
      const outputFile = path.join(ctx.projectDir, 'hardis-report', 'nut-deployments-strict.csv');
      const { entries, ndjson } = runMonitoringCommand(
        `hardis:org:diagnose:deployments --outputfile "${outputFile}" --agent --target-org ${ctx.orgAlias}`,
        'strict',
        'deployments-strict'
      );
      const entry = entries.find((e) => e._logElements?.length > 0);
      expect(entry, 'the deployments notification should carry log elements').to.not.equal(undefined);
      for (const row of (entry as NotifLogEntry)._logElements) {
        if (row.DeployedBy && row.DeployedBy !== 'Unknown') {
          expect(row.DeployedBy, JSON.stringify(row)).to.match(/^user_[0-9a-f]{10}$/);
        }
      }
      expect(ndjson, 'the admin name must not reach the API channel at strict level').to.not.include(adminName);
      const csvContent = fs.readFileSync(outputFile, 'utf8');
      expect(csvContent, 'the CSV report follows the strict level too').to.not.include(adminName);
    });
  });
});
