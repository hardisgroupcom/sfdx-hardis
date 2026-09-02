import { strict as assert } from 'assert';
import { mdTableCell, mdTableCellHtml } from '../../../src/common/gitProvider/utilsMarkdown.js';
import { DocBuilderObject } from '../../../src/common/docBuilder/docBuilderObject.js';

/**
 * A markdown table row is one line, and a pipe separates its cells. Free text a Salesforce admin
 * typed holds neither rule: the description of a validation rule of Account ran over four lines,
 * which closed the table and turned every rule below it into a paragraph of pipes.
 */
describe('table cells built from free text', () => {
  it('keeps a line break inside the cell', () => {
    assert.equal(mdTableCell('first\nsecond'), 'first<br/>second');
  });

  it('escapes a pipe instead of deleting it, so a formula keeps its OR operators', () => {
    assert.equal(mdTableCell('LEN(a) > 49 || LEN(b) > 49'), 'LEN(a) > 49 \\|\\| LEN(b) > 49');
  });

  it('renders an empty value as an empty cell', () => {
    assert.equal(mdTableCell(''), '<!-- -->');
  });

  it('turns the markup characters of free text into entities', () => {
    assert.equal(mdTableCellHtml('a < b && c > d'), 'a &lt; b &amp;&amp; c &gt; d');
  });

  it('reports a value it was given as null or undefined as an empty cell', () => {
    assert.equal(mdTableCellHtml(null), '<!-- -->');
    assert.equal(mdTableCellHtml(undefined), '<!-- -->');
  });
});

describe('validation rules table', () => {
  const rule = {
    fullName: 'BlockEditForClosedAccount',
    active: false,
    description: 'Only admins can edit a closed account\n\nOLD : the rule used to check the owner',
    errorConditionFormula: '(Closed__c == true)\n&& (LEN(Name) > 0 || LEN(Site) > 0)',
  };

  it('writes one rule on exactly one line, whatever its description holds', () => {
    const rows = DocBuilderObject.buildValidationRulesTable([rule]).filter(line => line.startsWith('| BlockEdit'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].includes('\n'), false);
  });

  it('keeps the row split into the four columns the header announces', () => {
    const [row] = DocBuilderObject.buildValidationRulesTable([rule]).filter(line => line.startsWith('| BlockEdit'));
    // A pipe of the content is escaped, so only the four separators of the row are left unescaped
    const separators = row.split(/(?<!\\)\|/).length - 1;
    assert.equal(separators, 5);
  });

  it('shows the formula as code, with its own line breaks kept', () => {
    const [row] = DocBuilderObject.buildValidationRulesTable([rule]).filter(line => line.startsWith('| BlockEdit'));
    assert.equal(row.includes('<code>(Closed__c == true)<br/>'), true);
    // The greater-than of the formula is written as an entity, the pipes of its OR are escaped
    assert.equal(row.includes('LEN(Name) &gt; 0 \\|\\| LEN(Site) &gt; 0'), true);
  });

  it('leaves the formula cell without a code block when the rule has no formula', () => {
    const [row] = DocBuilderObject.buildValidationRulesTable([
      { fullName: 'Empty', active: true, description: '', errorConditionFormula: '' }
    ]).filter(line => line.startsWith('| Empty'));
    assert.equal(row.includes('<code>'), false);
  });
});
