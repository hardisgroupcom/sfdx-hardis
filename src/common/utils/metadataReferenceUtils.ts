// Builds the "Where Used" index of Visualforce pages, Visualforce components, Aura bundles and
// Lightning Web Components: which metadata of the project points at them, and how.
//
// The scanner is two-tiered. Tier A parses the metadata holders whose structure tells exactly how the
// reference is made (a tab target, a layout item, a page access, an action override...) so the generated
// table can say more than "the name appears somewhere". Tier B is a fallback of qualified regexes
// (`c:Name`, `c__Name`, `markup://c:Name`, `/apex/Name`, `$Page.Name`) that catches the references living
// in free text: formulas, JavaScript, URL buttons, custom properties. Both tiers run on the same single
// read of each candidate file.
//
// A reference is only recorded when the extracted name matches a component that exists in the project,
// which is what keeps the qualified regexes from producing noise.

import fs from './fsUtils.js';
import * as path from 'path';
import { glob } from 'glob';
import { getLargeXmlParser } from './xmlUtils.js';
import { PACKAGE_DIRECTORY_DOC_GLOB_IGNORE_PATTERNS } from './projectUtils.js';
import { prettifyFieldName } from './flowVisualiser/nodeFormatUtils.js';
import { t } from './i18n.js';

/** The four families of components a reference can point at */
export type ReferenceTargetKind = 'apexPages' | 'apexComponents' | 'auraBundles' | 'lwcBundles';

/** One metadata pointing at a component */
export interface MetadataReference {
  /** Metadata type of the holder, e.g. "CustomTab" */
  metadataType: string;
  /** Name of the holder, e.g. "My_Tab" or "Account.Open_Portal" */
  name: string;
  /** How the reference is made, e.g. "Layout item" */
  detail: string;
  /** Path of the holder documentation relative to the docs root, when a doc section is known for that type */
  docLink?: string;
  /**
   * Set on the Profile and Permission Set page accesses. They are summarized instead of being listed
   * one by one: a page granted to every profile of the org would bury the tab, layout or button that
   * actually points at it.
   */
  accessKind?: 'enabled' | 'disabled';
}

/** Where-used index: component name to the list of metadata referencing it */
export interface ComponentReferenceIndex {
  apexPages: Record<string, MetadataReference[]>;
  apexComponents: Record<string, MetadataReference[]>;
  auraBundles: Record<string, MetadataReference[]>;
  lwcBundles: Record<string, MetadataReference[]>;
}

/** Component names existing in the project, used to qualify every extracted reference */
export interface KnownComponentNames {
  apexPages: string[];
  apexComponents: string[];
  auraBundles: string[];
  lwcBundles: string[];
}

// Only the file types that can hold a reference are read: scanning every XML of a package directory
// would mean reading thousands of field-meta.xml files that can never point at a page or a component.
const REFERENCE_SCAN_PATTERNS = [
  '**/*.page',
  '**/*.component',
  '**/*.email',
  '**/*.cls',
  '**/*.trigger',
  '**/aura/*/*.{cmp,app,evt,intf,tokens,design,auradoc,js}',
  '**/lwc/**/*.{js,html}',
  '**/*.tab-meta.xml',
  '**/*.weblink-meta.xml',
  '**/*.layout-meta.xml',
  '**/*.profile-meta.xml',
  '**/*.permissionset-meta.xml',
  '**/*.object-meta.xml',
  '**/*.quickAction-meta.xml',
  '**/*.flexipage-meta.xml',
  '**/*.flow-meta.xml',
  '**/*.app-meta.xml',
  '**/*.homePageComponent-meta.xml',
  '**/*.site-meta.xml',
];

