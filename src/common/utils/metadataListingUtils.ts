import { Connection } from '@salesforce/core';
import { getApiVersion } from '../../config/index.js';
import { withOrgApiCache } from '../cache/orgApiCache.js';
import { listMetadataTypes } from '../metadata-utils/metadataList.js';

// Listing of the metadata components of an org, shared by hardis:org:list:metadata and
// hardis:doc:metadata-deps: both read the same cache, so a listing made by one serves the other.

export interface ListedComponent {
  fullName: string;
  id: string;
}

// Metadata API types listing the folders of each folder type. EmailTemplate has two:
// Classic email templates live in EmailFolder folders, Lightning ones in EmailTemplateFolder folders.
const FOLDER_LISTING_TYPES: Record<string, string[]> = {
  Report: ['ReportFolder'],
  Dashboard: ['DashboardFolder'],
  EmailTemplate: ['EmailFolder', 'EmailTemplateFolder'],
  Document: ['DocumentFolder'],
};

// Folder that listMetadata never returns, but that holds components (Public Reports, unfiled templates...)
const UNFILED_PUBLIC_FOLDER = 'unfiled$public';
const TYPES_WITH_UNFILED_FOLDER = ['Report', 'EmailTemplate', 'Document'];

// A folder type is marked inFolder in the metadata registry (the single source of truth)
export function isFolderType(type: string): boolean {
  return listMetadataTypes().some((metadataType) => metadataType.xmlName === type && metadataType.inFolder === true);
}

// The Metadata API answers INVALID_TYPE for a type it can not list (Tooling-only type, misspelled type...)
export function isNotListableTypeError(error: unknown): boolean {
  const text = `${(error as any)?.name ?? ''} ${(error as any)?.errorCode ?? ''} ${(error as any)?.message ?? error}`;
  return /INVALID_TYPE/i.test(text);
}

// listMetadata of a type (in a folder for Report, Dashboard...), cached per org: only names and Ids are kept.
// value is null when the type can not be listed; any other failure (expired session, network error, API
// limit) is thrown. Never cached for Flow: activating another version in Setup changes the Id.
export async function listMetadataComponents(
  connection: Connection,
  type: string,
  folder?: string,
  options: { refresh?: boolean } = {}
): Promise<{ value: ListedComponent[] | null; fromCache: boolean }> {
  const listComponents = async (): Promise<ListedComponent[] | null> => {
    try {
      const listed = await connection.metadata.list([folder ? { type, folder } : { type }], getApiVersion(connection));
      const components: any[] = Array.isArray(listed) ? listed : listed ? [listed] : [];
      return components.map((component) => ({
        fullName: String(component?.fullName ?? ''),
        id: String(component?.id ?? ''),
      }));
    } catch (error) {
      if (isNotListableTypeError(error)) {
        return null;
      }
      throw error;
    }
  };
  if (type === 'Flow') {
    return { value: await listComponents(), fromCache: false };
  }
  const cacheKey = `listMetadata:${type}${folder ? `:${folder}` : ''}`;
  // A type that can not be listed is not cached either: a newer org or API version may list it
  return await withOrgApiCache(connection, cacheKey, listComponents, {
    refresh: options.refresh,
    shouldCache: (value) => value !== null,
  });
}

// Same as listMetadataComponents, but a failure gives null: for callers that have another way to find
// the component (the dependency lookup falls back to Tooling queries)
export async function listMetadataComponentsOrNull(
  connection: Connection,
  type: string,
  folder?: string,
  options: { refresh?: boolean } = {}
): Promise<{ value: ListedComponent[] | null; fromCache: boolean }> {
  try {
    return await listMetadataComponents(connection, type, folder, options);
  } catch {
    return { value: null, fromCache: false };
  }
}

export interface OrgMetadataListing {
  type: string;
  folder: string | null;
  // folders: the folders of a folder type, to pick before listing their content
  kind: 'components' | 'folders';
  items: ListedComponent[];
  // false when the Metadata API can not list this type (Tooling-only types, unknown types...)
  listable: boolean;
  fromCache: boolean;
}

// Folders of a folder type, unfiled$public included when the type has it
async function listFolders(
  connection: Connection,
  type: string,
  refresh?: boolean
): Promise<{ value: ListedComponent[] | null; fromCache: boolean }> {
  const listings = await Promise.all(
    (FOLDER_LISTING_TYPES[type] ?? []).map((folderType) =>
      listMetadataComponents(connection, folderType, undefined, { refresh })
    )
  );
  const folders = listings.flatMap((listing) => listing.value ?? []);
  if (TYPES_WITH_UNFILED_FOLDER.includes(type) && !folders.some((f) => f.fullName === UNFILED_PUBLIC_FOLDER)) {
    folders.push({ fullName: UNFILED_PUBLIC_FOLDER, id: '' });
  }
  return {
    value: listings.every((listing) => listing.value === null) && folders.length === 0 ? null : folders,
    fromCache: listings.every((listing) => listing.fromCache),
  };
}

// Components of a type, sorted by name. A folder type without folder gives its folders;
// with a folder, the content of that folder (names like Folder/Name).
export async function listOrgMetadata(
  connection: Connection,
  options: { type: string; folder?: string; refresh?: boolean }
): Promise<OrgMetadataListing> {
  const folder = options.folder?.trim() || null;
  const listFoldersOnly = isFolderType(options.type) && !folder;
  const listed = listFoldersOnly
    ? await listFolders(connection, options.type, options.refresh)
    : await listMetadataComponents(connection, options.type, folder ?? undefined, { refresh: options.refresh });
  const byName = new Map<string, ListedComponent>();
  for (const item of listed.value ?? []) {
    if (item.fullName !== '' && !byName.has(item.fullName)) {
      byName.set(item.fullName, item);
    }
  }
  return {
    type: options.type,
    folder,
    kind: listFoldersOnly ? 'folders' : 'components',
    items: [...byName.values()].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    listable: listed.value !== null,
    fromCache: listed.fromCache,
  };
}
