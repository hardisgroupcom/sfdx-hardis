import { expect } from 'chai';
import { parseYaml } from '../../../src/common/utils/yamlUtils.js';
import { mergeIntoYamlText } from '../../../src/common/docBuilder/docUtils.js';

const handWritten = [
  'site_name: Helios',
  '# Where the pages come from',
  'docs_dir: docs',
  'theme:',
  '  name: material',
  '  # Only for the banner that says the course is not finished',
  '  custom_dir: overrides',
  '  features:',
  '    - navigation.instant',
  'extra_javascript:',
  '  - javascripts/tables.js',
  '  # The lightbox, see its header',
  '  - javascripts/lightbox.js',
  '',
].join('\n');

describe('mergeIntoYamlText()', () => {
  it('keeps the comments of a map it only adds to', () => {
    const value: any = parseYaml(handWritten);
    value.theme.features.push('navigation.prune');
    const merged = mergeIntoYamlText(handWritten, value);
    expect(merged).to.include('# Only for the banner that says the course is not finished');
    expect(merged).to.include('# Where the pages come from');
    expect(parseYaml(merged)).to.deep.equal(value);
  });

  it('keeps the comments of a list that only gained items, and appends them', () => {
    const value: any = parseYaml(handWritten);
    value.extra_javascript.push('javascripts/sfdx-hardis-doc.js');
    const merged = mergeIntoYamlText(handWritten, value);
    expect(merged).to.include('# The lightbox, see its header');
    expect(merged.indexOf('javascripts/lightbox.js')).to.be.lessThan(merged.indexOf('javascripts/sfdx-hardis-doc.js'));
    expect(parseYaml(merged)).to.deep.equal(value);
  });

  it('replaces a list that lost items, and removes a key that is gone', () => {
    const value: any = parseYaml(handWritten);
    value.extra_javascript = ['javascripts/other.js'];
    delete value.docs_dir;
    const merged = mergeIntoYamlText(handWritten, value);
    expect(parseYaml(merged)).to.deep.equal(value);
  });

  it('returns the text unchanged when nothing changed', () => {
    expect(mergeIntoYamlText(handWritten, parseYaml(handWritten))).to.equal(handWritten);
  });
});
