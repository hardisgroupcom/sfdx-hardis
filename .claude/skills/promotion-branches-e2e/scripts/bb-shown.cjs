#!/usr/bin/env node
/*
 * Bitbucket Cloud comments as sfdx-hardis reads them. The CLI hides its markers there in links with
 * no text, `[](#hardis:<encoded>)`, and sends a task item with a box symbol
 * (src/common/gitProvider/utils/utilsBitbucketMarkup.ts), because Bitbucket displays an HTML comment as
 * text and draws no checkbox. A script that reads the raw content of a comment gets those: this
 * gives the HTML comments and the task items back, as fromBitbucketMarkup does. It is the one place
 * of the skill that knows the format: check-pr-modal.cjs requires it.
 *
 *   ... | node bb-shown.cjs                 stdin: text, stdout: the same with its markers shown
 *   ... | node bb-shown.cjs all             stdin: a page of comments (JSON), stdout: every comment
 *   ... | node bb-shown.cjs ids <needle>    stdin: a page of comments, stdout: ids of those holding <needle>
 *   ... | node bb-shown.cjs raw             stdin: one comment (JSON), stdout: its text
 *   ... | node bb-shown.cjs tick <needle>   stdin: one comment (JSON), stdout: its RAW text, as Bitbucket
 *                                           holds it, with the box of the items holding <needle> ticked
 */
const UNTICKED = '☐';
const TICKED = '☑';

// Like decodeHiddenMarker of the CLI: a marker that cannot be decoded is kept as it is written
function decode(encoded) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function shown(text) {
  return String(text || '')
    .replace(/\[\]\(#hardis:([^)\s]*)\)/g, (_match, encoded) => `<!-- ${decode(encoded)} -->`)
    .replace(/^(\s*[-*] )([☐☑]) /gm, (_match, bullet, box) => `${bullet}[${box === TICKED ? 'x' : ' '}] `);
}

// What a person does on Bitbucket, where no box can be clicked: in the text of the comment, the
// box symbol of the item is replaced by the ticked one. The hidden marker next to it is not touched.
function tick(raw, needle) {
  return String(raw || '')
    .split('\n')
    .map((line) => (shown(line).includes(needle) ? line.replace(new RegExp(`^(\\s*[-*] )${UNTICKED} `), `$1${TICKED} `) : line))
    .join('\n');
}

module.exports = { shown, tick };

if (require.main === module) {
  const [mode, needle] = process.argv.slice(2);
  let input = '';
  process.stdin
    .setEncoding('utf8')
    .on('data', (chunk) => (input += chunk))
    .on('end', () => {
      if (!mode) {
        process.stdout.write(shown(input));
        return;
      }
      let data;
      try {
        data = JSON.parse(input);
      } catch {
        process.exit(0);
      }
      const comments = (data.values || []).filter((comment) => !comment.deleted);
      const text = (comment) => shown((comment.content || {}).raw);
      if (mode === 'all') process.stdout.write(comments.map(text).join('\n'));
      else if (mode === 'ids') process.stdout.write(comments.filter((comment) => text(comment).includes(needle)).map((comment) => comment.id).join(' '));
      else if (mode === 'raw') process.stdout.write(text(data));
      else if (mode === 'tick') process.stdout.write(tick((data.content || {}).raw, needle));
    });
}
