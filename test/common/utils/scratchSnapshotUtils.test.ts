import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getExhaustedSnapshotLimit, getSnapshotDescription, isSnapshotSignupRetryable, getSnapshotName, parsePositiveSetting, pickScratchSnapshot, extendSnapshotDeltaWithDependencies, scopeDeltaToDeployManifest, scratchDefChangedSince, selectSnapshotOrgInitStepIds } from '../../../src/common/utils/scratchSnapshotUtils.js';
import { parsePackageXmlFile } from '../../../src/common/utils/xmlUtils.js';

const shaNew = 'a'.repeat(40);
const shaOld = 'b'.repeat(40);
const record = (name: string, description: string) => ({ SnapshotName: name, Description: description });

describe('pickScratchSnapshot', () => {
  const records = [
    record('SHaaaaaaaaaaaaa', `sfdx-hardis branch=main sha=${shaNew}`),
    record('SHbbbbbbbbbbbbb', `sfdx-hardis branch=main sha=${shaOld}`),
  ];

  it('takes the newest snapshot whose commit is in the history of HEAD', () => {
    expect(pickScratchSnapshot(records, 'main', () => true)).to.deep.equal({ name: 'SHaaaaaaaaaaaaa', sha: shaNew });
  });

  it('takes an older snapshot when the newest commit is not in the history, as for a branch behind its target', () => {
    expect(pickScratchSnapshot(records, 'main', (sha) => sha === shaOld)).to.deep.equal({ name: 'SHbbbbbbbbbbbbb', sha: shaOld });
  });

  it('returns null when no snapshot commit is in the history', () => {
    expect(pickScratchSnapshot(records, 'main', () => false)).to.equal(null);
  });

  it('ignores the snapshots of a branch whose name only starts the same, which the LIKE query also returns', () => {
    const other = [record('SHccccccccccccc', `sfdx-hardis branch=main_v2 sha=${shaNew}`)];
    expect(pickScratchSnapshot(other, 'main', () => true)).to.equal(null);
  });

  it('accepts the 64 character commit sha of a SHA-256 repository', () => {
    const sha256 = 'c'.repeat(64);
    const records256 = [record('SHccccccccccccc', `sfdx-hardis branch=main sha=${sha256}`)];
    expect(pickScratchSnapshot(records256, 'main', () => true)).to.deep.equal({ name: 'SHccccccccccccc', sha: sha256 });
  });

  it('ignores a description without a full commit sha', () => {
    const broken = [record('SHddddddddddddd', 'sfdx-hardis branch=main sha=abc123')];
    expect(pickScratchSnapshot(broken, 'main', () => true)).to.equal(null);
  });
});

describe('snapshot name and description', () => {
  it('names the snapshot with 15 alphanumeric characters, as Salesforce requires', () => {
    expect(getSnapshotName('main', '0123456789abcdef0123456789abcdef01234567')).to.match(/^SH0123456[0-9a-f]{6}$/);
  });

  it('gives two branches at the same commit different snapshot names', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expect(getSnapshotName('uat', sha)).to.not.equal(getSnapshotName('integration', sha));
  });

  it('writes a description that the Pull Request side reads back', () => {
    const record = { SnapshotName: 'SHaaaaaaaaaaaaa', Description: getSnapshotDescription('release/1.0', shaNew) };
    expect(pickScratchSnapshot([record], 'release/1.0', () => true)).to.deep.equal({ name: 'SHaaaaaaaaaaaaa', sha: shaNew });
  });
});

describe('getExhaustedSnapshotLimit', () => {
  const limits = (daily: number, active: number) => ({
    DailyOrgSnapshots: { Max: 5, Remaining: daily },
    ActiveOrgSnapshots: { Max: 5, Remaining: active },
  });

  it('names the daily limit when no snapshot is left today', () => {
    expect(getExhaustedSnapshotLimit(limits(0, 3))).to.equal('DailyOrgSnapshots (0 of 5 left)');
  });

  it('names the active limit when every snapshot slot is taken', () => {
    expect(getExhaustedSnapshotLimit(limits(4, 0))).to.equal('ActiveOrgSnapshots (0 of 5 left)');
  });

  it('returns null when both limits have room', () => {
    expect(getExhaustedSnapshotLimit(limits(1, 1))).to.equal(null);
  });

  it('returns null when the Dev Hub does not report the limits, so the refresh goes on as before', () => {
    expect(getExhaustedSnapshotLimit(null)).to.equal(null);
    expect(getExhaustedSnapshotLimit({ DailyScratchOrgs: { Max: 6, Remaining: 0 } })).to.equal(null);
  });
});

