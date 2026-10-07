import { expect } from 'chai';
import { enforceCommentLengthLimit, fitPrCommentSections, truncateCodeBlocks } from '../../../src/common/gitProvider/prCommentSizeGuard.js';
import { buildFlowDiffCommentMessage } from '../../../src/common/gitProvider/index.js';
import { cleanFlowDiffMarkdownForPrComment, getFlowStatusOnlyChange } from '../../../src/common/utils/mermaidUtils.js';

const bigList = (count: number) => Array.from({ length: count }, (_, i) => `- [#${i}](https://example.com/pr/${i}) A Pull Request title that is quite long`).join('\n');

describe('Pull Request comment size guard', () => {
  it('leaves a body under the budget as it is', () => {
    const result = fitPrCommentSections([{ id: 'a', keep: true, markdown: 'Hello' }, { id: 'b', markdown: 'World' }], 1000, '50,000');
    expect(result).to.deep.equal({ markdown: 'Hello\n\nWorld', shortened: false, leftOut: [] });
  });

  it('shortens lists before dropping sections, and never touches kept sections', () => {
    const verdict = '### ❌ Cannot merge';
    const list = bigList(3000);
    const result = fitPrCommentSections(
      [
        { id: 'verdict', keep: true, markdown: verdict },
        { id: 'refs', markdown: list, shortMarkdown: bigList(50), dropLabel: 'the Pull Requests' },
      ],
      46000,
      '50,000'
    );
    expect(result.shortened).to.be.true;
    expect(result.leftOut).to.deep.equal([]);
    expect(result.markdown.startsWith(verdict)).to.be.true;
    expect(result.markdown).to.contain('Shortened to fit the 50,000 character limit');
    expect(result.markdown.length).to.be.at.most(46000);
  });

  it('drops the biggest optional sections first and names them', () => {
    const result = fitPrCommentSections(
      [
        { id: 'verdict', keep: true, markdown: 'verdict' },
        { id: 'small', markdown: 'x'.repeat(1000), dropLabel: 'the small one' },
        { id: 'big', markdown: 'y'.repeat(200000), dropLabel: 'the big one' },
      ],
      26000,
      '30,000'
    );
    expect(result.leftOut).to.deep.equal(['the big one']);
    expect(result.markdown).to.contain('x'.repeat(1000));
    expect(result.markdown).to.contain('the big one left out');
  });

  it('keeps the last lines of a long code block', () => {
    const block = '```\n' + Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n') + '\n```';
    const shortened = truncateCodeBlocks(block, 40);
    expect(shortened).to.contain('… 60 lines left out');
    expect(shortened).to.contain('line 99');
    expect(shortened).to.not.contain('line 59\n');
  });

  it('cuts a body over the hard limit before its footer and markers', () => {
    const body = 'z'.repeat(70000) + '\n\n_Powered by [sfdx-hardis](https://x)_\n\n<!-- sfdx-hardis message-key deployment-check-job-12 -->';
    const result = enforceCommentLengthLimit(body, 50000);
    expect(result.cut).to.be.true;
    expect(result.body.length).to.be.at.most(50000);
    expect(result.body).to.contain('<!-- sfdx-hardis message-key deployment-check-job-12 -->');
    expect(result.body).to.contain('_Powered by [sfdx-hardis]');
  });
});

describe('Flow diff comments', () => {
  const flowXml = (status: string, label = 'Send email') => `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <name>Send_email</name>
        <label>${label}</label>
    </actionCalls>
    <label>Legal email</label>
    <status>${status}</status>
</Flow>`;

  it('detects a change of the status only', () => {
    expect(getFlowStatusOnlyChange(flowXml('Active'), flowXml('Obsolete'))).to.deep.equal({ before: 'Active', after: 'Obsolete' });
    expect(getFlowStatusOnlyChange(flowXml('Active'), flowXml('Obsolete', 'Send the email'))).to.be.null;
    expect(getFlowStatusOnlyChange(flowXml('Active'), flowXml('Active', 'Send the email'))).to.be.null;
    expect(getFlowStatusOnlyChange(flowXml('Active'), flowXml('Active'))).to.be.null;
  });

  const diffMarkdown = [
    '# Legal email "Proposal handed',
    '',
    '## Flow Diagram',
    '',
    '```mermaid',
    '%% If you read this, your Markdown visualizer does not handle MermaidJS syntax.',
    'flowchart TB',
    'START(["START"]):::startClassChanged',
    '',
    '',
    'Send_email("Send email"):::actionCallsChanged',
    'classDef startClassChanged fill:#ff0',
    'classDef actionCallsChanged fill:#f0f',
    'classDef recordLookupsAdded fill:#0f0',
    '```',
    '',
    '## General Information',
    '',
    '|<!-- -->|<!-- -->|',
    '|:---|:---|',
    '|Object|Opportunity|',
    '|🟥<span style="background-color: #ff7f7f; color: black;"><i>Status</i></span>|<span style="background-color: #ff7f7f; color: black;"><i>Active</i></span>|',
    '|🟩<span style="background-color: #a6e22e; color: black;"><b>Status</b></span>|<span style="background-color: #a6e22e; color: black;"><b>Obsolete</b></span>|',
    '',
    '___',
    '',
    '_Documentation generated from branch main by [sfdx-hardis](https://x)_',
  ].join('\n');

  it('puts the changed properties first and folds the full tables', () => {
    const cleaned = cleanFlowDiffMarkdownForPrComment(diffMarkdown);
    expect(cleaned).to.contain('| Flow | Status | Active | Obsolete |');
    expect(cleaned).to.not.contain('%%');
    expect(cleaned).to.not.contain('# Legal email');
    expect(cleaned).to.not.contain('## Flow Diagram');
    expect(cleaned).to.not.contain('recordLookupsAdded');
    expect(cleaned).to.contain('classDef startClassChanged');
    expect(cleaned).to.not.contain('Documentation generated from branch');
    expect(cleaned).to.not.match(/```mermaid[\s\S]*\n\n[\s\S]*```/);
    expect(cleaned.indexOf('| Flow | Status |')).to.be.lessThan(cleaned.indexOf('```mermaid'));
    expect(cleaned.indexOf('<summary>All properties and elements</summary>')).to.be.greaterThan(cleaned.indexOf('```mermaid'));
  });

  it('drops the full tables, then the diagram, when the comment is too large', () => {
    const huge = diffMarkdown.replace('|Object|Opportunity|', Array.from({ length: 3000 }, (_, i) => `|Property ${i}|Value ${i}|`).join('\n'));
    const message = buildFlowDiffCommentMessage(huge, 'Legal_Email', 20000);
    expect(message.length).to.be.at.most(20000);
    expect(message).to.contain('the full property tables left out');
    expect(message).to.contain('```mermaid');
  });
});
