/**
 * Integration tests for the SFDMU data workspace commands against a real Salesforce org.
 *
 * Runs only via `yarn test:nuts:org`, with a Dev Hub authenticated by the testkit.
 * Reuses the HardisNutDeployData workspace shipped with the fixture project, and the
 * records already imported by the scratch org initialization.
 */
import { expect } from 'chai';
import fs from 'fs-extra';
import * as path from 'path';
import {
    countAccounts,
    getSharedNutOrgSession,
  NutOrgContext,
  runHardis,
} from './helpers/nutOrgProject.js';

describe('hardis:org:data export and import against a real org', () => {
  let ctx: NutOrgContext;
  const workspaceName = 'HardisNutDeployData';
  let workspaceDir: string;

  before(async function () {
    this.timeout(1800000);
    ctx = await getSharedNutOrgSession();
    workspaceDir = path.join(ctx.projectDir, 'scripts', 'data', workspaceName);
  });

  it('imports the data workspace into the org', () => {
    const result = runHardis(
      ctx,
      `hardis:org:data:import --path scripts/data/${workspaceName} --target-org ${ctx.orgAlias}`,
      { ensureExitCode: 0 }
    );
    const output = result.shellOutput.stdout + result.shellOutput.stderr;
    expect(output.toLowerCase()).to.not.include('error while');
  });

  it('created the records in the org', () => {
    expect(countAccounts(ctx, 'HardisNutDeployData%')).to.equal(2);
  });

  it('exports the data workspace back from the org', async () => {
    // Move the seed CSV aside so the export has to produce it again
    const csvFile = path.join(workspaceDir, 'Account.csv');
    await fs.move(csvFile, `${csvFile}.seed`, { overwrite: true });

    const result = runHardis(
      ctx,
      `hardis:org:data:export --path scripts/data/${workspaceName} --target-org ${ctx.orgAlias}`,
      { ensureExitCode: 0 }
    );
    const output = result.shellOutput.stdout + result.shellOutput.stderr;
    expect(output.toLowerCase()).to.not.include('error while');
  });

  it('produced a CSV file containing the exported records', async () => {
    const csvFile = path.join(workspaceDir, 'Account.csv');
    expect(await fs.pathExists(csvFile), 'Account.csv should have been exported').to.equal(true);
    const content = await fs.readFile(csvFile, 'utf8');
    expect(content).to.include('HardisNutDeployData1');
    expect(content).to.include('HardisNutDeployData2');
  });

  it('re-imports without duplicating (upsert on Name)', () => {
    runHardis(ctx, `hardis:org:data:import --path scripts/data/${workspaceName} --target-org ${ctx.orgAlias}`, {
      ensureExitCode: 0,
    });
    expect(countAccounts(ctx, 'HardisNutDeployData%'), 'upsert should not create duplicates').to.equal(2);
  });
});
