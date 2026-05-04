/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { buildInlineRemoveTypes, parsePackageXmlFile } from '../../../../src/common/utils/xmlUtils.js';
import { PackageXmlRemove } from '../../../../src/commands/hardis/packagexml/remove.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useTmpDir(prefix: string): { getDir: () => string } {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `${prefix}-${Date.now()}`);
    await fs.ensureDir(tmpDir);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  return { getDir: () => tmpDir };
}

function buildPackageXml(types: Record<string, string[]>): string {
  const typesXml = Object.entries(types)
    .map(([name, members]) => {
      const membersXml = members.map((m) => `        <members>${m}</members>`).join('\n');
      return `    <types>\n${membersXml}\n        <name>${name}</name>\n    </types>`;
    })
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
    typesXml +
    '\n    <version>62.0</version>\n</Package>'
  );
}

// ---------------------------------------------------------------------------
// Unit tests for buildInlineRemoveTypes
// ---------------------------------------------------------------------------
describe('buildInlineRemoveTypes', () => {
  it('produces wildcard entries for each metadata type', () => {
    const result = buildInlineRemoveTypes(['ApexClass', 'CustomObject'], []);
    expect(result).to.have.length(2);
    const apexEntry = result.find((r) => r.name[0] === 'ApexClass');
    const objEntry = result.find((r) => r.name[0] === 'CustomObject');
    expect(apexEntry?.members).to.deep.equal(['*']);
    expect(objEntry?.members).to.deep.equal(['*']);
  });

  it('groups TypeName:MemberName pairs by type', () => {
    const result = buildInlineRemoveTypes([], ['ApexClass:MyClass', 'ApexClass:AnotherClass', 'CustomObject:Account__c']);
    expect(result).to.have.length(2);
    const apexEntry = result.find((r) => r.name[0] === 'ApexClass');
    const objEntry = result.find((r) => r.name[0] === 'CustomObject');
    expect(apexEntry?.members).to.have.members(['MyClass', 'AnotherClass']);
    expect(objEntry?.members).to.deep.equal(['Account__c']);
  });

  it('wildcard from metadatatypes overrides specific members from metadatanames for the same type', () => {
    const result = buildInlineRemoveTypes(['ApexClass'], ['ApexClass:MyClass']);
    const apexEntry = result.find((r) => r.name[0] === 'ApexClass');
    expect(apexEntry?.members).to.deep.equal(['*']);
  });

  it('ignores metadatanames entries that lack a colon separator', () => {
    const result = buildInlineRemoveTypes([], ['ApexClassNoColon', 'CustomObject:Account__c']);
    expect(result).to.have.length(1);
    expect(result[0].name[0]).to.equal('CustomObject');
  });

  it('returns an empty array when both inputs are empty', () => {
    expect(buildInlineRemoveTypes([], [])).to.deep.equal([]);
  });
});

