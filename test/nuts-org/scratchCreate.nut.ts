/**
 * Integration tests for hardis:scratch:create against a real Dev Hub.
 *
 * The scratch org is created by sfdx-hardis itself (not by the testkit), so this file
 * asserts that the whole initialization pipeline ran: source push, permission set
 * assignment, Apex init scripts and SFDMU data import.
 *
 * Runs only via `yarn test:nuts:org`.
 */
import { expect } from 'chai';
import { cleanNutOrgSession, countAccounts, createNutOrgSession, NutOrgContext, runHardis } from './helpers/nutOrgProject.js';

describe('hardis:scratch:create against a real Dev Hub', () => {
  let ctx: NutOrgContext;

  before(async function () {
    this.timeout(1800000); // scratch org creation + full initialization is slow
    ctx = await createNutOrgSession('scratch');
  });

  after(async function () {
    this.timeout(600000);
    await cleanNutOrgSession(ctx);
  });

  it('created a usable scratch org', () => {
    const res = runHardis(ctx, `org display --target-org ${ctx.orgAlias} --json`, { ensureExitCode: 0 });
    expect(res.jsonOutput?.result?.connectedStatus).to.equal('Connected');
    expect(res.jsonOutput?.result?.username).to.be.a('string');
  });

  it('pushed the project sources to the scratch org', () => {
    const res = runHardis(
      ctx,
      `data query --query "SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName='Account' AND QualifiedApiName='HardisNutFlag__c'" --use-tooling-api --json --target-org ${ctx.orgAlias}`,
      { ensureExitCode: 0 }
    );
    expect((res.jsonOutput?.result?.records ?? []).length, 'custom field should have been pushed').to.equal(1);
  });

  it('assigned the permission sets declared in initPermissionSets', () => {
    const res = runHardis(
      ctx,
      `data query --query "SELECT PermissionSet.Name FROM PermissionSetAssignment WHERE PermissionSet.Name = 'HardisNutPermSet'" --json --target-org ${ctx.orgAlias}`,
      { ensureExitCode: 0 }
    );
    expect((res.jsonOutput?.result?.records ?? []).length, 'HardisNutPermSet should be assigned').to.be.greaterThan(0);
  });

  it('ran the Apex initialization scripts declared in scratchOrgInitApexScripts', () => {
    expect(countAccounts(ctx, 'HardisNutScratchInitMarker'), 'init apex script should have inserted its marker').to.equal(1);
  });

  it('imported the ScratchInit SFDMU data workspace', () => {
    expect(countAccounts(ctx, 'HardisNutScratchData%'), 'scratch init data should have been imported').to.equal(2);
  });

  it('logged each initialization step', () => {
    // Guard against a silent no-op: the command must actually report what it did
    expect(ctx.scratchCreateOutput).to.match(/scratch org/i);
    expect(ctx.scratchCreateOutput.toLowerCase()).to.not.include('error while creating');
  });
});