describe('isSnapshotSignupRetryable', () => {
  // The shape execSfdxJson returns for a failed `sf org create scratch --json`
  const failure = (name: string, message: string) => ({
    status: 1,
    errorMessage: `[sfdx-hardis][ERROR] Error processing command\n{\n  "name": "${name}",\n  "message": "${message}"\n}`,
  });

  it('retries a signup the snapshot itself refused', () => {
    expect(isSnapshotSignupRetryable(failure('INVALID_ACCESS_LEVEL', 'We couldn’t create the snapshot INVALID_ACCESS_LEVEL.'))).to.equal(true);
  });

  it('does not retry a signup that timed out, as the first org may still be created', () => {
    expect(isSnapshotSignupRetryable(failure('ScratchOrgInfoTimeoutError', 'The scratch org did not complete within your wait time.'))).to.equal(false);
    expect(isSnapshotSignupRetryable(failure('MyDomainResolverTimeoutError', 'Unable to resolve the My Domain URL.'))).to.equal(false);
    expect(isSnapshotSignupRetryable({ status: 1, errorMessage: 'Socket timeout occurred while listening for results' })).to.equal(false);
  });

  it('does not retry when no scratch org is left', () => {
    expect(isSnapshotSignupRetryable(failure('LIMIT_EXCEEDED', 'The signup request failed because this organization has reached its daily scratch org signup limit'))).to.equal(false);
  });
});

describe('parsePositiveSetting', () => {
  it('keeps a whole number of at least 1', () => {
    expect(parsePositiveSetting('90', 60)).to.equal(90);
  });

  it('gives the default when unset or not a number, as an undefined Azure variable is', () => {
    expect(parsePositiveSetting(undefined, 60)).to.equal(60);
    expect(parsePositiveSetting('', 60)).to.equal(60);
    expect(parsePositiveSetting('$(SCRATCH_ORG_SNAPSHOT_WAIT)', 60)).to.equal(60);
  });

  it('raises a number below 1 to 1 instead of giving the default', () => {
    expect(parsePositiveSetting(0, 2)).to.equal(1);
  });
});

describe('scopeDeltaToDeployManifest', () => {
  const packageXml = (types: Record<string, string[]>) =>
    '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
    Object.entries(types)
      .map(([name, members]) => `  <types>\n${members.map((m) => `    <members>${m}</members>\n`).join('')}    <name>${name}</name>\n  </types>\n`)
      .join('') +
    '  <version>62.0</version>\n</Package>\n';
  let dir: string;
  let delta: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-delta-'));
    delta = path.join(dir, 'package', 'package.xml');
    fs.mkdirSync(path.dirname(delta));
    fs.writeFileSync(delta, packageXml({ ApexClass: ['ClassA', 'ClassC'], CustomObject: ['Foo__c'], Flow: ['FlowX'] }));
    fs.writeFileSync(path.join(dir, 'manifest.xml'), packageXml({ ApexClass: ['ClassA', 'ClassB'], CustomObject: ['*'] }));
    process.env.PACKAGE_XML_TO_DEPLOY = path.join(dir, 'manifest.xml');
  });

  afterEach(() => {
    delete process.env.DEBUG_DEPLOY;
    delete process.env.PACKAGE_XML_TO_DEPLOY;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps only the changed items the manifest deploys in deploy mode, a wildcard type included', async () => {
    process.env.DEBUG_DEPLOY = 'true';
    const scoped = await scopeDeltaToDeployManifest(delta, {});
    expect(await parsePackageXmlFile(scoped)).to.deep.equal({ ApexClass: ['ClassA'], CustomObject: ['Foo__c'] });
  });

  it('returns the delta unchanged when the sources are pushed', async () => {
    expect(await scopeDeltaToDeployManifest(delta, {})).to.equal(delta);
  });
});

describe('scratchDefChangedSince', () => {
  let dir: string;
  let sha: string;
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir }).toString().trim();
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  const commit = () => {
    git('add', '-A');
    git('commit', '-q', '-m', 'change');
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-def-'));
    git('init', '-q');
    write('config/project-scratch-def.json', JSON.stringify({ edition: 'Developer', settingsPath: 'config/settings' }));
    write('config/settings/Security.settings-meta.xml', '<SecuritySettings/>');
    write('force-app/main/default/classes/A.cls', 'public class A {}');
    git('add', '-A');
    git('commit', '-q', '-m', 'snapshot commit');
    sha = git('rev-parse', 'HEAD');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is false when only the sources changed since the snapshot commit', () => {
    write('force-app/main/default/classes/A.cls', 'public class A { }');
    commit();
    expect(scratchDefChangedSince(sha, dir)).to.equal(false);
  });

  it('is true when the scratch org definition changed, as the snapshot child cannot take new features', () => {
    write('config/project-scratch-def.json', JSON.stringify({ edition: 'Developer', settingsPath: 'config/settings', features: ['Communities'] }));
    commit();
    expect(scratchDefChangedSince(sha, dir)).to.equal(true);
  });

  it('is true when a file under the settingsPath of the definition changed', () => {
    write('config/settings/Security.settings-meta.xml', '<SecuritySettings><x/></SecuritySettings>');
    commit();
    expect(scratchDefChangedSince(sha, dir)).to.equal(true);
  });
});

