import * as path from 'path';
import fs from './fsUtils.js';
import { git, isGitRepo } from './index.js';
import { parsePackageXmlFile, writePackageXmlFile } from './xmlUtils.js';

// A kind of source file that can be retrieved empty, and how to recognize it.
export interface EmptyItemConstraint {
  metadataType: string;
  globPattern: string;
  rootTag: string;
  // Tag whose absence makes the file empty. Without it, the file is empty when the root has no child at all.
  childTag?: string;
}

// CustomObject: retrieving a field, list view, record type or validation rule without its object writes
// <CustomObject></CustomObject>. Committed, it puts CustomObject:<name> in the delta package.xml and the
// deployment fails with "Must specify a non-empty label for the CustomObject".
export const EMPTY_ITEM_CONSTRAINTS: EmptyItemConstraint[] = [
  {
    metadataType: 'GlobalValueSetTranslation',
    globPattern: '/**/*.globalValueSetTranslation-meta.xml',
    rootTag: 'GlobalValueSetTranslation',
    childTag: 'valueTranslation',
  },
  {
    metadataType: 'StandardValueSet',
    globPattern: '/**/*.standardValueSet-meta.xml',
    rootTag: 'StandardValueSet',
    childTag: 'standardValue',
  },
  {
    metadataType: 'SharingRules',
    globPattern: '/**/*.sharingRules-meta.xml',
    rootTag: 'SharingRules',
    childTag: 'sharingOwnerRules',
  },
  {
    metadataType: 'CustomObject',
    globPattern: '/**/*.object-meta.xml',
    rootTag: 'CustomObject',
  },
];

// True when the parsed XML (xml2js) has no content under its root, or misses the expected child tag.
export function isEmptyMetadataRoot(xmlContent: any, rootTag: string, childTag?: string): boolean {
  const root = xmlContent?.[rootTag];
  if (childTag) {
    return !(root && root[childTag]);
  }
  // xml2js gives '' for <Root/> and { $: { xmlns } } for <Root xmlns="..."></Root>
  if (root == null || typeof root !== 'object') {
    return true;
  }
  return Object.keys(root).filter((key) => key !== '$').length === 0;
}

// Decide whether an empty file can be deleted without git seeing it as a deleted component.
// - deltaFrom given: deletable when the file does not exist at that commit (it was added since)
// - no deltaFrom, CustomObject: deletable when the file is not in HEAD (not committed yet)
// - no deltaFrom, other types: always deletable (behavior of the command before CustomObject was handled)
// - outside a git repository: always deletable, no delta can turn the deletion into a destructive change
export async function isEmptyItemDeletable(
  file: string,
  constraint: EmptyItemConstraint,
  deltaFrom: string | null
): Promise<boolean> {
  if (!isGitRepo()) {
    return true;
  }
  if (deltaFrom) {
    return !(await fileExistsAtCommit(file, deltaFrom));
  }
  if (constraint.metadataType === 'CustomObject') {
    return !(await fileExistsAtCommit(file, 'HEAD'));
  }
  return true;
}

// True when the ref resolves to a commit in this repository (an unfetched or mistyped ref does not).
export async function isKnownCommit(ref: string): Promise<boolean> {
  try {
    // simple-git does not throw on a failing command that writes nothing to stderr: check the hash it printed
    const hash = await git({ output: false, displayCommand: false }).raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return /^[0-9a-f]{40}/.test(hash.trim());
  } catch {
    return false;
  }
}

export async function fileExistsAtCommit(file: string, commit: string): Promise<boolean> {
  const relativePath = path.relative(process.cwd(), path.resolve(file)).replace(/\\/g, '/');
  try {
    await git({ output: false, displayCommand: false }).raw(['cat-file', '-e', `${commit}:./${relativePath}`]);
    return true;
  } catch {
    return false;
  }
}

// Remove members of a type from a package.xml. Returns the members actually removed.
export async function removeTypeMembersFromPackageXml(
  packageXmlFile: string,
  metadataType: string,
  members: string[]
): Promise<string[]> {
  if (members.length === 0 || !fs.existsSync(packageXmlFile)) {
    return [];
  }
  const packageXmlContent = await parsePackageXmlFile(packageXmlFile);
  const existingMembers: string[] = packageXmlContent[metadataType] || [];
  const removed = existingMembers.filter((member) => members.includes(member));
  if (removed.length === 0) {
    return [];
  }
  const keptMembers = existingMembers.filter((member) => !members.includes(member));
  if (keptMembers.length > 0) {
    packageXmlContent[metadataType] = keptMembers;
  } else {
    delete packageXmlContent[metadataType];
  }
  await writePackageXmlFile(packageXmlFile, packageXmlContent);
  return removed;
}
