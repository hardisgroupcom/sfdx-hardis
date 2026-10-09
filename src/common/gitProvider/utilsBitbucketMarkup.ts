import { rewordTickSentences } from './utilsPrCommentWording.js';

// Bitbucket Cloud escapes raw HTML in comments and descriptions: an HTML comment, a <details> block
// or a <br/> is displayed as it is written. sfdx-hardis writes its comments once, for every provider,
// with hidden markers (<!-- ... -->) that carry what the next job reads back, folded sections and
// line breaks in table cells. These two functions sit at the door of the Bitbucket provider: what
// goes out is rewritten in the markdown Bitbucket draws, what comes back gets its markers again,
// so nothing else in sfdx-hardis knows the difference.

// A marker becomes a link with no text: Bitbucket draws an anchor nobody sees, wherever it sits,
// a table cell included. The content travels in the fragment of the link.
const HIDDEN_MARKER_PREFIX = '#hardis:';
const HIDDEN_MARKER_REGEX = /\[\]\(#hardis:([^)\s]*)\)/g;
const HTML_COMMENT_REGEX = /<!--([\s\S]*?)-->/g;
// Bitbucket Cloud draws a task item as a plain bullet, and nobody can tick it there: the item shows
// a box symbol instead, and the sentences asking to tick a box (utilsPrCommentLayout.ts and
// deploymentActionsStateUtils.ts write them) name what does work on Bitbucket.
const TASK_ITEM_REGEX = /^(\s*[-*] )\[([ xX])\] /gm;
const BOX_ITEM_REGEX = /^(\s*[-*] )([\u2610\u2611]) /gm;
const MARK_THEM_AS_DONE = 'Do the steps below in the org, mark them as done, then run the validation again.';
const COMMENT_IS_REWRITTEN = 'This comment is rewritten by sfdx-hardis: do not edit it.';
const NO_BOX_TO_TICK =
  'Once it is done in the org, mark it as done with `sf hardis:project:action:set-status` or the **Mark as done** button of the Deployment Actions tab in VS Code (a box cannot be ticked in a Bitbucket comment).';
const CODE_FENCE_REGEX = /^\s*(`{3,}|~{3,})/;

/**
 * Rewrites a comment or a description for Bitbucket Cloud:
 * - an HTML comment becomes a hidden marker;
 * - a folded section becomes its summary in bold followed by its content, since nothing folds there;
 * - a line break tag becomes a space, a bold tag becomes markdown bold;
 * - a task item shows a box symbol, since Bitbucket draws no checkbox and nobody can tick one.
 * Code blocks are left as they are: what they hold is shown as text on every provider.
 */
export function toBitbucketMarkup(body: string): string {
  if (!body) {
    return body;
  }
  return mapOutsideCodeBlocks(body, (text) =>
    rewordTickSentences(text, { tickHint: NO_BOX_TO_TICK, tickThenValidateAgain: MARK_THEM_AS_DONE, onlyBoxesAreEdited: COMMENT_IS_REWRITTEN })
      .replace(HTML_COMMENT_REGEX, (_match, content: string) => encodeHiddenMarker(content))
      .replace(TASK_ITEM_REGEX, (_match, bullet: string, state: string) => `${bullet}${state === ' ' ? '\u2610' : '\u2611'} `)
      .replace(/<summary>([\s\S]*?)<\/summary>/gi, (_match, summary: string) => `\n\n**${plainSummary(summary)}**\n\n`)
      .replace(/<\/?details[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<b>([\s\S]*?)<\/b>/gi, (_match, bold: string) => `**${bold.trim()}**`)
      .replace(/\n{3,}/g, '\n\n'),
  );
}

/**
 * Gives back to a comment or a description read from Bitbucket Cloud the HTML comments its hidden
 * markers stand for. Text written before the markers existed, with its HTML comments as they were,
 * comes back unchanged.
 */
export function fromBitbucketMarkup(raw: string): string {
  if (!raw) {
    return raw;
  }
  return raw
    .replace(HIDDEN_MARKER_REGEX, (_match, encoded: string) => `<!-- ${decodeHiddenMarker(encoded)} -->`)
    .replace(BOX_ITEM_REGEX, (_match, bullet: string, box: string) => `${bullet}[${box === '\u2611' ? 'x' : ' '}] `);
}

function mapOutsideCodeBlocks(body: string, transform: (text: string) => string): string {
  const lines = body.split('\n');
  const result: string[] = [];
  let outside: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (outside.length > 0) {
      result.push(transform(outside.join('\n')));
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
    if (match && match[1][0] === fence[0] && match[1].length >= fence.length && line.trim() === match[1]) {
      fence = null;
    }
  }
  flush();
  return result.join('\n');
}

function encodeHiddenMarker(content: string): string {
  // encodeURIComponent leaves the characters markdown gives a meaning to: they are escaped too
  const encoded = encodeURIComponent(content.trim()).replace(/[!'()*_~]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase());
  return `[](${HIDDEN_MARKER_PREFIX}${encoded})`;
}

function decodeHiddenMarker(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
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
