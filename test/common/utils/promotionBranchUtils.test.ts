/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Load the provider barrel first: promotionBranchUtils imports the CommonPullRequestInfo type from it,
// and the gitProvider modules take part in an import cycle that must be entered through index.js.
import '../../../src/common/gitProvider/index.js';
import type { CommonPullRequestInfo } from '../../../src/common/gitProvider/index.js';
import {
  buildAlreadyPromotedMarkdown,
  buildInheritedBehaviorsMarkdown,
  classifyPromotionPullRequest,
  expandPromotionPullRequests,
  filterDeclaredPullRequests,
  findPromotionsCarrying,
  getCarriedBy,
  getPromotionBranchConfig,
  isPromotionBranchName,
  isPromotionPullRequest,
  mergeInheritedCustomBehaviors,
  parsePromotionPullRequestIds,
} from '../../../src/common/utils/promotionBranchUtils.js';

const ENABLED = { enabled: true, prefix: 'promotion' };
const DISABLED = { enabled: false, prefix: 'promotion' };

function pr(overrides: Partial<CommonPullRequestInfo>): CommonPullRequestInfo {
  const idNumber = overrides.idNumber ?? 1;
  return {
    idNumber,
    idStr: String(idNumber),
    sourceBranch: 'feature/story',
    targetBranch: 'uat',
    title: `PR ${idNumber}`,
    description: '',
    authorName: 'someone',
    webUrl: `https://git.example.com/pr/${idNumber}`,
    mergedDate: '2026-09-01T10:00:00Z',
    customBehaviors: {},
    providerInfo: {},
    ...overrides,
  };
}

const DECLARATION = 'Promotion of September\n\n```yaml\npromotionPullRequests: [482, 487]\n```\n';

describe('getPromotionBranchConfig()', () => {
  it('is disabled with the default prefix when nothing is configured', () => {
    expect(getPromotionBranchConfig({})).to.deep.equal({ enabled: false, prefix: 'promotion' });
    expect(getPromotionBranchConfig(null)).to.deep.equal({ enabled: false, prefix: 'promotion' });
  });

  it('only enables on an explicit true', () => {
    expect(getPromotionBranchConfig({ enablePromotionBranches: true }).enabled).to.equal(true);
    expect(getPromotionBranchConfig({ enablePromotionBranches: 'true' }).enabled).to.equal(false);
  });

  it('normalizes a prefix written with a trailing slash', () => {
    expect(getPromotionBranchConfig({ promotionBranchPrefix: 'release/' }).prefix).to.equal('release');
    expect(getPromotionBranchConfig({ promotionBranchPrefix: '  ' }).prefix).to.equal('promotion');
  });
});

describe('isPromotionBranchName()', () => {
  it('matches the <prefix>/<name> convention only, without case', () => {
    expect(isPromotionBranchName('promotion/2026-09')).to.equal(true);
    expect(isPromotionBranchName('Promotion/2026-09')).to.equal(true);
    expect(isPromotionBranchName('promotion-notes')).to.equal(false);
    expect(isPromotionBranchName('promotional/banner')).to.equal(false);
    expect(isPromotionBranchName('promotion/')).to.equal(false);
    expect(isPromotionBranchName('feature/promotion/x')).to.equal(false);
    expect(isPromotionBranchName('')).to.equal(false);
  });

  it('honors a custom prefix', () => {
    expect(isPromotionBranchName('release/1.4', 'release')).to.equal(true);
    expect(isPromotionBranchName('promotion/1.4', 'release')).to.equal(false);
  });
});

describe('parsePromotionPullRequestIds()', () => {
  it('returns null when the key is absent, so "not declared" differs from "declared empty"', () => {
    expect(parsePromotionPullRequestIds('')).to.equal(null);
    expect(parsePromotionPullRequestIds(null)).to.equal(null);
    expect(parsePromotionPullRequestIds('```yaml\ndeploymentApexTestClasses: [A]\n```')).to.equal(null);
    expect(parsePromotionPullRequestIds('```yaml\npromotionPullRequests: []\n```')).to.deep.equal([]);
  });

  it('reads numbers and provider-style references, deduplicated', () => {
    const description = '```yaml\npromotionPullRequests:\n  - 482\n  - "#487"\n  - "!491"\n  - "PR 500"\n  - 482\n  - nonsense\n  - -3\n```';
    expect(parsePromotionPullRequestIds(description)).to.deep.equal([482, 487, 491, 500]);
  });

  it('reads the key from any yaml block of the description, not only the first one', () => {
    const description = '```yaml\ndeploymentApexTestClasses: [A]\n```\nSome text\n```yml\npromotionPullRequests: [12]\n```';
    expect(parsePromotionPullRequestIds(description)).to.deep.equal([12]);
  });

  it('ignores a block that is not valid yaml', () => {
    expect(parsePromotionPullRequestIds('```yaml\npromotionPullRequests: [482\n```')).to.equal(null);
  });
});

