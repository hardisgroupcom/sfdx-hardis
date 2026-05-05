import { expect } from 'chai';
import { isValidEmail, formatTemplate, decodeHtmlEntities, toPascalCase } from '../../../src/common/utils/stringUtils.js';

describe('isValidEmail()', () => {
  it('accepts a standard email', () => {
    expect(isValidEmail('user@example.com')).to.be.true;
  });

  it('accepts an email with subdomain', () => {
    expect(isValidEmail('user@mail.example.co.uk')).to.be.true;
  });

  it('accepts an email with plus sign', () => {
    expect(isValidEmail('user+tag@example.com')).to.be.true;
  });

  it('rejects a string without @', () => {
    expect(isValidEmail('not-an-email')).to.be.false;
  });

  it('rejects a string with space', () => {
    expect(isValidEmail('user @example.com')).to.be.false;
  });

  it('rejects a string without domain part', () => {
    expect(isValidEmail('user@')).to.be.false;
  });

  it('rejects an empty string', () => {
    expect(isValidEmail('')).to.be.false;
  });
});

describe('formatTemplate()', () => {
  it('replaces a named placeholder with an object', () => {
    expect(formatTemplate('Hello {name}', { name: 'World' })).to.equal('Hello World');
  });

  it('replaces multiple named placeholders', () => {
    expect(formatTemplate('{first} and {second}', { first: 'foo', second: 'bar' })).to.equal('foo and bar');
  });

  it('replaces numeric index placeholders with an array', () => {
    expect(formatTemplate('Item {0} of {1}', ['foo', 'bar'])).to.equal('Item foo of bar');
  });

  it('leaves unknown placeholders unchanged', () => {
    expect(formatTemplate('Hello {missing}', {})).to.equal('Hello {missing}');
  });

  it('replaces a placeholder with a number value', () => {
    expect(formatTemplate('Count: {n}', { n: 42 })).to.equal('Count: 42');
  });

  it('returns the original string when no placeholders', () => {
    expect(formatTemplate('No placeholders', { name: 'x' })).to.equal('No placeholders');
  });
});

describe('decodeHtmlEntities()', () => {
  it('decodes &amp;', () => {
    expect(decodeHtmlEntities('foo &amp; bar')).to.equal('foo & bar');
  });

  it('decodes &lt; and &gt;', () => {
    expect(decodeHtmlEntities('&lt;div&gt;')).to.equal('<div>');
  });

  it('decodes &quot;', () => {
    expect(decodeHtmlEntities('say &quot;hello&quot;')).to.equal('say "hello"');
  });

  it('decodes &#39;', () => {
    expect(decodeHtmlEntities("it&#39;s")).to.equal("it's");
  });

  it('decodes &apos;', () => {
    expect(decodeHtmlEntities("it&apos;s")).to.equal("it's");
  });

  it('leaves an unrecognised entity unchanged', () => {
    expect(decodeHtmlEntities('&unknown;')).to.equal('&unknown;');
  });

  it('returns a plain string unchanged', () => {
    expect(decodeHtmlEntities('hello world')).to.equal('hello world');
  });
});

describe('toPascalCase()', () => {
  it('converts hyphen-separated words', () => {
    expect(toPascalCase('my-folder-name')).to.equal('MyFolderName');
  });

  it('converts underscore-separated words', () => {
    expect(toPascalCase('my_template')).to.equal('MyTemplate');
  });

  it('converts space-separated words', () => {
    expect(toPascalCase('hello world')).to.equal('HelloWorld');
  });

  it('handles an already-PascalCase string', () => {
    expect(toPascalCase('MyName')).to.equal('MyName');
  });

  it('handles a single word', () => {
    expect(toPascalCase('word')).to.equal('Word');
  });

  it('handles mixed separators', () => {
    expect(toPascalCase('foo-bar_baz')).to.equal('FooBarBaz');
  });
});
