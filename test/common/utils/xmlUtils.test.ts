/* eslint-disable @typescript-eslint/no-unused-expressions */
// Characterization tests for the XML parse/build helpers.
// The expected files under test/fixtures/xml/expected and the parsed JSON shapes
// under test/fixtures/xml/parsed were generated with the historical xml2js-based
// implementation: any change to the XML engine must keep them byte-identical
// (metadata XML round-trip fidelity is critical for CI/CD diffs).
import { expect } from 'chai';
import fs from '../../../src/common/utils/fsUtils.js';
import * as os from 'os';
import * as path from 'path';
import {
  countPackageXmlItems,
  isPackageXmlEmpty,
  listDuplicateFolderMetadataApiNames,
  parseXmlFile,
  parseXmlString,
  parsePackageXmlFile,
  removePackageXmlFilesContent,
  writeXmlFile,
  writeXmlFileFormatted,
  writePackageXmlFile,
} from '../../../src/common/utils/xmlUtils.js';

const fixturesDir = path.join(process.cwd(), 'test', 'fixtures', 'xml');
const samples = ['package-sample', 'custom-labels-sample', 'profile-sample', 'attributes-sample'];

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'sfdx-hardis-xml-test-'));
}

describe('xmlUtils XML engine characterization', () => {
  for (const sample of samples) {
    it(`parses ${sample}.xml into the xml2js-compatible shape`, async () => {
      const parsed = await parseXmlFile(path.join(fixturesDir, `${sample}.xml`));
      const expected = await fs.readJson(path.join(fixturesDir, 'parsed', `${sample}.json`));
      expect(parsed).to.deep.equal(expected);
    });

    it(`round-trips ${sample}.xml byte-identically`, async () => {
      const parsed = await parseXmlFile(path.join(fixturesDir, `${sample}.xml`));
      const tmpDir = await makeTmpDir();
      const outFile = path.join(tmpDir, `${sample}.xml`);
      try {
        await writeXmlFile(outFile, parsed);
        const written = await fs.readFile(outFile, 'utf8');
        const expected = await fs.readFile(path.join(fixturesDir, 'expected', `${sample}.xml`), 'utf8');
        expect(written).to.equal(expected);
      } finally {
        await fs.remove(tmpDir);
      }
    });

    it(`write(parse(x)) is stable for ${sample}.xml`, async () => {
      const tmpDir = await makeTmpDir();
      try {
        const firstFile = path.join(tmpDir, 'first.xml');
        const secondFile = path.join(tmpDir, 'second.xml');
        await writeXmlFile(firstFile, await parseXmlFile(path.join(fixturesDir, `${sample}.xml`)));
        await writeXmlFile(secondFile, await parseXmlFile(firstFile));
        expect(await fs.readFile(secondFile, 'utf8')).to.equal(await fs.readFile(firstFile, 'utf8'));
      } finally {
        await fs.remove(tmpDir);
      }
    });
  }

  it('parses empty leafs as [""] and attributed nil elements as [{ $: ... }]', async () => {
    const labels = await parseXmlFile(path.join(fixturesDir, 'custom-labels-sample.xml'));
    expect(labels.CustomLabels.labels[1].shortDescription).to.deep.equal(['']);
    expect(labels.CustomLabels.labels[1].value).to.deep.equal(['']);
    const translations = await parseXmlFile(path.join(fixturesDir, 'attributes-sample.xml'));
    expect(translations.CustomObjectTranslation.fields[0].help).to.deep.equal([{ $: { 'xsi:nil': 'true' } }]);
  });

  it('keeps root element attributes under $', async () => {
    const parsed = await parseXmlFile(path.join(fixturesDir, 'package-sample.xml'));
    expect(parsed.Package.$).to.deep.equal({ xmlns: 'http://soap.sforce.com/2006/04/metadata' });
  });

  it('writeXmlFileFormatted normalizes an XML string through the same engine', async () => {
    const tmpDir = await makeTmpDir();
    try {
      const outFile = path.join(tmpDir, 'formatted.xml');
      const raw = await fs.readFile(path.join(fixturesDir, 'package-sample.xml'), 'utf8');
      await writeXmlFileFormatted(outFile, raw);
      const expected = await fs.readFile(path.join(fixturesDir, 'expected', 'package-sample.xml'), 'utf8');
      expect(await fs.readFile(outFile, 'utf8')).to.equal(expected);
    } finally {
      await fs.remove(tmpDir);
    }
  });

  it('honors the SFDX_XML_INDENT env var', async () => {
    const tmpDir = await makeTmpDir();
    const previousIndent = process.env.SFDX_XML_INDENT;
    process.env.SFDX_XML_INDENT = '  ';
    try {
      const outFile = path.join(tmpDir, 'indent.xml');
      await writeXmlFile(outFile, { Package: { version: ['62.0'] } });
      const written = await fs.readFile(outFile, 'utf8');
      expect(written).to.include('\n  <version>62.0</version>');
    } finally {
      if (previousIndent === undefined) {
        delete process.env.SFDX_XML_INDENT;
      } else {
        process.env.SFDX_XML_INDENT = previousIndent;
      }
      await fs.remove(tmpDir);
    }
  });

  it('preserves significant leading/trailing whitespace in text values', () => {
    const parsed = parseXmlString('<CustomLabels><labels><value>Total: </value><other> padded </other></labels></CustomLabels>');
    expect(parsed.CustomLabels.labels[0].value).to.deep.equal(['Total: ']);
    expect(parsed.CustomLabels.labels[0].other).to.deep.equal([' padded ']);
  });

  it('round-trips a value with trailing whitespace byte-identically', async () => {
    const tmpDir = await makeTmpDir();
    try {
      const outFile = path.join(tmpDir, 'trailing.xml');
      const parsed = parseXmlString('<CustomLabels><labels><value>Total: </value></labels></CustomLabels>');
      await writeXmlFile(outFile, parsed);
      expect(await fs.readFile(outFile, 'utf8')).to.include('<value>Total: </value>');
    } finally {
      await fs.remove(tmpDir);
    }
  });

  it('parses whitespace-only values as empty strings like the historical parser', () => {
    const parsed = parseXmlString('<CustomLabels><labels><value>   </value><desc>\n    </desc></labels></CustomLabels>');
    expect(parsed.CustomLabels.labels[0].value).to.deep.equal(['']);
    expect(parsed.CustomLabels.labels[0].desc).to.deep.equal(['']);
  });

  it('drops indentation whitespace between elements', () => {
    const parsed = parseXmlString('<Package>\n    <types>\n        <name>ApexClass</name>\n    </types>\n</Package>');
    expect(parsed).to.deep.equal({ Package: { types: [{ name: ['ApexClass'] }] } });
  });

  it('drops XML comments like the historical parser', () => {
    const parsed = parseXmlString('<?xml version="1.0" encoding="UTF-8"?>\n<Package><!-- a comment --><version>62.0</version></Package>');
    expect(parsed).to.deep.equal({ Package: { version: ['62.0'] } });
  });

  it('extracts CDATA content as plain text', () => {
    const parsed = parseXmlString('<CustomLabels><labels><value><![CDATA[Some <b>html</b> & text]]></value></labels></CustomLabels>');
    expect(parsed.CustomLabels.labels[0].value).to.deep.equal(['Some <b>html</b> & text']);
  });

  it('decodes numeric character references', () => {
    const parsed = parseXmlString('<CustomLabels><labels><value>caf&#233; &#x26; th&#xE9;</value></labels></CustomLabels>');
    expect(parsed.CustomLabels.labels[0].value).to.deep.equal(['café & thé']);
  });

  it('throws on malformed XML', () => {
    expect(() => parseXmlString('<Package><types></Package>')).to.throw();
  });

  it('parseXmlFile wraps parse errors in an SfError mentioning the file', async () => {
    const tmpDir = await makeTmpDir();
    try {
      const badFile = path.join(tmpDir, 'bad.xml');
      await fs.writeFile(badFile, '<Package><oops></Package>');
      try {
        await parseXmlFile(badFile);
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('bad.xml');
      }
    } finally {
      await fs.remove(tmpDir);
    }
  });

  it('supports the explicitArray:false shape (single child = object, repeated = array)', () => {
    const xml = '<CustomLabels><labels><fullName>A</fullName></labels><labels><fullName>B</fullName></labels><version>62.0</version></CustomLabels>';
    const parsed = parseXmlString(xml, { explicitArray: false });
    expect(parsed.CustomLabels.version).to.equal('62.0');
    expect(parsed.CustomLabels.labels).to.be.an('array').with.length(2);
    expect(parsed.CustomLabels.labels[0].fullName).to.equal('A');
  });

  it('escapes &, < and > in text values but not quotes', async () => {
    const tmpDir = await makeTmpDir();
    try {
      const outFile = path.join(tmpDir, 'escape.xml');
      await writeXmlFile(outFile, { CustomLabels: { labels: [{ value: ['a & b < c > "d"'] }] } });
      const written = await fs.readFile(outFile, 'utf8');
      expect(written).to.include('<value>a &amp; b &lt; c &gt; "d"</value>');
    } finally {
      await fs.remove(tmpDir);
    }
  });
});