describe('classifyPromotionPullRequest()', () => {
  it('needs the flag, the prefix and the key', () => {
    expect(classifyPromotionPullRequest(pr({ sourceBranch: 'promotion/x', description: DECLARATION }), ENABLED)).to.equal('promotion');
    expect(classifyPromotionPullRequest(pr({ sourceBranch: 'promotion/x', description: 'no key' }), ENABLED)).to.equal('prefix-without-key');
    expect(classifyPromotionPullRequest(pr({ sourceBranch: 'feature/x', description: DECLARATION }), ENABLED)).to.equal('key-without-prefix');
    expect(classifyPromotionPullRequest(pr({ sourceBranch: 'feature/x', description: 'plain' }), ENABLED)).to.equal('none');
  });

  // The regression contract: a stray key or prefix on a project that did not opt in changes nothing
  it('classifies nothing when the feature is disabled', () => {
    expect(classifyPromotionPullRequest(pr({ sourceBranch: 'promotion/x', description: DECLARATION }), DISABLED)).to.equal('none');
    expect(isPromotionPullRequest(pr({ sourceBranch: 'promotion/x', description: DECLARATION }), DISABLED)).to.equal(false);
    expect(classifyPromotionPullRequest(null, ENABLED)).to.equal('none');
  });
});

describe('filterDeclaredPullRequests()', () => {
  const promotion = pr({ idNumber: 900, sourceBranch: 'promotion/x', targetBranch: 'preprod', description: DECLARATION });

  it('keeps merged stories, skips missing and open ones, never the promotion itself', () => {
    const fetched = new Map<number, CommonPullRequestInfo | null>([
      [482, pr({ idNumber: 482 })],
      [487, null],
      [491, pr({ idNumber: 491, mergedDate: undefined })],
      [900, promotion],
    ]);
    const kept = filterDeclaredPullRequests([482, 487, 491, 900], fetched, promotion);
    expect(kept.map((story) => story.idNumber)).to.deep.equal([482]);
  });

  it('marks each kept story with the promotion that carries it', () => {
    const fetched = new Map<number, CommonPullRequestInfo | null>([[482, pr({ idNumber: 482 })]]);
    const [story] = filterDeclaredPullRequests([482], fetched, promotion);
    expect(getCarriedBy(story)).to.deep.equal({ idStr: '900', idNumber: 900, sourceBranch: 'promotion/x', webUrl: promotion.webUrl });
    expect(getCarriedBy(pr({ idNumber: 1 }))).to.equal(null);
  });
});

describe('expandPromotionPullRequests()', () => {
  const stories = new Map<number, CommonPullRequestInfo>([
    [482, pr({ idNumber: 482 })],
    [487, pr({ idNumber: 487 })],
  ]);
  const fetchPullRequest = async (id: number) => stories.get(id) || null;

  it('adds the declared stories of a promotion Pull Request found in a window, once', async () => {
    const window = [
      pr({ idNumber: 900, sourceBranch: 'promotion/x', targetBranch: 'preprod', description: DECLARATION }),
      pr({ idNumber: 482 }), // already in the window on its own
      pr({ idNumber: 901, sourceBranch: 'feature/other' }),
    ];
    const expanded = await expandPromotionPullRequests(window, ENABLED, fetchPullRequest);
    expect(expanded.map((entry) => entry.idNumber)).to.deep.equal([900, 482, 901, 487]);
    expect(getCarriedBy(expanded[3])?.idNumber).to.equal(900);
    expect(getCarriedBy(expanded[1])).to.equal(null);
  });

  it('expands one level only', async () => {
    const nestedPromotion = pr({ idNumber: 950, sourceBranch: 'promotion/nested', description: '```yaml\npromotionPullRequests: [487]\n```' });
    const window = [pr({ idNumber: 900, sourceBranch: 'promotion/x', description: '```yaml\npromotionPullRequests: [950]\n```' })];
    const expanded = await expandPromotionPullRequests(window, ENABLED, async (id) => (id === 950 ? nestedPromotion : stories.get(id) || null));
    expect(expanded.map((entry) => entry.idNumber)).to.deep.equal([900, 950]);
  });

  it('returns the window untouched when the feature is disabled', async () => {
    const window = [pr({ idNumber: 900, sourceBranch: 'promotion/x', description: DECLARATION })];
    let fetchCalls = 0;
    const expanded = await expandPromotionPullRequests(window, DISABLED, async (id) => {
      fetchCalls++;
      return stories.get(id) || null;
    });
    expect(expanded).to.deep.equal(window);
    expect(fetchCalls).to.equal(0);
  });
});

