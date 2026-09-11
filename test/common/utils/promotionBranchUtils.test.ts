/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Load the provider barrel first: promotionBranchUtils imports the CommonPullRequestInfo type from it,
// and the gitProvider modules take part in an import cycle that must be entered through index.js.
import '../../../src/common/gitProvider/index.js';
import type { CommonPullRequestInfo } from '../../../src/common/gitProvider/index.js';
import {
  buildAlreadyPromotedMarkdown,
  buildInheritedBehaviorsMarkdown,
  buildPromotionBranchName,
  buildPromotionIndex,
  classifyPromotionPullRequest,
  expandPromotionPullRequests,
  filterDeclaredPullRequests,
  findPromotionsCarrying,
  findPromotionsCarryingIndexed,
  allowedPromotionSourceBranches,
  allowedPromotionTargetBranches,
  formatPromotionSteps,
  getCarriedBy,
  getPromotionBranchConfig,
  hasPromotionPrefixOnly,
  isPromotionStepAllowed,
  parsePromotionSteps,
  isPromotionBranchName,
  isPromotionPullRequest,
  isPromotionPullRequestForItsTarget,
  mergeInheritedCustomBehaviors,
  extractPromotionBranchNames,
  parsePromotionBranchName,
  parsePromotionPullRequestIds,
} from '../../../src/common/utils/promotionBranchUtils.js';

const ENABLED = { enabled: true, allowedSteps: [] };
const DISABLED = { enabled: false, allowedSteps: [] };
const PROMOTION_BRANCH = 'promotion/uat/preprod/2026-09-06-1';

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
  it('is disabled when nothing is configured', () => {
    expect(getPromotionBranchConfig({})).to.deep.equal({ enabled: false, allowedSteps: [] });
    expect(getPromotionBranchConfig(null)).to.deep.equal({ enabled: false, allowedSteps: [] });
  });

  it('only enables on an explicit true', () => {
    expect(getPromotionBranchConfig({ enablePromotionBranches: true }).enabled).to.equal(true);
    expect(getPromotionBranchConfig({ enablePromotionBranches: 'true' }).enabled).to.equal(false);
  });
});

describe('allowedPromotionSteps', () => {
  it('is read from the project config, next to the feature switch', () => {
    const config = getPromotionBranchConfig({
      enablePromotionBranches: true,
      allowedPromotionSteps: [{ source: 'uat', target: 'preprod' }],
    });
    expect(config.enabled).to.equal(true);
    expect(config.allowedSteps).to.deep.equal([{ source: 'uat', target: 'preprod' }]);
  });

  it('accepts the "uat > preprod" shorthand of a hand-edited config', () => {
    expect(parsePromotionSteps(['uat > preprod', 'preprod -> main'])).to.deep.equal([
      { source: 'uat', target: 'preprod' },
      { source: 'preprod', target: 'main' },
    ]);
  });

  it('leaves out what it cannot read, and the duplicates', () => {
    expect(parsePromotionSteps([{ target: 'preprod' }, null, 42, '', { source: '  ' }])).to.deep.equal([]);
    expect(parsePromotionSteps([{ source: 'uat', target: 'preprod' }, 'uat > preprod'])).to.have.length(1);
    expect(parsePromotionSteps('uat > preprod')).to.deep.equal([]);
  });

  it('an entry without a target allows every target of that branch', () => {
    const steps = parsePromotionSteps([{ source: 'uat' }]);
    expect(steps).to.deep.equal([{ source: 'uat', target: '' }]);
    expect(isPromotionStepAllowed(steps, 'uat', 'preprod')).to.equal(true);
    expect(isPromotionStepAllowed(steps, 'uat', 'main')).to.equal(true);
    expect(isPromotionStepAllowed(steps, 'integration', 'uat')).to.equal(false);
  });

  // The command requires the list (promotionCreateAllowedStepsRequired). The pure helpers still
  // answer "no restriction" for an empty one, which is what the deployment jobs and the pipeline
  // diagram of a project being configured rely on.
  it('an empty list is no restriction for the helpers', () => {
    expect(isPromotionStepAllowed([], 'integration', 'uat')).to.equal(true);
    expect(allowedPromotionSourceBranches([], ['integration', 'uat'])).to.deep.equal(['integration', 'uat']);
    expect(allowedPromotionTargetBranches([], 'uat', ['preprod', 'main'])).to.deep.equal(['preprod', 'main']);
  });

  it('matches branch names whatever their case', () => {
    const steps = parsePromotionSteps([{ source: 'UAT', target: 'PreProd' }]);
    expect(isPromotionStepAllowed(steps, 'uat', 'preprod')).to.equal(true);
    expect(isPromotionStepAllowed(steps, 'uat', 'main')).to.equal(false);
  });

  it('filters the branches offered as source and as target', () => {
    const steps = parsePromotionSteps([{ source: 'uat', target: 'preprod' }]);
    expect(allowedPromotionSourceBranches(steps, ['integration', 'uat', 'preprod'])).to.deep.equal(['uat']);
    expect(allowedPromotionTargetBranches(steps, 'uat', ['preprod', 'main'])).to.deep.equal(['preprod']);
    expect(allowedPromotionTargetBranches(steps, 'preprod', ['main'])).to.deep.equal([]);
  });

  it('says the allowed steps in one line', () => {
    expect(formatPromotionSteps([])).to.equal('-');
    expect(formatPromotionSteps(parsePromotionSteps([{ source: 'uat', target: 'preprod' }, { source: 'preprod' }])))
      .to.equal('uat -> preprod, preprod -> *');
  });
});