// CustomSite fields whose value is a Visualforce page name
const SITE_PAGE_FIELDS = [
  'indexPage',
  'siteTemplate',
  'errorPage',
  'inMaintenancePage',
  'inactiveIndexPage',
  'fileNotFoundPage',
  'genericErrorPage',
  'authorizationRequiredPage',
  'bandwidthExceededPage',
  'serverIsDown',
  'changePasswordPage',
  'forgotPasswordPage',
  'myProfilePage',
  'robotsTxtPage',
  'selfRegPage',
];

// How a bare "c:Name" must be understood in a given file: Visualforce markup means an ApexComponent,
// everything else means an Aura bundle or a Lightning Web Component
type BareNamespaceMeaning = 'apexComponents' | 'auraOrLwc';

interface HolderContext {
  metadataType: string;
  name: string;
  docLink?: string;
  /** Component family and name of the holder itself, to drop self-references */
  selfKind?: ReferenceTargetKind;
  selfName?: string;
  bareNamespaceMeaning: BareNamespaceMeaning;
}

const XML_HOLDER_TYPES: { suffix: string; metadataType: string; docSection?: string }[] = [
  { suffix: '.tab-meta.xml', metadataType: 'CustomTab' },
  { suffix: '.weblink-meta.xml', metadataType: 'WebLink' },
  { suffix: '.layout-meta.xml', metadataType: 'Layout' },
  { suffix: '.profile-meta.xml', metadataType: 'Profile', docSection: 'profiles' },
  { suffix: '.permissionset-meta.xml', metadataType: 'PermissionSet', docSection: 'permissionsets' },
  { suffix: '.object-meta.xml', metadataType: 'CustomObject', docSection: 'objects' },
  { suffix: '.quickAction-meta.xml', metadataType: 'QuickAction' },
  { suffix: '.flexipage-meta.xml', metadataType: 'FlexiPage', docSection: 'pages' },
  { suffix: '.flow-meta.xml', metadataType: 'Flow', docSection: 'flows' },
  { suffix: '.app-meta.xml', metadataType: 'CustomApplication' },
  { suffix: '.homePageComponent-meta.xml', metadataType: 'HomePageComponent' },
  { suffix: '.site-meta.xml', metadataType: 'CustomSite' },
];

function asArray(value: any): any[] {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isScalar(value: any): boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Collects every value of a field, at any depth of a parsed metadata */
function collectFieldValues(node: any, fieldName: string, acc: string[] = []): string[] {
  if (node === null || node === undefined) {
    return acc;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectFieldValues(item, fieldName, acc);
    }
    return acc;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === fieldName && isScalar(value)) {
        acc.push(String(value));
      } else {
        collectFieldValues(value, fieldName, acc);
      }
    }
  }
  return acc;
}

/** Collects every object holding a given key, at any depth of a parsed metadata */
function collectNodesWithKey(node: any, key: string, acc: any[] = []): any[] {
  if (node === null || node === undefined) {
    return acc;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectNodesWithKey(item, key, acc);
    }
    return acc;
  }
  if (typeof node === 'object') {
    if (isScalar(node[key])) {
      acc.push(node);
    }
    for (const value of Object.values(node)) {
      collectNodesWithKey(value, key, acc);
    }
  }
  return acc;
}

function isTruthyXmlValue(value: any): boolean {
  return value === true || String(value).toLowerCase() === 'true';
}

/** Removes the "c:" or "c__" default namespace prefix from a component reference */
function stripDefaultNamespace(rawName: string): string {
  return String(rawName).replace(/^c:/, '').replace(/^c__/, '').trim();
}

function expectedDocLink(docsSection: string, fileName: string): string {
  return `${docsSection}/${fileName}`;
}

