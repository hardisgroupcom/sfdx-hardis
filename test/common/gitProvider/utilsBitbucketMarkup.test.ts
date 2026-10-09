import { expect } from 'chai';
import { fromBitbucketMarkup, toBitbucketMarkup } from '../../../src/common/gitProvider/utilsBitbucketMarkup.js';

// Bitbucket Cloud displays raw HTML as text: comments go out rewritten, and come back with the
// HTML comments the rest of sfdx-hardis reads.
describe('Bitbucket markup of Pull Request comments', () => {
  it('hides an HTML comment in a link with no text and gives it back on the way in', () => {
    const body = 'Verdict line\n\n<!-- sfdx-hardis message-key deployment-check-12 -->\n';

    const sent = toBitbucketMarkup(body);

    expect(sent).to.not.contain('<!--');
    expect(sent).to.contain('[](#hardis:sfdx-hardis%20message-key%20deployment-check-12)');
    expect(fromBitbucketMarkup(sent)).to.equal(body);
  });

  it('keeps a marker readable whatever characters it holds', () => {
    const marker = '<!-- sfdx-hardis-manual-action id:e2e_gate(1)*~! org:uat pr:37 when:pre-deploy -->';
    const meta = '<!-- meta:eyJub3RlIjoiYStiL2M9PSJ9 -->';
    const body = `- [ ] ${marker} Manual step\n\n| Action | uat |\n|---|---|\n| Step | done ${meta} |\n`;

    const sent = toBitbucketMarkup(body);

    expect(sent).to.not.match(/[()*_~!'][^\n]*#hardis:[^)]*[(*_~!']/);
    expect(sent.split('\n')[0]).to.match(/^- ☐ \[\]\(#hardis:[^)\s]+\) Manual step$/);
    expect(fromBitbucketMarkup(sent)).to.equal(body);
  });

  it('turns a folded section into its summary in bold followed by its content', () => {
    const body = 'Before\n\n<details>\n<summary><b>Deployment actions of this job (4)</b></summary>\n\n| Action | Status |\n|---|---|\n| One | done |\n\n</details>\n\nAfter';

    const sent = toBitbucketMarkup(body);

    expect(sent).to.not.match(/<\/?(details|summary|b)>/);
    expect(sent).to.contain('**Deployment actions of this job (4)**');
    expect(sent).to.contain('| One | done |');
    expect(sent).to.not.match(/\n{3,}/);
  });

  it('replaces a line break tag in a table cell by a space', () => {
    const sent = toBitbucketMarkup('| Step | 2026-10-08<br/>[1](https://example.com/job/1) |');

    expect(sent).to.equal('| Step | 2026-10-08 [1](https://example.com/job/1) |');
  });

  it('leaves code blocks as they are', () => {
    const code = '````\nSolve the conflicts between <!-- markers --> in <details> blocks<br/>\n```xml\n<fullName>A</fullName>\n```\n````';
    const body = `Prompt:\n\n${code}\n\n<!-- sfdx-hardis nav-end -->`;

    const sent = toBitbucketMarkup(body);

    expect(sent).to.contain(code);
    expect(sent).to.contain('[](#hardis:sfdx-hardis%20nav-end)');
  });

  it('does not change a text sent twice', () => {
    const body = '<details><summary>Details</summary>\n\nText<br/>more\n\n</details>\n<!-- sfdx-hardis deployment-id 0Af000000000001 -->';

    const once = toBitbucketMarkup(body);

    expect(toBitbucketMarkup(once)).to.equal(once);
  });

  it('shows a box symbol for a task item and names what marks an action as done on Bitbucket', () => {
    const body = 'Tick a box once the action is done in the org: the next sfdx-hardis job records it. Rerun a failed action.\n\n- [ ] To do\n- [x] Done\n';

    const sent = toBitbucketMarkup(body);

    expect(sent).to.contain('- ☐ To do\n- ☑ Done');
    expect(sent).to.not.contain('Tick a box');
    expect(sent).to.contain('sf hardis:project:action:set-status');
    expect(fromBitbucketMarkup(sent)).to.contain('- [ ] To do\n- [x] Done');
  });

  it('reads a comment written before the hidden markers existed', () => {
    const old = 'Old comment\n<!-- sfdx-hardis message-key deployment-12 -->';

    expect(fromBitbucketMarkup(old)).to.equal(old);
  });
});
