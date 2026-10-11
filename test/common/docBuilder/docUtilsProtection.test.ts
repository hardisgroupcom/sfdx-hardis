import { strict as assert } from 'assert';
import fs from '../../../src/common/utils/fsUtils.js';
import * as os from 'os';
import * as path from 'path';
import { isDocProtected, withDocProtectionHeader } from '../../../src/common/docBuilder/docUtils.js';

/**
 * Every generated page tells its reader to set DO_NOT_OVERWRITE_DOC=TRUE to keep what they wrote in
 * it. The Apex and Flow pages carried neither the lines nor the check: a sentence written there was
 * gone at the next generation.
 */
describe('documentation page protection', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-protection-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('puts the two protection lines on top of a page that has none', () => {
    const page = withDocProtectionHeader('# InstallationScheduler Class\n');
    const lines = page.split('\n');
    assert.match(lines[0], /auto-generated/);
    assert.equal(lines[1], '<!-- DO_NOT_OVERWRITE_DOC=FALSE -->');
    assert.equal(lines[3], '# InstallationScheduler Class');
  });

  it('never adds them twice', () => {
    const once = withDocProtectionHeader('# Flow\n');
    assert.equal(withDocProtectionHeader(once), once);
  });

  it('reads a page marked TRUE as protected, and a missing or FALSE page as not', () => {
    const marked = path.join(dir, 'marked.md');
    const generated = path.join(dir, 'generated.md');
    fs.writeFileSync(marked, withDocProtectionHeader('# Page\n').replace('=FALSE', '=TRUE'));
    fs.writeFileSync(generated, withDocProtectionHeader('# Page\n'));
    assert.equal(isDocProtected(marked), true);
    assert.equal(isDocProtected(generated), false);
    assert.equal(isDocProtected(path.join(dir, 'missing.md')), false);
  });

  it('accepts the marker typed in lower case', () => {
    const marked = path.join(dir, 'lower.md');
    fs.writeFileSync(marked, withDocProtectionHeader('# Page\n').replace('=FALSE', '=true'));
    assert.equal(isDocProtected(marked), true);
  });

  // An Apex page embeds the source of its class, which can quote the markers
  it('only reads the head of a page', () => {
    const body = '# Class\n\n' + 'x'.repeat(2000) + '\n// <!-- DO_NOT_OVERWRITE_DOC=TRUE -->\n';
    const page = withDocProtectionHeader(body);
    assert.match(page.split('\n')[1], /DO_NOT_OVERWRITE_DOC=FALSE/);
    const file = path.join(dir, 'class.md');
    fs.writeFileSync(file, page);
    assert.equal(isDocProtected(file), false);
  });
});
