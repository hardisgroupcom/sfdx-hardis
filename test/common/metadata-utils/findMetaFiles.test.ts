/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import { MetadataUtils } from '../../../src/common/metadata-utils/index.js';
import { getSfdxProjectPackageDirectories } from '../../../src/common/utils/projectUtils.js';

/**
 * Fixture project: test/fixtures/metadata-lookup-project
 *
 * Two package directories declared in its sfdx-project.json, force-app first:
 *   force-app/main/default/flows/Lookup_Alpha.flow-meta.xml
 *   force-app/main/default/flows/Lookup_Beta.flow-meta.xml
 *   force-app/main/default/flows/Lookup_Parens(1).flow-meta.xml
 *   force-app/main/default/flows/Lookup_Braces{1}.flow-meta.xml
 *   force-app/main/extra/flows/Lookup_Nested.flow-meta.xml
 *   force-app/main/default/classes/LookupSample.cls
 *   force-app/main/default/classes/LookupSample.cls-meta.xml
 *   second-app/main/default/flows/Lookup_Alpha.flow-meta.xml   (also in force-app)
 *   second-app/main/default/flows/Lookup_Gamma.flow-meta.xml
 *
 * The package directories are passed explicitly to the methods under test, so the tests
 * do not depend on the current working directory.
 */
const FIXTURE_PROJECT = path.join(process.cwd(), 'test', 'fixtures', 'metadata-lookup-project');

// Plain recursive listing, used to build the expected result without going through glob
async function listFilesRecursively(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    files.push(...(entry.isDirectory() ? await listFilesRecursively(entryPath) : [entryPath]));
  }
  return files;
}

let packageDirectories: { path: string; fullPath: string }[];

before(async () => {
  packageDirectories = await getSfdxProjectPackageDirectories(FIXTURE_PROJECT);
});

describe('MetadataUtils.findMetaFileFromTypeAndName()', () => {
  it('returns the source file of a Flow', async () => {
    const metaFile = await MetadataUtils.findMetaFileFromTypeAndName('Flow', 'Lookup_Beta', packageDirectories);
    expect(metaFile).to.equal('force-app/main/default/flows/Lookup_Beta.flow-meta.xml');
  });

  it('returns a forward-slash path, whatever the platform', async () => {
    const metaFile = await MetadataUtils.findMetaFileFromTypeAndName('Flow', 'Lookup_Beta', packageDirectories);
    expect(metaFile).to.not.include('\\');
  });

  it('finds a Flow stored in a folder other than main/default', async () => {
    const metaFile = await MetadataUtils.findMetaFileFromTypeAndName('Flow', 'Lookup_Nested', packageDirectories);
    expect(metaFile).to.equal('force-app/main/extra/flows/Lookup_Nested.flow-meta.xml');
  });

  it('finds a metadata of the second package directory', async () => {
    const metaFile = await MetadataUtils.findMetaFileFromTypeAndName('Flow', 'Lookup_Gamma', packageDirectories);
    expect(metaFile).to.equal('second-app/main/default/flows/Lookup_Gamma.flow-meta.xml');
  });

  it('returns the file of the first package directory when a name exists in several', async () => {
    const metaFile = await MetadataUtils.findMetaFileFromTypeAndName('Flow', 'Lookup_Alpha', packageDirectories);
    expect(metaFile).to.equal('force-app/main/default/flows/Lookup_Alpha.flow-meta.xml');
  });

  it('prefers the source file over the -meta.xml file', async () => {
    const metaFile = await MetadataUtils.findMetaFileFromTypeAndName('ApexClass', 'LookupSample', packageDirectories);
    expect(metaFile).to.equal('force-app/main/default/classes/LookupSample.cls');
  });

  it('returns null when the metadata has no source file', async () => {
    const metaFile = await MetadataUtils.findMetaFileFromTypeAndName('Flow', 'Lookup_Unknown', packageDirectories);
    expect(metaFile).to.be.null;
  });

  it('returns null when the metadata type is not in the registry', async () => {
    const metaFile = await MetadataUtils.findMetaFileFromTypeAndName('NotAMetadataType', 'Lookup_Beta', packageDirectories);
    expect(metaFile).to.be.null;
  });

  it('does not match a name that only partially matches a file name', async () => {
    const metaFile = await MetadataUtils.findMetaFileFromTypeAndName('Flow', 'Lookup_Alph', packageDirectories);
    expect(metaFile).to.be.null;
  });
});