function getHolderContext(file: string): HolderContext | null {
  const posixFile = file.replace(/\\/g, '/');
  const baseName = path.basename(posixFile);

  // Aura bundle files, including their -meta.xml, belong to the bundle folder
  const auraMatch = posixFile.match(/(?:^|\/)aura\/([^/]+)\/[^/]+$/);
  if (auraMatch) {
    const bundleName = auraMatch[1];
    return {
      metadataType: 'AuraDefinitionBundle',
      name: bundleName,
      // Optimistic link: the Aura section may not have been written yet when the scan runs
      docLink: expectedDocLink('aura', `${bundleName}.md`),
      selfKind: 'auraBundles',
      selfName: bundleName,
      bareNamespaceMeaning: 'auraOrLwc',
    };
  }

  const lwcMatch = posixFile.match(/(?:^|\/)lwc\/([^/]+)\//);
  if (lwcMatch) {
    const bundleName = lwcMatch[1];
    return {
      metadataType: 'LightningComponentBundle',
      name: bundleName,
      docLink: expectedDocLink('lwc', `${bundleName}.md`),
      selfKind: 'lwcBundles',
      selfName: bundleName,
      bareNamespaceMeaning: 'auraOrLwc',
    };
  }

  if (baseName.endsWith('.page')) {
    const pageName = baseName.slice(0, -'.page'.length);
    return {
      metadataType: 'ApexPage',
      name: pageName,
      docLink: expectedDocLink('visualforce', `${pageName}.md`),
      selfKind: 'apexPages',
      selfName: pageName,
      bareNamespaceMeaning: 'apexComponents',
    };
  }

  if (baseName.endsWith('.component')) {
    const componentName = baseName.slice(0, -'.component'.length);
    return {
      metadataType: 'ApexComponent',
      name: componentName,
      docLink: expectedDocLink('visualforce', `${componentName}-component.md`),
      selfKind: 'apexComponents',
      selfName: componentName,
      bareNamespaceMeaning: 'apexComponents',
    };
  }

  // Apex classes and triggers share the same documentation section
  for (const apexSuffix of ['.cls', '.trigger']) {
    if (baseName.endsWith(apexSuffix)) {
      const apexName = baseName.slice(0, -apexSuffix.length);
      return {
        metadataType: apexSuffix === '.cls' ? 'ApexClass' : 'ApexTrigger',
        name: apexName,
        docLink: expectedDocLink('apex', `${apexName}.md`),
        bareNamespaceMeaning: 'auraOrLwc',
      };
    }
  }

  if (baseName.endsWith('.email')) {
    return {
      metadataType: 'EmailTemplate',
      name: baseName.slice(0, -'.email'.length),
      bareNamespaceMeaning: 'apexComponents',
    };
  }

  for (const holderType of XML_HOLDER_TYPES) {
    if (!baseName.endsWith(holderType.suffix)) {
      continue;
    }
    const shortName = baseName.slice(0, -holderType.suffix.length);
    // A WebLink is scoped by the object folder holding it
    let name = shortName;
    if (holderType.metadataType === 'WebLink') {
      const objectMatch = posixFile.match(/(?:^|\/)objects\/([^/]+)\//);
      name = objectMatch ? `${objectMatch[1]}.${shortName}` : shortName;
    }
    return {
      metadataType: holderType.metadataType,
      name,
      docLink: holderType.docSection ? expectedDocLink(holderType.docSection, `${shortName}.md`) : undefined,
      bareNamespaceMeaning: 'auraOrLwc',
    };
  }

  return null;
}

/**
 * Records the references found in one file, keeping only the names of components existing in the
 * project, dropping self-references and keeping the first detail found for a given holder.
 */
class ReferenceCollector {
  public readonly holder: HolderContext;
  private readonly index: ComponentReferenceIndex;
  private readonly known: Record<ReferenceTargetKind, Map<string, string>>;

  constructor(
    index: ComponentReferenceIndex,
    known: Record<ReferenceTargetKind, Map<string, string>>,
    holder: HolderContext
  ) {
    this.index = index;
    this.known = known;
    this.holder = holder;
  }

  public add(
    kind: ReferenceTargetKind,
    rawName: string,
    detail: string,
    accessKind?: MetadataReference['accessKind']
  ): void {
    const candidate = stripDefaultNamespace(rawName);
    if (!candidate) {
      return;
    }
    const componentName = this.known[kind].get(candidate.toLowerCase());
    if (!componentName) {
      return;
    }
    if (this.holder.selfKind === kind && this.holder.selfName === componentName) {
      return;
    }
    const references = (this.index[kind][componentName] ||= []);
    const alreadyKnown = references.some(
      (reference) => reference.metadataType === this.holder.metadataType && reference.name === this.holder.name
    );
    if (alreadyKnown) {
      return;
    }
    references.push({
      metadataType: this.holder.metadataType,
      name: this.holder.name,
      detail,
      ...(this.holder.docLink ? { docLink: this.holder.docLink } : {}),
      ...(accessKind ? { accessKind } : {}),
    });
  }

  /** Resolves a "c:Name" or "c__Name" reference that can be either an Aura bundle or a LWC */
  public addAuraOrLwc(rawName: string, detail: string): void {
    const candidate = stripDefaultNamespace(rawName);
    if (this.known.auraBundles.has(candidate.toLowerCase())) {
      this.add('auraBundles', candidate, detail);
      return;
    }
    this.add('lwcBundles', candidate, detail);
  }
}

function collectVisualforceMarkupReferences(content: string, collector: ReferenceCollector): void {
  for (const match of content.matchAll(/<apex:(?:include|composition)\b[^>]*?(?:pageName|template)\s*=\s*"([^"]+)"/gi)) {
    collector.add('apexPages', match[1], t('docMdRefMarkupReference'));
  }
  for (const match of content.matchAll(/<c:([A-Za-z_][A-Za-z0-9_]*)/g)) {
    collector.add('apexComponents', match[1], t('docMdRefMarkupReference'));
  }
}

function collectAuraMarkupReferences(content: string, collector: ReferenceCollector): void {
  for (const match of content.matchAll(/\bextends\s*=\s*"c:([A-Za-z_][A-Za-z0-9_]*)"/g)) {
    collector.add('auraBundles', match[1], t('docMdRefAuraExtends'));
  }
  for (const match of content.matchAll(/\bimplements\s*=\s*"([^"]+)"/g)) {
    for (const implemented of match[1].split(',')) {
      const trimmed = implemented.trim();
      if (trimmed.startsWith('c:')) {
        collector.add('auraBundles', trimmed, t('docMdRefAuraImplements'));
      }
    }
  }
  for (const match of content.matchAll(/markup:\/\/c:([A-Za-z_][A-Za-z0-9_]*)/g)) {
    collector.add('auraBundles', match[1], t('docMdRefAuraDependency'));
  }
  for (const match of content.matchAll(/<c:([A-Za-z_][A-Za-z0-9_]*)/g)) {
    collector.add('auraBundles', match[1], t('docMdRefMarkupReference'));
  }
}

