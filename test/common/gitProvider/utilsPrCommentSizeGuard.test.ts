import { expect } from 'chai';
import { enforceCommentLengthLimit, fitPrCommentSections, truncateCodeBlocks } from '../../../src/common/gitProvider/utilsPrCommentSizeGuard.js';
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

  it('pairs the removed and added rows of a block, and keeps the AI summary visible', () => {
    const markdown = [
      '## Flow Diagram',
      '',
      '```mermaid',
      'flowchart TB',
      '```',
      '',
      '## AI-Generated Differences Summary',
      '',
      'The greeting is now longer.',
      '',
      '## Flow Nodes Details',
      '',
      '### Set_Greeting',
      '',
      '|🟥<i>Label</i>|<i>Set greeting</i>|',
      '|🟥<i>Description</i>|<i>Old</i>|',
      '|🟩<b>Label</b>|<b>Set the greeting</b>|',
      '|🟩<b>Description</b>|<b>New</b>|',
    ].join('\n');
    const cleaned = cleanFlowDiffMarkdownForPrComment(markdown);
    expect(cleaned).to.contain('**2 properties changed**');
    expect(cleaned).to.contain('| Set_Greeting | Label | Set greeting | Set the greeting |');
    expect(cleaned).to.contain('| Set_Greeting | Description | Old | New |');
    expect(cleaned.indexOf('The greeting is now longer.')).to.be.lessThan(cleaned.indexOf('<details>'));
  });

  it('keeps formulas whole, names numbered rows after their table, and makes a new element one row', () => {
    const green = (text: string) => `<span style="background-color: #a6e22e; color: black;"><b>${text}</b></span>`;
    const red = (text: string) => `<span style="background-color: #ff7f7f; color: black;"><i>${text}</i></span>`;
    const markdown = [
      '```mermaid',
      'flowchart TB',
      '```',
      '',
      '## General Information',
      '',
      '#### Filters (logic: **and**)',
      '',
      `|🟩${green('2')}|${green('Panels_Required__c')}|${green('Is Null')}|${green('<!-- -->')}|`,
      '',
      '## Formulas',
      '',
      `|🟥${red('crewTooSmall')}|${red('Boolean')}|${red('{!$Record.Crew_Size__c} < 2')}|${red('True when fewer than two people are assigned.')}|`,
      `|🟩${green('crewTooSmall')}|${green('Boolean')}|${green('AND(<br/>  {!$Record.Crew_Size__c} * 8 < {!$Record.Panels_Required__c}<br/>)')}|${green('True when eight panels a person do not cover the job')}|`,
      '',
      '## Flow Nodes Details',
      '',
      '### Create_Warning_Task',
      '',
      `|🟩${green('Connector')}|${green('[Mark_Warning_Sent](#mark_warning_sent)')}|`,
      '',
      '### 🟩Mark_Warning_Sent',
      '',
      `|🟩${green('Type')}|${green('Record Update')}|`,
      `|🟩${green('Label')}|${green('Mark Warning Sent')}|`,
      '',
      '#### 🟩Input Assignments',
      '',
      `|🟩${green('Crew_Warning_Sent__c')}|${green('true')}|`,
    ].join('\n');
    const cleaned = cleanFlowDiffMarkdownForPrComment(markdown);
    expect(cleaned).to.contain('**4 properties changed**');
    expect(cleaned).to.contain('| Flow | Filters (logic: and) 2 | _none_ | Panels_Required__c · Is Null |');
    expect(cleaned).to.contain('| Formulas | crewTooSmall | Boolean · {!$Record.Crew_Size__c} &lt; 2 · True when fewer than two people are assigned. | Boolean · AND( {!$Record.Crew_Size__c} * 8 &lt; {!$Record.Panels_Required__c} ) · True when eight panels a person do not cover the job |');
    expect(cleaned).to.contain('| Create_Warning_Task | Connector | _none_ | Mark_Warning_Sent |');
    expect(cleaned).to.contain('| Mark_Warning_Sent | Element | _none_ | Mark_Warning_Sent (Record Update) |');
    expect(cleaned).to.not.contain('| Mark_Warning_Sent | Label |');
  });

  it('replaces a diagram too large for the comment instead of cutting it', () => {
    const hugeDiagram = diffMarkdown.replace('flowchart TB', 'flowchart TB\n' + Array.from({ length: 4000 }, (_, i) => `N${i}("Node ${i}")`).join('\n'));
    const message = buildFlowDiffCommentMessage(hugeDiagram, 'Legal_Email', 20000);
    expect(message.length).to.be.at.most(20000);
    expect(message).to.not.contain('```mermaid');
    expect(message).to.contain('The diagram is too large for a Pull Request comment');
  });

  it('drops the full tables, then the diagram, when the comment is too large', () => {
    const huge = diffMarkdown.replace('|Object|Opportunity|', Array.from({ length: 3000 }, (_, i) => `|Property ${i}|Value ${i}|`).join('\n'));
    const message = buildFlowDiffCommentMessage(huge, 'Legal_Email', 20000);
    expect(message.length).to.be.at.most(20000);
    expect(message).to.contain('the full property tables left out');
    expect(message).to.contain('```mermaid');
  });
});
