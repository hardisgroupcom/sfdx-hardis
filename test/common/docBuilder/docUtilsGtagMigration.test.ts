import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from 'fs-extra';
import * as yaml from 'js-yaml';
import { migrateGtagJsToMkDocsAnalytics, mergeIntoYamlText } from '../../../src/common/docBuilder/docUtils.js';

/** A project documentation as it was generated before analytics moved to extra.analytics. */
const legacyMkDocsYml = [
  'site_name: Helios',
  '# The pages sfdx-hardis writes',
  'docs_dir: docs',
  'extra_javascript:',
  '  - javascripts/tables.js',
  '  - javascripts/gtag.js',
  '  # Rewritten on every run',
  '  - javascripts/sfdx-hardis-doc.js',
  'extra:',
  '  social:',
  '    - icon: fontawesome/brands/github',
  '  generator: false',
  '',
].join('\n');

function gtagJsWith(id: string): string {
  return [
    'var gtag_id = "' + id + '";',
    '',
    'if (gtag_id !== "G-XXXXXXXXXX") {',
    '  var script = document.createElement("script");',
    '  script.src = "https://www.googletagmanager.com/gtag/js?id=" + gtag_id;',
    '  document.head.appendChild(script);',
    '}',
    '',
  ].join('\n');
}

describe('migrateGtagJsToMkDocsAnalytics()', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfdx-hardis-gtag-'));
    await fs.ensureDir(path.join(projectDir, 'docs', 'javascripts'));
  });

  afterEach(async () => {
    await fs.remove(projectDir);
  });

  const writeGtagJs = (id: string) =>
    fs.writeFile(path.join(projectDir, 'docs', 'javascripts', 'gtag.js'), gtagJsWith(id));

  const gtagJsExists = () => fs.existsSync(path.join(projectDir, 'docs', 'javascripts', 'gtag.js'));

  it('moves a configured measurement id into extra.analytics and drops the script', async () => {
    await writeGtagJs('G-ABC1234567');
    const mkdocsYml: any = yaml.load(legacyMkDocsYml);

    const result = await migrateGtagJsToMkDocsAnalytics(projectDir, mkdocsYml);

    expect(result.movedProperty).to.equal('G-ABC1234567');
    expect(mkdocsYml.extra.analytics).to.deep.equal({ provider: 'google', property: 'G-ABC1234567' });
    // The rest of extra is untouched
    expect(mkdocsYml.extra.generator).to.equal(false);
    expect(mkdocsYml.extra_javascript).to.not.include('javascripts/gtag.js');
    expect(mkdocsYml.extra_javascript).to.include('javascripts/tables.js');
    expect(gtagJsExists()).to.equal(false);
  });

  it('writes the id where the theme reads it, and keeps the comments of the file', async () => {
    await writeGtagJs('G-ABC1234567');
    const mkdocsYml: any = yaml.load(legacyMkDocsYml);

    await migrateGtagJsToMkDocsAnalytics(projectDir, mkdocsYml);
    const written = mergeIntoYamlText(legacyMkDocsYml, mkdocsYml);

    const reloaded: any = yaml.load(written);
    expect(reloaded.extra.analytics.property).to.equal('G-ABC1234567');
    expect(reloaded.extra_javascript).to.not.include('javascripts/gtag.js');
    expect(written).to.include('# The pages sfdx-hardis writes');
  });

  it('drops the script of a project that never configured an id, and adds no analytics', async () => {
    await writeGtagJs('G-XXXXXXXXXX');
    const mkdocsYml: any = yaml.load(legacyMkDocsYml);

    const result = await migrateGtagJsToMkDocsAnalytics(projectDir, mkdocsYml);

    expect(result.movedProperty).to.equal(null);
    expect(mkdocsYml.extra.analytics).to.equal(undefined);
    expect(mkdocsYml.extra_javascript).to.not.include('javascripts/gtag.js');
    expect(gtagJsExists()).to.equal(false);
  });

  it('touches nothing when the two places declare different ids', async () => {
    await writeGtagJs('G-ABC1234567');
    const mkdocsYml: any = yaml.load(legacyMkDocsYml);
    mkdocsYml.extra.analytics = { provider: 'google', property: 'G-SOMEONEELSE' };

    const result = await migrateGtagJsToMkDocsAnalytics(projectDir, mkdocsYml);

    expect(result.conflictingProperty).to.equal('G-SOMEONEELSE');
    expect(result.movedProperty).to.equal(null);
    expect(mkdocsYml.extra.analytics.property).to.equal('G-SOMEONEELSE');
    // Nothing is thrown away while the project owner has not said which id is theirs
    expect(mkdocsYml.extra_javascript).to.include('javascripts/gtag.js');
    expect(gtagJsExists()).to.equal(true);
  });

  it('finishes a migration that was interrupted, when both already say the same id', async () => {
    await writeGtagJs('G-ABC1234567');
    const mkdocsYml: any = yaml.load(legacyMkDocsYml);
    mkdocsYml.extra.analytics = { provider: 'google', property: 'G-ABC1234567' };

    const result = await migrateGtagJsToMkDocsAnalytics(projectDir, mkdocsYml);

    expect(result.conflictingProperty).to.equal(null);
    expect(mkdocsYml.extra.analytics.property).to.equal('G-ABC1234567');
    expect(mkdocsYml.extra_javascript).to.not.include('javascripts/gtag.js');
    expect(gtagJsExists()).to.equal(false);
  });

  it('removes an entry left behind when the script is already gone', async () => {
    const mkdocsYml: any = yaml.load(legacyMkDocsYml);

    const result = await migrateGtagJsToMkDocsAnalytics(projectDir, mkdocsYml);

    expect(result.entryRemoved).to.equal(true);
    expect(result.fileRemoved).to.equal(false);
    expect(mkdocsYml.extra_javascript).to.not.include('javascripts/gtag.js');
  });

  it('does nothing at all on a documentation that never had the script', async () => {
    const mkdocsYml: any = yaml.load(legacyMkDocsYml);
    mkdocsYml.extra_javascript = ['javascripts/tables.js'];
    const before = JSON.parse(JSON.stringify(mkdocsYml));

    const result = await migrateGtagJsToMkDocsAnalytics(projectDir, mkdocsYml);

    expect(result).to.deep.equal({ movedProperty: null, conflictingProperty: null, fileRemoved: false, entryRemoved: false });
    expect(mkdocsYml).to.deep.equal(before);
  });

  it('is safe to run twice', async () => {
    await writeGtagJs('G-ABC1234567');
    const mkdocsYml: any = yaml.load(legacyMkDocsYml);

    await migrateGtagJsToMkDocsAnalytics(projectDir, mkdocsYml);
    const afterFirst = JSON.parse(JSON.stringify(mkdocsYml));
    await migrateGtagJsToMkDocsAnalytics(projectDir, mkdocsYml);

    expect(mkdocsYml).to.deep.equal(afterFirst);
  });
});