describe('mergeInheritedCustomBehaviors()', () => {
  it('ORs the behaviors of the carried stories into the promotion Pull Request and reports origins', () => {
    const promotion = pr({ idNumber: 900, sourceBranch: 'promotion/x', customBehaviors: { noDeltaDeployment: true } });
    const stories = [
      pr({ idNumber: 482, customBehaviors: { purgeFlowVersions: true } }),
      pr({ idNumber: 487, customBehaviors: { purgeFlowVersions: true, flowDeleteInterviews: true } }),
      pr({ idNumber: 491, customBehaviors: { noDeltaDeployment: true } }),
      promotion,
    ];
    const inherited = mergeInheritedCustomBehaviors(promotion, stories);
    expect(promotion.customBehaviors).to.deep.equal({ noDeltaDeployment: true, purgeFlowVersions: true, flowDeleteInterviews: true });
    // noDeltaDeployment was already set on the promotion itself: not inherited, not reported
    expect(inherited).to.deep.equal([
      { behavior: 'purgeFlowVersions', keyword: 'PURGE_FLOW_VERSIONS', fromPullRequests: ['482', '487'] },
      { behavior: 'flowDeleteInterviews', keyword: 'FLOW_DELETE_INTERVIEWS', fromPullRequests: ['487'] },
    ]);
  });

  it('changes nothing when no story declares anything', () => {
    const promotion = pr({ idNumber: 900, customBehaviors: {} });
    expect(mergeInheritedCustomBehaviors(promotion, [pr({ idNumber: 482 })])).to.deep.equal([]);
    expect(promotion.customBehaviors).to.deep.equal({});
  });

  it('renders the inherited keywords with links to their origin', () => {
    const stories = [pr({ idNumber: 482 })];
    const markdown = buildInheritedBehaviorsMarkdown(
      [{ behavior: 'purgeFlowVersions', keyword: 'PURGE_FLOW_VERSIONS', fromPullRequests: ['482', '999'] }],
      stories,
    );
    expect(markdown).to.contain('`PURGE_FLOW_VERSIONS` inherited from [#482](https://git.example.com/pr/482), #999');
    expect(buildInheritedBehaviorsMarkdown([], stories)).to.equal('');
  });
});

describe('findPromotionsCarrying() / buildAlreadyPromotedMarkdown()', () => {
  const merged = pr({ idNumber: 900, sourceBranch: 'promotion/x', targetBranch: 'preprod', description: DECLARATION, mergedDate: '2026-09-02T09:00:00Z' });
  const open = pr({ idNumber: 901, sourceBranch: 'promotion/y', targetBranch: 'preprod', description: DECLARATION, mergedDate: undefined });
  const notPromotion = pr({ idNumber: 902, sourceBranch: 'feature/z', targetBranch: 'preprod', description: DECLARATION });

  it('finds the merged promotion Pull Requests declaring a story', () => {
    expect(findPromotionsCarrying(482, [merged, open, notPromotion], ENABLED).map((entry) => entry.idNumber)).to.deep.equal([900]);
    expect(findPromotionsCarrying(555, [merged], ENABLED)).to.deep.equal([]);
    expect(findPromotionsCarrying(482, [merged], DISABLED)).to.deep.equal([]);
  });

  it('renders one line per already promoted story, nothing when there is none', () => {
    const markdown = buildAlreadyPromotedMarkdown([
      { story: pr({ idNumber: 482 }), promotions: [merged] },
      { story: pr({ idNumber: 487 }), promotions: [] },
    ]);
    expect(markdown).to.contain('[#482](https://git.example.com/pr/482) already deployed via `promotion/x` ([#900](https://git.example.com/pr/900), into `preprod` on 2026-09-02)');
    expect(markdown).to.not.contain('#487');
    expect(buildAlreadyPromotedMarkdown([{ story: pr({ idNumber: 487 }), promotions: [] }])).to.equal('');
  });
});
