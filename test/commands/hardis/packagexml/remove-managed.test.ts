import { expect } from 'chai';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { isManagedPackageMember, parsePackageXmlFile } from '../../../../src/common/utils/xmlUtils.js';
import { PackageXmlRemoveManaged } from '../../../../src/commands/hardis/packagexml/remove-managed.js';

type RemoveManagedResult = {
  outputPackageXmlFile: string;
  namespaces: string[];
  removedCount: number;
  removedByType: Record<string, string[]>;
};

/**
 * Lightweight temp-directory helper that does NOT call process.chdir(),
 * avoiding conflicts with ESM module resolution during teardown.
 */
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

// ---------------------------------------------------------------------------
// Helper: write a minimal package.xml file from a plain object
// ---------------------------------------------------------------------------
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
// Unit tests for the shared xmlUtils helper
// ---------------------------------------------------------------------------
describe('isManagedPackageMember', () => {
  const namespaces = ['SBQQ', 'nCino'];

  it('top-level namespaced item is managed', () => {
    expect(isManagedPackageMember('SBQQ__Quote__c', namespaces)).to.be.true;
  });

  it('top-level custom item is not managed', () => {
    expect(isManagedPackageMember('MyObject__c', namespaces)).to.be.false;
  });

  it('namespaced child on namespaced parent is managed', () => {
    expect(isManagedPackageMember('SBQQ__Quote__c.SBQQ__Status__c', namespaces)).to.be.true;
  });

  it('custom child on namespaced parent is NOT managed (must be preserved)', () => {
    expect(isManagedPackageMember('SBQQ__Quote__c.My_Custom_Field__c', namespaces)).to.be.false;
  });

  it('namespaced child on standard parent is managed', () => {
    expect(isManagedPackageMember('Account.SBQQ__Field__c', namespaces)).to.be.true;
  });

  it('custom child on custom parent is not managed', () => {
    expect(isManagedPackageMember('MyObj__c.MyField__c', namespaces)).to.be.false;
  });

  it('second namespace is detected', () => {
    expect(isManagedPackageMember('nCino__Loan__c', namespaces)).to.be.true;
  });

  it('name sharing only a partial prefix is not managed', () => {
    // "SBQQExtra__Obj__c" does not start with "SBQQ__"
    expect(isManagedPackageMember('SBQQExtra__Obj__c', namespaces)).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// Integration tests for hardis:packagexml:remove-managed
// ---------------------------------------------------------------------------
describe('hardis:packagexml:remove-managed', () => {
  const ctx = useTmpDir('remove-managed');

  function writeInput(filename: string, types: Record<string, string[]>): string {
    const filePath = path.join(ctx.getDir(), filename);
    fs.writeFileSync(filePath, buildPackageXml(types));
    return filePath;
  }

  it('removes managed items when --namespaces is provided', async () => {
    const inputPath = writeInput('package.xml', {
      CustomObject: ['SBQQ__Quote__c', 'MyObject__c'],
      CustomField: ['SBQQ__Quote__c.SBQQ__Status__c', 'SBQQ__Quote__c.My_Status__c', 'MyObject__c.MyField__c'],
    });
    const outputPath = path.join(ctx.getDir(), 'out.xml');

    const result = (await PackageXmlRemoveManaged.run(['-p', inputPath, '-n', 'SBQQ', '-o', outputPath])) as RemoveManagedResult;

    // SBQQ__Quote__c (CustomObject) + SBQQ__Quote__c.SBQQ__Status__c (CustomField) = 2 removed
    expect(result.removedCount).to.equal(2);
    const out = await parsePackageXmlFile(outputPath);
    expect(out['CustomObject']).to.deep.equal(['MyObject__c']);
    expect(out['CustomField']).to.have.members(['SBQQ__Quote__c.My_Status__c', 'MyObject__c.MyField__c']);
  });

  it('default output filename is <input>-without-managed.xml', async () => {
    const inputPath = writeInput('package.xml', {
      CustomObject: ['SBQQ__Quote__c', 'MyObject__c'],
    });

    const result = (await PackageXmlRemoveManaged.run(['-p', inputPath, '-n', 'SBQQ'])) as RemoveManagedResult;

    const expectedOutput = inputPath.replace('.xml', '-without-managed.xml');
    expect(result.outputPackageXmlFile).to.equal(expectedOutput);
    expect(fs.existsSync(expectedOutput)).to.be.true;
  });

  it('--namespace-detection installed-packages reads InstalledPackage entries', async () => {
    const inputPath = writeInput('package.xml', {
      InstalledPackage: ['SBQQ'],
      CustomObject: ['SBQQ__Quote__c', 'MyObject__c'],
    });
    const outputPath = path.join(ctx.getDir(), 'out-installed.xml');

    const result = (await PackageXmlRemoveManaged.run([
      '-p', inputPath,
      '--namespace-detection', 'installed-packages',
      '-o', outputPath,
    ])) as RemoveManagedResult;

    expect(result.namespaces).to.deep.equal(['SBQQ']);
    expect(result.removedCount).to.be.greaterThan(0);
    const out = await parsePackageXmlFile(outputPath);
    expect(out['CustomObject']).to.deep.equal(['MyObject__c']);
  });

  it('--namespace-detection installed-packages returns empty when no InstalledPackage entries exist', async () => {
    const inputPath = writeInput('package.xml', {
      CustomObject: ['SBQQ__Quote__c', 'MyObject__c'],
    });
    const outputPath = path.join(ctx.getDir(), 'out-no-installed.xml');

    const result = (await PackageXmlRemoveManaged.run([
      '-p', inputPath,
      '--namespace-detection', 'installed-packages',
      '-o', outputPath,
    ])) as RemoveManagedResult;

    expect(result.namespaces).to.deep.equal([]);
    expect(result.removedCount).to.equal(0);
    expect(fs.existsSync(outputPath)).to.be.false;
  });

  it('--namespace-detection api-name (default) infers namespaces from member names', async () => {
    const inputPath = writeInput('package.xml', {
      CustomObject: ['SBQQ__Quote__c', 'MyObject__c'],
      CustomField: ['SBQQ__Quote__c.SBQQ__Status__c'],
    });
    const outputPath = path.join(ctx.getDir(), 'out-pattern.xml');

    const result = (await PackageXmlRemoveManaged.run(['-p', inputPath, '-o', outputPath])) as RemoveManagedResult;

    expect(result.namespaces).to.deep.equal(['SBQQ']);
    expect(result.removedCount).to.equal(2); // SBQQ__Quote__c + SBQQ__Quote__c.SBQQ__Status__c
  });

  it('--namespaces overrides --namespace-detection', async () => {
    // InstalledPackage has nCino, but --namespaces forces SBQQ
    const inputPath = writeInput('package.xml', {
      InstalledPackage: ['nCino'],
      CustomObject: ['SBQQ__Quote__c', 'nCino__Loan__c', 'MyObject__c'],
    });
    const outputPath = path.join(ctx.getDir(), 'out-override.xml');

    const result = (await PackageXmlRemoveManaged.run([
      '-p', inputPath,
      '-n', 'SBQQ',
      '--namespace-detection', 'installed-packages',
      '-o', outputPath,
    ])) as RemoveManagedResult;

    expect(result.namespaces).to.deep.equal(['SBQQ']);
    const out = await parsePackageXmlFile(outputPath);
    // Only SBQQ items removed; nCino items kept
    expect(out['CustomObject']).to.have.members(['nCino__Loan__c', 'MyObject__c']);
  });

  it('preserves custom metadata created on managed objects', async () => {
    const inputPath = writeInput('package.xml', {
      CustomObject: ['SBQQ__Quote__c'],
      CustomField: ['SBQQ__Quote__c.My_Custom_Field__c', 'SBQQ__Quote__c.SBQQ__Managed_Field__c'],
      ValidationRule: ['SBQQ__Quote__c.My_Validation', 'SBQQ__Quote__c.SBQQ__Managed_Validation'],
    });
    const outputPath = path.join(ctx.getDir(), 'out-preserve.xml');

    await PackageXmlRemoveManaged.run(['-p', inputPath, '-n', 'SBQQ', '-o', outputPath]);

    const out = await parsePackageXmlFile(outputPath);
    // The managed top-level object is removed → CustomObject type disappears
    expect(out['CustomObject']).to.be.undefined;
    // Custom work on the managed object is kept; managed children are removed
    expect(out['CustomField']).to.deep.equal(['SBQQ__Quote__c.My_Custom_Field__c']);
    expect(out['ValidationRule']).to.deep.equal(['SBQQ__Quote__c.My_Validation']);
  });

  it('does not write the output file when nothing is removed', async () => {
    const inputPath = writeInput('package.xml', {
      CustomObject: ['MyObject__c', 'AnotherObject__c'],
    });
    const outputPath = path.join(ctx.getDir(), 'out-none.xml');

    const result = (await PackageXmlRemoveManaged.run(['-p', inputPath, '-n', 'SBQQ', '-o', outputPath])) as RemoveManagedResult;

    expect(result.removedCount).to.equal(0);
    expect(fs.existsSync(outputPath)).to.be.false;
  });

  it('returns early with empty result when no namespaces can be detected', async () => {
    // No InstalledPackage entries, no NS__Name__ patterns in member names
    const inputPath = writeInput('package.xml', {
      CustomObject: ['MyObject__c', 'AnotherObject__c'],
    });
    const outputPath = path.join(ctx.getDir(), 'out-no-ns.xml');

    const result = (await PackageXmlRemoveManaged.run(['-p', inputPath, '-o', outputPath])) as RemoveManagedResult;

    expect(result.namespaces).to.deep.equal([]);
    expect(result.removedCount).to.equal(0);
    expect(fs.existsSync(outputPath)).to.be.false;
  });
});