// ---------------------------------------------------------------------------
// Integration tests for hardis:packagexml:remove
// ---------------------------------------------------------------------------
describe('hardis:packagexml:remove', () => {
  const ctx = useTmpDir('packagexml-remove');

  function writeInput(filename: string, types: Record<string, string[]>): string {
    const filePath = path.join(ctx.getDir(), filename);
    fs.writeFileSync(filePath, buildPackageXml(types));
    return filePath;
  }

  // --- existing --removepackagexml flag behavior ---

  it('removes items present in the filter package.xml (--removepackagexml)', async () => {
    const inputPath = writeInput('package.xml', {
      ApexClass: ['ClassA', 'ClassB', 'ClassC'],
      CustomObject: ['Account__c', 'Contact__c'],
    });
    const filterPath = writeInput('destructiveChanges.xml', {
      ApexClass: ['ClassB'],
      CustomObject: ['Account__c'],
    });
    const outputPath = path.join(ctx.getDir(), 'out.xml');

    await PackageXmlRemove.run(['-p', inputPath, '-r', filterPath, '-f', outputPath]);

    const out = await parsePackageXmlFile(outputPath);
    expect(out['ApexClass']).to.have.members(['ClassA', 'ClassC']);
    expect(out['CustomObject']).to.deep.equal(['Contact__c']);
  });

  it('removes entire type when filter uses wildcard member (*)', async () => {
    const inputPath = writeInput('package.xml', {
      ApexClass: ['ClassA', 'ClassB'],
      CustomObject: ['MyObj__c'],
    });
    const filterPath = writeInput('filter.xml', {
      ApexClass: ['*'],
    });
    const outputPath = path.join(ctx.getDir(), 'out.xml');

    await PackageXmlRemove.run(['-p', inputPath, '-r', filterPath, '-f', outputPath]);

    const out = await parsePackageXmlFile(outputPath);
    expect(out['ApexClass']).to.be.undefined;
    expect(out['CustomObject']).to.deep.equal(['MyObj__c']);
  });

  // --- new --metadatatypes flag ---

  it('removes all members of a type when --metadatatypes is used', async () => {
    const inputPath = writeInput('package.xml', {
      ApexClass: ['ClassA', 'ClassB'],
      CustomObject: ['MyObj__c'],
    });
    const outputPath = path.join(ctx.getDir(), 'out.xml');

    await PackageXmlRemove.run(['-p', inputPath, '--metadatatypes', 'ApexClass', '-f', outputPath]);

    const out = await parsePackageXmlFile(outputPath);
    expect(out['ApexClass']).to.be.undefined;
    expect(out['CustomObject']).to.deep.equal(['MyObj__c']);
  });

  it('removes multiple types when --metadatatypes has a comma-separated list', async () => {
    const inputPath = writeInput('package.xml', {
      ApexClass: ['ClassA', 'ClassB'],
      CustomObject: ['MyObj__c'],
      Flow: ['MyFlow'],
    });
    const outputPath = path.join(ctx.getDir(), 'out.xml');

    await PackageXmlRemove.run(['-p', inputPath, '--metadatatypes', 'ApexClass,Flow', '-f', outputPath]);

    const out = await parsePackageXmlFile(outputPath);
    expect(out['ApexClass']).to.be.undefined;
    expect(out['Flow']).to.be.undefined;
    expect(out['CustomObject']).to.deep.equal(['MyObj__c']);
  });

  it('ignores --metadatatypes values that are not in the source package.xml', async () => {
    const inputPath = writeInput('package.xml', {
      CustomObject: ['MyObj__c'],
    });
    const outputPath = path.join(ctx.getDir(), 'out.xml');

    await PackageXmlRemove.run(['-p', inputPath, '--metadatatypes', 'ApexClass', '-f', outputPath]);

    const out = await parsePackageXmlFile(outputPath);
    expect(out['CustomObject']).to.deep.equal(['MyObj__c']);
  });

  // --- new --metadatanames flag ---

  it('removes specific members when --metadatanames is used', async () => {
    const inputPath = writeInput('package.xml', {
      ApexClass: ['ClassA', 'ClassB', 'ClassC'],
      CustomObject: ['Account__c', 'Contact__c'],
    });
    const outputPath = path.join(ctx.getDir(), 'out.xml');

    await PackageXmlRemove.run([
      '-p', inputPath,
      '--metadatanames', 'ApexClass:ClassB,CustomObject:Account__c',
      '-f', outputPath,
    ]);

    const out = await parsePackageXmlFile(outputPath);
    expect(out['ApexClass']).to.have.members(['ClassA', 'ClassC']);
    expect(out['CustomObject']).to.deep.equal(['Contact__c']);
  });

  it('removes the entire type block when all members are specified in --metadatanames', async () => {
    const inputPath = writeInput('package.xml', {
      ApexClass: ['ClassA'],
      CustomObject: ['MyObj__c'],
    });
    const outputPath = path.join(ctx.getDir(), 'out.xml');

    await PackageXmlRemove.run(['-p', inputPath, '--metadatanames', 'ApexClass:ClassA', '-f', outputPath]);

    const out = await parsePackageXmlFile(outputPath);
    expect(out['ApexClass']).to.be.undefined;
    expect(out['CustomObject']).to.deep.equal(['MyObj__c']);
  });

  // --- combining --metadatatypes and --metadatanames ---

  it('combines --metadatatypes and --metadatanames when both are provided', async () => {
    const inputPath = writeInput('package.xml', {
      ApexClass: ['ClassA', 'ClassB'],
      CustomObject: ['Account__c', 'Contact__c'],
      Flow: ['MyFlow'],
    });
    const outputPath = path.join(ctx.getDir(), 'out.xml');

    await PackageXmlRemove.run([
      '-p', inputPath,
      '--metadatatypes', 'Flow',
      '--metadatanames', 'CustomObject:Account__c',
      '-f', outputPath,
    ]);

    const out = await parsePackageXmlFile(outputPath);
    expect(out['ApexClass']).to.have.members(['ClassA', 'ClassB']);
    expect(out['CustomObject']).to.deep.equal(['Contact__c']);
    expect(out['Flow']).to.be.undefined;
  });

  // --- --removedonly flag with new inline flags ---

  it('--removedonly with --metadatatypes returns only the removed items', async () => {
    const inputPath = writeInput('package.xml', {
      ApexClass: ['ClassA', 'ClassB'],
      CustomObject: ['MyObj__c'],
    });
    const outputPath = path.join(ctx.getDir(), 'out.xml');

    await PackageXmlRemove.run(['-p', inputPath, '--metadatatypes', 'ApexClass', '-f', outputPath, '--removedonly']);

    const out = await parsePackageXmlFile(outputPath);
    expect(out['ApexClass']).to.have.members(['ClassA', 'ClassB']);
    expect(out['CustomObject']).to.be.undefined;
  });

  it('--removedonly with --metadatanames returns only the specified removed members', async () => {
    const inputPath = writeInput('package.xml', {
      ApexClass: ['ClassA', 'ClassB', 'ClassC'],
    });
    const outputPath = path.join(ctx.getDir(), 'out.xml');

    await PackageXmlRemove.run([
      '-p', inputPath,
      '--metadatanames', 'ApexClass:ClassA,ApexClass:ClassC',
      '-f', outputPath,
      '--removedonly',
    ]);

    const out = await parsePackageXmlFile(outputPath);
    expect(out['ApexClass']).to.have.members(['ClassA', 'ClassC']);
  });

  // --- return value ---

  it('run() returns the output file path', async () => {
    const inputPath = writeInput('package.xml', { ApexClass: ['ClassA'] });
    const filterPath = writeInput('filter.xml', { ApexClass: ['ClassA'] });
    const outputPath = path.join(ctx.getDir(), 'out.xml');

    const result: any = await PackageXmlRemove.run(['-p', inputPath, '-r', filterPath, '-f', outputPath]);

    expect(result).to.deep.equal({ outputPackageXmlFile: outputPath });
  });
});
