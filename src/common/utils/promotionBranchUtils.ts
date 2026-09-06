import c from 'chalk';
import * as yaml from 'js-yaml';
import { CommonPullRequestInfo } from '../gitProvider/index.js';
import { uxLog } from './index.js';
import { t } from './i18n.js';

/**
 * Promotion branches: a branch assembled by cherry-picking approved User Stories from a major
 * branch (ex: uat), so they reach the next major branch (ex: preprod) before the rest of the
 * promotion window. The cherry-picked commits carry new SHAs, so the Pull Request scope, which
 * matches merged Pull Requests by merge commit SHA, cannot find the stories. The promotion Pull
 * Request declares them instead, in a YAML block of its description:
 *
 * ```yaml
 * promotionPullRequests: [482, 487, 491]
 * ```
 *
 * Everything here is pure logic over config and Pull Request data: no git, no provider call, so
 * the CLI and the VS Code extension can apply the same rules. Nothing in this module has any
 * effect while `enablePromotionBranches` is false.
 */

export const PROMOTION_PULL_REQUESTS_KEY = 'promotionPullRequests';
export const PROMOTION_BRANCH_PREFIX = 'promotion';
// promotion/<source major branch>/<target major branch>/<YYYY-MM-DD>-<counter>
export const PROMOTION_BRANCH_NAME_EXAMPLE = 'promotion/uat/preprod/2026-09-06-1';

export interface PromotionBranchConfig {
  enabled: boolean;
}

export interface PromotionBranchNameParts {
  sourceBranch: string;
  targetBranch: string;
  date: string;
  counter: number;
}

/**
 * How a Pull Request relates to the promotion branch feature.
 * - promotion: prefixed branch carrying a declared list, the feature applies
 * - prefix-without-key: named like a promotion branch but declares nothing, treated as a feature branch
 * - key-without-prefix: declares a list on an ordinary branch, the list is ignored
 * - none: not concerned
 */
export type PromotionPullRequestKind = 'promotion' | 'prefix-without-key' | 'key-without-prefix' | 'none';

export type InheritedCustomBehavior = {
  behavior: keyof CommonPullRequestInfo['customBehaviors'];
  keyword: string;
  fromPullRequests: string[];
};

const CUSTOM_BEHAVIOR_KEYWORDS: Record<keyof CommonPullRequestInfo['customBehaviors'], string> = {
  noDeltaDeployment: 'NO_DELTA',
  purgeFlowVersions: 'PURGE_FLOW_VERSIONS',
  destructiveChangesAfterDeployment: 'DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT',
  flowDeleteInterviews: 'FLOW_DELETE_INTERVIEWS',
};

export function getPromotionBranchConfig(config: any): PromotionBranchConfig {
  return {
    enabled: config?.enablePromotionBranches === true,
  };
}

/**
 * Split a promotion branch name into its parts. The convention is not configurable:
 * promotion/<source major branch>/<target major branch>/<YYYY-MM-DD>-<counter>, so the name
 * alone says where the stories come from and where they go, and two promotions assembled the
 * same day do not collide. Returns null for anything else, including a bare "promotion/xxx".
 */
export function parsePromotionBranchName(branchName: string): PromotionBranchNameParts | null {
  const segments = (branchName || '').trim().split('/');
  if (segments.length !== 4 || segments[0].toLowerCase() !== PROMOTION_BRANCH_PREFIX) {
    return null;
  }
  const [, sourceBranch, targetBranch, suffix] = segments;
  const suffixMatch = suffix.match(/^(\d{4}-\d{2}-\d{2})-(\d+)$/);
  if (!sourceBranch || !targetBranch || !suffixMatch) {
    return null;
  }
  return {
    sourceBranch,
    targetBranch,
    date: suffixMatch[1],
    counter: parseInt(suffixMatch[2], 10),
  };
}

/**
 * True for a branch following the promotion/<source>/<target>/<YYYY-MM-DD>-<counter> convention.
 */
export function isPromotionBranchName(branchName: string): boolean {
  return parsePromotionBranchName(branchName) !== null;
}

/**
 * True for a branch that starts with promotion/ but does not follow the convention: named
 * like a promotion branch by hand, it is treated as an ordinary feature branch with a warning.
 */
export function hasPromotionPrefixOnly(branchName: string): boolean {
  const name = (branchName || '').trim().toLowerCase();
  return name.startsWith(PROMOTION_BRANCH_PREFIX + '/') && !isPromotionBranchName(branchName);
}

/**
 * Build a promotion branch name, with today's date unless given. The counter separates the
 * promotions assembled the same day between the same branches (1, 2, 3...).
 */
