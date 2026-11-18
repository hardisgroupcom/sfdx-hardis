/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  buildVersionedBranchGraph,
  compareReleaseVersions,
  computeNextReleaseVersion,
  findLatestVersionTagOfBranch,
  findPreviousVersionTag,
  formatReleaseVersion,
  formatVersionTagMessage,
  parseReleaseVersion,
  parseVersionTagMessage,
  ReleaseSourceKind,
  ReleaseVersionSettings,
  VersionTag,
} from '../../../src/common/utils/releaseVersionRules.js';

const PIPELINE = [
  { branchName: 'int', mergeTargets: ['uat'] },
  { branchName: 'uat', mergeTargets: ['preprod'], releaseVersioning: true },
  { branchName: 'preprod', mergeTargets: ['main'], releaseVersioning: true },
  { branchName: 'main', mergeTargets: [], releaseVersioning: true },
];

const SETTINGS: ReleaseVersionSettings = {
  initialVersion: parseReleaseVersion('1.0.0')!,
  minimumVersion: null,
};

function makeTag(name: string, branch: string | null, index: number, managed = true): VersionTag {
  const date = new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString();
  return {
    name,
    version: parseReleaseVersion(name)!,
    commit: `commit-${index}`,
    date,
    managed,
    branch,
    org: null,
    deployedAt: managed ? date : null,
    pullRequest: null,
    jobUrl: null,
  };
}

// Runs one deployment against the tags created so far, and records the tag it creates
class Repository {
  public tags: VersionTag[] = [];
  private counter = 0;
  public readonly graph = buildVersionedBranchGraph(PIPELINE);

  public constructor(public settings: ReleaseVersionSettings = SETTINGS) {}

  public seed(name: string, branch: string | null, managed = true): void {
    this.counter++;
    this.tags.push(makeTag(name, branch, this.counter, managed));
  }

  public deploy(branch: string, source: { sourceBranch: string | null; sourceKind: ReleaseSourceKind | null }, tagsMergedInHead: string[] = []): string | null {
    this.counter++;
    const decision = computeNextReleaseVersion(
      { branch, sourceBranch: source.sourceBranch, sourceKind: source.sourceKind, headCommit: `commit-${this.counter}`, tagsMergedInHead },
      this.tags,
      this.graph,
      this.settings
    );
    if (decision.tagName) {
      this.tags.push(makeTag(decision.tagName, branch, this.counter));
    }
    return decision.tagName;
  }

  public names(): string[] {
    return this.tags.map((tag) => tag.name);
  }
}

const fromInt = { sourceBranch: 'int', sourceKind: 'majorBranch' as const };
const fromUat = { sourceBranch: 'uat', sourceKind: 'majorBranch' as const };
const fromPreprod = { sourceBranch: 'preprod', sourceKind: 'majorBranch' as const };
const hotfix = { sourceBranch: 'hotfix/CRM-1110', sourceKind: 'other' as const };

