/**
 * Integration tests for hardis:project:deploy:smart against a real Salesforce org.
 *
 * Runs only via `yarn test:nuts:org`, with a Dev Hub authenticated by the testkit.
 * Scenarios share a single scratch org and run in declaration order, because Salesforce
 * serializes deployments per org and a Developer Edition Dev Hub only allows 3 active
 * scratch orgs. Do not run this file with mocha --parallel.
 */
import { expect } from 'chai';
import fs from '../../src/common/utils/fsUtils.js';
import * as path from 'path';
import { countDeployComponentChanges } from '../../src/common/utils/deployResultSummary.js';
import {
  addApexClassToManifest,
  addBrokenApexClass,
  clearBranchConfig,
  countAccounts,
  deleteAccounts,
  expectOutputExcludes,
  expectOutputIncludes,
  getSharedNutOrgSession,
  git,
  NutOrgContext,
  purgeNutApexClasses,
  queryTooling,
  readDeployResultReport,
  runHardis,
  writeBranchConfig,
} from './helpers/nutOrgProject.js';

describe('hardis:project:deploy:smart against a real org', () => {
  let ctx: NutOrgContext;

  before(async function () {
    this.timeout(1800000);
    ctx = await getSharedNutOrgSession();
  });

  describe('validation (--check)', () => {
    it('validates the project without deploying', () => {
      const result = runHardis(
        ctx,
        `hardis:project:deploy:smart --check --testlevel RunLocalTests --target-org ${ctx.orgAlias}`,
        { ensureExitCode: 0 }
      );
      const output = result.shellOutput.stdout + result.shellOutput.stderr;

      expectOutputIncludes(output, 'Deployment check summary');
      expectOutputIncludes(output, 'Succeeded');
      // The complete JSON must NOT be dumped in the console anymore (issue #2026)
      expectOutputExcludes(output, '"numberComponentsDeployed"');
    });

    it('writes the complete deployment JSON in hardis-report', async () => {
      const report = await readDeployResultReport(ctx.projectDir);
      expect(report, 'deploy-result report file should exist').to.not.equal(null);
      expect(report.result.checkOnly, 'validation should be flagged checkOnly').to.equal(true);
      expect(report.result.id).to.be.a('string');
    });

    it('keeps the full JSON in the console when NO_TRUNCATE_LOGS is set', () => {
      const result = runHardis(
        ctx,
        `hardis:project:deploy:smart --check --testlevel NoTestRun --target-org ${ctx.orgAlias}`,
        { ensureExitCode: 0, env: { NO_TRUNCATE_LOGS: 'true' } }
      );
      const output = result.shellOutput.stdout + result.shellOutput.stderr;
      expectOutputIncludes(output, 'Deployment check summary');
      expectOutputIncludes(output, 'numberComponentsDeployed');
    });
  });

  describe('deployment actions', () => {
    /**
     * Declares one action of each of the three types that can be verified against the org,
     * split across the pre-deploy and post-deploy phases, and checks both the reported
     * result of each action and its actual effect in the org.
     */
    before(async () => {
      // The apex action inserts a marker Account. Reset it so the exact count assertion below
      // stays meaningful when the scratch org is reused from a previous run.
      deleteAccounts(ctx, 'HardisNutApexActionMarker');
      await writeBranchConfig(
        ctx.projectDir,
        'main',
        [
          'commandsPreDeploy:',
          '  - id: nut-command-pre',
          '    label: NUT command action (pre-deploy)',
          '    type: command',
          '    command: node -e "console.log(\'HARDIS_NUT_COMMAND_ACTION_RAN\')"',
          '    context: all',
          '    runOnlyOnceByOrg: false',
          'commandsPostDeploy:',
          '  - id: nut-apex-post',
          '    label: NUT apex action (post-deploy)',
          '    type: apex',
          '    command: sf apex run --file scripts/apex/deploy-action.apex',
          '    parameters:',
          '      apexScript: scripts/apex/deploy-action.apex',
          '    context: all',
          '    runOnlyOnceByOrg: false',
          '  - id: nut-data-post',
          '    label: NUT data action (post-deploy)',
          '    type: data',
          '    command: sf hardis:org:data:import --path scripts/data/HardisNutDeployData',
          '    parameters:',
          '      sfdmuProject: HardisNutDeployData',
          '    context: all',
          '    runOnlyOnceByOrg: false',
          '  - id: nut-manual-post',
          '    label: NUT manual action (post-deploy)',
          '    type: manual',
          '    command: none',
          '    parameters:',
          '      instructions: Nothing to do, this action only documents a manual step',
          '    context: all',
          '    runOnlyOnceByOrg: false',
          '',
        ].join('\n')
      );
    });

    after(async () => {
      await clearBranchConfig(ctx.projectDir);
    });

    // Captured once: re-running the deployment would duplicate the records the actions insert
    let deployOutput = '';

    it('runs actions of every declared type during a real deployment', () => {
      const result = runHardis(
        ctx,
        `hardis:project:deploy:smart --testlevel RunLocalTests --target-org ${ctx.orgAlias}`,
        { ensureExitCode: 0, env: { CONFIG_BRANCH: 'main' } }
      );
      deployOutput = result.shellOutput.stdout + result.shellOutput.stderr;

      expectOutputIncludes(deployOutput, 'Deployment summary');
      expectOutputIncludes(deployOutput, '[DeploymentActions] Running action NUT command action (pre-deploy)');
      expectOutputIncludes(deployOutput, '[DeploymentActions] Running action NUT apex action (post-deploy)');
      expectOutputIncludes(deployOutput, '[DeploymentActions] Running action NUT data action (post-deploy)');
      // No action must be reported as failed
      expectOutputExcludes(deployOutput, '[DeploymentActions] Action NUT command action (pre-deploy) failed');
      expectOutputExcludes(deployOutput, '[DeploymentActions] Action NUT apex action (post-deploy) failed');
      expectOutputExcludes(deployOutput, '[DeploymentActions] Action NUT data action (post-deploy) failed');
    });

    it('the command action produced its output', () => {
      expectOutputIncludes(deployOutput, 'HARDIS_NUT_COMMAND_ACTION_RAN', 'command action stdout should be forwarded');
    });

    it('reported the manual action without running anything', () => {
      expectOutputIncludes(deployOutput, 'NUT manual action (post-deploy)');
    });

    it('the apex action really ran against the org', () => {
      expect(countAccounts(ctx, 'HardisNutApexActionMarker'), 'apex action should have inserted its marker').to.equal(1);
    });

    it('the data action really imported its SFDMU workspace', () => {
      expect(countAccounts(ctx, 'HardisNutDeployData%'), 'data action should have imported 2 accounts').to.equal(2);
    });

    it('deployed the metadata itself', () => {
      const records = queryTooling(
        ctx,
        "SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName='Account' AND QualifiedApiName='HardisNutFlag__c'"
      );
      expect(records.length).to.equal(1);
    });
  });

  describe('deployment action contexts', () => {
    it('skips a process-deployment-only action during a --check run', async () => {
      await writeBranchConfig(
        ctx.projectDir,
        'main',
        [
          'commandsPreDeploy:',
          '  - id: nut-process-only',
          '    label: NUT process only action',
          '    type: command',
          '    command: node -e "console.log(\'HARDIS_NUT_PROCESS_ONLY_RAN\')"',
          '    context: process-deployment-only',
          '    runOnlyOnceByOrg: false',
          '',
        ].join('\n')
      );

      const result = runHardis(
        ctx,
        `hardis:project:deploy:smart --check --testlevel NoTestRun --target-org ${ctx.orgAlias}`,
        { ensureExitCode: 0, env: { CONFIG_BRANCH: 'main' } }
      );
      const output = result.shellOutput.stdout + result.shellOutput.stderr;

      expectOutputIncludes(output, '[DeploymentActions] Skipping NUT process only action');
      expectOutputExcludes(output, 'HARDIS_NUT_PROCESS_ONLY_RAN');
      await clearBranchConfig(ctx.projectDir);
    });

    it('reports a failing action and stops the deployment', async () => {
      await writeBranchConfig(
        ctx.projectDir,
        'main',
        [
          'commandsPreDeploy:',
          '  - id: nut-failing',
          '    label: NUT failing action',
          '    type: command',
          '    command: node -e "process.exit(3)"',
          '    context: all',
          '    runOnlyOnceByOrg: false',
          '',
        ].join('\n')
      );

      const result = runHardis(
        ctx,
        `hardis:project:deploy:smart --check --testlevel NoTestRun --target-org ${ctx.orgAlias}`,
        { ensureExitCode: 'nonZero', env: { CONFIG_BRANCH: 'main' } }
      );
      const output = result.shellOutput.stdout + result.shellOutput.stderr;

      expectOutputIncludes(output, '[DeploymentActions] Action NUT failing action failed');
      await clearBranchConfig(ctx.projectDir);
    });

    it('tolerates a failing action declared with allowFailure', async () => {
      await writeBranchConfig(
        ctx.projectDir,
        'main',
        [
          'commandsPreDeploy:',
          '  - id: nut-failing-allowed',
          '    label: NUT tolerated failing action',
          '    type: command',
          '    command: node -e "process.exit(3)"',
          '    context: all',
          '    runOnlyOnceByOrg: false',
          '    allowFailure: true',
          '',
        ].join('\n')
      );

      const result = runHardis(
        ctx,
        `hardis:project:deploy:smart --check --testlevel NoTestRun --target-org ${ctx.orgAlias}`,
        { ensureExitCode: 0, env: { CONFIG_BRANCH: 'main' } }
      );
      const output = result.shellOutput.stdout + result.shellOutput.stderr;

      expectOutputIncludes(output, 'Deployment check summary');
      await clearBranchConfig(ctx.projectDir);
    });
  });

  describe('delta deployment', () => {
    // A delta deployment compares a source branch with a target branch, the way a Pull Request
    // does. Running it on the target branch itself leaves the comparison scope empty, so the
    // scenario really needs a feature branch.
    const featureBranch = 'feature/nut-delta';

    after(() => {
      // The later scenarios expect the fixture to be back on its main branch. Forced because the
      // commands under test rewrite their report files as they go, and a hook that throws here
      // would fail every remaining scenario rather than just this one.
      git(ctx.projectDir, 'checkout --force main');
    });

    it('deploys only what changed between the feature branch and its target branch', async () => {
      git(ctx.projectDir, `checkout -b ${featureBranch}`);
      const classesDir = path.join(ctx.projectDir, 'force-app', 'main', 'default', 'classes');
      await fs.writeFile(
        path.join(classesDir, 'HardisNutDelta.cls'),
        'public with sharing class HardisNutDelta {\n  public static Integer answer() {\n    return 42;\n  }\n}\n',
        'utf8'
      );
      await fs.writeFile(
        path.join(classesDir, 'HardisNutDelta.cls-meta.xml'),
        '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>65.0</apiVersion>\n    <status>Active</status>\n</ApexClass>\n',
        'utf8'
      );
      // sfdx-hardis filters the delta package against the project manifest, so a class missing
      // from it would be dropped and the delta would end up empty
      await addApexClassToManifest(ctx.projectDir, 'HardisNutDelta');
      git(ctx.projectDir, 'add -A');
      git(ctx.projectDir, 'commit -m "feat: add delta class" --no-verify');
      git(ctx.projectDir, `push -u origin ${featureBranch}`);

      const result = runHardis(
        ctx,
        `hardis:project:deploy:smart --check --delta --testlevel NoTestRun --target-branch main --target-org ${ctx.orgAlias}`,
        { ensureExitCode: 0 }
      );
      const output = result.shellOutput.stdout + result.shellOutput.stderr;

      expectOutputIncludes(output, 'Deployment check summary');
      expectOutputIncludes(output, 'DELTA');
      // Only the class added on the feature branch belongs to the delta
      expectOutputIncludes(output, 'HardisNutDelta');
    });
  });

  describe('quick deploy', () => {
    let validationJobId: string;

    it('produces a validation job id', async () => {
      runHardis(
        ctx,
        `hardis:project:deploy:smart --check --testlevel RunLocalTests --target-org ${ctx.orgAlias}`,
        { ensureExitCode: 0 }
      );
      const report = await readDeployResultReport(ctx.projectDir);
      validationJobId = report?.result?.id;
      expect(validationJobId, 'validation should expose a deployment id').to.be.a('string');
    });

    it('uses the job id forced by SFDX_HARDIS_DEPLOY_CHECK_ID', () => {
      // Without this env var, the job id would be looked up in Pull Request comments,
      // which do not exist in a NUT.
      const result = runHardis(ctx, `hardis:project:deploy:smart --target-org ${ctx.orgAlias}`, {
        ensureExitCode: 0,
        env: { SFDX_HARDIS_DEPLOY_CHECK_ID: validationJobId },
      });
      const output = result.shellOutput.stdout + result.shellOutput.stderr;

      expectOutputIncludes(output, validationJobId);
      expectOutputIncludes(output, 'QuickDeploy');
      expectOutputIncludes(output, 'Quick Deploy');
    });

    it('skips quick deploy when SFDX_HARDIS_QUICK_DEPLOY is false', () => {
      const result = runHardis(ctx, `hardis:project:deploy:smart --testlevel NoTestRun --target-org ${ctx.orgAlias}`, {
        ensureExitCode: 0,
        env: { SFDX_HARDIS_QUICK_DEPLOY: 'false', SFDX_HARDIS_DEPLOY_CHECK_ID: validationJobId },
      });
      const output = result.shellOutput.stdout + result.shellOutput.stderr;

      expectOutputIncludes(output, 'Deployment summary');
      expectOutputExcludes(output, 'Successfully processed QuickDeploy');
    });
  });

  /**
   * The created / updated / deleted / unchanged split reported for a deployment.
   *
   * This is the one part of the feature that cannot be proven by a unit test: it asserts what
   * Salesforce itself puts in `details.componentSuccesses[]` for a component that was deployed
   * without changing anything in the org, which only a real deployment can produce.
   */
  describe('deployment impact reporting', () => {
    // Unique per run: with SFDX_HARDIS_NUT_REUSE_ORG the org survives between runs, so a fixed
    // class name would already be there and come back as updated instead of created.
    const impactClass = `HardisNutImpact${Date.now()}`;
    const deployCommand = () =>
      runHardis(ctx, `hardis:project:deploy:smart --testlevel NoTestRun --target-org ${ctx.orgAlias}`, {
        ensureExitCode: 0,
      });

    /** The detail row Salesforce returned for the class added by this scenario */
    function impactClassRow(report: any): any {
      const rows = (report?.result?.details?.componentSuccesses || []).filter(
        (row: any) => row?.fullName === impactClass
      );
      expect(rows.length, `deploy result should carry a detail row for ${impactClass}`).to.be.greaterThan(0);
      return rows[0];
    }

    before(async () => {
      const classesDir = path.join(ctx.projectDir, 'force-app', 'main', 'default', 'classes');
      await fs.writeFile(
        path.join(classesDir, `${impactClass}.cls`),
        `public with sharing class ${impactClass} {\n  public static Integer answer() {\n    return 42;\n  }\n}\n`,
        'utf8'
      );
      await fs.writeFile(
        path.join(classesDir, `${impactClass}.cls-meta.xml`),
        '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>65.0</apiVersion>\n    <status>Active</status>\n</ApexClass>\n',
        'utf8'
      );
      // sfdx-hardis filters the deployment against the project manifest, so a class missing from
      // it would never reach the org
      await addApexClassToManifest(ctx.projectDir, impactClass);
      git(ctx.projectDir, 'add -A');
      git(ctx.projectDir, `commit -m "test: add deployment impact class" --no-verify`);
    });

    after(() => {
      // This class is really deployed, and the org is reused by the scenarios that follow and by
      // the next run. Left there, it is Apex no test covers, and it would drag the org-wide
      // coverage under the 75% gate every deployment then checks.
      purgeNutApexClasses(ctx);
    });

    let firstDeployReport: any;

    it('reports a brand new class as created', async () => {
      const result = deployCommand();
      const output = result.shellOutput.stdout + result.shellOutput.stderr;
      firstDeployReport = await readDeployResultReport(ctx.projectDir);

      expect(impactClassRow(firstDeployReport).created, `${impactClass} should be reported as created`).to.equal(true);

      const changes = countDeployComponentChanges(firstDeployReport.result);
      expect(changes.detailed, 'a real deployment must carry per-component detail').to.equal(true);
      expect(changes.created).to.be.greaterThan(0);
      // The console summary must show the same figures that were parsed out of the report
      expectOutputIncludes(output, 'Changes:');
      expectOutputIncludes(output, `${changes.created} created`);
      expectOutputIncludes(output, `${changes.unchanged} unchanged`);
    });

    it('adds the split up to the number of components Salesforce reports as deployed', () => {
      const changes = countDeployComponentChanges(firstDeployReport.result);
      // Salesforce repeats some components across several detail rows and adds a package.xml
      // pseudo-row: without the deduplication, the split would not match its own count
      expect(changes.created + changes.updated + changes.deleted + changes.unchanged).to.equal(
        Number(firstDeployReport.result.numberComponentsDeployed)
      );
      expect(changes.total).to.equal(Number(firstDeployReport.result.numberComponentsDeployed));
    });

    it('reports the very same class as unchanged when it is deployed again', async () => {
      const result = deployCommand();
      const output = result.shellOutput.stdout + result.shellOutput.stderr;
      const report = await readDeployResultReport(ctx.projectDir);

      // Nothing changed in the sources between the two deployments, so the org already holds this
      // exact class: this is what makes a full deployment report far fewer changes than items
      const row = impactClassRow(report);
      expect(row.created, `${impactClass} should not be created twice`).to.not.equal(true);
      expect(row.changed, `${impactClass} should be reported as unchanged`).to.not.equal(true);

      const changes = countDeployComponentChanges(report.result);
      expect(changes.unchanged, 'a re-deployment of untouched sources must report unchanged items').to.be.greaterThan(0);
      expectOutputIncludes(output, `${changes.unchanged} unchanged`);
    });
  });

  describe('failing deployment', () => {
    it('fails with a readable error and still writes the report file', async () => {
      await addBrokenApexClass(ctx.projectDir);
      git(ctx.projectDir, 'add -A');
      git(ctx.projectDir, 'commit -m "test: add broken apex class" --no-verify');

      const result = runHardis(
        ctx,
        `hardis:project:deploy:smart --check --testlevel NoTestRun --target-org ${ctx.orgAlias}`,
        { ensureExitCode: 'nonZero' }
      );
      const output = result.shellOutput.stdout + result.shellOutput.stderr;

      expectOutputIncludes(output, 'Deployment check summary');
      expectOutputIncludes(output, 'HardisNutBroken');
      // The complete JSON must not be dumped on the failure path either
      expectOutputExcludes(output, '"componentSuccesses"');

      const report = await readDeployResultReport(ctx.projectDir);
      expect(report, 'report file should be written on failure too').to.not.equal(null);
      expect(Number(report.result.numberComponentErrors)).to.be.greaterThan(0);
    });
  });
});