describe('promotion branch naming', () => {
  it('parses promotion/<source>/<target>/<YYYY-MM-DD>-<counter>', () => {
    expect(parsePromotionBranchName(PROMOTION_BRANCH)).to.deep.equal({
      sourceBranch: 'uat',
      targetBranch: 'preprod',
      date: '2026-09-06',
      counter: 1,
    });
    expect(parsePromotionBranchName('Promotion/UAT/main/2026-12-31-12')?.counter).to.equal(12);
  });

  it('rejects anything else, including a bare promotion/<name>', () => {
    for (const name of ['promotion/2026-09', 'promotion/uat/preprod', 'promotion/uat/preprod/2026-09-06', 'promotion/uat/preprod/20260906-1', 'promotion//preprod/2026-09-06-1', 'feature/promotion/uat/preprod/2026-09-06-1', 'promotion-notes', '']) {
      expect(parsePromotionBranchName(name), name).to.equal(null);
      expect(isPromotionBranchName(name), name).to.equal(false);
    }
    expect(isPromotionBranchName(PROMOTION_BRANCH)).to.equal(true);
  });

  it('cannot express a branch name holding a slash, which is why the command refuses one', () => {
    // hardis:project:promotion:create stops before touching git when a major branch name has a
    // "/": the name it would build has five segments and would never be recognized here
    const built = buildPromotionBranchName('release/uat', 'preprod', 1, new Date('2026-09-06T10:00:00Z'));
    expect(built).to.equal('promotion/release/uat/preprod/2026-09-06-1');
    expect(isPromotionBranchName(built)).to.equal(false);
  });

  it('tells a hand-named promotion/ branch from a valid one', () => {
    expect(hasPromotionPrefixOnly('promotion/2026-09')).to.equal(true);
    expect(hasPromotionPrefixOnly(PROMOTION_BRANCH)).to.equal(false);
    expect(hasPromotionPrefixOnly('feature/x')).to.equal(false);
  });

  it('builds a name with the date and counter', () => {
    expect(buildPromotionBranchName('uat', 'preprod', 1, new Date('2026-09-06T10:00:00Z'))).to.equal(PROMOTION_BRANCH);
    expect(buildPromotionBranchName('uat', 'preprod', 0, new Date('2026-09-06T10:00:00Z'))).to.equal(PROMOTION_BRANCH);
    expect(buildPromotionBranchName('integration', 'uat', 3, new Date('2026-01-02T23:59:00Z'))).to.equal('promotion/integration/uat/2026-01-02-3');
  });

  // A merged promotion branch deleted from the remote is not a ref any more: the merge sentence of
  // the target branch is the only thing left saying its name was already used today
  it('reads the promotion branch names out of the merge sentences of every provider', () => {
    const log = [
      "Merge pull request #12 from hardisgroupcom/promotion/uat/preprod/2026-09-06-1", // GitHub
      "Merge branch 'promotion/uat/preprod/2026-09-06-2' into 'preprod'", // GitLab
      'See merge request hardisgroupcom/project!34',
      'Merge pull request 42 from promotion/uat/preprod/2026-09-06-3 into preprod', // Azure DevOps
      'Merged in promotion/uat/preprod/2026-09-06-4 (pull request #5)', // Bitbucket
      'Merge pull request #13 from hardisgroupcom/feature/PROJ-1',
    ].join('\n\n');
    expect(extractPromotionBranchNames(log)).to.deep.equal([
      'promotion/uat/preprod/2026-09-06-1',
      'promotion/uat/preprod/2026-09-06-2',
      'promotion/uat/preprod/2026-09-06-3',
      'promotion/uat/preprod/2026-09-06-4',
    ]);
  });

  it('names each promotion branch once and never returns something the convention rejects', () => {
    expect(extractPromotionBranchNames('promotion/uat/preprod/2026-09-06-1 and promotion/uat/preprod/2026-09-06-1')).to.deep.equal([
      PROMOTION_BRANCH,
    ]);
    // A five-segment name (a major branch holding a "/") is not a promotion branch, and neither is
    // a prefix without a counter
    expect(extractPromotionBranchNames('promotion/release/uat/preprod/2026-09-06-1')).to.deep.equal([]);
    expect(extractPromotionBranchNames('promotion/uat/preprod/2026-09-06')).to.deep.equal([]);
    expect(extractPromotionBranchNames('')).to.deep.equal([]);
    expect(extractPromotionBranchNames(null as any)).to.deep.equal([]);
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

  it('refuses a value holding more than one reference instead of keeping its last number', () => {
    // Written without brackets, yaml gives a single string: silently reading 487 would drop 482
    // from the scope of the deployment
    expect(parsePromotionPullRequestIds('```yaml\npromotionPullRequests: "482, 487"\n```')).to.deep.equal([]);
    expect(parsePromotionPullRequestIds('```yaml\npromotionPullRequests:\n  - "PR 482 (draft)"\n```')).to.deep.equal([]);
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
  it('needs the flag, the naming convention and the key', () => {
    expect(classifyPromotionPullRequest(pr({ sourceBranch: PROMOTION_BRANCH, description: DECLARATION }), ENABLED)).to.equal('promotion');
    expect(classifyPromotionPullRequest(pr({ sourceBranch: PROMOTION_BRANCH, description: 'no key' }), ENABLED)).to.equal('prefix-without-key');
    // Named by hand: not a promotion branch even with the key
    expect(classifyPromotionPullRequest(pr({ sourceBranch: 'promotion/2026-09', description: DECLARATION }), ENABLED)).to.equal('prefix-without-key');
    expect(classifyPromotionPullRequest(pr({ sourceBranch: 'feature/x', description: DECLARATION }), ENABLED)).to.equal('key-without-prefix');
    expect(classifyPromotionPullRequest(pr({ sourceBranch: 'feature/x', description: 'plain' }), ENABLED)).to.equal('none');
  });

  // The regression contract: a stray key or prefix on a project that did not opt in changes nothing
  it('classifies nothing when the feature is disabled', () => {
    expect(classifyPromotionPullRequest(pr({ sourceBranch: PROMOTION_BRANCH, description: DECLARATION }), DISABLED)).to.equal('none');
    expect(isPromotionPullRequest(pr({ sourceBranch: PROMOTION_BRANCH, description: DECLARATION }), DISABLED)).to.equal(false);
    expect(classifyPromotionPullRequest(null, ENABLED)).to.equal('none');
  });
});

describe('isPromotionPullRequestForItsTarget()', () => {
  it('refuses a promotion branch retargeted somewhere else', () => {
    const asNamed = pr({ sourceBranch: PROMOTION_BRANCH, targetBranch: 'preprod', description: DECLARATION });
    expect(isPromotionPullRequestForItsTarget(asNamed, ENABLED)).to.equal(true);
    // Opened against main instead of the preprod its name announces: the carried stories would run
    // their deployment actions in production
    const retargeted = pr({ sourceBranch: PROMOTION_BRANCH, targetBranch: 'main', description: DECLARATION });
    expect(isPromotionPullRequest(retargeted, ENABLED)).to.equal(true);
    expect(isPromotionPullRequestForItsTarget(retargeted, ENABLED)).to.equal(false);
    // Case is not significant, and an unknown target is not a mismatch
    expect(isPromotionPullRequestForItsTarget(pr({ sourceBranch: PROMOTION_BRANCH, targetBranch: 'PREPROD', description: DECLARATION }), ENABLED)).to.equal(true);
    expect(isPromotionPullRequestForItsTarget(pr({ sourceBranch: PROMOTION_BRANCH, targetBranch: '', description: DECLARATION }), ENABLED)).to.equal(true);
  });
});

describe('filterDeclaredPullRequests()', () => {
  const promotion = pr({ idNumber: 900, sourceBranch: PROMOTION_BRANCH, targetBranch: 'preprod', description: DECLARATION });

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
    expect(getCarriedBy(story)).to.deep.equal({ idStr: '900', idNumber: 900, sourceBranch: PROMOTION_BRANCH, webUrl: promotion.webUrl });
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
      pr({ idNumber: 900, sourceBranch: PROMOTION_BRANCH, targetBranch: 'preprod', description: DECLARATION }),
      pr({ idNumber: 482 }), // already in the window on its own
      pr({ idNumber: 901, sourceBranch: 'feature/other' }),
    ];
    const expanded = await expandPromotionPullRequests(window, ENABLED, fetchPullRequest);
    expect(expanded.map((entry) => entry.idNumber)).to.deep.equal([900, 482, 901, 487]);
    expect(getCarriedBy(expanded[3])?.idNumber).to.equal(900);
    expect(getCarriedBy(expanded[1])).to.equal(null);
  });

  it('follows a promotion that carries another promotion, down to the User Stories', async () => {
    // The shape a four level pipeline produces: preprod -> main carries the uat -> preprod
    // promotion, whose own declaration holds the stories
    const nestedPromotion = pr({ idNumber: 950, sourceBranch: 'promotion/uat/preprod/2026-09-05-1', description: '```yaml\npromotionPullRequests: [487]\n```' });
    const window = [pr({ idNumber: 900, sourceBranch: PROMOTION_BRANCH, description: '```yaml\npromotionPullRequests: [950]\n```' })];
    const expanded = await expandPromotionPullRequests(window, ENABLED, async (id) => (id === 950 ? nestedPromotion : stories.get(id) || null));
    expect(expanded.map((entry) => entry.idNumber)).to.deep.equal([900, 950, 487]);
  });

  it('returns the window untouched when the feature is disabled', async () => {
    const window = [pr({ idNumber: 900, sourceBranch: PROMOTION_BRANCH, description: DECLARATION })];
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
    const promotion = pr({ idNumber: 900, sourceBranch: PROMOTION_BRANCH, customBehaviors: { noDeltaDeployment: true } });
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

describe('expandPromotionPullRequests() with nested promotions', () => {
  it('follows a promotion that carries another promotion down to the User Stories', async () => {
    // The shape a four level pipeline produces: preprod -> main carries the uat -> preprod
    // promotion, which carries the stories
    const inner = pr({ idNumber: 900, sourceBranch: PROMOTION_BRANCH, targetBranch: 'preprod', description: DECLARATION });
    const outer = pr({
      idNumber: 901,
      sourceBranch: 'promotion/preprod/main/2026-09-10-1',
      targetBranch: 'main',
      description: '```yaml\npromotionPullRequests: [900]\n```',
    });
    const byId: Record<number, CommonPullRequestInfo> = {
      900: inner,
      482: pr({ idNumber: 482 }),
      487: pr({ idNumber: 487 }),
    };
    const expanded = await expandPromotionPullRequests([outer], ENABLED, async (id) => byId[id] || null);
    expect(expanded.map((entry) => entry.idNumber)).to.deep.equal([901, 900, 482, 487]);
  });
});

describe('findPromotionsCarrying() / buildAlreadyPromotedMarkdown()', () => {
  const merged = pr({ idNumber: 900, sourceBranch: PROMOTION_BRANCH, targetBranch: 'preprod', description: DECLARATION, mergedDate: '2026-09-02T09:00:00Z' });
  const open = pr({ idNumber: 901, sourceBranch: 'promotion/uat/preprod/2026-09-06-2', targetBranch: 'preprod', description: DECLARATION, mergedDate: undefined });
  const notPromotion = pr({ idNumber: 902, sourceBranch: 'feature/z', targetBranch: 'preprod', description: DECLARATION });

  it('finds the merged promotion Pull Requests declaring a story', () => {
    expect(findPromotionsCarrying(482, [merged, open, notPromotion], ENABLED).map((entry) => entry.idNumber)).to.deep.equal([900]);
    expect(findPromotionsCarrying(555, [merged], ENABLED)).to.deep.equal([]);
    expect(findPromotionsCarrying(482, [merged], DISABLED)).to.deep.equal([]);
  });

  it('parses each promotion description once, whatever the number of stories', () => {
    const index = buildPromotionIndex([merged, open, notPromotion], ENABLED);
    expect(findPromotionsCarryingIndexed(482, index).map((entry) => entry.idNumber)).to.deep.equal([900]);
    expect(findPromotionsCarryingIndexed(487, index).map((entry) => entry.idNumber)).to.deep.equal([900]);
    expect(findPromotionsCarryingIndexed(555, index)).to.deep.equal([]);
    expect(buildPromotionIndex([merged], DISABLED).size).to.equal(0);
  });

  it('renders one line per already promoted story, nothing when there is none', () => {
    const markdown = buildAlreadyPromotedMarkdown([
      { story: pr({ idNumber: 482 }), promotions: [merged] },
      { story: pr({ idNumber: 487 }), promotions: [] },
    ]);
    expect(markdown).to.contain(`[#482](https://git.example.com/pr/482) already deployed via \`${PROMOTION_BRANCH}\` ([#900](https://git.example.com/pr/900), into \`preprod\` on 2026-09-02)`);
    expect(markdown).to.not.contain('#487');
    expect(buildAlreadyPromotedMarkdown([{ story: pr({ idNumber: 487 }), promotions: [] }])).to.equal('');
  });
});
