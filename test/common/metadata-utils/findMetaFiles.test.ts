/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as path from 'path';
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
