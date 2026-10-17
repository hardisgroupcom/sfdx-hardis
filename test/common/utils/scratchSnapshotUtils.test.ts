import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getExhaustedSnapshotLimit, getSnapshotDescription, getSnapshotName, parsePositiveSetting, pickScratchSnapshot, scopeDeltaToDeployManifest } from '../../../src/common/utils/scratchSnapshotUtils.js';
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