describe('package.xml helpers', () => {
  it('parsePackageXmlFile returns a type -> members map', async () => {
    const content = await parsePackageXmlFile(path.join(fixturesDir, 'package-sample.xml'));
    expect(content).to.deep.equal({
      ApexClass: ['*'],
      CustomField: ['Account.AccountNumber__c', 'Account.Client_Type__c'],
      PermissionSet: ['MyPermissionSet'],
    });
  });

  it('countPackageXmlItems counts all members', async () => {
    expect(await countPackageXmlItems(path.join(fixturesDir, 'package-sample.xml'))).to.equal(4);
  });

  it('isPackageXmlEmpty returns false on a filled package.xml', async () => {
    expect(await isPackageXmlEmpty(path.join(fixturesDir, 'package-sample.xml'))).to.be.false;
  });

  it('writePackageXmlFile creates a valid package.xml from scratch', async () => {
    const tmpDir = await makeTmpDir();
    try {
      const outFile = path.join(tmpDir, 'package.xml');
      await writePackageXmlFile(outFile, { ApexClass: ['MyClass'], CustomObject: ['Account'] });
      const reRead = await parsePackageXmlFile(outFile);
      expect(reRead).to.deep.equal({ ApexClass: ['MyClass'], CustomObject: ['Account'] });
      const rawContent = await fs.readFile(outFile, 'utf8');
      expect(rawContent).to.include('<?xml version="1.0" encoding="UTF-8"?>');
      expect(rawContent).to.include('<Package>');
    } finally {
      await fs.remove(tmpDir);
    }
  });
});