/** Action overrides work the same way on a CustomObject and on a CustomApplication */
function collectActionOverrideReferences(root: any, collector: ReferenceCollector): void {
  for (const actionOverride of asArray(root?.actionOverrides)) {
    const content = isScalar(actionOverride?.content) ? String(actionOverride.content) : '';
    if (!content) {
      continue;
    }
    const detail = t('docMdRefActionOverride', { action: String(actionOverride?.actionName || '') });
    const overrideType = String(actionOverride?.type || '');
    if (overrideType === 'Visualforce') {
      collector.add('apexPages', content, detail);
    } else if (overrideType === 'LightningComponent') {
      collector.addAuraOrLwc(content, detail);
    }
  }
}

function collectPageAccessReferences(root: any, collector: ReferenceCollector): void {
  for (const pageAccess of asArray(root?.pageAccesses)) {
    if (!isScalar(pageAccess?.apexPage)) {
      continue;
    }
    const isEnabled = isTruthyXmlValue(pageAccess.enabled);
    const detail = isEnabled ? t('docMdRefPageAccessEnabled') : t('docMdRefPageAccessDisabled');
    collector.add('apexPages', String(pageAccess.apexPage), detail, isEnabled ? 'enabled' : 'disabled');
  }
}

function collectFlexiPageReferences(root: any, collector: ReferenceCollector): void {
  for (const componentInstance of collectNodesWithKey(root, 'componentName')) {
    const componentName = String(componentInstance.componentName || '');
    if (componentName === 'flexipage:visualforcePage') {
      for (const property of asArray(componentInstance.componentInstanceProperties)) {
        if (String(property?.name) === 'pageName' && isScalar(property?.value)) {
          collector.add('apexPages', String(property.value), t('docMdRefFlexiPageComponent'));
        }
      }
    } else if (componentName.startsWith('c:') || componentName.startsWith('c__')) {
      collector.addAuraOrLwc(componentName, t('docMdRefFlexiPageComponent'));
    }
  }
}

