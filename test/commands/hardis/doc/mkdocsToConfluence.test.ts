import { strict as assert } from 'assert';
import { DOMParser } from '@xmldom/xmldom';
import MkDocsToConfluence from '../../../../src/commands/hardis/doc/mkdocs-to-confluence.js';

/**
 * Confluence storage format is XHTML, and it refuses a whole page on the first malformed tag or
 * on a named entity it cannot resolve. These tests convert a page and read the result back with
 * an XML parser, which is the check the Confluence API performs on its side.
 */
class Converter extends MkDocsToConfluence {
  public convert(markdown: string, filePath = 'index.md'): string {
    return this.convertMarkdownToConfluenceStorage(markdown, filePath);
  }
}

// The command is never run here, only its conversion, so it is built without going through the
// oclif constructor.
const converter = Object.create(Converter.prototype) as Converter;
(converter as any).pageTitleMap = new Map<string, string>();

function convert(markdown: string, filePath = 'index.md'): string {
  return converter.convert(markdown, filePath);
}

function assertValidStorageFormat(storage: string) {
  const errors: string[] = [];
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') {
        errors.push(String(message).split(/[\r\n]/)[0].trim());
      }
    },
  });
  try {
    parser.parseFromString(`<root xmlns:ac="http://x" xmlns:ri="http://y">${storage}</root>`, 'text/xml');
  } catch (e: any) {
    errors.push(String(e.message).split(/[\r\n]/)[0].trim());
  }
  assert.deepEqual(errors, [], 'Storage format is not valid XHTML:\n' + storage);
}

