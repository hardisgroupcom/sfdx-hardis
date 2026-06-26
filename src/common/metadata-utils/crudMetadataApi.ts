import { Connection, SfError } from '@salesforce/core';
import {
  ComponentSet,
  ComponentSetBuilder,
  MetadataConverter,
  MetadataResolver,
  RegistryAccess,
} from '@salesforce/source-deploy-retrieve';
import XMLBuilder from 'fast-xml-builder';
import { XMLParser } from 'fast-xml-parser';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { createTempDir, uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';

// Namespace stamped on every metadata-format root element.
const METADATA_XMLNS = 'http://soap.sforce.com/2006/04/metadata';

// CRUD-based Metadata API read/upsert limit: 10 components per call,
// except CustomMetadata and CustomApplication which allow 200.
// https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_readMetadata.htm
export const DEFAULT_MAX_CHUNK_SIZE = 10;
export const SPECIAL_MAX_CHUNK_SIZE = 200;
export const SPECIAL_CHUNK_TYPES = ['CustomApplication', 'CustomMetadata'];

export type CrudComponentResult = {
  type: string;
  fullName: string;
  status: 'success' | 'error' | 'skipped';
  created?: boolean;
  filePath?: string;
  error?: string;
};

export type CrudMetadataOutcome = {
  successes: CrudComponentResult[];
  failures: CrudComponentResult[];
  // Components left untouched because their type is not addressable by the CRUD Metadata API.
  skipped: CrudComponentResult[];
};

// SDR registry adapters whose source representation carries non-XML content (Apex/Visualforce
// code, binaries, or multi-file bundles). The CRUD Metadata API payload is a single parsed XML
// body, so it cannot carry that content: these types must use the file-based Metadata API.
// `bundle` -> LWC/Aura, `matchingContentFile` -> Apex*, `mixedContent` -> StaticResource/Document,
// `digitalExperience` -> DigitalExperienceBundle. Pure-XML adapters (`decomposed`, `default`, none)
// such as CustomObject/Profile/PermissionSet round-trip fine and are not listed.
export const CRUD_INCOMPATIBLE_ADAPTERS = new Set(['bundle', 'matchingContentFile', 'mixedContent', 'digitalExperience']);

/* ----------------------------------------------------------------------------
 * Pure helpers (no connection, unit-testable)
 * ------------------------------------------------------------------------- */

// Hard per-type ceiling imposed by the Salesforce CRUD Metadata API.
export function determineMaxChunkSize(typeName: string): number {
  return SPECIAL_CHUNK_TYPES.includes(typeName) ? SPECIAL_MAX_CHUNK_SIZE : DEFAULT_MAX_CHUNK_SIZE;
}

// Validate a user-supplied --chunk-size against the absolute allowed maximum.
// Returns the value, or throws if out of range. Per-type capping happens in resolveEffectiveChunkSize.
export function validateChunkSizeOverride(requested: number): number {
  if (!Number.isInteger(requested) || requested < 1) {
    throw new SfError(t('crudChunkSizeMustBePositive', { value: String(requested) }));
  }
  if (requested > SPECIAL_MAX_CHUNK_SIZE) {
    throw new SfError(t('crudChunkSizeTooLarge', { value: String(requested), max: String(SPECIAL_MAX_CHUNK_SIZE) }));
  }
  return requested;
}

// The size actually used for a given type: the override capped at the type's hard ceiling.
export function resolveEffectiveChunkSize(typeName: string, override?: number | null): number {
  const ceiling = determineMaxChunkSize(typeName);
  if (override == null) {
    return ceiling;
  }
  return Math.min(override, ceiling);
}

export function chunkArray<T>(input: T[], size: number): T[][] {
  if (size < 1) {
    throw new SfError(t('crudChunkSizeMustBePositive', { value: String(size) }));
  }
  const chunks: T[][] = [];
  for (let i = 0; i < input.length; i += size) {
    chunks.push(input.slice(i, i + size));
  }
  return chunks;
}

export function groupByType<T>(items: T[], typeOf: (item: T) => string): Record<string, T[]> {
  return items.reduce((acc, item) => {
    const key = typeOf(item);
    (acc[key] ||= []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

// Split repeatable --metadata flag values (each of which may be comma-joined) into individual entries.
// SDR's ComponentSetBuilder parses the "Type:Name" / bare "Type" form itself, so we only normalize here.
export function splitMetadataEntries(values: string[] | undefined): string[] {
  return (values || []).flatMap((entry) => entry.split(',').map((e) => e.trim()).filter(Boolean));
}

// Decide whether the overall run should be treated as a failure (non-zero exit).
// Skipped components are not failures, so only `failures` is consulted.
export function isOutcomeFailed(outcome: Pick<CrudMetadataOutcome, 'failures'>, ignoreErrors: boolean): boolean {
  return !ignoreErrors && outcome.failures.length > 0;
}

// True when the type's source carries non-XML content the CRUD Metadata API payload cannot
// represent. Pure over the adapter string so it is trivially unit-testable.
export function isCrudIncompatibleAdapter(adapter: string | null | undefined): boolean {
  return adapter != null && CRUD_INCOMPATIBLE_ADAPTERS.has(adapter);
}

// Resolve a type name to its SDR registry adapter and classify it. Unknown type names are
// treated as compatible so the API call (not this guard) surfaces a real error.
export function isCrudIncompatibleTypeName(typeName: string, registry: RegistryAccess): boolean {
  try {
    const adapter = (registry.getTypeByName(typeName) as any)?.strategies?.adapter as string | undefined;
    return isCrudIncompatibleAdapter(adapter);
  } catch {
    return false;
  }
}

// Split components into those the CRUD Metadata API can process and those it cannot.
// `registry` defaults to a fresh RegistryAccess so callers (e.g. commands) need not construct one.
export function partitionCrudCompatibility<T extends { type: { name: string }; fullName: string }>(
  components: T[],
  registry?: RegistryAccess
): { supported: T[]; skipped: T[] } {
  const reg = registry ?? new RegistryAccess();
  const supported: T[] = [];
  const skipped: T[] = [];
  for (const cmp of components) {
    (isCrudIncompatibleTypeName(cmp.type.name, reg) ? skipped : supported).push(cmp);
  }
  return { supported, skipped };
}

// Build a metadata-format XML document string from a read() result object.
// `rootElementName` is the metadata type name (e.g. "Profile", "CustomObject").
export function buildMetadataXml(rootElementName: string, data: Record<string, any>): string {
  const builder = new XMLBuilder({
    format: true,
    indentBy: '    ',
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    suppressEmptyNode: false,
  });
  const xml = builder.build({
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    [rootElementName]: { '@_xmlns': METADATA_XMLNS, ...data },
  });
  return xml.endsWith('\n') ? xml : xml + '\n';
}

// Strip properties that must not appear in a metadata-format file body.
function cleanReadResult(result: Record<string, any>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { fullName, ...rest } = result;
  return rest;
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/* ----------------------------------------------------------------------------
 * Component set resolution (input: -m / -x / -d)
 * ------------------------------------------------------------------------- */

export interface BuildComponentSetOptions {
  metadataEntries?: string[];
  manifestPath?: string;
  sourceDirs?: string[];
  packageDirs?: string[];
  username?: string;
  // When true, wildcards / bare types are expanded against the org via listMetadata.
  resolveFromOrg?: boolean;
}

export async function buildTargetComponentSet(options: BuildComponentSetOptions): Promise<ComponentSet> {
  const buildOpts: Parameters<typeof ComponentSetBuilder.build>[0] = {};
  const directoryPaths = options.packageDirs ?? [];
  if (options.sourceDirs?.length) {
    buildOpts.sourcepath = options.sourceDirs;
  }
  if (options.manifestPath) {
    buildOpts.manifest = {
      manifestPath: options.manifestPath,
      directoryPaths,
    };
  }
  if (options.metadataEntries?.length) {
    buildOpts.metadata = {
      metadataEntries: options.metadataEntries,
      directoryPaths,
    };
  }
  // Org resolution (listMetadata) is only meaningful to expand bare types and wildcards
  // passed via --metadata. ComponentSetBuilder scopes the org listing by the metadata
  // entries; with no entries it lists the ENTIRE org and unions it into the set. So for
  // --source-dir / --manifest (which already name concrete components) we must NOT set
  // `org`, otherwise a source-dir read pulls every component of every type from the org.
  if (options.resolveFromOrg && options.username && options.metadataEntries?.length) {
    buildOpts.org = { username: options.username, exclude: [] };
  }
  return ComponentSetBuilder.build(buildOpts);
}

/* ----------------------------------------------------------------------------
 * CRUD read (org -> local source files)
 * ------------------------------------------------------------------------- */

export interface CrudReadOptions {
  conn: Connection;
  componentSet: ComponentSet;
  outputDir: string;
  packageDirs?: string[];
  chunkSizeOverride?: number | null;
  commandThis: any;
  debug?: boolean;
}

interface MetadataFileSpec {
  rootElementName: string;
  data: Record<string, any>;
}

export async function crudReadMetadatas(options: CrudReadOptions): Promise<CrudMetadataOutcome> {
  const { conn, componentSet, outputDir, chunkSizeOverride, commandThis, debug } = options;
  const registry = new RegistryAccess();
  const successes: CrudComponentResult[] = [];
  const failures: CrudComponentResult[] = [];

  // Set aside types the CRUD Metadata API cannot read (Apex, LWC, StaticResource, ...).
  const { supported, skipped } = partitionCrudCompatibility(componentSet.toArray(), registry);
  const skippedResults: CrudComponentResult[] = skipped.map((cmp) => ({
    type: cmp.type.name,
    fullName: cmp.fullName,
    status: 'skipped',
  }));
  const byType = groupByType(supported, (cmp) => cmp.type.name);

  // Accumulate metadata-format files (top-level types and parent-wrapped child types).
  const fileSpecs = new Map<string, MetadataFileSpec>();
  const tmpMdRoot = await createTempDir();

  for (const [typeName, comps] of Object.entries(byType)) {
    const size = resolveEffectiveChunkSize(typeName, chunkSizeOverride);
    for (const batch of chunkArray(comps, size)) {
      const fullNames = batch.map((cmp) => cmp.fullName);
      let results: any[];
      try {
        if (debug) {
          uxLog('other', commandThis, c.grey(`readMetadata ${typeName}: ${fullNames.join(', ')}`));
        }
        results = toArray(await conn.metadata.read(typeName as any, fullNames));
      } catch (e) {
        for (const cmp of batch) {
          failures.push({ type: typeName, fullName: cmp.fullName, status: 'error', error: (e as Error).message });
        }
        continue;
      }
      // Map results back to the requested members by fullName (order is not guaranteed).
      const resultsByName = new Map<string, any>();
      for (const res of results) {
        if (res?.fullName) {
          resultsByName.set(res.fullName, res);
        }
      }
      for (const cmp of batch) {
        const res = resultsByName.get(cmp.fullName) ?? (results.length === 1 && batch.length === 1 ? results[0] : null);
        if (!res?.fullName) {
          failures.push({ type: typeName, fullName: cmp.fullName, status: 'error', error: t('crudComponentNotFoundInOrg') });
          continue;
        }
        accumulateMetadataFile(fileSpecs, registry, typeName, cmp.fullName, res);
        successes.push({ type: typeName, fullName: cmp.fullName, status: 'success' });
      }
    }
  }

  // Write all metadata-format files, then convert to source format (handles decomposition).
  if (fileSpecs.size > 0) {
    for (const [relPath, spec] of fileSpecs.entries()) {
      const absPath = path.join(tmpMdRoot, relPath);
      await fs.ensureDir(path.dirname(absPath));
      await fs.writeFile(absPath, buildMetadataXml(spec.rootElementName, spec.data));
    }
    const writtenFiles = await convertMetadataDirToSource(tmpMdRoot, outputDir, options.packageDirs);
    // Attach written file paths to successes where we can match them.
    for (const success of successes) {
      const match = writtenFiles.find((f) => f.type === success.type && f.fullName === success.fullName);
      if (match) {
        success.filePath = match.filePath;
      }
    }
  }

  return { successes, failures, skipped: skippedResults };
}

// Place a read result into the in-memory file map, wrapping child types under their parent.
function accumulateMetadataFile(
  fileSpecs: Map<string, MetadataFileSpec>,
  registry: RegistryAccess,
  typeName: string,
  fullName: string,
  result: Record<string, any>
): void {
  const type = registry.getTypeByName(typeName);
  const parentType = registry.getParentType(typeName);
  if (parentType) {
    // Child type (e.g. RecordType under CustomObject): nest under a synthesized parent file.
    const parentName = fullName.split('.')[0];
    const childName = fullName.includes('.') ? fullName.slice(fullName.indexOf('.') + 1) : fullName;
    const relPath = path.join(parentType.directoryName, `${parentName}.${parentType.suffix}`);
    const collectionKey = type.directoryName;
    const spec = fileSpecs.get(relPath) ?? { rootElementName: parentType.name, data: {} as Record<string, any> };
    const childData = { ...cleanReadResult(result), fullName: childName };
    (spec.data[collectionKey] ||= []).push(childData);
    fileSpecs.set(relPath, spec);
    return;
  }
  const relPath = path.join(type.directoryName, `${fullName}.${type.suffix}`);
  fileSpecs.set(relPath, { rootElementName: type.name, data: cleanReadResult(result) });
}

interface ConvertedFile {
  type: string;
  fullName: string;
  filePath: string;
}

// Resolve a metadata-format directory and convert it to source format into outputDir.
// Merges with any existing source in packageDirs so files are overwritten in place.
async function convertMetadataDirToSource(
  mdRoot: string,
  outputDir: string,
  packageDirs?: string[]
): Promise<ConvertedFile[]> {
  const resolver = new MetadataResolver();
  const components = resolver.getComponentsFromPath(mdRoot);
  let mergeWith: any[] = [];
  if (packageDirs?.length) {
    const existing = packageDirs.filter((dir) => fs.existsSync(dir));
    if (existing.length) {
      mergeWith = ComponentSet.fromSource(existing).getSourceComponents().toArray();
    }
  }
  const result = await new MetadataConverter().convert(components, 'source', {
    type: 'merge',
    mergeWith,
    defaultDirectory: outputDir,
  });
  return (result.converted ?? []).map((cmp: any) => ({
    type: cmp.type.name,
    fullName: cmp.fullName,
    filePath: cmp.xml ?? '',
  }));
}

/* ----------------------------------------------------------------------------
 * CRUD upsert (local source files -> org)
 * ------------------------------------------------------------------------- */

export interface CrudUpsertOptions {
  conn: Connection;
  componentSet: ComponentSet;
  chunkSizeOverride?: number | null;
  commandThis: any;
  debug?: boolean;
}

export async function crudUpsertMetadatas(options: CrudUpsertOptions): Promise<CrudMetadataOutcome> {
  const { conn, componentSet, chunkSizeOverride, commandThis, debug } = options;
  const registry = new RegistryAccess();
  const successes: CrudComponentResult[] = [];
  const failures: CrudComponentResult[] = [];

  // Set aside types the CRUD Metadata API cannot deploy (Apex, LWC, StaticResource, ...).
  const { supported, skipped } = partitionCrudCompatibility(componentSet.toArray(), registry);
  const skippedResults: CrudComponentResult[] = skipped.map((cmp) => ({
    type: cmp.type.name,
    fullName: cmp.fullName,
    status: 'skipped',
  }));
  if (supported.length === 0) {
    return { successes, failures, skipped: skippedResults };
  }

  // Convert local source into metadata format (recomposes decomposed types into a single file).
  const tmpMdRoot = await createTempDir();
  const convertResult = await new MetadataConverter().convert(componentSet, 'metadata', {
    type: 'directory',
    outputDirectory: tmpMdRoot,
  });

  // Upsert at the top-level-type granularity (child types live inside their parent file).
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
  const seen = new Set<string>();
  const payloadsByType = groupByType(
    (convertResult.converted ?? []).filter(
      (cmp: any) =>
        cmp.xml && !registry.getParentType(cmp.type.name) && !isCrudIncompatibleTypeName(cmp.type.name, registry)
    ),
    (cmp: any) => cmp.type.name
  );

  for (const [typeName, comps] of Object.entries(payloadsByType)) {
    const size = resolveEffectiveChunkSize(typeName, chunkSizeOverride);
    // De-duplicate components that map to the same file.
    const uniqueComps = (comps as any[]).filter((cmp) => {
      const key = `${typeName}:${cmp.fullName}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    const payloads = uniqueComps
      .map((cmp) => {
        try {
          const fileContent = fs.readFileSync(cmp.xml, 'utf8');
          const parsed = parser.parse(fileContent);
          const body = parsed[typeName] ?? {};
          delete body['@_xmlns'];
          return { fullName: cmp.fullName, ...body };
        } catch (e) {
          failures.push({ type: typeName, fullName: cmp.fullName, status: 'error', error: (e as Error).message });
          return null;
        }
      })
      .filter((p): p is Record<string, any> => p !== null);

    for (const batch of chunkArray(payloads, size)) {
      try {
        if (debug) {
          uxLog('other', commandThis, c.grey(`upsertMetadata ${typeName}: ${batch.map((b) => b.fullName).join(', ')}`));
        }
        const upsertResults = toArray(await conn.metadata.upsert(typeName as any, batch));
        const resultsByName = new Map<string, any>();
        for (const res of upsertResults) {
          if (res?.fullName) {
            resultsByName.set(res.fullName, res);
          }
        }
        for (const payload of batch) {
          const res = resultsByName.get(payload.fullName) ?? (upsertResults.length === 1 ? upsertResults[0] : null);
          if (res?.success) {
            successes.push({ type: typeName, fullName: payload.fullName, status: 'success', created: res.created === true });
          } else {
            const errors = toArray(res?.errors)
              .map((err: any) => err?.message ?? String(err))
              .join('; ');
            failures.push({ type: typeName, fullName: payload.fullName, status: 'error', error: errors || t('crudUpsertFailed') });
          }
        }
      } catch (e) {
        for (const payload of batch) {
          failures.push({ type: typeName, fullName: payload.fullName, status: 'error', error: (e as Error).message });
        }
      }
    }
  }

  return { successes, failures, skipped: skippedResults };
}