export function buildPromotionBranchName(sourceBranch: string, targetBranch: string, counter: number, date: Date = new Date()): string {
  const day = date.toISOString().substring(0, 10);
  return `${PROMOTION_BRANCH_PREFIX}/${sourceBranch}/${targetBranch}/${day}-${Math.max(1, Math.floor(counter))}`;
}

/**
 * Pull Request numbers declared in the YAML block of a Pull Request description.
 * Accepts numbers and strings ("482", "#482", "!482", "PR 482"), ignores anything else, and
 * returns null when the key is absent, so the caller can tell "not declared" from "declared empty".
 */
export function parsePromotionPullRequestIds(description: string | null | undefined): number[] | null {
  const yamlBlocks = extractYamlBlocks(description || '');
  let found = false;
  const ids: number[] = [];
  for (const block of yamlBlocks) {
    let parsed: any;
    try {
      parsed = yaml.load(block);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || !Object.prototype.hasOwnProperty.call(parsed, PROMOTION_PULL_REQUESTS_KEY)) {
      continue;
    }
    found = true;
    const rawList = parsed[PROMOTION_PULL_REQUESTS_KEY];
    const items = Array.isArray(rawList) ? rawList : rawList == null ? [] : [rawList];
    for (const item of items) {
      const id = normalizePullRequestId(item);
      if (id !== null && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }
  return found ? ids : null;
}

function normalizePullRequestId(item: any): number | null {
  if (typeof item === 'number') {
    return Number.isInteger(item) && item > 0 ? item : null;
  }
  if (typeof item === 'string') {
    const match = item.trim().match(/(\d+)\s*$/);
    if (match) {
      const id = parseInt(match[1], 10);
      return id > 0 ? id : null;
    }
  }
  return null;
}

// Every ```yaml fenced block of a description, not only the first: the release manager may keep
// the promotion list apart from the deploymentApexTestClasses block.
function extractYamlBlocks(description: string): string[] {
  const blocks: string[] = [];
  const regex = /```ya?ml\s*\r?\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(description)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

export function classifyPromotionPullRequest(
  pr: Pick<CommonPullRequestInfo, 'sourceBranch' | 'description'> | null | undefined,
  config: PromotionBranchConfig,
): PromotionPullRequestKind {
  if (!config.enabled || !pr) {
    return 'none';
  }
  const hasValidName = isPromotionBranchName(pr.sourceBranch);
  const declaredIds = parsePromotionPullRequestIds(pr.description);
  if (hasValidName && declaredIds !== null) {
    return 'promotion';
  }
  if (hasValidName || hasPromotionPrefixOnly(pr.sourceBranch)) {
    return 'prefix-without-key';
  }
  if (declaredIds !== null) {
    return 'key-without-prefix';
  }
  return 'none';
}

export function isPromotionPullRequest(
  pr: Pick<CommonPullRequestInfo, 'sourceBranch' | 'description'> | null | undefined,
  config: PromotionBranchConfig,
): boolean {
  return classifyPromotionPullRequest(pr, config) === 'promotion';
}

/**
 * Log the cases where the feature is nearly, but not, applicable. Silent when nothing looks like
 * a promotion branch, so ordinary jobs keep their exact output.
 */
export function warnAboutPromotionPullRequestMisuse(pr: CommonPullRequestInfo | null, config: PromotionBranchConfig): void {
  if (!pr) {
    return;
  }
  if (!config.enabled) {
    if (hasPromotionPrefixOnly(pr.sourceBranch) || isPromotionBranchName(pr.sourceBranch) || parsePromotionPullRequestIds(pr.description) !== null) {
      uxLog('log', null, c.grey('[PromotionBranch] ' + t('promotionBranchFeatureDisabled', { pr: pr.idStr })));
    }
    return;
  }
  const kind = classifyPromotionPullRequest(pr, config);
  if (kind === 'prefix-without-key' && hasPromotionPrefixOnly(pr.sourceBranch)) {
    // Named by hand without the convention: the declared list, if any, is ignored too
    uxLog('warning', null, c.yellow('[PromotionBranch] ' + t('promotionBranchNameInvalid', { branch: pr.sourceBranch, example: PROMOTION_BRANCH_NAME_EXAMPLE })));
  } else if (kind === 'prefix-without-key') {
    uxLog('warning', null, c.yellow('[PromotionBranch] ' + t('promotionBranchWithoutDeclaredScope', { branch: pr.sourceBranch, key: PROMOTION_PULL_REQUESTS_KEY })));
  } else if (kind === 'key-without-prefix') {
    uxLog('warning', null, c.yellow('[PromotionBranch] ' + t('promotionKeyOnNonPromotionBranch', { branch: pr.sourceBranch, key: PROMOTION_PULL_REQUESTS_KEY, example: PROMOTION_BRANCH_NAME_EXAMPLE })));
  } else if (kind === 'promotion') {
    // The name announces the target: say so when the Pull Request goes somewhere else
    const parts = parsePromotionBranchName(pr.sourceBranch)!;
    if (pr.targetBranch && parts.targetBranch.toLowerCase() !== pr.targetBranch.toLowerCase()) {
      uxLog('warning', null, c.yellow('[PromotionBranch] ' + t('promotionBranchTargetMismatch', { branch: pr.sourceBranch, expected: parts.targetBranch, actual: pr.targetBranch })));
    }
  }
}

/**
 * Validate the declared Pull Requests once fetched: a missing one (typo, deleted, other
 * repository) and one still open (its content cannot be in the branch) are skipped with a
 * warning, never an error. The release manager's list is otherwise taken as is.
 */
export function filterDeclaredPullRequests(
  declaredIds: number[],
  fetched: Map<number, CommonPullRequestInfo | null>,
  promotionPr: CommonPullRequestInfo,
): CommonPullRequestInfo[] {
  const kept: CommonPullRequestInfo[] = [];
  for (const id of declaredIds) {
    const pr = fetched.get(id) || null;
    if (!pr) {
      uxLog('warning', null, c.yellow('[PromotionBranch] ' + t('promotionDeclaredPrNotFound', { id, pr: promotionPr.idStr })));
      continue;
    }
    if (!pr.mergedDate) {
      uxLog('warning', null, c.yellow('[PromotionBranch] ' + t('promotionDeclaredPrNotMerged', { id, pr: promotionPr.idStr })));
      continue;
    }
    if (pr.idNumber === promotionPr.idNumber) {
      continue;
    }
    kept.push(markCarriedBy(pr, promotionPr));
  }
  return kept;
}

/**
 * A story reached through a promotion Pull Request keeps a pointer to it, so the scope paragraph
 * and the job log can say where it comes from. Stored on providerInfo to leave the common type
 * untouched for the providers.
 */
export function markCarriedBy(pr: CommonPullRequestInfo, promotionPr: CommonPullRequestInfo): CommonPullRequestInfo {
  pr.providerInfo = pr.providerInfo || {};
  pr.providerInfo.sfdxHardisCarriedBy = {
    idStr: promotionPr.idStr,
    idNumber: promotionPr.idNumber,
    sourceBranch: promotionPr.sourceBranch,
    webUrl: promotionPr.webUrl,
  };
  return pr;
}

export function getCarriedBy(pr: CommonPullRequestInfo): { idStr: string; idNumber: number; sourceBranch: string; webUrl: string } | null {
  return pr?.providerInfo?.sfdxHardisCarriedBy || null;
}

/**
 * One-level expansion of a promotion window: every promotion Pull Request found in it brings the
 * stories it declares, so a later `preprod -> main` merge replays their actions and test classes
 * in production even though their cherry-picked commits never matched by SHA.
 * Deliberately one level only: a promotion branch built from another promotion branch is not a
 * supported layout, and recursion would make the scope depend on the whole history.
 */
export async function expandPromotionPullRequests(
  pullRequests: CommonPullRequestInfo[],
  config: PromotionBranchConfig,
  fetchPullRequest: (id: number) => Promise<CommonPullRequestInfo | null>,
): Promise<CommonPullRequestInfo[]> {
  if (!config.enabled) {
    return pullRequests;
  }
  const result: CommonPullRequestInfo[] = [...pullRequests];
  const known = new Set(pullRequests.map((pr) => pr.idNumber));
  for (const pr of pullRequests) {
    if (!isPromotionPullRequest(pr, config)) {
      continue;
    }
    const declaredIds = parsePromotionPullRequestIds(pr.description) || [];
    const fetched = new Map<number, CommonPullRequestInfo | null>();
    for (const id of declaredIds) {
      if (known.has(id)) {
        continue; // already in the window on its own, nothing to add
      }
      fetched.set(id, await fetchPullRequest(id));
    }
    const carried = filterDeclaredPullRequests([...fetched.keys()], fetched, pr);
    for (const story of carried) {
      known.add(story.idNumber);
      result.push(story);
    }
    if (carried.length > 0) {
      uxLog('log', null, c.grey('[PromotionBranch] ' + t('promotionWindowExpanded', {
        pr: pr.idStr,
        count: carried.length,
        prList: carried.map((story) => `#${story.idStr}`).join(', '),
      })));
    }
  }
  return result;
}

