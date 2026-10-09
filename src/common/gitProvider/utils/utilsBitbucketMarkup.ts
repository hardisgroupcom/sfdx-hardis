import { rewordTickSentences } from './utilsPrCommentWording.js';

// Bitbucket Cloud escapes raw HTML in comments and descriptions: an HTML comment, a <details> block
// or a <br/> is displayed as it is written. sfdx-hardis writes its comments once, for every provider,
// with hidden markers (<!-- ... -->) that carry what the next job reads back, folded sections and
// line breaks in table cells. These two functions sit at the door of the Bitbucket provider: what
// goes out is rewritten in the markdown Bitbucket draws, what comes back gets its markers again,
// so nothing else in sfdx-hardis knows the difference.

/**
 * What is being sent:
 * - comment: a comment sfdx-hardis writes and owns, rewritten in full;
 * - newDescription: the description of a Pull Request sfdx-hardis creates (a promotion): its markers
 *   and its folded sections, nothing a person would have typed;
 * - description: the description of a Pull Request a person wrote, where sfdx-hardis only adds its
 *   navigation: its own markers are hidden and nothing else is touched.
 */
export type BitbucketMarkupKind = 'comment' | 'newDescription' | 'description';

// A marker becomes a link with no text: Bitbucket draws an anchor nobody sees, wherever it sits,
// a table cell included. The content travels in the fragment of the link, percent-encoded, or in
// base64url when that is shorter (a JSON payload triples once percent-encoded).
const HIDDEN_MARKER_REGEX = /\[\]\(#hardis(64)?:([^)\s]*)\)/g;
const HTML_COMMENT_REGEX = /<!--([\s\S]*?)-->/g;
const HARDIS_HTML_COMMENT_REGEX = /<!--(\s*sfdx-hardis[\s\S]*?)-->/g;
// Bitbucket Cloud draws a task item as a plain bullet, and nobody can tick it there: the item shows
// a box symbol instead, and the sentences asking to tick a box (utilsPrCommentWording.ts) name what
// does work on Bitbucket.
const TASK_ITEM_REGEX = /^(\s*[-*] )\[([ xX])\] /gm;
const BOX_ITEM_REGEX = /^(\s*[-*] )([☐☑]) /gm;
const MARK_THEM_AS_DONE = 'Do the steps below in the org, mark them as done, then run the validation again.';
const COMMENT_IS_REWRITTEN = 'This comment is rewritten by sfdx-hardis: do not edit it.';
const NO_BOX_TO_TICK =
  'Once it is done in the org, mark it as done with `sf hardis:project:action:set-status` or the **Mark as done** button of the Deployment Actions tab in VS Code (a box cannot be ticked in a Bitbucket comment).';
// A fence opens a block only when the line does not close it too (```one line```)
const CODE_FENCE_REGEX = /^\s*(`{3,}|~{3,})(?!.*\1)/;
const INLINE_CODE_REGEX = /(`+)(?!`)[^\n]*?[^`\n]\1(?!`)/g;
// Stands for a code span while the transform runs: a private use character, which no comment holds
const INLINE_CODE_PLACEHOLDER_REGEX = /\uE000(\d+)\uE000/g;

/**
 * Rewrites a comment or a description for Bitbucket Cloud:
 * - an HTML comment becomes a hidden marker;
 * - a folded section becomes its summary in bold followed by its content, since nothing folds there;
 * - a line break tag becomes a space, a bold tag becomes markdown bold;
 * - a task item shows a box symbol, since Bitbucket draws no checkbox and nobody can tick one.
 * Code, in a block or in a line, is left as it is: what it holds is shown as text on every provider.
 * A description gets less of it, see BitbucketMarkupKind.
 */
export function toBitbucketMarkup(body: string, kind: BitbucketMarkupKind = 'comment'): string {
  if (!body) {
    return body;
  }
  return mapOutsideCode(body, (text) => {
    if (kind === 'description') {
      return text.replace(HARDIS_HTML_COMMENT_REGEX, (_match, content: string) => encodeHiddenMarker(content));
    }
    let result = text;
    if (kind === 'comment') {
      result = rewordTickSentences(result, { tickHint: NO_BOX_TO_TICK, tickThenValidateAgain: MARK_THEM_AS_DONE, onlyBoxesAreEdited: COMMENT_IS_REWRITTEN })
        .replace(HTML_COMMENT_REGEX, (_match, content: string) => encodeHiddenMarker(content))
        .replace(TASK_ITEM_REGEX, (_match, bullet: string, state: string) => `${bullet}${state === ' ' ? '☐' : '☑'} `);
    } else {
      result = result.replace(HARDIS_HTML_COMMENT_REGEX, (_match, content: string) => encodeHiddenMarker(content));
    }
    return result
      .replace(/<summary>([\s\S]*?)<\/summary>/gi, (_match, summary: string) => `\n\n**${plainSummary(summary)}**\n\n`)
      .replace(/<\/?details[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<b>([\s\S]*?)<\/b>/gi, (_match, bold: string) => `**${bold.trim()}**`)
      .replace(/\n{3,}/g, '\n\n');
  });
}

/**
 * Gives back to a comment or a description read from Bitbucket Cloud the HTML comments its hidden
 * markers stand for, and its task items. Text written before the markers existed, with its HTML
 * comments as they were, comes back unchanged.
 */
export function fromBitbucketMarkup(raw: string): string {
  if (!raw) {
    return raw;
  }
  return raw
    .replace(HIDDEN_MARKER_REGEX, (_match, base64: string | undefined, encoded: string) => `<!-- ${decodeHiddenMarker(encoded, base64 === '64')} -->`)
    .replace(BOX_ITEM_REGEX, (_match, bullet: string, box: string) => `${bullet}[${box === '☑' ? 'x' : ' '}] `);
}

// Applies a transform to what is not code: fenced blocks are skipped, and code spans inside a line
// are set aside while the transform runs, then put back.
function mapOutsideCode(body: string, transform: (text: string) => string): string {
  const lines = body.split('\n');
  const result: string[] = [];
  let outside: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (outside.length > 0) {
      result.push(mapOutsideInlineCode(outside.join('\n'), transform));
      outside = [];
    }
  };
  for (const line of lines) {
    const match = line.match(CODE_FENCE_REGEX);
    if (fence === null) {
      if (match) {
        flush();
        fence = match[1];
        result.push(line);
      } else {
        outside.push(line);
      }
      continue;
    }
    result.push(line);
    // A block closes on a fence of the same character, at least as long as the one that opened it
    const closing = line.match(/^\s*(`{3,}|~{3,})\s*$/);
    if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) {
      fence = null;
    }
  }
  flush();
  return result.join('\n');
}

function mapOutsideInlineCode(text: string, transform: (text: string) => string): string {
  const spans: string[] = [];
  const withoutSpans = text.replace(INLINE_CODE_REGEX, (span) => {
    spans.push(span);
    return `\uE000${spans.length - 1}\uE000`;
  });
  return transform(withoutSpans).replace(INLINE_CODE_PLACEHOLDER_REGEX, (_match, index: string) => spans[Number(index)]);
}

function encodeHiddenMarker(content: string): string {
  const text = content.trim();
  // encodeURIComponent leaves the characters markdown gives a meaning to: they are escaped too
  const percent = encodeURIComponent(text).replace(/[!'()*_~]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase());
  const base64 = Buffer.from(text, 'utf8').toString('base64url');
  return base64.length < percent.length ? `[](#hardis64:${base64})` : `[](#hardis:${percent})`;
}

function decodeHiddenMarker(encoded: string, base64: boolean): string {
  try {
    return base64 ? Buffer.from(encoded, 'base64url').toString('utf8') : decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

// The summary of a folded section, without the bold it may already carry
function plainSummary(summary: string): string {
  return summary
    .replace(/<\/?b>/gi, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
