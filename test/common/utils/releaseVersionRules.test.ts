/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  buildVersionedBranchGraph,
  compareReleaseVersions,
  computeNextReleaseVersion,
  findLatestVersionTagOfBranch,
  findPreviousVersionTag,
  formatReleaseVersion,
  formatTagName,
  formatVersionTagMessage,
  isValidTagVariableValue,
  listTagVariableEnvNames,
  parseReleaseVersion,
  parseTagFormat,
  parseVersionTagMessage,
  ReleaseSourceKind,
  ReleaseVersion,
  ReleaseVersionSettings,
  TagFormat,
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

function makeTag(
  name: string,
  branch: string | null,
  index: number,
  managed = true,
  details: { version?: ReleaseVersion; variables?: Record<string, string> } = {}
): VersionTag {
  const date = new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString();
  return {
    name,
    version: details.version || parseReleaseVersion(name)!,
    variables: details.variables || {},
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

  public deploy(
    branch: string,
    source: { sourceBranch: string | null; sourceKind: ReleaseSourceKind | null },
    tagsMergedInHead: string[] = [],
    takenTagNames: string[] = []
  ): string | null {
    this.counter++;
    const decision = computeNextReleaseVersion(
      { branch, sourceBranch: source.sourceBranch, sourceKind: source.sourceKind, headCommit: `commit-${this.counter}`, tagsMergedInHead, takenTagNames },
      this.tags,
      this.graph,
      this.settings
    );
    if (decision.tagName && decision.version) {
      // The version comes from the tag message, as listVersionTags reads it: never from the name
      this.tags.push(makeTag(decision.tagName, branch, this.counter, true, { version: decision.version, variables: decision.variables }));
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
      const metadata = {
        branch: 'uat',
        version: { major: 1, minor: 5, patch: 0, rc: 3 },
        variables: { PI: '2', IT: '4' },
        org: 'https://acme--uat.sandbox.my.salesforce.com',
        deployedAt: '2026-11-17T14:02:11.000Z',
        pullRequest: 512,
        jobUrl: 'https://github.com/acme/crm/actions/runs/1',
      };
      const message = formatVersionTagMessage('v1.5.0-pi2-it4-uat-rc3', metadata);
      expect(message).to.contain('version: 1.5.0\nrc: 3\nvariables: PI=2 IT=4');
      expect(parseVersionTagMessage(message)).to.deep.equal(metadata);
      const final = formatVersionTagMessage('v1.5.0', { ...metadata, branch: 'main', version: { major: 1, minor: 5, patch: 0, rc: null }, variables: {} });
      expect(final).to.not.contain('rc:');
      expect(final).to.not.contain('variables:');
      expect(parseVersionTagMessage(final)?.version).to.deep.equal({ major: 1, minor: 5, patch: 0, rc: null });
      expect(parseVersionTagMessage('Release 1.5.0')).to.be.null;
    });

    it('reads a tag message without version: the version then comes from the tag name', () => {
      const parsed = parseVersionTagMessage('sfdx-hardis release version v1.5.0-rc.3\n\nbranch: preprod\ndeployedAt: 2026-11-17T14:02:11.000Z');
      expect(parsed?.version).to.be.null;
      expect(parsed?.variables).to.deep.equal({});
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

  describe('tag formats', () => {
    const UAT_FORMAT = parseTagFormat('v{MAJ}.{MIN}.{PATCH}-pi{PI}-it{IT}-{BRANCH}-rc{RC}') as TagFormat;
    const PREPROD_FORMAT = parseTagFormat('v{MAJ}.{MIN}.{PATCH}-{BRANCH}-rc{RC}') as TagFormat;

    function withFormats(tagFormats: Record<string, TagFormat>, variables: Record<string, string> = {}): ReleaseVersionSettings {
      return { ...SETTINGS, tagFormats, minimumVariables: { uat: variables, preprod: variables } };
    }

    function setVariables(repo: Repository, variables: Record<string, string>): void {
      repo.settings = { ...repo.settings, minimumVariables: { uat: variables, preprod: variables } };
    }

    it('reads valid formats and rejects invalid ones', () => {
      expect(parseTagFormat('v{MAJ}.{MIN}.{PATCH}-rc.{RC}')?.variables).to.deep.equal([]);
      expect(UAT_FORMAT.variables).to.deep.equal(['PI', 'IT']);
      expect(parseTagFormat('v{MAJ}.{MIN}.{PATCH}-{BRANCH}-rc{RC}')?.variables).to.deep.equal([]);
      for (const invalid of [
        '',
        'v{MAJ}.{MIN}.{PATCH}-uat',
        'v{MAJ}.{MIN}.{MIN}.{PATCH}-rc{RC}',
        'v{MAJ}.{MIN}{PATCH}-rc{RC}',
        'v{MAJ}.{MIN}.{PATCH}/rc{RC}',
        'v{MAJ}.{MIN}.{PATCH}-rc {RC}',
        '-v{MAJ}.{MIN}.{PATCH}-rc{RC}',
        'v{MAJ}..{MIN}.{PATCH}-rc{RC}',
        'v{MAJ}.{MIN}.{PATCH}-rc{RC}.lock',
        'v{MAJ}.{MIN}.{PATCH}-rc{RC}-{1PI}',
        'v{MAJ}.{MIN}.{PATCH}-rc{RC}-{PI',
      ]) {
        expect(parseTagFormat(invalid), invalid).to.be.null;
      }
    });

    it('writes the git branch name in {BRANCH}', () => {
      const format = parseTagFormat('v{MAJ}.{MIN}.{PATCH}-{BRANCH}-rc{RC}') as TagFormat;
      const version = { major: 1, minor: 2, patch: 0, rc: 4 };
      expect(formatTagName(format, version, 'release/uat', {})).to.equal('v1.2.0-release-uat-rc4');
      expect(formatTagName(format, version, 'release__uat', {})).to.equal('v1.2.0-release-uat-rc4');
    });

    it('names the CI/CD variables of a tag variable, the one of the branch first', () => {
      expect(listTagVariableEnvNames('uat', 'PI')).to.deep.equal(['SFDX_HARDIS_RELEASE_VERSIONING_VAR_UAT_PI', 'SFDX_HARDIS_RELEASE_VERSIONING_VAR_PI']);
      expect(listTagVariableEnvNames('release__uat', 'It')).to.deep.equal([
        'SFDX_HARDIS_RELEASE_VERSIONING_VAR_RELEASE_UAT_IT',
        'SFDX_HARDIS_RELEASE_VERSIONING_VAR_IT',
      ]);
    });

    it('accepts only safe variable values', () => {
      expect(isValidTagVariableValue('3')).to.be.true;
      expect(isValidTagVariableValue('2026.Q1')).to.be.true;
      expect(isValidTagVariableValue('.3')).to.be.false;
      expect(isValidTagVariableValue('3 ')).to.be.false;
      expect(isValidTagVariableValue('a/b')).to.be.false;
    });

    it('numbers a release cycle with one counter per tag text and variables changed by the config', () => {
      const repo = new Repository(withFormats({ uat: UAT_FORMAT, preprod: PREPROD_FORMAT }, { PI: '2', IT: '4' }));
      expect(repo.deploy('uat', fromInt)).to.equal('v1.0.0-pi2-it4-uat-rc1');
      expect(repo.deploy('uat', fromInt)).to.equal('v1.0.0-pi2-it4-uat-rc2');
      expect(repo.deploy('uat', fromInt)).to.equal('v1.0.0-pi2-it4-uat-rc3');
      expect(repo.deploy('preprod', fromUat)).to.equal('v1.0.0-preprod-rc1');
      setVariables(repo, { PI: '2', IT: '5' });
      expect(repo.deploy('uat', fromInt)).to.equal('v1.1.0-pi2-it5-uat-rc1');
      expect(repo.deploy('preprod', hotfix)).to.equal('v1.0.0-preprod-rc2');
      expect(repo.deploy('main', fromPreprod, repo.names().filter((name) => name.startsWith('v1.0.0')))).to.equal('v1.0.0');
      // A new PI: the variables go up together, IT 1 of PI 3 is above IT 5 of PI 2
      setVariables(repo, { PI: '3', IT: '1' });
      expect(repo.deploy('uat', fromInt)).to.equal('v1.1.0-pi3-it1-uat-rc1');
      expect(repo.deploy('uat', fromInt)).to.equal('v1.1.0-pi3-it1-uat-rc2');
      // Lowering the config has no effect: the tags hold higher values
      setVariables(repo, { PI: '2', IT: '9' });
      expect(repo.deploy('uat', fromInt)).to.equal('v1.1.0-pi3-it1-uat-rc3');
      expect(repo.deploy('preprod', fromUat)).to.equal('v1.1.0-preprod-rc1');
      expect(repo.deploy('main', fromPreprod, repo.names())).to.equal('v1.1.0');
      // Release notes: a release candidate starts from the tag deployed before it on its branch
      expect(findPreviousVersionTag('v1.1.0-pi3-it1-uat-rc1', repo.tags)?.name).to.equal('v1.1.0-pi2-it5-uat-rc1');
      expect(findPreviousVersionTag('v1.1.0-preprod-rc1', repo.tags)?.name).to.equal('v1.0.0-preprod-rc2');
      expect(findPreviousVersionTag('v1.1.0', repo.tags)?.name).to.equal('v1.0.0');
    });

    it('shares one counter between two branches with the same format', () => {
      const format = parseTagFormat('v{MAJ}.{MIN}.{PATCH}-rc{RC}') as TagFormat;
      const repo = new Repository(withFormats({ uat: format, preprod: format }));
      expect(repo.deploy('uat', fromInt)).to.equal('v1.0.0-rc1');
      expect(repo.deploy('uat', fromInt)).to.equal('v1.0.0-rc2');
      expect(repo.deploy('preprod', fromUat)).to.equal('v1.0.0-rc3');
    });

    it('creates no tag when a variable has no value', () => {
      const repo = new Repository(withFormats({ uat: UAT_FORMAT }, { PI: '2' }));
      const decision = computeNextReleaseVersion(
        { branch: 'uat', sourceBranch: 'int', sourceKind: 'majorBranch', headCommit: 'x', tagsMergedInHead: [] },
        [],
        repo.graph,
        repo.settings
      );
      expect(decision.reason).to.equal('missing-variables');
      expect(decision.tagName).to.be.null;
      expect(decision.missingVariables).to.deep.equal(['IT']);
    });

    it('takes the variables of the previous tags when the config has none', () => {
      const repo = new Repository(withFormats({ uat: UAT_FORMAT }));
      repo.tags.push(makeTag('v1.0.0-pi4-it2-uat-rc1', 'uat', 100, true, { version: { major: 1, minor: 0, patch: 0, rc: 1 }, variables: { PI: '4', IT: '2' } }));
      expect(repo.deploy('uat', fromInt)).to.equal('v1.0.0-pi4-it2-uat-rc2');
    });

    it('keeps plain versions on the highest versioned branch', () => {
      const repo = new Repository(withFormats({ main: PREPROD_FORMAT }));
      repo.seed('v1.4.1', 'main');
      expect(repo.deploy('main', fromPreprod, ['v1.4.1'])).to.equal('v1.4.2');
    });

    it('skips a name already taken by a tag made by hand', () => {
      const repo = new Repository();
      expect(repo.deploy('uat', fromInt, [], ['v1.0.0-rc.1'])).to.equal('v1.0.0-rc.2');
    });
  });
});
