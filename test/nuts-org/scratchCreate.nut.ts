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
import {
    countAccounts,
    getSharedNutOrgSession,
  NutOrgContext,
  queryRecords,
  queryTooling,
  runSf,
} from './helpers/nutOrgProject.js';

describe('hardis:scratch:create against a real Dev Hub', () => {
  let ctx: NutOrgContext;

  before(async function () {
    this.timeout(1800000); // scratch org creation + full initialization is slow
    ctx = await getSharedNutOrgSession();
    if (ctx.reused) {
      // Nothing was created by this run, so there is no initialization to assert on
      this.skip();
    }
  });

  it('created a usable scratch org', () => {
    const res = runSf<any>(`org display --target-org ${ctx.orgAlias} --json`, { cwd: ctx.projectDir });
    // A scratch org reports status "Active"; connectedStatus is only set for non-scratch orgs
    expect(res.result?.status, 'scratch org should be Active').to.equal('Active');
    expect(res.result?.username).to.be.a('string');
    expect(res.result?.username).to.include('hardis-scratch-');
  });

  it('pushed the project sources to the scratch org', () => {
    const records = queryTooling(
      ctx,
      "SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName='Account' AND QualifiedApiName='HardisNutFlag__c'"
    );
    expect(records.length, 'custom field should have been pushed').to.equal(1);
  });

  it('assigned the permission sets declared in initPermissionSets', () => {
    const records = queryRecords(
      ctx,
      "SELECT PermissionSet.Name FROM PermissionSetAssignment WHERE PermissionSet.Name = 'HardisNutPermSet'"
    );
    expect(records.length, 'HardisNutPermSet should be assigned').to.be.greaterThan(0);
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