describe('mkdocs-to-confluence storage format', () => {
  describe('website markup that Confluence knows nothing about', () => {
    const homePage = [
      '# Project Documentation',
      '',
      '<div class="sfdx-hardis-home-cards" markdown>',
      '',
      '<div class="sfdx-hardis-home-card" markdown>',
      '',
      '[Objects](objects/index.md){ .sfdx-hardis-home-card__title } <span class="c">47</span>',
      '',
      'Every object of the org.',
      '',
      '</div>',
      '',
      '</div>',
      '',
    ].join('\n');

    it('accepts the home page, which the layout divs used to make invalid', () => {
      assertValidStorageFormat(convert(homePage));
    });

    it('drops the layout containers and the attribute list that decorates them', () => {
      const storage = convert(homePage);
      assert.equal(storage.includes('<div'), false, 'a div carries no meaning in Confluence');
      assert.equal(storage.includes('markdown>'), false, 'a valueless attribute is not XHTML');
      assert.equal(storage.includes('{ .sfdx-hardis-home-card__title }'), false, 'attr_list is not content');
      assert.equal(storage.includes('Objects'), true, 'what the card said is kept');
      assert.equal(storage.includes('>47<'), true, 'and so is how many pages it counts');
    });

    it('leaves a Salesforce formula alone, which also opens on a brace', () => {
      assert.equal(convert('Amount is {!Record.Amount__c}.').includes('{!Record.Amount__c}'), true);
    });
  });

  describe('table cells', () => {
    const table = [
      '| Rule | Formula |',
      '| :--- | :------ |',
      '| VR001 | <code>ISBLANK(A) = TRUE \\|\\| ISBLANK(B) = TRUE</code> |',
      '',
    ].join('\n');

    it('keeps the OR of a formula in the cell it belongs to', () => {
      const storage = convert(table);
      assertValidStorageFormat(storage);
      assert.equal(storage.includes('ISBLANK(A) = TRUE || ISBLANK(B) = TRUE'), true);
      assert.equal((storage.match(/<td>/g) || []).length, 2, 'the row still holds two cells');
    });

    it('keeps the colors a Flow element is drawn with', () => {
      const storage = convert('| Element |\n| :------ |\n| <span style="color: red;">Decision</span> |\n');
      assertValidStorageFormat(storage);
      assert.equal(storage.includes('<span style="color: red;">Decision</span>'), true);
    });

    it('does not read the multiplication of a formula as emphasis', () => {
      const storage = convert('| A | B |\n| :- | :- |\n| {!a.Cost__c} * {!b.Rate__c} | {!c} * {!d} |\n');
      assertValidStorageFormat(storage);
      assert.equal(storage.includes('<em>'), false);
    });

    it('does not let bold run from one cell into another', () => {
      const storage = convert('| A | B |\n| :- | :- |\n| **SLACK*CHANNEL*ID** | **OTHER** |\n');
      assertValidStorageFormat(storage);
    });
  });

  describe('collapsible sections', () => {
    it('becomes the expand macro, body and all', () => {
      const storage = convert('<details><summary>ApexClass (12)</summary>\n\n- One\n- Two\n\n</details>\n');
      assertValidStorageFormat(storage);
      assert.equal(storage.includes('<ac:structured-macro ac:name="expand">'), true);
      assert.equal(storage.includes('<ac:parameter ac:name="title">ApexClass (12)</ac:parameter>'), true);
      assert.equal(storage.includes('<li>One</li>'), true);
    });

    it('closes a section the page left open', () => {
      const storage = convert('<details markdown="1">\n<summary>Technical explanations</summary>\n\nSome text.\n');
      assertValidStorageFormat(storage);
    });

    it('ignores a closing tag that opens nothing', () => {
      assertValidStorageFormat(convert('Text.\n\n</details>\n'));
    });
  });

  describe('entities and angle brackets', () => {
    it('writes a named entity as the code point Confluence resolves', () => {
      const storage = convert('Chemin&nbsp;: docs.');
      assertValidStorageFormat(storage);
      assert.equal(storage.includes('&#160;'), true);
      assert.equal(storage.includes('&nbsp;'), false);
    });

    it('keeps an ampersand that only meant to be an ampersand', () => {
      const storage = convert('Sales &amp; Service, R&D, &notAnEntity;');
      assertValidStorageFormat(storage);
      assert.equal(storage.includes('&amp;notAnEntity;'), true);
    });

    it('escapes generic Apex code entirely, not by halves', () => {
      const storage = convert('| Method |\n| :----- |\n| Map<Id,List<Opportunity>> getAll() |\n');
      assertValidStorageFormat(storage);
      assert.equal(storage.includes('Map&lt;Id,List&lt;Opportunity&gt;&gt;'), true);
    });

    it('shows the storage format markup a page talks about instead of running it', () => {
      const storage = convert('Links use <ac:link> with <ri:page ri:content-title="..." />.');
      assertValidStorageFormat(storage);
      assert.equal(storage.includes('&lt;ac:link&gt;'), true);
    });
  });

  describe('code and images', () => {
    it('carries source code that closes a CDATA of its own', () => {
      const storage = convert('```html\n<aura:component>\n]]>\n</aura:component>\n```\n');
      assertValidStorageFormat(storage);
      assert.equal(storage.includes(']]]]><![CDATA[>'), true);
    });

    it('keeps an HTML comment a code span is documenting', () => {
      const storage = convert('Read the `<!-- marker -->` line, then `scripts/run.yml` files.');
      assertValidStorageFormat(storage);
      assert.equal(storage.includes('marker'), true);
      assert.equal((storage.match(/<code>/g) || []).length, 2);
    });

    it('removes a comment that is only a comment', () => {
      const storage = convert('Text.\n\n<!-- sfdx-hardis-home-page: abc -->\n');
      assert.equal(storage.includes('sfdx-hardis-home-page'), false);
    });

    it('shows an image wrapped in a link as an image, not as its own markup', () => {
      const storage = convert('[![Banner](https://x.test/b.png)](https://cloudity.com)');
      assertValidStorageFormat(storage);
      assert.equal(storage.includes('<a href="https://cloudity.com"><ac:image>'), true);
      assert.equal(storage.includes('&lt;ac:image'), false);
    });
  });
});
