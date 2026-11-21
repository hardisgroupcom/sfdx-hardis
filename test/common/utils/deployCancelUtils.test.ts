import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import * as path from 'path';
import {
  cancelRunningDeploymentSimulation,
  findNewDeployJobId,
  readRunningDeploymentSimulation,
  readSfDeployCache,
  startDeployJobIdWatcher,
} from '../../../src/common/utils/deployCancelUtils.js';

const ORG = 'ci@acme.com.uat';

describe('findNewDeployJobId()', () => {
  const before = { '0AfOLD': { 'dry-run': true, 'target-org': ORG, timestamp: '2026-11-20T10:00:00.000Z' } };

  it('returns null when no deployment was started since the snapshot', () => {
    expect(findNewDeployJobId(before, { ...before }, ORG, true)).to.equal(null);
  });

  it('returns the new simulation on the target org', () => {
    const after = { ...before, '0AfNEW': { 'dry-run': true, 'target-org': ORG, timestamp: '2026-11-20T10:05:00.000Z' } };
    expect(findNewDeployJobId(before, after, ORG, true)).to.equal('0AfNEW');
  });

  it('ignores a real deployment when looking for a simulation', () => {
    const after = { ...before, '0AfDEPLOY': { 'target-org': ORG, timestamp: '2026-11-20T10:05:00.000Z' } };
    expect(findNewDeployJobId(before, after, ORG, true)).to.equal(null);
  });

  it('prefers the simulation on the target org over one on another org', () => {
    const after = {
      ...before,
      '0AfOTHER': { 'dry-run': true, 'target-org': 'other@acme.com', timestamp: '2026-11-20T10:06:00.000Z' },
      '0AfMINE': { 'dry-run': true, 'target-org': ORG, timestamp: '2026-11-20T10:05:00.000Z' },
    };
    expect(findNewDeployJobId(before, after, ORG, true)).to.equal('0AfMINE');
  });

  // The org can be given as an alias, while the Salesforce CLI stores the username
  it('falls back to the new simulations of any org when none matches the target org', () => {
    const after = { ...before, '0AfNEW': { 'dry-run': true, 'target-org': ORG, timestamp: '2026-11-20T10:05:00.000Z' } };
    expect(findNewDeployJobId(before, after, 'uat-alias', true)).to.equal('0AfNEW');
  });

  // A retried deploy command starts a new simulation
  it('returns the most recent one when several simulations were started', () => {
    const after = {
      ...before,
      '0AfFIRST': { 'dry-run': true, 'target-org': ORG, timestamp: '2026-11-20T10:05:00.000Z' },
      '0AfRETRY': { 'dry-run': true, 'target-org': ORG, timestamp: '2026-11-20T10:09:00.000Z' },
    };
    expect(findNewDeployJobId(before, after, ORG, true)).to.equal('0AfRETRY');
  });
});

describe('deployment simulation job id file', () => {
  let tmpDir: string;
  let cacheFile: string;
  let outputFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hardis-deploy-cancel-'));
    cacheFile = path.join(tmpDir, 'deploy-cache.json');
    outputFile = path.join(tmpDir, 'running-deployment-simulation.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads an empty deploy cache when the file is missing or invalid', () => {
    expect(readSfDeployCache(cacheFile)).to.deep.equal({});
    fs.writeFileSync(cacheFile, '{ not json');
    expect(readSfDeployCache(cacheFile)).to.deep.equal({});
  });

  it('records the job id of the new simulation, then deletes the file once stopped', async () => {
    fs.writeFileSync(cacheFile, JSON.stringify({}));
    const watcher = startDeployJobIdWatcher(ORG, true, { cacheFile, outputFile, intervalMs: 10 });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({ '0AfNEW': { 'dry-run': true, 'target-org': ORG, timestamp: new Date().toISOString() } })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const recorded = readRunningDeploymentSimulation(outputFile);
    expect(recorded?.jobId).to.equal('0AfNEW');
    expect(recorded?.targetUsername).to.equal(ORG);
    expect(recorded?.dryRun).to.equal(true);
    await watcher.stop();
    expect(fs.existsSync(outputFile)).to.equal(false);
  });

  it('has nothing to cancel when no simulation was recorded', async () => {
    const res = await cancelRunningDeploymentSimulation(null, {
      file: outputFile,
      execSfdxJsonFn: async () => {
        throw new Error('must not be called');
      },
    });
    expect(res.status).to.equal('nothing-to-cancel');
  });

  it('never cancels a real deployment', async () => {
    fs.writeFileSync(outputFile, JSON.stringify({ jobId: '0AfDEPLOY', targetUsername: ORG, dryRun: false }));
    let called = false;
    const res = await cancelRunningDeploymentSimulation(null, {
      file: outputFile,
      execSfdxJsonFn: async () => {
        called = true;
        return { status: 0 };
      },
    });
    expect(res.status).to.equal('skipped-not-simulation');
    expect(called).to.equal(false);
  });

  it('cancels the recorded simulation in its org', async () => {
    fs.writeFileSync(outputFile, JSON.stringify({ jobId: '0AfNEW', targetUsername: ORG, dryRun: true }));
    let command = '';
    const res = await cancelRunningDeploymentSimulation(null, {
      file: outputFile,
      execSfdxJsonFn: async (cmd: string) => {
        command = cmd;
        return { status: 0, result: {} };
      },
    });
    expect(res.status).to.equal('canceled');
    expect(command).to.contain('sf project deploy cancel --job-id 0AfNEW');
    expect(command).to.contain(`--target-org ${ORG}`);
    // A workspace kept between runs must never cancel this job id again
    expect(fs.existsSync(outputFile)).to.equal(false);
  });

  // Ex: the simulation was already completed when the CI job was cancelled
  it('reports a failure without throwing when the cancel command fails', async () => {
    fs.writeFileSync(outputFile, JSON.stringify({ jobId: '0AfDONE', targetUsername: ORG, dryRun: true }));
    const res = await cancelRunningDeploymentSimulation(null, {
      file: outputFile,
      execSfdxJsonFn: async () => ({ status: 1, message: 'The deployment is already completed' }),
    });
    expect(res.status).to.equal('failed');
    expect(res.message).to.contain('already completed');
    expect(fs.existsSync(outputFile)).to.equal(false);
  });
});