describe('releaseVersionRules', () => {
  describe('buildVersionedBranchGraph', () => {
    it('gives each versioned branch its role and skips the others', () => {
      const graph = buildVersionedBranchGraph(PIPELINE);
      expect(graph.versioned).to.deep.equal(['uat', 'preprod', 'main']);
      expect(graph.roles).to.deep.equal({ uat: 'first', preprod: 'middle', main: 'final' });
      expect(graph.roles.int).to.be.undefined;
      expect(graph.above.uat).to.have.members(['preprod', 'main']);
      expect(graph.below.main).to.have.members(['uat', 'preprod']);
    });

    it('skips an unversioned branch between two versioned ones', () => {
      const graph = buildVersionedBranchGraph([
        { branchName: 'uat', mergeTargets: ['preprod'], releaseVersioning: true },
        { branchName: 'preprod', mergeTargets: ['main'] },
        { branchName: 'main', mergeTargets: [], releaseVersioning: true },
      ]);
      expect(graph.roles).to.deep.equal({ uat: 'first', main: 'final' });
    });

    it('uses the config file form of branch names with a slash', () => {
      const graph = buildVersionedBranchGraph([
        { branchName: 'release__uat', mergeTargets: ['main'], releaseVersioning: true },
        { branchName: 'main', mergeTargets: [], releaseVersioning: true },
      ]);
      expect(graph.roles.release__uat).to.equal('first');
    });
  });

  describe('computeNextReleaseVersion: a release cycle', () => {
    it('numbers the ten deployments of the documented example', () => {
      const repo = new Repository();
      repo.seed('v1.3.0', 'main');
      expect(repo.deploy('uat', fromInt)).to.equal('v1.4.0-rc.1');
      expect(repo.deploy('uat', fromInt)).to.equal('v1.4.0-rc.2');
      expect(repo.deploy('preprod', fromUat)).to.equal('v1.4.0-rc.3');
      // 1.4.0 moved up to preprod: uat opens the next release
      expect(repo.deploy('uat', fromInt)).to.equal('v1.5.0-rc.1');
      expect(repo.deploy('main', fromPreprod, ['v1.3.0', 'v1.4.0-rc.1', 'v1.4.0-rc.2', 'v1.4.0-rc.3'])).to.equal('v1.4.0');
      // Nothing waits in preprod: a hotfix starts a patch
      expect(repo.deploy('preprod', hotfix)).to.equal('v1.4.1-rc.1');
      expect(repo.deploy('main', fromPreprod, ['v1.3.0', 'v1.4.0-rc.1', 'v1.4.0-rc.2', 'v1.4.0-rc.3', 'v1.4.0', 'v1.4.1-rc.1'])).to.equal('v1.4.1');
      // A backpromote into uat keeps the open release of uat
      expect(repo.deploy('uat', { sourceBranch: 'backpromote/uat', sourceKind: 'other' })).to.equal('v1.5.0-rc.2');
      expect(repo.deploy('preprod', fromUat)).to.equal('v1.5.0-rc.3');
      expect(repo.deploy('uat', fromInt)).to.equal('v1.6.0-rc.1');
    });

    it('starts from the initial version when the repository has no semver tag', () => {
      const repo = new Repository();
      expect(repo.deploy('uat', fromInt)).to.equal('v1.0.0-rc.1');
    });

    it('raises the version to the minimum version', () => {
      const repo = new Repository({ ...SETTINGS, minimumVersion: parseReleaseVersion('2.0.0') });
      repo.seed('v1.3.0', 'main');
      expect(repo.deploy('uat', fromInt)).to.equal('v2.0.0-rc.1');
      expect(repo.deploy('uat', fromInt)).to.equal('v2.0.0-rc.2');
    });

    it('creates no version on a branch that does not declare releaseVersioning', () => {
      const repo = new Repository();
      const decision = computeNextReleaseVersion(
        { branch: 'int', sourceBranch: null, sourceKind: null, headCommit: 'abc', tagsMergedInHead: [] },
        [],
        repo.graph,
        SETTINGS
      );
      expect(decision.reason).to.equal('not-versioned');
      expect(decision.tagName).to.be.null;
    });

    it('keeps the tag of a commit deployed again', () => {
      const repo = new Repository();
      repo.seed('v1.3.0', 'main');
      repo.deploy('uat', fromInt);
      const decision = computeNextReleaseVersion(
        { branch: 'uat', sourceBranch: 'int', sourceKind: 'majorBranch', headCommit: repo.tags[1].commit, tagsMergedInHead: [] },
        repo.tags,
        repo.graph,
        SETTINGS
      );
      expect(decision.reason).to.equal('already-tagged');
      expect(decision.tagName).to.equal('v1.4.0-rc.1');
    });

    it('lets a hotfix join the release waiting in preprod', () => {
      const repo = new Repository();
      repo.seed('v1.4.1', 'main');
      repo.seed('v1.5.0-rc.2', 'uat');
      repo.seed('v1.5.0-rc.3', 'preprod');
      expect(repo.deploy('preprod', hotfix)).to.equal('v1.5.0-rc.4');
    });

    it('treats a direct push to preprod as a hotfix', () => {
      const repo = new Repository();
      repo.seed('v1.4.1', 'main');
      expect(repo.deploy('preprod', { sourceBranch: null, sourceKind: null })).to.equal('v1.4.2-rc.1');
    });

    it('reads the source of a promotion branch', () => {
      const repo = new Repository();
      repo.seed('v1.4.1', 'main');
      repo.seed('v1.6.0-rc.1', 'uat');
      expect(repo.deploy('preprod', { sourceBranch: 'uat', sourceKind: 'promotionBranch' })).to.equal('v1.6.0-rc.2');
    });

    it('treats a higher branch merged back into preprod as a hotfix', () => {
      const repo = new Repository();
      repo.seed('v1.4.1', 'main');
      repo.seed('v1.5.0-rc.1', 'uat');
      expect(repo.deploy('preprod', { sourceBranch: 'main', sourceKind: 'majorBranch' })).to.equal('v1.4.2-rc.1');
      // Release 1.5.0 did not move up: uat keeps it open
      expect(repo.deploy('uat', fromInt)).to.equal('v1.5.0-rc.2');
    });

    it('releases the version of the source of a promotion branch into main', () => {
      const repo = new Repository();
      repo.seed('v1.4.1', 'main');
      repo.seed('v1.5.0-rc.2', 'uat');
      repo.seed('v1.5.0-rc.3', 'preprod');
      repo.seed('v1.6.0-rc.1', 'uat');
      // The cherry-picked commits carry new SHAs: no release candidate is reachable from the deployed commit
      expect(repo.deploy('main', { sourceBranch: 'preprod', sourceKind: 'promotionBranch' }, ['v1.4.1'])).to.equal('v1.5.0');
    });

    it('releases the newest version when a release overtook another one', () => {
      const repo = new Repository();
      repo.seed('v1.4.1', 'main');
      repo.seed('v1.5.0-rc.3', 'preprod');
      repo.seed('v1.6.0-rc.1', 'uat');
      expect(repo.deploy('preprod', fromUat)).to.equal('v1.6.0-rc.2');
      expect(repo.deploy('main', fromPreprod, ['v1.4.1', 'v1.5.0-rc.3', 'v1.6.0-rc.1', 'v1.6.0-rc.2'])).to.equal('v1.6.0');
    });

    it('gives the next patch to main when nothing new reached it', () => {
      const repo = new Repository();
      repo.seed('v1.4.1', 'main');
      expect(repo.deploy('main', fromPreprod, ['v1.4.1'])).to.equal('v1.4.2');
    });

    it('gives a minor version to each deployment when main is the only versioned branch', () => {
      const graph = buildVersionedBranchGraph([
        { branchName: 'uat', mergeTargets: ['main'] },
        { branchName: 'main', mergeTargets: [], releaseVersioning: true },
      ]);
      const decision = computeNextReleaseVersion(
        { branch: 'main', sourceBranch: 'uat', sourceKind: 'majorBranch', headCommit: 'x', tagsMergedInHead: ['v1.4.1'] },
        [makeTag('v1.4.1', 'main', 1)],
        graph,
        SETTINGS
      );
      expect(decision.tagName).to.equal('v1.5.0');
      expect(decision.reason).to.equal('final-only');
    });

    it('counts tags created by hand for the numbering', () => {
      const repo = new Repository();
      repo.seed('1.8.0', null, false);
      expect(repo.deploy('uat', fromInt)).to.equal('v1.9.0-rc.1');
    });
  });

  describe('versions and tag messages', () => {
    it('parses and formats versions', () => {
      expect(parseReleaseVersion('v1.5.0-rc.3')).to.deep.equal({ major: 1, minor: 5, patch: 0, rc: 3 });
      expect(parseReleaseVersion('1.5.0')).to.deep.equal({ major: 1, minor: 5, patch: 0, rc: null });
      expect(parseReleaseVersion('v2.0')).to.be.null;
      expect(parseReleaseVersion('v1.5.0-beta.1')).to.be.null;
      expect(formatReleaseVersion({ major: 1, minor: 5, patch: 0, rc: 3 })).to.equal('v1.5.0-rc.3');
      expect(formatReleaseVersion({ major: 1, minor: 5, patch: 0, rc: null }, false)).to.equal('1.5.0');
    });

    it('orders a release candidate before its plain version', () => {
      const ordered = ['v1.5.0', 'v1.4.1', 'v1.5.0-rc.10', 'v1.5.0-rc.2']
        .map((name) => parseReleaseVersion(name)!)
        .sort(compareReleaseVersions)
        .map((version) => formatReleaseVersion(version));
      expect(ordered).to.deep.equal(['v1.4.1', 'v1.5.0-rc.2', 'v1.5.0-rc.10', 'v1.5.0']);
    });

    it('writes and reads the message of a version tag', () => {
      const message = formatVersionTagMessage('v1.5.0-rc.3', {
        branch: 'preprod',
        org: 'https://acme--preprod.sandbox.my.salesforce.com',
        deployedAt: '2026-11-17T14:02:11.000Z',
        pullRequest: 512,
        jobUrl: 'https://github.com/acme/crm/actions/runs/1',
      });
      expect(parseVersionTagMessage(message)).to.deep.equal({
        branch: 'preprod',
        org: 'https://acme--preprod.sandbox.my.salesforce.com',
        deployedAt: '2026-11-17T14:02:11.000Z',
        pullRequest: 512,
        jobUrl: 'https://github.com/acme/crm/actions/runs/1',
      });
      expect(parseVersionTagMessage('Release 1.5.0')).to.be.null;
    });
  });

  describe('findPreviousVersionTag and findLatestVersionTagOfBranch', () => {
    const tags = [
      makeTag('v1.4.0', 'main', 1),
      makeTag('v1.4.1-rc.1', 'preprod', 2),
      makeTag('v1.4.1', 'main', 3),
      makeTag('v1.5.0-rc.2', 'uat', 4),
      makeTag('v1.5.0-rc.3', 'preprod', 5),
      makeTag('v1.5.0', 'main', 6),
    ];

    it('starts a plain version from the previous plain version, never from its own candidates', () => {
      expect(findPreviousVersionTag('v1.5.0', tags)?.name).to.equal('v1.4.1');
    });

    it('starts a release candidate from the previous version of its branch', () => {
      expect(findPreviousVersionTag('v1.5.0-rc.3', tags)?.name).to.equal('v1.4.1-rc.1');
    });

    it('finds nothing before the first version', () => {
      expect(findPreviousVersionTag('v1.4.0', tags)).to.be.undefined;
    });

    it('finds the version last deployed on a branch', () => {
      expect(findLatestVersionTagOfBranch(tags, 'preprod')?.name).to.equal('v1.5.0-rc.3');
      expect(findLatestVersionTagOfBranch(tags, 'int')).to.be.undefined;
    });
  });
});
