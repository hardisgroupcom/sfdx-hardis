/**
 * Keywords that change a deployment when written in a Pull Request description or in the latest
 * commit (NO_DELTA, nosmart, PURGE_FLOW_VERSIONS, DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT).
 * They match in any case, with their words joined by "_", "-", a space or nothing:
 * NO_DELTA, no_delta, No-Delta, no delta and nodelta are the same keyword.
 */
export type DeploymentKeyword = 'noDelta' | 'noSmart' | 'purgeFlowVersions' | 'destructiveChangesAfterDeployment';

const DEPLOYMENT_KEYWORD_WORDS: Record<DeploymentKeyword, string[]> = {
  noDelta: ['no', 'delta'],
  noSmart: ['no', 'smart'],
  purgeFlowVersions: ['purge', 'flow', 'versions'],
  destructiveChangesAfterDeployment: ['destructive', 'changes', 'after', 'deployment'],
};

const KEYWORD_REGEXES: Record<DeploymentKeyword, RegExp> = Object.fromEntries(
  Object.entries(DEPLOYMENT_KEYWORD_WORDS).map(([keyword, words]) => [keyword, buildKeywordRegex(words)])
) as Record<DeploymentKeyword, RegExp>;

/**
 * True when the text contains the keyword, in any case, not inside a longer word.
 * "_" is not part of a word here, so NO_DELTA_UAT and NO_DELTA=true still match.
 */
export function containsDeploymentKeyword(text: string | null | undefined, keyword: DeploymentKeyword): boolean {
  return KEYWORD_REGEXES[keyword].test(text || '');
}

/**
 * True when the subject (message) or the body of a commit contains the keyword.
 */
export function commitContainsDeploymentKeyword(
  commit: { message?: string; body?: string } | null | undefined,
  keyword: DeploymentKeyword
): boolean {
  return containsDeploymentKeyword(commit?.message, keyword) || containsDeploymentKeyword(commit?.body, keyword);
}

/**
 * True when a Pull Request description contains the keyword outside HTML comments, fenced code
 * blocks and indented code lines, so a PR template listing the keywords does not apply them.
 */
export function descriptionContainsDeploymentKeyword(
  description: string | null | undefined,
  keyword: DeploymentKeyword
): boolean {
  const meaningfulText = stripMarkdownCommentsAndFences(description || '')
    .split(/\r?\n/)
    .filter((rawLine) => !isIndentedCodeLine(rawLine))
    .join('\n');
  return containsDeploymentKeyword(meaningfulText, keyword);
}

/**
 * Removes HTML comments and fenced code blocks from markdown. An unclosed comment or fence hides
 * everything after it.
 */
export function stripMarkdownCommentsAndFences(text: string): string {
  return (text || '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, '');
}

function buildKeywordRegex(words: string[]): RegExp {
  return new RegExp(`(?<![a-z0-9])${words.join('[ \\t_-]?')}(?![a-z0-9])`, 'i');
}

// A line indented by a tab or 4 spaces is code, unless it is an item of a nested list
function isIndentedCodeLine(rawLine: string): boolean {
  if (!/^(?:\t| {4})/.test(rawLine)) {
    return false;
  }
  return !/^(?:[-*+]|\d+[.)])\s/.test(rawLine.trim());
}