describe('MetadataUtils.findMetaFilesFromTypeAndNames()', () => {
  it('returns one entry per requested name', async () => {
    const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames(
      'Flow',
      ['Lookup_Alpha', 'Lookup_Beta', 'Lookup_Gamma', 'Lookup_Nested'],
      packageDirectories
    );
    expect([...metaFiles.entries()]).to.deep.equal([
      ['Lookup_Alpha', 'force-app/main/default/flows/Lookup_Alpha.flow-meta.xml'],
      ['Lookup_Beta', 'force-app/main/default/flows/Lookup_Beta.flow-meta.xml'],
      ['Lookup_Gamma', 'second-app/main/default/flows/Lookup_Gamma.flow-meta.xml'],
      ['Lookup_Nested', 'force-app/main/extra/flows/Lookup_Nested.flow-meta.xml'],
    ]);
  });

  it('sets null for the names that have no source file, and keeps the found ones', async () => {
    const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames(
      'Flow',
      ['Lookup_Unknown', 'Lookup_Beta', 'Lookup_AlsoUnknown'],
      packageDirectories
    );
    expect([...metaFiles.entries()]).to.deep.equal([
      ['Lookup_Unknown', null],
      ['Lookup_Beta', 'force-app/main/default/flows/Lookup_Beta.flow-meta.xml'],
      ['Lookup_AlsoUnknown', null],
    ]);
  });

  it('returns an empty Map when no name is requested', async () => {
    const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames('Flow', [], packageDirectories);
    expect(metaFiles.size).to.equal(0);
  });

  it('returns only the requested names, not the other metadatas of the type', async () => {
    const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames('Flow', ['Lookup_Beta'], packageDirectories);
    expect([...metaFiles.keys()]).to.deep.equal(['Lookup_Beta']);
  });

  it('collapses duplicated requested names into a single entry', async () => {
    const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames(
      'Flow',
      ['Lookup_Beta', 'Lookup_Beta'],
      packageDirectories
    );
    expect([...metaFiles.entries()]).to.deep.equal([
      ['Lookup_Beta', 'force-app/main/default/flows/Lookup_Beta.flow-meta.xml'],
    ]);
  });

  it('returns all names as null when the metadata type is not in the registry', async () => {
    const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames(
      'NotAMetadataType',
      ['Lookup_Alpha', 'Lookup_Beta'],
      packageDirectories
    );
    expect([...metaFiles.values()]).to.deep.equal([null, null]);
  });

  // The names are injected in the glob expression, so they must be escaped to be matched literally
  it('matches names containing glob special characters literally', async () => {
    const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames(
      'Flow',
      ['Lookup_Parens(1)', 'Lookup_Braces{1}'],
      packageDirectories
    );
    expect([...metaFiles.entries()]).to.deep.equal([
      ['Lookup_Parens(1)', 'force-app/main/default/flows/Lookup_Parens(1).flow-meta.xml'],
      ['Lookup_Braces{1}', 'force-app/main/default/flows/Lookup_Braces{1}.flow-meta.xml'],
    ]);
  });

  it('does not let a glob wildcard in a name match other files', async () => {
    const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames('Flow', ['Lookup_*'], packageDirectories);
    expect(metaFiles.get('Lookup_*')).to.be.null;
  });

  // Every caller that used to look names up one by one now goes through this method, so its result is
  // compared with a listing built by walking the fixture with fs, without any glob involved
  it('returns the same files as a plain recursive listing of the fixture', async () => {
    for (const [packageXmlType, directoryName, fileSuffix] of [
      ['Flow', 'flows', '.flow-meta.xml'],
      ['ApexClass', 'classes', '.cls'],
    ] as [string, string, string][]) {
      const expected = new Map<string, string>();
      // Walk the package directories in order, first one wins, like the method under test
      for (const packageDirectory of packageDirectories) {
        for (const filePath of await listFilesRecursively(packageDirectory.fullPath)) {
          const relativePath = path.relative(packageDirectory.fullPath, filePath).split(path.sep);
          const fileName = relativePath[relativePath.length - 1];
          if (!relativePath.includes(directoryName) || !fileName.endsWith(fileSuffix)) {
            continue;
          }
          const packageXmlName = fileName.slice(0, -fileSuffix.length);
          if (!expected.has(packageXmlName)) {
            expected.set(packageXmlName, [packageDirectory.path, ...relativePath].join('/'));
          }
        }
      }
      expect(expected.size, `${packageXmlType} found in the fixture`).to.be.greaterThan(0);
      const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames(
        packageXmlType,
        [...expected.keys()],
        packageDirectories
      );
      expect([...metaFiles.entries()].sort(), packageXmlType).to.deep.equal([...expected.entries()].sort());
    }
  });

  it('returns for a single name what the batched call returns for it', async () => {
    const names = ['Lookup_Alpha', 'Lookup_Gamma', 'Lookup_Nested', 'Lookup_Unknown'];
    const batched = await MetadataUtils.findMetaFilesFromTypeAndNames('Flow', names, packageDirectories);
    for (const name of names) {
      const single = await MetadataUtils.findMetaFileFromTypeAndName('Flow', name, packageDirectories);
      expect(single, name).to.equal(batched.get(name) ?? null);
    }
  });

  // Report, Dashboard, Document and EmailTemplate are stored in folders, and their package.xml members
  // carry that folder. A slash can not go inside the extglob alternation the names are matched with, so
  // these names need their folder in the path part of the glob expression
  describe('folder-scoped metadata types', () => {
    it('resolves a name holding its folder', async () => {
      const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames(
        'Report',
        ['Lookup_Folder/Lookup_Report'],
        packageDirectories
      );
      expect([...metaFiles.entries()]).to.deep.equal([
        ['Lookup_Folder/Lookup_Report', 'force-app/main/default/reports/Lookup_Folder/Lookup_Report.report-meta.xml'],
      ]);
    });

    it('keeps the folder of each name, for two names sharing the same leaf name', async () => {
      const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames(
        'Report',
        ['Lookup_Folder/Lookup_Report', 'Lookup_Other_Folder/Lookup_Report'],
        packageDirectories
      );
      expect([...metaFiles.entries()]).to.deep.equal([
        ['Lookup_Folder/Lookup_Report', 'force-app/main/default/reports/Lookup_Folder/Lookup_Report.report-meta.xml'],
        [
          'Lookup_Other_Folder/Lookup_Report',
          'second-app/main/default/reports/Lookup_Other_Folder/Lookup_Report.report-meta.xml',
        ],
      ]);
    });

    it('returns null for a name whose folder does not hold it', async () => {
      const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames(
        'Report',
        ['Lookup_Other_Folder/Lookup_Unknown'],
        packageDirectories
      );
      expect(metaFiles.get('Lookup_Other_Folder/Lookup_Unknown')).to.be.null;
    });

    it('prefers the source file over the -meta.xml file for a folder-scoped name', async () => {
      const metaFile = await MetadataUtils.findMetaFileFromTypeAndName(
        'EmailTemplate',
        'Lookup_Templates/Lookup_Mail',
        packageDirectories
      );
      expect(metaFile).to.equal('force-app/main/default/email/Lookup_Templates/Lookup_Mail.email');
    });

    it('mixes folder-scoped and plain names in a single call', async () => {
      const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames(
        'Report',
        ['Lookup_Folder/Lookup_Report', 'Lookup_Unknown'],
        packageDirectories
      );
      expect([...metaFiles.entries()]).to.deep.equal([
        ['Lookup_Folder/Lookup_Report', 'force-app/main/default/reports/Lookup_Folder/Lookup_Report.report-meta.xml'],
        ['Lookup_Unknown', null],
      ]);
    });
  });

  it('resolves a list longer than the glob alternation chunk size', async () => {
    // 1200 names to cross the 500 names per glob expression limit, with real Flows spread over the chunks
    const names = Array.from({ length: 1200 }, (_, index) => `Lookup_Filler_${index}`);
    names[10] = 'Lookup_Alpha';
    names[700] = 'Lookup_Beta';
    names[1100] = 'Lookup_Gamma';
    const metaFiles = await MetadataUtils.findMetaFilesFromTypeAndNames('Flow', names, packageDirectories);
    expect(metaFiles.size).to.equal(1200);
    expect(metaFiles.get('Lookup_Alpha')).to.equal('force-app/main/default/flows/Lookup_Alpha.flow-meta.xml');
    expect(metaFiles.get('Lookup_Beta')).to.equal('force-app/main/default/flows/Lookup_Beta.flow-meta.xml');
    expect(metaFiles.get('Lookup_Gamma')).to.equal('second-app/main/default/flows/Lookup_Gamma.flow-meta.xml');
    expect([...metaFiles.values()].filter((metaFile) => metaFile !== null)).to.have.lengthOf(3);
  });
});
