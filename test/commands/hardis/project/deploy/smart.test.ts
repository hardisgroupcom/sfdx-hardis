/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import SmartDeploy from '../../../../../src/commands/hardis/project/deploy/smart.js';
import { execCommand } from '../../../../../src/common/utils/index.js';

const HARDIS_REST_DEPLOY_ENV_VAR = 'SFDX_HARDIS_USE_REST_DEPLOY';
const SF_REST_DEPLOY_ENV_VAR = 'SF_ORG_METADATA_REST_DEPLOY';
const MANAGED_ENV_VARS = [HARDIS_REST_DEPLOY_ENV_VAR, SF_REST_DEPLOY_ENV_VAR];

describe('SmartDeploy REST deployment option', () => {
  const savedEnv: Record<string, string | undefined> = {};

  function applyRestDeploymentOption(configInfo: { useRestDeploy?: boolean } = {}): string[] {
    const logs: string[] = [];
    const commandThis = {
      configInfo,
      ux: { log: (message: string) => logs.push(message) },
    };

    (SmartDeploy.prototype as any).applyRestDeploymentOption.call(commandThis);
    return logs;
  }

  beforeEach(() => {
    for (const envVar of MANAGED_ENV_VARS) {
      savedEnv[envVar] = process.env[envVar];
      delete process.env[envVar];
    }
  });

  afterEach(() => {
    for (const envVar of MANAGED_ENV_VARS) {
      if (savedEnv[envVar] === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = savedEnv[envVar];
      }
    }
  });

  it('sets the Salesforce CLI environment variable from branch config', () => {
    const logs = applyRestDeploymentOption({ useRestDeploy: true });

    expect(process.env[SF_REST_DEPLOY_ENV_VAR]).to.equal('true');
    expect(logs).to.have.length(1);
    expect(logs[0]).to.include('[RestDeployment]');
  });

  it('allows the sfdx-hardis environment variable to enable REST deployment', () => {
    process.env[HARDIS_REST_DEPLOY_ENV_VAR] = 'true';

    applyRestDeploymentOption({ useRestDeploy: false });

    expect(process.env[SF_REST_DEPLOY_ENV_VAR]).to.equal('true');
  });

  it('allows an explicit false environment value to override enabled branch config', () => {
    process.env[HARDIS_REST_DEPLOY_ENV_VAR] = 'false';

    const logs = applyRestDeploymentOption({ useRestDeploy: true });

    expect(process.env[SF_REST_DEPLOY_ENV_VAR]).to.be.undefined;
    expect(logs).to.be.empty;
  });

  it('falls back to branch config for an unresolved Azure variable expression', () => {
    process.env[HARDIS_REST_DEPLOY_ENV_VAR] = '$(SFDX_HARDIS_USE_REST_DEPLOY)';

    applyRestDeploymentOption({ useRestDeploy: true });

    expect(process.env[SF_REST_DEPLOY_ENV_VAR]).to.equal('true');
  });

  it('leaves the Salesforce CLI environment variable unchanged when the option is disabled', () => {
    process.env[SF_REST_DEPLOY_ENV_VAR] = 'false';

    const logs = applyRestDeploymentOption({ useRestDeploy: false });

    expect(process.env[SF_REST_DEPLOY_ENV_VAR]).to.equal('false');
    expect(logs).to.be.empty;
  });

  it('passes the Salesforce CLI environment variable to spawned commands', async () => {
    applyRestDeploymentOption({ useRestDeploy: true });

    const result = await execCommand(
      `"${process.execPath}" -p "process.env.${SF_REST_DEPLOY_ENV_VAR}"`,
      null,
      { output: false }
    );

    expect(result.status).to.equal(0);
    expect(result.stdout.trim()).to.equal('true');
  });
});