/** A Flow screen embeds an Aura component or a LWC through the extensionName of its screen fields */
function collectFlowReferences(root: any, collector: ReferenceCollector): void {
  for (const extensionName of collectFieldValues(root, 'extensionName')) {
    if (extensionName.startsWith('c:') || extensionName.startsWith('c__')) {
      collector.addAuraOrLwc(extensionName, t('docMdRefFlowScreenComponent'));
    }
  }
}

/** Apex names a Visualforce page with the Page global variable, for example Page.MyVfPage */
function collectApexReferences(content: string, collector: ReferenceCollector): void {
  for (const match of content.matchAll(/\bPage\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    collector.add('apexPages', match[1], t('docMdRefCodeReference'));
  }
}

function collectXmlMetadataReferences(content: string, collector: ReferenceCollector): void {
  let parsed: any;
  try {
    parsed = getLargeXmlParser().parse(content);
  } catch {
    return;
  }
  if (!parsed) {
    return;
  }

  const customTab = parsed.CustomTab;
  if (customTab) {
    for (const page of collectFieldValues(customTab, 'page')) {
      collector.add('apexPages', page, t('docMdRefTabTarget'));
    }
    for (const fieldName of ['auraComponent', 'lwcComponent']) {
      for (const component of collectFieldValues(customTab, fieldName)) {
        collector.addAuraOrLwc(component, t('docMdRefTabTarget'));
      }
    }
  }

  if (parsed.WebLink) {
    for (const page of collectFieldValues(parsed.WebLink, 'page')) {
      collector.add('apexPages', page, t('docMdRefWebLinkTarget'));
    }
  }

  if (parsed.Layout) {
    for (const page of collectFieldValues(parsed.Layout, 'page')) {
      collector.add('apexPages', page, t('docMdRefLayoutItem'));
    }
  }

  if (parsed.Profile) {
    collectPageAccessReferences(parsed.Profile, collector);
  }

  if (parsed.PermissionSet) {
    collectPageAccessReferences(parsed.PermissionSet, collector);
  }

  if (parsed.CustomObject) {
    collectActionOverrideReferences(parsed.CustomObject, collector);
  }

  if (parsed.CustomApplication) {
    collectActionOverrideReferences(parsed.CustomApplication, collector);
  }

  const quickAction = parsed.QuickAction;
  if (quickAction) {
    for (const page of collectFieldValues(quickAction, 'page')) {
      collector.add('apexPages', page, t('docMdRefQuickActionTarget'));
    }
    for (const component of collectFieldValues(quickAction, 'lightningComponent')) {
      collector.addAuraOrLwc(component, t('docMdRefQuickActionTarget'));
    }
  }

  if (parsed.FlexiPage) {
    collectFlexiPageReferences(parsed.FlexiPage, collector);
  }

  if (parsed.Flow) {
    collectFlowReferences(parsed.Flow, collector);
  }

  if (parsed.HomePageComponent) {
    for (const page of collectFieldValues(parsed.HomePageComponent, 'page')) {
      collector.add('apexPages', page, t('docMdRefHomePageComponent'));
    }
  }

  const customSite = parsed.CustomSite;
  if (customSite) {
    for (const fieldName of SITE_PAGE_FIELDS) {
      for (const page of collectFieldValues(customSite, fieldName)) {
        collector.add('apexPages', page, t('docMdRefSitePage', { field: prettifyFieldName(fieldName) }));
      }
    }
  }
}

/** Tier B: qualified patterns catching the references living in free text */
function collectFallbackReferences(content: string, collector: ReferenceCollector): void {
  for (const match of content.matchAll(/\/apex\/([A-Za-z_][A-Za-z0-9_]*)/g)) {
    collector.add('apexPages', match[1], t('docMdRefApexUrlReference'));
  }
  for (const match of content.matchAll(/\$Page\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    collector.add('apexPages', match[1], t('docMdRefCodeReference'));
  }
  for (const match of content.matchAll(/markup:\/\/c:([A-Za-z_][A-Za-z0-9_]*)/g)) {
    collector.add('auraBundles', match[1], t('docMdRefAuraDependency'));
  }
  for (const match of content.matchAll(/\bc__([A-Za-z_][A-Za-z0-9_]*)/g)) {
    collector.addAuraOrLwc(match[1], t('docMdRefCodeReference'));
  }
  for (const match of content.matchAll(/\bc:([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (collector.holder.bareNamespaceMeaning === 'apexComponents') {
      collector.add('apexComponents', match[1], t('docMdRefMarkupReference'));
    } else {
      collector.addAuraOrLwc(match[1], t('docMdRefCodeReference'));
    }
  }
}

function isAuraBundleFile(file: string): boolean {
  return /(?:^|\/)aura\/[^/]+\/[^/]+\.(cmp|app|evt|intf|tokens|design|auradoc|js)$/.test(file.replace(/\\/g, '/'));
}

function buildKnownNamesMap(names: string[]): Map<string, string> {
  const knownNames = new Map<string, string>();
  for (const name of names || []) {
    knownNames.set(String(name).toLowerCase(), String(name));
  }
  return knownNames;
}

/**
 * Scans the package directories once and returns, for each Visualforce page, Visualforce component,
 * Aura bundle and Lightning Web Component of the project, the metadata referencing it.
 */
export async function buildComponentReferenceIndex(
  packageDirs: { path: string }[],
  knownNames: KnownComponentNames
): Promise<ComponentReferenceIndex> {
  const index: ComponentReferenceIndex = { apexPages: {}, apexComponents: {}, auraBundles: {}, lwcBundles: {} };
  const known: Record<ReferenceTargetKind, Map<string, string>> = {
    apexPages: buildKnownNamesMap(knownNames?.apexPages || []),
    apexComponents: buildKnownNamesMap(knownNames?.apexComponents || []),
    auraBundles: buildKnownNamesMap(knownNames?.auraBundles || []),
    lwcBundles: buildKnownNamesMap(knownNames?.lwcBundles || []),
  };
  const nothingToLookFor = Object.values(known).every((names) => names.size === 0);
  if (nothingToLookFor) {
    return index;
  }

  const scannedFiles = new Set<string>();
  for (const packageDir of packageDirs || []) {
    const matchingFiles = await glob(REFERENCE_SCAN_PATTERNS, {
      cwd: packageDir.path,
      ignore: PACKAGE_DIRECTORY_DOC_GLOB_IGNORE_PATTERNS,
      nodir: true,
    });
    for (const matchingFile of matchingFiles) {
      const file = path.join(packageDir.path, matchingFile).replace(/\\/g, '/');
      if (scannedFiles.has(file)) {
        continue;
      }
      scannedFiles.add(file);
      const holder = getHolderContext(file);
      if (!holder) {
        continue;
      }
      let content: string;
      try {
        content = await fs.readFile(file, 'utf-8');
      } catch {
        continue;
      }
      const collector = new ReferenceCollector(index, known, holder);
      // Tier A first: its details are more precise, and the deduplication keeps the first one found
      if (file.endsWith('.page') || file.endsWith('.component') || file.endsWith('.email')) {
        collectVisualforceMarkupReferences(content, collector);
      } else if (file.endsWith('.cls') || file.endsWith('.trigger')) {
        collectApexReferences(content, collector);
      } else if (isAuraBundleFile(file)) {
        collectAuraMarkupReferences(content, collector);
      } else if (file.endsWith('.xml')) {
        collectXmlMetadataReferences(content, collector);
      }
      collectFallbackReferences(content, collector);
    }
  }

  return index;
}

/** Returns the references of a component, sorted by metadata type then name */
export function getComponentReferences(
  index: ComponentReferenceIndex | null,
  kind: ReferenceTargetKind,
  componentName: string
): MetadataReference[] {
  const references = index?.[kind]?.[componentName] || [];
  return [...references].sort(
    (a, b) => a.metadataType.localeCompare(b.metadataType) || a.name.localeCompare(b.name)
  );
}

// Above this many Profile or Permission Set access rows, they are summarized instead of listed: a page
// granted to every profile of an org would push the tab, the layout or the button pointing at it out of sight.
const MAX_ACCESS_ROWS = 10;

/**
 * Builds the "Where Used" markdown section. `prefix` is prepended to the documentation links, so that
 * they resolve from the folder holding the generated file (for example "../" from docs/visualforce).
 * Profile and Permission Set access rows are summarized instead of listed when they would flood the table,
 * and the ones only disabling access are always summarized; a note keeps their count.
 */
export function buildReferencesTable(references: MetadataReference[], prefix: string): string[] {
  const lines: string[] = [`## ${t('docMdWhereUsed')}`, ''];
  const allReferences = references || [];

  // Structural references first: they say how the component is reached, where an access row only says who may reach it
  const structuralReferences = allReferences.filter((reference) => !reference.accessKind);
  const accessGrantedReferences = allReferences.filter((reference) => reference.accessKind === 'enabled');
  const accessDisabledCount = allReferences.filter((reference) => reference.accessKind === 'disabled').length;
  const listedAccessReferences = accessGrantedReferences.length > MAX_ACCESS_ROWS ? [] : accessGrantedReferences;
  const accessGrantedOmittedCount = accessGrantedReferences.length - listedAccessReferences.length;
  const visibleReferences = [...structuralReferences, ...listedAccessReferences];

  const notes: string[] = [];
  if (accessGrantedOmittedCount > 0) {
    notes.push(t('docMdWhereUsedAccessEnabledOmitted', { count: accessGrantedOmittedCount }));
  }
  if (accessDisabledCount > 0) {
    notes.push(t('docMdWhereUsedAccessDisabledOmitted', { count: accessDisabledCount }));
  }

  if (visibleReferences.length === 0) {
    lines.push(...[t('docMdWhereUsedNone'), '']);
    for (const note of notes) {
      lines.push(...[note, '']);
    }
    return lines;
  }

  lines.push(...[
    `| ${t('docMdColMetadataType')} | ${t('docMdColName')} | ${t('docMdColDetail')} |`,
    '| :-------- | :---- | :---------- |',
  ]);
  for (const reference of visibleReferences) {
    const nameCell = reference.docLink ? `[${reference.name}](${prefix}${reference.docLink})` : reference.name;
    lines.push(`| ${reference.metadataType} | ${nameCell} | ${reference.detail || ''} |`);
  }
  lines.push('');
  for (const note of notes) {
    lines.push(...[note, '']);
  }
  return lines;
}

/** One outbound dependency declared by a Visualforce page or component markup */
export interface VisualforceDependency {
  /** Kind of dependency, used both for sorting and for the Type column */
  kind: 'apexComponents' | 'apexPages' | 'auraBundles' | 'staticResources' | 'customLabels';
  name: string;
  docLink?: string;
}

/**
 * Reads the outbound dependencies of a Visualforce markup: embedded custom components, included pages,
 * static resources and custom labels. Controllers stay in the attributes table.
 */
export function extractVisualforceDependencies(markup: string, selfName?: string): VisualforceDependency[] {
  if (!markup) {
    return [];
  }
  const byKey = new Map<string, VisualforceDependency>();
  const add = (kind: VisualforceDependency['kind'], name: string, docLink?: string) => {
    const trimmed = String(name || '').trim();
    if (!trimmed || (selfName && trimmed === selfName && (kind === 'apexPages' || kind === 'apexComponents'))) {
      return;
    }
    const key = `${kind}|${trimmed}`;
    if (!byKey.has(key)) {
      byKey.set(key, { kind, name: trimmed, ...(docLink ? { docLink } : {}) });
    }
  };

  for (const match of markup.matchAll(/<c:([A-Za-z_][A-Za-z0-9_]*)/g)) {
    add('apexComponents', match[1], expectedDocLink('visualforce', `${match[1]}-component.md`));
  }
  for (const match of markup.matchAll(/<apex:(?:include|composition)\b[^>]*?(?:pageName|template)\s*=\s*"([^"$]+)"/gi)) {
    const pageName = match[1].replace(/^\$Page\./, '').trim();
    if (pageName && !pageName.includes('{') && !pageName.includes('!')) {
      add('apexPages', pageName, expectedDocLink('visualforce', `${pageName}.md`));
    }
  }
  for (const match of markup.matchAll(/\$Page\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    add('apexPages', match[1], expectedDocLink('visualforce', `${match[1]}.md`));
  }
  for (const match of markup.matchAll(/\/apex\/([A-Za-z_][A-Za-z0-9_]*)/g)) {
    add('apexPages', match[1], expectedDocLink('visualforce', `${match[1]}.md`));
  }
  for (const match of markup.matchAll(/\$Resource\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    add('staticResources', match[1]);
  }
  for (const match of markup.matchAll(/\$Label\.([A-Za-z_][A-Za-z0-9_.]*)/g)) {
    add('customLabels', match[1]);
  }

  const kindOrder: Record<VisualforceDependency['kind'], number> = {
    apexComponents: 0,
    apexPages: 1,
    auraBundles: 2,
    staticResources: 3,
    customLabels: 4,
  };
  return [...byKey.values()].sort(
    (a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name)
  );
}

function dependencyKindLabel(kind: VisualforceDependency['kind']): string {
  switch (kind) {
    case 'apexComponents':
      return t('docMdUsesTypeComponent');
    case 'apexPages':
      return t('docMdUsesTypePage');
    case 'auraBundles':
      return t('docMdUsesTypeAura');
    case 'staticResources':
      return t('docMdUsesTypeStaticResource');
    case 'customLabels':
      return t('docMdUsesTypeCustomLabel');
    default:
      return kind;
  }
}

/**
 * Builds the "Uses" markdown section from outbound Visualforce dependencies.
 * `prefix` is prepended to documentation links (for example "../" from docs/visualforce).
 */
export function buildUsesTable(dependencies: VisualforceDependency[], prefix: string): string[] {
  const lines: string[] = [`## ${t('docMdUses')}`, ''];
  if (!dependencies || dependencies.length === 0) {
    lines.push(...[t('docMdUsesNone'), '']);
    return lines;
  }
  lines.push(...[
    `| ${t('docMdColType')} | ${t('docMdColName')} |`,
    '| :--: | :---- |',
  ]);
  for (const dependency of dependencies) {
    const nameCell = dependency.docLink ? `[${dependency.name}](${prefix}${dependency.docLink})` : dependency.name;
    lines.push(`| ${dependencyKindLabel(dependency.kind)} | ${nameCell} |`);
  }
  lines.push('');
  return lines;
}