/**
 * The promotion Pull Request inherits the custom behaviors of the stories it carries (OR): what a
 * story declared, it needs in every org it reaches. Mutates `target` in place, which is the object
 * shared through GitProvider.getPullRequestInfo({ useCache: true }), and returns what was inherited
 * with its origin so the check comment can say where each keyword came from.
 */
export function mergeInheritedCustomBehaviors(
  target: CommonPullRequestInfo,
  sources: CommonPullRequestInfo[],
): InheritedCustomBehavior[] {
  const inherited: InheritedCustomBehavior[] = [];
  target.customBehaviors = target.customBehaviors || {};
  for (const behavior of Object.keys(CUSTOM_BEHAVIOR_KEYWORDS) as Array<keyof CommonPullRequestInfo['customBehaviors']>) {
    const fromPullRequests = sources
      .filter((source) => source.idNumber !== target.idNumber && source.customBehaviors?.[behavior] === true)
      .map((source) => source.idStr);
    if (fromPullRequests.length === 0) {
      continue;
    }
    // Already set on the promotion Pull Request itself: nothing inherited, nothing to report
    if (target.customBehaviors[behavior] === true) {
      continue;
    }
    target.customBehaviors[behavior] = true;
    inherited.push({ behavior, keyword: CUSTOM_BEHAVIOR_KEYWORDS[behavior], fromPullRequests });
  }
  return inherited;
}