// A Report or a Dashboard API name is unique in the whole org, so the same API name in two folders is
// the same component: package-no-overwrite.xml must protect it whatever the folder it sits in the org.
describe('folder based metadata with an org unique API name', () => {
  function packageXmlWith(types: { [type: string]: string[] }): string {
    const typesXml = Object.keys(types)
      .map(
        (type) =>
          `    <types>\n${types[type].map((m) => `        <members>${m}</members>`).join('\n')}\n        <name>${type}</name>\n    </types>`
      )
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${typesXml}\n    <version>62.0</version>\n</Package>`;
  }

  // Target org content: My_Report sits in the GlobalFollowup folder
  const orgManifest = packageXmlWith({
    Report: ['GlobalFollowup/', 'GlobalFollowup/My_Report', 'Mercury/', 'Mercury/Another_Report'],
    ApexClass: ['MyClass'],
  });

  async function filterPackage(packageXml: string, filterXml: string, options: any): Promise<any> {
    const tmpDir = await makeTmpDir();
    try {
      const packageXmlFile = path.join(tmpDir, 'package.xml');
      const filterFile = path.join(tmpDir, 'filter.xml');
      await fs.writeFile(packageXmlFile, packageXml);
      await fs.writeFile(filterFile, filterXml);
      const types = await removePackageXmlFilesContent(packageXmlFile, filterFile, options);
      const result: { [type: string]: string[] } = {};
      for (const type of types) {
        result[type.name[0]] = type.members || [];
      }
      return result;
    } finally {
      await fs.remove(tmpDir);
    }
  }

  it('protects a Report that exists in the target org under another folder', async () => {
    const result = await filterPackage(
      packageXmlWith({ Report: ['Mercury/My_Report'], ApexClass: ['MyClass'] }),
      orgManifest,
      { removedOnly: false, keepEmptyTypes: true, context: 'no-overwrite-remove' }
    );
    expect(result.Report).to.deep.equal([]);
  });

  it('still deploys a Report that does not exist in the target org', async () => {
    const result = await filterPackage(packageXmlWith({ Report: ['Mercury/A_New_Report'] }), orgManifest, {
      removedOnly: false,
      keepEmptyTypes: true,
      context: 'no-overwrite-remove',
    });
    expect(result.Report).to.deep.equal(['Mercury/A_New_Report']);
  });

  it('keeps a Report of package-no-overwrite.xml listed under another folder in the org', async () => {
    const result = await filterPackage(packageXmlWith({ Report: ['Mercury/My_Report'] }), orgManifest, {
      removedOnly: true,
      keepEmptyTypes: false,
      context: 'no-overwrite-keep',
    });
    expect(result.Report).to.deep.equal(['Mercury/My_Report']);
  });

  it('does not make folder entries match each other', async () => {
    const result = await filterPackage(packageXmlWith({ Report: ['Other_Folder/'] }), orgManifest, {
      removedOnly: false,
      keepEmptyTypes: true,
      context: 'no-overwrite-remove',
    });
    expect(result.Report).to.deep.equal(['Other_Folder/']);
  });

  it('keeps folder sensitive matching for the types that are not org unique', async () => {
    const orgWithEmailTemplate = packageXmlWith({ EmailTemplate: ['GlobalFollowup/My_Template'] });
    const result = await filterPackage(packageXmlWith({ EmailTemplate: ['Mercury/My_Template'] }), orgWithEmailTemplate, {
      removedOnly: false,
      keepEmptyTypes: true,
      context: 'no-overwrite-remove',
    });
    expect(result.EmailTemplate).to.deep.equal(['Mercury/My_Template']);
  });

  it('keeps folder sensitive matching outside of the no-overwrite filtering', async () => {
    const result = await filterPackage(packageXmlWith({ Report: ['Mercury/My_Report'] }), orgManifest, {
      removedOnly: false,
      keepEmptyTypes: true,
      context: 'delta',
    });
    expect(result.Report).to.deep.equal(['Mercury/My_Report']);
  });

  it('listDuplicateFolderMetadataApiNames reports API names present in several folders', async () => {
    const tmpDir = await makeTmpDir();
    try {
      const packageXmlFile = path.join(tmpDir, 'package.xml');
      await fs.writeFile(
        packageXmlFile,
        packageXmlWith({
          Report: ['Mercury/', 'Mercury/My_Report', 'Mercury/Sub/My_Report', 'Mercury/Alone', 'unfiled$public/Alone2'],
          Dashboard: ['A/Same_Name', 'B/Same_Name'],
          EmailTemplate: ['A/Not_Org_Unique', 'B/Not_Org_Unique'],
        })
      );
      const duplicates = await listDuplicateFolderMetadataApiNames(packageXmlFile);
      expect(duplicates).to.deep.equal([
        { type: 'Report', apiName: 'My_Report', members: ['Mercury/My_Report', 'Mercury/Sub/My_Report'] },
        { type: 'Dashboard', apiName: 'Same_Name', members: ['A/Same_Name', 'B/Same_Name'] },
      ]);
    } finally {
      await fs.remove(tmpDir);
    }
  });

  it('listDuplicateFolderMetadataApiNames returns nothing on a clean package.xml', async () => {
    const tmpDir = await makeTmpDir();
    try {
      const packageXmlFile = path.join(tmpDir, 'package.xml');
      await fs.writeFile(packageXmlFile, packageXmlWith({ Report: ['*'], Dashboard: ['A/One', 'B/Two'] }));
      expect(await listDuplicateFolderMetadataApiNames(packageXmlFile)).to.deep.equal([]);
    } finally {
      await fs.remove(tmpDir);
    }
  });
});
