/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { parseJsdocSymbols, renderJsdocMarkdown } from '../../../src/common/utils/jsdocMarkdown.js';

const LWC_SOURCE = `
import { LightningElement, api, track, wire } from 'lwc';
import getRecord from '@salesforce/apex/MyController.getRecord';

/**
 * Displays an account summary card.
 * Second description line.
 * @fires accountselected
 * @see https://developer.salesforce.com/docs/component-library
 */
export default class AccountSummary extends LightningElement {
  /**
   * Id of the account to display.
   * @type {string}
   */
  @api recordId;

  /** Card title */
  @api title = 'Account summary';

  /**
   * Internal list of rows
   * @type {Array.<Object>}
   */
  @track rows = [];

  /** Wired record */
  @wire(getRecord, { recordId: '$recordId' })
  wiredRecord({ error, data }) {
    this.rows = data ? data.rows : [];
  }

  undocumentedField = 42;

  /**
   * Secret internal counter
   * @private
   */
  _counter = 0;

  /** Hidden helper */
  #secret() {}

  /**
   * Loads the rows for the given account.
   * @param {string} accountId - The account Id
   * @param {Object} [options={}] Loading options
   * @param {boolean} [options.force] Force reload
   * @returns {Promise<Array.<Object>>} The loaded rows
   * @throws {Error} When the account is not found
   * @example
   * const rows = await cmp.loadRows('001xx000003DGbY', { force: true });
   */
  async loadRows(accountId, options = {}) {
    return [];
  }

  /**
   * Whether the card has rows to display.
   * @returns {boolean}
   */
  get hasRows() {
    return this.rows.length > 0;
  }

  /**
   * Sets the selected row.
   * @param {Object} value The row to select
   */
  set selectedRow(value) {
    this._selected = value;
  }

  /**
   * Previous API
   * @deprecated Use loadRows instead
   */
  refresh() {}

  /**
   * Row click handler.
   * @param {CustomEvent} event The row event
   */
  handleRowClick = (event) => {
    this.dispatchEvent(new CustomEvent('accountselected', { detail: event.detail }));
  };

  /**
   * Builds a label.
   * @param {string|number} value Raw value
   * @returns {string}
   */
  static buildLabel(value) {
    return String(value);
  }

  undocumentedMethod() {}
}
`;