describe('extendSnapshotDeltaWithDependencies', () => {
  const xml = (types: Record<string, string[]>) =>
    '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
    Object.entries(types)
      .map(([name, members]) => `  <types>\n${members.map((m) => `    <members>${m}</members>\n`).join('')}    <name>${name}</name>\n  </types>\n`)
      .join('') +
    '  <version>62.0</version>\n</Package>\n';
  const fullManifest = { CustomField: ['Account.Foo__c'], CustomObject: ['Account'], RecordType: ['Account.Business', 'Account.Partner'] };
  const cwd = process.cwd();
  let dir: string;
  let sha: string;
  let delta: string;
  let destructive: string;
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir }).toString().trim();
  const commitManifest = (types: Record<string, string[]>) => {
    fs.writeFileSync(path.join(dir, 'manifest', 'package.xml'), xml(types));
    git('add', '-A');
    git('commit', '-q', '-m', 'manifest');
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-deps-'));
    fs.mkdirSync(path.join(dir, 'manifest'));
    git('init', '-q');
    commitManifest(fullManifest);
    sha = git('rev-parse', 'HEAD');
    delta = path.join(dir, 'delta.xml');
    destructive = path.join(dir, 'destructive.xml');
    fs.writeFileSync(delta, xml({ CustomField: ['Account.Foo__c'] }));
    fs.writeFileSync(destructive, xml({}));
    process.env.DEBUG_DEPLOY = 'true';
    process.env.PACKAGE_XML_TO_DEPLOY = 'manifest/package.xml';
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env.DEBUG_DEPLOY;
    delete process.env.PACKAGE_XML_TO_DEPLOY;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('adds the record types of the object of a changed field, as deploy:smart does', async () => {
    await extendSnapshotDeltaWithDependencies(sha, delta, destructive, { useDeltaDeploymentWithDependencies: true });
    expect((await parsePackageXmlFile(delta)).RecordType).to.deep.equal(['Account.Business', 'Account.Partner']);
  });

  it('adds the items added to the manifest since the snapshot commit', async () => {
    commitManifest({ ...fullManifest, ApexClass: ['NewService'] });
    await extendSnapshotDeltaWithDependencies(sha, delta, destructive, { useDeltaDeploymentWithDependencies: true });
    expect((await parsePackageXmlFile(delta)).ApexClass).to.deep.equal(['NewService']);
  });

  it('leaves the delta unchanged when the sources are pushed, as there is no full manifest to read', async () => {
    delete process.env.DEBUG_DEPLOY;
    await extendSnapshotDeltaWithDependencies(sha, delta, destructive, { useDeltaDeploymentWithDependencies: true });
    expect(await parsePackageXmlFile(delta)).to.deep.equal({ CustomField: ['Account.Foo__c'] });
  });

  it('leaves the delta unchanged when useDeltaDeploymentWithDependencies is off', async () => {
    await extendSnapshotDeltaWithDependencies(sha, delta, destructive, {});
    expect(await parsePackageXmlFile(delta)).to.deep.equal({ CustomField: ['Account.Foo__c'] });
  });
});

describe('selectSnapshotOrgInitStepIds', () => {
  const config = {
    orgInitSteps: [
      { id: 'packages', type: 'install-packages' },
      { id: 'sources', type: 'deploy-sources' },
      { id: 'permsets', type: 'assign-permission-sets', parameters: { permissionSets: ['Admin'] } },
      { id: 'script', type: 'apex', parameters: { apexScript: 'scripts/apex/init.apex' } },
      { id: 'per-org-data', type: 'data', runAtPoolFill: false, parameters: { sfdmuProject: 'Users' } },
      { id: 'off', type: 'apex', enabled: false },
      { id: 'sandbox-only', type: 'apex', orgTypes: ['sandbox'] },
    ],
  };

  it('runs in the source what a pool fill runs', () => {
    expect(selectSnapshotOrgInitStepIds(config, 'source')).to.deep.equal(['packages', 'sources', 'permsets', 'script']);
  });

  it('runs in a child the steps left, plus the permission set assignments, never the full deployment', () => {
    expect(selectSnapshotOrgInitStepIds(config, 'child')).to.deep.equal(['permsets', 'per-org-data']);
  });

  it('always deploys the sources in the source, even when the deployment is kept for after a pool fetch', () => {
    const late = { orgInitSteps: config.orgInitSteps.map((step) => (step.id === 'sources' ? { ...step, runAtPoolFill: false } : step)) };
    expect(selectSnapshotOrgInitStepIds(late, 'source')).to.include('sources');
    expect(selectSnapshotOrgInitStepIds(late, 'child')).to.not.include('sources');
  });
});
