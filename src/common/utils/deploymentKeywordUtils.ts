/**
 * Keywords that change a deployment when written in a Pull Request description or in the latest
 * commit. They all match in any case.
 * - NO_DELTA and nosmart also accept their words joined by "-", a space or nothing: NO_DELTA,
 *   no_delta, No-Delta, no delta and nodelta are the same keyword.
 * - PURGE_FLOW_VERSIONS and DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT start destructive steps, so they
 *   keep their underscores: a sentence like "we do not purge flow versions" must not trigger them.
 * A keyword inside a path or a branch name (fix/no-delta-detection, flows/Purge_Flow_Versions.flow-meta.xml)
 * does not count, neither does one inside an HTML comment or a fenced code block.
 */
export type DeploymentKeyword = 'noDelta' | 'noSmart' | 'purgeFlowVersions' | 'destructiveChangesAfterDeployment';

export const DEPLOYMENT_KEYWORD_LABELS: Record<DeploymentKeyword, string> = {
  noDelta: 'NO_DELTA',
  noSmart: 'nosmart',
  purgeFlowVersions: 'PURGE_FLOW_VERSIONS',
  destructiveChangesAfterDeployment: 'DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT',
};

const LOOSE_JOINER = '[ \\t_-]?';
const UNDERSCORE_JOINER = '_';

const KEYWORD_REGEXES: Record<DeploymentKeyword, RegExp> = {
  noDelta: buildKeywordRegex(['no', 'delta'], LOOSE_JOINER),
  noSmart: buildKeywordRegex(['no', 'smart'], LOOSE_JOINER),
  purgeFlowVersions: buildKeywordRegex(['purge', 'flow', 'versions'], UNDERSCORE_JOINER),
  destructiveChangesAfterDeployment: buildKeywordRegex(['destructive', 'changes', 'after', 'deployment'], UNDERSCORE_JOINER),
};

/**
 * True when the subject (message) or the body of a commit contains the keyword, outside HTML
 * comments and fenced code blocks: some git providers copy the Pull Request description, template
 * included, into the merge commit.
 */
export function commitContainsDeploymentKeyword(
  commit: { message?: string; body?: string } | null | undefined,
  keyword: DeploymentKeyword
): boolean {
  return (
    containsDeploymentKeyword(stripMarkdownCommentsAndFences(commit?.message || ''), keyword) ||
    containsDeploymentKeyword(stripMarkdownCommentsAndFences(commit?.body || ''), keyword)
  );
}

/**
 * Removes HTML comments and fenced code blocks (``` or ~~~, 3 or more, closed by a fence at least as
 * long) from markdown. An unclosed comment or fence hides everything after it.
 */
export function stripMarkdownCommentsAndFences(text: string): string {
  return (text || '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/(^|\n)[ \t]*(`{3,}|~{3,})[\s\S]*?(?:\n[ \t]*\2[`~]*[ \t]*(?=\n|$)|$)/g, '$1');
}

/**
 * True when the text contains the keyword, in any case, outside a longer word, a path or a branch
 * name. "_" after the keyword is allowed, so NO_DELTA_UAT still matches.
 */
export function containsDeploymentKeyword(text: string | null | undefined, keyword: DeploymentKeyword): boolean {
  return KEYWORD_REGEXES[keyword].test(text || '');
}

function buildKeywordRegex(words: string[], joiner: string): RegExp {
  // Before: not a letter, a digit or "/", nor "-", "." or "_" glued to a word (feature-no-delta, X_NO_DELTA)
  const before = '(?<![a-z0-9/]|[a-z0-9][-._])';
  // After: not a letter or a digit, nor "-", "." or "/" followed by more of a name (no-delta-fix, Versions.flow)
  const after = '(?![a-z0-9]|[-./][a-z0-9])';
  return new RegExp(`${before}${words.join(joiner)}${after}`, 'i');
}
