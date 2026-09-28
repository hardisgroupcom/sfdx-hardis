import { Connection } from '@salesforce/core';
import { getApiVersion } from '../../config/index.js';
import { withOrgApiCache } from '../cache/orgApiCache.js';

// Listing of the metadata components of an org, shared by hardis:org:list:metadata and
// hardis:doc:metadata-deps: both read the same cache, so a listing made by one serves the other.

export interface ListedComponent {
  fullName: string;
  id: string;
}

// Folder types list their folders through another Metadata API type
export const FOLDER_TYPES: Record<string, string> = {
  Report: 'ReportFolder',
  Dashboard: 'DashboardFolder',
  EmailTemplate: 'EmailFolder',
  Document: 'DocumentFolder',
};

export function isFolderType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(FOLDER_TYPES, type);
}

// listMetadata of a type (in a folder for Report, Dashboard...), cached per org: only names and Ids are kept.
// value is null when the type cannot be listed. Never cached for Flow: activating another version in Setup
// changes the Id.
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
    } catch {
      return null;
    }
  };
  if (type === 'Flow') {
    return { value: await listComponents(), fromCache: false };
  }
  const cacheKey = `listMetadata:${type}${folder ? `:${folder}` : ''}`;
  // A failed listing is not cached: the type may be listable next time (network error, expired session...)
  return await withOrgApiCache(connection, cacheKey, listComponents, {
    refresh: options.refresh,
    shouldCache: (value) => value !== null,
  });
}

export interface OrgMetadataListing {
  type: string;
  folder: string | null;
  // folders: the folders of a folder type, to pick before listing their content
  kind: 'components' | 'folders';
  items: ListedComponent[];
  // false when the Metadata API cannot list this type (Tooling-only types, unknown types...)
  listable: boolean;
  fromCache: boolean;
}

// Components of a type, sorted by name. A folder type without folder gives its folders;
// with a folder, the content of that folder (names like Folder/Name).
export async function listOrgMetadata(
  connection: Connection,
  options: { type: string; folder?: string; refresh?: boolean }
): Promise<OrgMetadataListing> {
  const folder = options.folder?.trim() || null;
  const listFolders = isFolderType(options.type) && !folder;
  const listed = listFolders
    ? await listMetadataComponents(connection, FOLDER_TYPES[options.type], undefined, { refresh: options.refresh })
    : await listMetadataComponents(connection, options.type, folder ?? undefined, { refresh: options.refresh });
  const items = [...(listed.value ?? [])]
    .filter((item) => item.fullName !== '')
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  return {
    type: options.type,
    folder,
    kind: listFolders ? 'folders' : 'components',
    items,
    listable: listed.value !== null,
    fromCache: listed.fromCache,
  };
}