describe('jsdocMarkdown', () => {

  describe('renderJsdocMarkdown with an LWC class', () => {
    const md = renderJsdocMarkdown(LWC_SOURCE, { fileName: 'accountSummary.js' });

    it('renders the class heading with kind, extends, fires and see', () => {
      expect(md).to.include('### AccountSummary\n');
      expect(md).to.include('Displays an account summary card.\nSecond description line.');
      expect(md).to.include('**Kind**: global class');
      expect(md).to.include('**Extends**: <code>LightningElement</code>');
      expect(md).to.include('**Fires**: <code>accountselected</code>');
      expect(md).to.include('**See**: https://developer.salesforce.com/docs/component-library');
    });

    it('renders @api, @track and @wire decorated properties', () => {
      expect(md).to.include('#### recordId : <code>string</code>');
      expect(md).to.include('**Kind**: instance property of <code>AccountSummary</code>');
      expect(md).to.include('**Decorators**: <code>@api</code>');
      expect(md).to.include('#### title\n');
      expect(md).to.include("**Default**: <code>'Account summary'</code>");
      expect(md).to.include('#### rows : <code>Array.&lt;Object&gt;</code>');
      expect(md).to.include('**Decorators**: <code>@track</code>');
      expect(md).to.include('#### wiredRecord({ error, data })');
      expect(md).to.include("**Decorators**: <code>@wire(getRecord, { recordId: '$recordId' })</code>");
    });

    it('renders a method with params table, returns, throws and example', () => {
      expect(md).to.include('#### loadRows(accountId, [options]) ⇒ <code>Promise&lt;Array.&lt;Object&gt;&gt;</code>');
      expect(md).to.include('**Kind**: instance async method of <code>AccountSummary</code>');
      expect(md).to.include('**Returns**: <code>Promise&lt;Array.&lt;Object&gt;&gt;</code> - The loaded rows');
      expect(md).to.include('**Throws**: <code>Error</code> - When the account is not found');
      expect(md).to.include('| Param | Type | Default | Description |');
      expect(md).to.include('| --- | --- | --- | --- |');
      expect(md).to.include('| accountId | <code>string</code> |  | The account Id |');
      expect(md).to.include('| [options] | <code>Object</code> | <code>{}</code> | Loading options |');
      expect(md).to.include('| [options.force] | <code>boolean</code> |  | Force reload |');
      expect(md).to.include("**Example**\n\n```js\nconst rows = await cmp.loadRows('001xx000003DGbY', { force: true });\n```");
    });

    it('renders getters and setters', () => {
      expect(md).to.include('#### hasRows\n');
      expect(md).to.include('**Kind**: instance property (getter) of <code>AccountSummary</code>');
      expect(md).to.include('**Returns**: <code>boolean</code>');
      expect(md).to.include('#### selectedRow : <code>Object</code>');
      expect(md).to.include('**Kind**: instance property (setter) of <code>AccountSummary</code>');
    });

    it('renders deprecated members, arrow function methods and static methods', () => {
      expect(md).to.include('#### refresh()\n');
      expect(md).to.include('**Deprecated**: Use loadRows instead');
      expect(md).to.include('#### handleRowClick(event)\n');
      expect(md).to.include('**Kind**: instance method of <code>AccountSummary</code>');
      expect(md).to.include('| Param | Type | Description |');
      expect(md).to.include('| event | <code>CustomEvent</code> | The row event |');
      expect(md).to.include('#### buildLabel(value) ⇒ <code>string</code>');
      expect(md).to.include('**Kind**: static method of <code>AccountSummary</code>');
      expect(md).to.include('| value | <code>string</code> \\| <code>number</code> | Raw value |');
    });

    it('skips undocumented and private members', () => {
      expect(md).to.not.include('undocumentedField');
      expect(md).to.not.include('undocumentedMethod');
      expect(md).to.not.include('_counter');
      expect(md).to.not.include('secret');
      expect(md).to.not.include('Hidden helper');
    });

    it('keeps the source order and is deterministic', () => {
      expect(md.indexOf('### AccountSummary')).to.be.lessThan(md.indexOf('#### recordId'));
      expect(md.indexOf('#### recordId')).to.be.lessThan(md.indexOf('#### loadRows'));
      expect(md.indexOf('#### loadRows')).to.be.lessThan(md.indexOf('#### buildLabel'));
      expect(renderJsdocMarkdown(LWC_SOURCE, { fileName: 'accountSummary.js' })).to.equal(md);
      expect(md).to.not.match(/\n{3,}/);
      expect(md.endsWith('\n')).to.be.false;
    });
  });

  describe('parseJsdocSymbols', () => {
    it('returns typed symbols including private ones', () => {
      const symbols = parseJsdocSymbols(LWC_SOURCE);
      const byName = Object.fromEntries(symbols.map((s) => [s.name, s]));
      expect(byName.AccountSummary.kind).to.equal('class');
      expect(byName.recordId.kind).to.equal('property');
      expect(byName.recordId.decorators).to.deep.equal(['@api']);
      expect(byName.loadRows.kind).to.equal('method');
      expect(byName.loadRows.isAsync).to.be.true;
      expect(byName.loadRows.params.map((p) => p.name)).to.deep.equal(['accountId', 'options', 'options.force']);
      expect(byName.loadRows.params[1].optional).to.be.true;
      expect(byName.loadRows.params[1].defaultValue).to.equal('{}');
      expect(byName.hasRows.kind).to.equal('getter');
      expect(byName.buildLabel.isStatic).to.be.true;
      expect(byName._counter.isPrivate).to.be.true;
      expect(byName['#secret'].isPrivate).to.be.true;
      expect(byName.undocumentedMethod).to.be.undefined;
    });
  });

  describe('functions, constants and file level comments', () => {
    it('renders exported functions and arrow functions as global functions', () => {
      const source = [
        '/**',
        ' * Adds two numbers.',
        ' * @param {number} a First operand',
        ' * @param {number} b Second operand',
        ' * @return {number} The sum',
        ' */',
        'export function add(a, b) { return a + b; }',
        '',
        '/** Multiplies two numbers. */',
        'export const mul = async (a, b) => a * b;',
        '',
        '/** Doubles a number. */',
        'const twice = x => x * 2;',
      ].join('\n');
      const md = renderJsdocMarkdown(source);
      expect(md).to.include('### add(a, b) ⇒ <code>number</code>');
      expect(md).to.include('**Kind**: global function');
      expect(md).to.include('**Returns**: <code>number</code> - The sum');
      expect(md).to.include('### mul(a, b)\n');
      expect(md).to.include('### twice(x)\n');
    });

    it('renders constants with their type and default value', () => {
      const source = '/**\n * Maximum rows\n * @type {number}\n */\nconst MAX_ROWS = 50;\n';
      const md = renderJsdocMarkdown(source);
      expect(md).to.include('### MAX_ROWS : <code>number</code>');
      expect(md).to.include('**Kind**: global constant');
      expect(md).to.include('**Default**: <code>50</code>');
    });

    it('renders @file descriptions and typedefs', () => {
      const source = [
        '/**',
        ' * @file Helpers for the account card.',
        ' */',
        '',
        '/**',
        ' * @typedef {Object} Row',
        ' * @property {string} id Row identifier',
        ' * @property {string} [label] Row label',
        ' */',
      ].join('\n');
      const md = renderJsdocMarkdown(source, { fileName: 'helpers.js' });
      expect(md).to.include('Helpers for the account card.');
      expect(md).to.include('**File**: <code>helpers.js</code>');
      expect(md).to.include('### Row : <code>Object</code>');
      expect(md).to.include('**Kind**: global typedef');
      expect(md).to.include('**Properties**');
      expect(md).to.include('| Name | Type | Description |');
      expect(md).to.include('| id | <code>string</code> | Row identifier |');
      expect(md).to.include('| [label] | <code>string</code> | Row label |');
    });
  });

  describe('edge cases', () => {
    it('returns an empty string when nothing is documented', () => {
      expect(renderJsdocMarkdown('')).to.equal('');
      expect(renderJsdocMarkdown('export default class Foo {}')).to.equal('');
      expect(renderJsdocMarkdown('// just a comment\nconst a = 1;')).to.equal('');
      expect(renderJsdocMarkdown('/* block comment */\nconst a = 1;')).to.equal('');
      expect(renderJsdocMarkdown(undefined as any)).to.equal('');
    });

    it('returns an empty string when only private members are documented', () => {
      const source = 'class Foo {\n  /**\n   * Hidden\n   * @private\n   */\n  bar() {}\n}\n';
      expect(renderJsdocMarkdown(source)).to.equal('');
    });

    it('never throws on malformed comments', () => {
      expect(renderJsdocMarkdown('/** unterminated comment\nclass Foo {}')).to.equal('');
      expect(renderJsdocMarkdown('/** orphan at the end of file */')).to.equal('');
      // An empty doc comment still documents the declaration that follows it, without description
      expect(renderJsdocMarkdown('/**  */\nclass Foo {}')).to.equal('### Foo\n\n**Kind**: global class');
      const unclosedType = '/**\n * Broken\n * @param {string broken\n */\nfunction broken(a) {}\n';
      const md = renderJsdocMarkdown(unclosedType);
      expect(md).to.include('### broken(');
      expect(md).to.include('**Kind**: global function');
      const unbalanced = '/** Doc */\nclass Foo {\n  /** Method */\n  bar(a {\n';
      expect(() => renderJsdocMarkdown(unbalanced)).to.not.throw();
    });

    it('skips orphan comments followed by another doc comment', () => {
      const source = '/** Orphan text */\n/** Real doc */\nfunction real() {}\n';
      const md = renderJsdocMarkdown(source);
      expect(md).to.not.include('Orphan text');
      expect(md).to.include('### real()');
      expect(md).to.include('Real doc');
    });

    it('detects the owning class even when the class itself is undocumented', () => {
      const source = 'export default class Widget extends LightningElement {\n  /** Says hi */\n  hello() {}\n}\n\n/** Outside */\nfunction outside() {}\n';
      const md = renderJsdocMarkdown(source);
      expect(md).to.include('**Kind**: instance method of <code>Widget</code>');
      expect(md).to.include('### outside()');
      expect(md).to.include('**Kind**: global function');
    });

    it('names an anonymous default export class after the file', () => {
      const source = '/** Component */\nexport default class extends LightningElement {\n  /** Prop */\n  @api value;\n}\n';
      const md = renderJsdocMarkdown(source, { fileName: 'myCmp.js' });
      expect(md).to.include('### myCmp\n');
      expect(md).to.include('**Kind**: instance property of <code>myCmp</code>');
    });

    it('handles CRLF line endings, inline links, captions and pipes in descriptions', () => {
      const source = [
        '/**',
        ' * Formats a value. See {@link https://example.com|the docs} and {@link Other}.',
        ' * @param {string} value Either "a|b" or "c"',
        ' * @example <caption>Basic usage</caption>',
        ' *   format("a");',
        ' * @example',
        ' * ```js',
        ' * format("b");',
        ' * ```',
        ' */',
        'export function format(value) {}',
      ].join('\r\n');
      const md = renderJsdocMarkdown(source);
      expect(md).to.include('Formats a value. See [the docs](https://example.com) and <code>Other</code>.');
      expect(md).to.include('| value | <code>string</code> | Either "a\\|b" or "c" |');
      expect(md).to.include('_Basic usage_\n\n```js\nformat("a");\n```');
      expect(md).to.include('**Example**\n\n```js\nformat("b");\n```');
      expect(md).to.not.include('\r');
    });

    it('supports Aura style object literal methods and multi-line wire decorators', () => {
      const source = [
        '({',
        '  /**',
        '   * Init handler.',
        '   * @param {Object} component The component',
        '   */',
        '  doInit: function(component, event, helper) {},',
        '})',
        '',
        'class Cmp {',
        '  /** Wired list */',
        '  @wire(getList, {',
        '    listName: "$name"',
        '  })',
        '  list;',
        '}',
      ].join('\n');
      const md = renderJsdocMarkdown(source);
      expect(md).to.include('### doInit(component)');
      expect(md).to.include('| component | <code>Object</code> | The component |');
      expect(md).to.include('#### list\n');
      expect(md).to.include('**Decorators**: <code>@wire(getList, { listName: "$name" })</code>');
      expect(md).to.include('**Kind**: instance property of <code>Cmp</code>');
    });
  });
});
