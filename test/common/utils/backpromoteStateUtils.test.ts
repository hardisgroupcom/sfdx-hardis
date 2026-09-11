/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import {
  BACKPROMOTE_STATE_MARKER,
  BackpromoteOrgRecord,
  buildBackpromoteStateComment,
  computeBackpromoteGroupHistory,
  findActionsDoneInOrg,
  gitProviderNameFromLabel,
  isSameOrgId,
  mergeBackpromoteOrgRecords,
  orgShortName,
  parseBackpromoteStateComment,
} from '../../../src/common/utils/backpromoteStateUtils.js';

const SAM_ORG = '00D5g000004ABCDEAA';
const LEA_ORG = '00D5g000009WXYZEAA';

const samRecord: BackpromoteOrgRecord = {
  orgId: SAM_ORG,
  orgName: 'mycompany--dev-sam',
  date: '2026-09-11T10:11:15.027Z',
  commit: '4588789444856da00350fcc956ad81324d8d4e5c',
  actions: [{ id: 'load-matrix', label: 'Load approval | matrix', status: 'success', date: '2026-09-11T10:10:57.810Z' }],
};

describe('backpromote history comment', () => {
  it('writes a readable table whose rows carry their record, and reads it back unchanged', () => {
    const body = buildBackpromoteStateComment([samRecord]);
    expect(body.startsWith(BACKPROMOTE_STATE_MARKER)).to.be.true;
    expect(body).to.contain('`mycompany--dev-sam`');
    expect(body).to.contain('2026-09-11 10:11 UTC');
    expect(body).to.contain('`4588789`');
    expect(body).to.contain('Load approval \\| matrix');
    expect(parseBackpromoteStateComment(body)).to.deep.equal([samRecord]);
  });

  it('keeps the marker comment closed whatever the org name or action label hold', () => {
    const tricky: BackpromoteOrgRecord = { ...samRecord, orgName: 'odd --> name', actions: [{ id: 'a', label: '<!-- --> "quoted"', status: 'manual', date: '' }] };
    const parsed = parseBackpromoteStateComment(buildBackpromoteStateComment([tricky]));
    expect(parsed).to.deep.equal([tricky]);
  });

  it('ignores rows edited by hand instead of failing', () => {
    const body = [BACKPROMOTE_STATE_MARKER, '| <!-- sfdx-hardis-backpromote data:%7Bbroken --> x |', '| <!-- sfdx-hardis-backpromote data:%7B%7D --> y |'].join('\n');
    expect(parseBackpromoteStateComment(body)).to.deep.equal([]);
  });

  it('merges one record per org, keeps other orgs, replaces an action and keeps the deployment date of an actions-only update', () => {
    const lea: BackpromoteOrgRecord = { orgId: LEA_ORG, orgName: 'mycompany--dev-lea', date: '2026-09-10T08:00:00.000Z', commit: 'aaa', actions: [] };
    const actionsOnly: BackpromoteOrgRecord = {
      orgId: SAM_ORG.substring(0, 15),
      orgName: 'mycompany--dev-sam',
      date: null,
      commit: '',
      actions: [
        { id: 'load-matrix', label: 'Load approval matrix', status: 'failed', date: '2026-09-12T09:00:00.000Z' },
        { id: 'assign-ps', label: 'Assign permission set', status: 'success', date: '2026-09-12T09:01:00.000Z' },
      ],
    };
    const merged = mergeBackpromoteOrgRecords([samRecord, lea], [actionsOnly]);
    expect(merged).to.have.length(2);
    const sam = merged.find((record) => record.orgName === 'mycompany--dev-sam')!;
    expect(sam.date).to.equal(samRecord.date);
    expect(sam.commit).to.equal(samRecord.commit);
    expect(sam.actions.map((action) => `${action.id}:${action.status}`)).to.deep.equal(['load-matrix:failed', 'assign-ps:success']);
    expect(merged.find((record) => record.orgId === LEA_ORG)).to.deep.equal(lea);
  });
});

describe('computeBackpromoteGroupHistory()', () => {
  const recordsByPr = new Map<number, BackpromoteOrgRecord[]>([
    [481, [samRecord, { orgId: LEA_ORG, orgName: 'mycompany--dev-lea', date: '2026-09-12T08:00:00.000Z', commit: 'bbb', actions: [] }]],
    [482, [{ ...samRecord, date: null }]],
  ]);

  it('is done for the org when every Pull Request of the group was deployed there', () => {
    const history = computeBackpromoteGroupHistory({ associatedPrs: [{ id: 481 }] }, recordsByPr, SAM_ORG);
    expect(history.status).to.equal('done');
    expect(history.trackable).to.be.true;
    expect(history.backpromotedToThisOrg).to.deep.equal({ date: samRecord.date, commit: samRecord.commit });
    expect(history.backpromotedTo.map((org) => org.orgName)).to.deep.equal(['mycompany--dev-lea', 'mycompany--dev-sam']);
  });

  it('is pending in another org, after a refresh (new org id), and when a record only holds actions', () => {
    expect(computeBackpromoteGroupHistory({ associatedPrs: [{ id: 481 }] }, recordsByPr, '00D5g00000REFRESHED').status).to.equal('pending');
    expect(computeBackpromoteGroupHistory({ associatedPrs: [{ id: 482 }] }, recordsByPr, SAM_ORG).status).to.equal('pending');
    expect(computeBackpromoteGroupHistory({ associatedPrs: [{ id: 481 }, { id: 482 }] }, recordsByPr, SAM_ORG).status).to.equal('pending');
  });

  it('never marks a merge without Pull Request number as done', () => {
    const history = computeBackpromoteGroupHistory({ associatedPrs: [{ id: 0 }] }, recordsByPr, SAM_ORG);
    expect(history.status).to.equal('pending');
    expect(history.trackable).to.be.false;
  });

  it('lists the actions that already ran successfully in the org only', () => {
    const done = findActionsDoneInOrg(recordsByPr, SAM_ORG);
    expect([...done.keys()]).to.deep.equal(['load-matrix']);
    expect(findActionsDoneInOrg(recordsByPr, LEA_ORG).size).to.equal(0);
  });
});

describe('backpromote org and provider names', () => {
  it('compares org ids on their 15 first characters', () => {
    expect(isSameOrgId(SAM_ORG, SAM_ORG.substring(0, 15))).to.be.true;
    expect(isSameOrgId(SAM_ORG, LEA_ORG)).to.be.false;
    expect(isSameOrgId('', '')).to.be.false;
  });

  it('names an org after the first part of its instance host', () => {
    expect(orgShortName('https://mycompany--dev-sam.sandbox.my.salesforce.com', 'x')).to.equal('mycompany--dev-sam');
    expect(orgShortName('https://flow-java-4878-dev-ed.scratch.my.salesforce.com/', 'x')).to.equal('flow-java-4878-dev-ed');
    expect(orgShortName('', 'fallback@user')).to.equal('fallback@user');
  });

  it('recognizes the four git providers from their connector label', () => {
    expect(gitProviderNameFromLabel('sfdx-hardis GitHub connector')).to.equal('github');
    expect(gitProviderNameFromLabel('sfdx-hardis Gitlab connector')).to.equal('gitlab');
    expect(gitProviderNameFromLabel('sfdx-hardis Azure Devops connector')).to.equal('azure');
    expect(gitProviderNameFromLabel('sfdx-hardis Bitbucket connector')).to.equal('bitbucket');
    expect(gitProviderNameFromLabel('something else')).to.be.null;
  });
});
