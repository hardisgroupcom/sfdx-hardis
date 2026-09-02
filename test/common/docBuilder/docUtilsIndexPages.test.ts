import { strict as assert } from 'assert';
import { indexPageListsPages, promoteSectionIndexTitle, sortDescriptionsByName } from '../../../src/common/docBuilder/docUtils.js';
import { prettifyFieldName } from '../../../src/common/utils/flowVisualiser/nodeFormatUtils.js';

/**
 * A page takes its title from its first level 1 heading and falls back to the file name when it
 * has none, so every generated index.md used to be called "Index" in the browser tab, in the
 * search results and at the top of the page.
 */
describe('section index page titles', () => {
  it('promotes the section heading that opens the table into the page title', () => {
    assert.deepEqual(
      promoteSectionIndexTitle(['## Objects', '', '| Name | Label |', '| :-- | :-- |']),
      ['# Objects', '', '| Name | Label |', '| :-- | :-- |']
    );
  });

  it('promotes only the first heading, so the sections below keep their level', () => {
    assert.deepEqual(
      promoteSectionIndexTitle(['## Flows', '', '## Related Flows']),
      ['# Flows', '', '## Related Flows']
    );
  });

  it('leaves a table that opens with something else alone', () => {
    assert.deepEqual(promoteSectionIndexTitle(['', '| Name |']), ['', '| Name |']);
  });

  it('leaves an empty section alone', () => {
    assert.deepEqual(promoteSectionIndexTitle([]), []);
  });
});

/**
 * The home page used to list every section the command knows how to produce, so a project without
 * Lightning Pages or installed packages got links to pages that were never written.
 */
describe('documented section detection', () => {
  const footer = '\n_Generated with [sfdx-hardis](https://sfdx-hardis.cloudity.com) by [Cloudity](https://cloudity.com?ref=sfdxhardis)_\n';

  it('sees a section that lists a page', () => {
    assert.equal(indexPageListsPages('# Objects\n\n| [Account](Account.md) |' + footer), true);
  });

  it('sees a section whose pages are written in another folder', () => {
    // Process Builders have their own index, their pages live among the Flows
    assert.equal(indexPageListsPages('# Process Builders\n\n| [PB](../flows/PB.md) |' + footer), true);
  });

  it('sees a page whose name holds a space', () => {
    const line = '| [Case.Case creation Auto-Response](Case.Case creation Auto-Response.md) | true |';
    assert.equal(indexPageListsPages('# AutoResponse Rules\n\n' + line + footer), true);
  });

  it('follows a link that carries an anchor', () => {
    assert.equal(indexPageListsPages('| [Account](Account.md#fields) |' + footer), true);
  });

  it('does not count the external links of the footer', () => {
    assert.equal(indexPageListsPages('# Lightning Pages\n' + footer), false);
  });

  it('does not count an external address that ends with .md', () => {
    assert.equal(indexPageListsPages('[Changelog](https://sfdx-hardis.cloudity.com/CHANGELOG.md)'), false);
  });

  it('reports an empty page as not documented', () => {
    assert.equal(indexPageListsPages(''), false);
  });
});

/**
 * Index tables used to be rendered in the order the metadata files happened to be walked in: the
 * Lightning Web Components table came out reversed.
 */
describe('index table sorting', () => {
  it('sorts entries by name, whatever order they were collected in', () => {
    assert.deepEqual(
      sortDescriptionsByName([{ name: 'utilsPrivate' }, { name: 'utils' }, { name: 'sampleApp' }]).map(d => d.name),
      ['sampleApp', 'utils', 'utilsPrivate']
    );
  });

  it('ignores case, so ATPCheck and AccountCases are not separated', () => {
    assert.deepEqual(
      sortDescriptionsByName([{ name: 'ATPCheck' }, { name: 'AccountCases' }, { name: 'AP01_Account' }]).map(d => d.name),
      ['AccountCases', 'AP01_Account', 'ATPCheck']
    );
  });

  it('sorts in place, so an array feeding several tables is only sorted once', () => {
    const descriptions = [{ name: 'b' }, { name: 'a' }];
    assert.equal(sortDescriptionsByName(descriptions), descriptions);
    assert.equal(descriptions[0].name, 'a');
  });

  it('does not fail on an entry without a name', () => {
    assert.deepEqual(sortDescriptionsByName([{ name: 'b' }, {}]).map(d => d.name), [undefined, 'b']);
  });
});

/**
 * prettifyFieldName splits an API name written in camelCase into words. User licenses go through
 * it too, and they are already prose: "B2BMA Integration User" came out "B2 B M A  Integration  User".
 */
describe('prettifyFieldName', () => {
  it('splits an API name into words', () => {
    assert.equal(prettifyFieldName('recordTriggerType'), 'Record Trigger Type');
  });

  it('leaves a value that already holds a space untouched', () => {
    assert.equal(prettifyFieldName('B2BMA Integration User'), 'B2BMA Integration User');
    assert.equal(prettifyFieldName('Chatter Free'), 'Chatter Free');
  });

  it('leaves no leading space on a single word', () => {
    assert.equal(prettifyFieldName('Salesforce'), 'Salesforce');
  });

  it('keeps the special cases it knows about', () => {
    assert.equal(prettifyFieldName('sObjectType'), 'SObject Type');
  });

  it('returns an empty value unchanged', () => {
    assert.equal(prettifyFieldName(''), '');
  });
});
