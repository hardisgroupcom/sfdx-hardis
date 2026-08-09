/* eslint-disable @typescript-eslint/no-unused-expressions */
// Characterization tests for the XML parse/build helpers.
// The expected files under test/fixtures/xml/expected and the parsed JSON shapes
// under test/fixtures/xml/parsed were generated with the historical xml2js-based
// implementation: any change to the XML engine must keep them byte-identical
// (metadata XML round-trip fidelity is critical for CI/CD diffs).
import { expect } from 'chai';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import {
  countPackageXmlItems,
  isPackageXmlEmpty,
  parseXmlFile,
  parsePackageXmlFile,
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