/**
 * Markdown line for the check comment listing the inherited keywords with their origin.
 */
export function buildInheritedBehaviorsMarkdown(inherited: InheritedCustomBehavior[], pullRequests: CommonPullRequestInfo[]): string {
  if (inherited.length === 0) {
    return '';
  }
  const linkFor = (idStr: string): string => {
    const pr = pullRequests.find((candidate) => candidate.idStr === idStr);
    return pr?.webUrl ? `[#${idStr}](${pr.webUrl})` : `#${idStr}`;
  };
  const items = inherited.map((item) => `\`${item.keyword}\` inherited from ${item.fromPullRequests.map(linkFor).join(', ')}`);
  return `ℹ️ Custom behaviors inherited from the carried Pull Requests: ${items.join('; ')}.`;
}

/**
 * Promotion Pull Requests (merged into the target of a window, or any branch downstream) that
 * declare a given story: the story has already been shipped there. Used to annotate promotion
 * windows, never to remove the story from them: its original merge commit is still to be
 * promoted, and its actions are idempotent through their state comment.
 */
export function findPromotionsCarrying(
  storyIdNumber: number,
  promotionPullRequests: CommonPullRequestInfo[],
  config: PromotionBranchConfig,
): CommonPullRequestInfo[] {
  return findPromotionsCarryingIndexed(storyIdNumber, buildPromotionIndex(promotionPullRequests, config));
}

/**
 * The declarations of every merged promotion Pull Request, parsed once. A pipeline with a
 * thousand Pull Requests would otherwise parse the same YAML blocks once per story.
 */
export type PromotionIndex = Map<number, CommonPullRequestInfo[]>;

export function buildPromotionIndex(
  promotionPullRequests: CommonPullRequestInfo[],
  config: PromotionBranchConfig,
): PromotionIndex {
  const index: PromotionIndex = new Map();
  if (!config.enabled) {
    return index;
  }
  for (const pr of promotionPullRequests) {
    if (!isPromotionPullRequest(pr, config) || !pr.mergedDate) {
      continue;
    }
    for (const storyIdNumber of parsePromotionPullRequestIds(pr.description) || []) {
      const carriers = index.get(storyIdNumber) || [];
      if (!carriers.some((carrier) => carrier.idNumber === pr.idNumber)) {
        carriers.push(pr);
      }
      index.set(storyIdNumber, carriers);
    }
  }
  return index;
}

export function findPromotionsCarryingIndexed(storyIdNumber: number, index: PromotionIndex): CommonPullRequestInfo[] {
  return index.get(storyIdNumber) || [];
}

/**
 * Markdown sentence appended to the scope paragraph of a promotion window: which stories of the
 * window were already deployed through a promotion branch, and where.
 */
export function buildAlreadyPromotedMarkdown(
  entries: Array<{ story: CommonPullRequestInfo; promotions: CommonPullRequestInfo[] }>,
): string {
  const lines = entries
    .filter((entry) => entry.promotions.length > 0)
    .map((entry) => {
      const storyLink = entry.story.webUrl ? `[#${entry.story.idStr}](${entry.story.webUrl})` : `#${entry.story.idStr}`;
      const via = entry.promotions
        .map((promotion) => {
          const link = promotion.webUrl ? `[#${promotion.idStr}](${promotion.webUrl})` : `#${promotion.idStr}`;
          const date = promotion.mergedDate ? ` on ${String(promotion.mergedDate).substring(0, 10)}` : '';
          return `\`${promotion.sourceBranch}\` (${link}, into \`${promotion.targetBranch}\`${date})`;
        })
        .join(', ');
      return `- ${storyLink} already deployed via ${via}`;
    });
  if (lines.length === 0) {
    return '';
  }
  return `ℹ️ Some Pull Requests of this promotion window were already deployed through a promotion branch. Their metadata is redeployed as a no-op and their actions are skipped where already performed:\n${lines.join('\n')}`;
}
