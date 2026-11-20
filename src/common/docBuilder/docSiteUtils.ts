import fs from '../utils/fsUtils.js';
import * as path from 'path';

// Folders of docs/ that only feed the next generation: the AI answers and the Mermaid images
// already rendered. Pages carry the cached text inline, so these files never belong to a site:
// published, they doubled the search index with the cache of every language.
export const DOC_CACHE_FOLDERS = ['cache-ai-results', 'cache-mermaid'];

// Cloudflare Pages refuses any file over 25 MiB. The search index is trimmed a bit below it.
export const CLOUDFLARE_PAGES_MAX_FILE_SIZE = 25 * 1024 * 1024;
export const CLOUDFLARE_PAGES_SAFE_FILE_SIZE = 24 * 1024 * 1024;

// Zensical writes search.json with its entries in "items", MkDocs Material wrote
// search/search_index.json with its entries in "docs"
const SEARCH_INDEX_FILES = ['search.json', path.join('search', 'search_index.json')];

interface SearchIndex {
  file: string;
  content: any;
  entriesKey: 'items' | 'docs';
}

// Zensical has no exclude_docs: the cache folders are built like any other page, then removed
// here from the site and from its search index. Returns the number of search entries removed.
export async function removeDocCacheFromSite(siteDir: string): Promise<number> {
  if (!fs.existsSync(siteDir)) {
    return 0;
  }
  for (const folder of DOC_CACHE_FOLDERS) {
    await fs.remove(path.join(siteDir, folder));
  }
  const searchIndex = await readSearchIndex(siteDir);
  if (!searchIndex) {
    return 0;
  }
  const entries: any[] = searchIndex.content[searchIndex.entriesKey];
  const keptEntries = entries.filter((entry) => !isDocCacheLocation(entry?.location));
  const removedCount = entries.length - keptEntries.length;
  if (removedCount > 0) {
    searchIndex.content[searchIndex.entriesKey] = keptEntries;
    await writeSearchIndex(searchIndex);
  }
  return removedCount;
}

// When the search index is still over maxBytes, the text of its largest entries is emptied until
// it fits: Apex code, Visualforce markup and Flow history diagrams go first, without a list to
// maintain. Their location and title stay, so a search on a page name still finds the page.
export async function fitSearchIndexToSize(siteDir: string, maxBytes: number): Promise<{ trimmed: number; largest: string[] }> {
  const searchIndex = await readSearchIndex(siteDir);
  if (!searchIndex) {
    return { trimmed: 0, largest: [] };
  }
  let totalBytes = Buffer.byteLength(JSON.stringify(searchIndex.content));
  if (totalBytes <= maxBytes) {
    return { trimmed: 0, largest: [] };
  }
  const entries: any[] = searchIndex.content[searchIndex.entriesKey];
  const entriesByTextSize = entries
    .filter((entry) => typeof entry?.text === 'string' && entry.text.length > 0)
    .map((entry) => ({ entry, textBytes: Buffer.byteLength(JSON.stringify(entry.text)) }))
    .sort((a, b) => b.textBytes - a.textBytes);
  const trimmedLocations: string[] = [];
  for (const { entry, textBytes } of entriesByTextSize) {
    if (totalBytes <= maxBytes) {
      break;
    }
    entry.text = '';
    // The emptied text still takes its two quotes
    totalBytes -= textBytes - 2;
    trimmedLocations.push(String(entry.location ?? ''));
  }
  await writeSearchIndex(searchIndex);
  return { trimmed: trimmedLocations.length, largest: trimmedLocations.slice(0, 5) };
}

export async function listSiteFilesOverSize(siteDir: string, maxBytes: number): Promise<{ file: string; size: number }[]> {
  if (!fs.existsSync(siteDir)) {
    return [];
  }
  const filesOverSize: { file: string; size: number }[] = [];
  const foldersToRead = [siteDir];
  while (foldersToRead.length > 0) {
    const folder = foldersToRead.pop() as string;
    for (const dirEntry of await fs.readdir(folder, { withFileTypes: true })) {
      const entryPath = path.join(folder, dirEntry.name);
      if (dirEntry.isDirectory()) {
        foldersToRead.push(entryPath);
      }
      else if (dirEntry.isFile()) {
        const size = (await fs.stat(entryPath)).size;
        if (size > maxBytes) {
          filesOverSize.push({ file: path.relative(siteDir, entryPath).replace(/\\/g, '/'), size });
        }
      }
    }
  }
  return filesOverSize.sort((a, b) => b.size - a.size);
}

export function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

// A search index in a format not known here is left as it is
async function readSearchIndex(siteDir: string): Promise<SearchIndex | null> {
  const searchIndexFile = SEARCH_INDEX_FILES.map((file) => path.join(siteDir, file)).find((file) => fs.existsSync(file));
  if (!searchIndexFile) {
    return null;
  }
  let content: any;
  try {
    content = JSON.parse(await fs.readFile(searchIndexFile, 'utf8'));
  } catch {
    return null;
  }
  if (Array.isArray(content?.items)) {
    return { file: searchIndexFile, content, entriesKey: 'items' };
  }
  if (Array.isArray(content?.docs)) {
    return { file: searchIndexFile, content, entriesKey: 'docs' };
  }
  return null;
}

// A location is relative to the site root: "cache-ai-results/en-PROMPT-Account-123/#fields",
// or "cache-ai-results/en-PROMPT-Account-123.html" when directory URLs are off
function isDocCacheLocation(location: unknown): boolean {
  if (typeof location !== 'string') {
    return false;
  }
  const relativeLocation = location.replace(/^\.?\//, '');
  return DOC_CACHE_FOLDERS.some((folder) => relativeLocation.startsWith(`${folder}/`));
}

async function writeSearchIndex(searchIndex: SearchIndex): Promise<void> {
  await fs.writeFile(searchIndex.file, JSON.stringify(searchIndex.content));
}
