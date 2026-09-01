import c from 'chalk';
import fs from '../utils/fsUtils.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

import * as yaml from 'js-yaml';
import { SfError } from "@salesforce/core";
import { UtilsAi } from "../aiProvider/utils.js";
import { AiProvider } from "../aiProvider/index.js";
import { uxLog, execCommand } from "../utils/index.js";
import { SUPPORTED_LOCALES, t } from '../utils/i18n.js';


/**
 * Builds a Set of all known translated values for docMdMenu* and docMdAll* i18n keys
 * across all supported locales. Used to detect and remove stale nav entries in mkdocs.yml
 * when the documentation language changes between runs.
 */
export function buildAllKnownNavLabels(keyPrefixes: string[] = ['docMdMenu', 'docMdAll']): Set<string> {
  const labels = new Set<string>();
  /* jscpd:ignore-start */
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  /* jscpd:ignore-end */
  for (const locale of SUPPORTED_LOCALES) {
    const localeFile = path.join(__dirname, '..', '..', 'i18n', `${locale}.json`);
    if (fs.existsSync(localeFile)) {
      try {
        const translations: Record<string, string> = JSON.parse(fs.readFileSync(localeFile, 'utf-8'));
        for (const [key, value] of Object.entries(translations)) {
          if (keyPrefixes.some(keyPrefix => key.startsWith(keyPrefix))) {
            labels.add(value);
          }
        }
      } catch {
        // Ignore unreadable locale files
      }
    }
  }
  return labels;
}

// Zensical reads the same mkdocs.yml file, but resolves emoji helpers from its own
// namespace. Older configs written for materialx or material for MkDocs are upgraded
// on read, so an existing repository picks up the new namespace on its next doc build.
const EMOJI_TWEMOJI_TAG = '!!python/name:zensical.extensions.emoji.twemoji';
const EMOJI_TO_SVG_TAG = '!!python/name:zensical.extensions.emoji.to_svg';
const FENCE_CODE_FORMAT_TAG = '!!python/name:pymdownx.superfences.fence_code_format';

const LEGACY_EMOJI_TWEMOJI_TAGS = [
  '!!python/name:materialx.emoji.twemoji',
  '!!python/name:material.extensions.emoji.twemoji',
];
const LEGACY_EMOJI_TO_SVG_TAGS = [
  '!!python/name:materialx.emoji.to_svg',
  '!!python/name:material.extensions.emoji.to_svg',
];

// MkDocs documents a nav sub-section as a LIST of single-key mappings. Historic
// versions of this command wrote sub-menus as one flat mapping instead, which
// MkDocs tolerated but Zensical rejects with
// "TypeError: Unknown nav item value type: <class 'dict'>".
// Nav is normalized on read, so an existing project is upgraded in place on its
// next doc command: every entry keeps its label, its target and its position,
// including sub-menus a user added by hand after the documentation was generated.
//
// A nav has two kinds of node, and they are NOT interchangeable:
//  - an item, an element of a nav list, written { Label: target }
//  - a target, the value of an item: a page path, or a sub-menu of items
// A one-child sub-menu is indistinguishable from an item by shape alone, so the
// two roles are normalized by two functions rather than guessed from the keys.

// Normalize the value side of a nav item: a page path, or a sub-menu.
export function normalizeMkDocsNavTarget(target: any): any {
  if (Array.isArray(target)) {
    return normalizeMkDocsNav(target);
  }
  if (target && typeof target === 'object') {
    // Sub-menu written the legacy way: every key of the mapping is an item
    return Object.entries(target).map(([label, child]) => ({ [label]: normalizeMkDocsNavTarget(child) }));
  }
  // Page path, or anything else we do not have to touch
  return target;
}

// Normalize a nav list: every element is an item.
export function normalizeMkDocsNav(nav: any): any[] {
  if (nav === null || nav === undefined) {
    return [];
  }
  if (!Array.isArray(nav)) {
    // Whole nav written as a mapping: each of its keys is a root item
    return normalizeMkDocsNavTarget(nav);
  }
  const items: any[] = [];
  for (const item of nav) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      // A well-formed item holds one key; a multi-key mapping found in item
      // position is expanded into one item per key so nothing is dropped.
      for (const [label, target] of Object.entries(item)) {
        items.push({ [label]: normalizeMkDocsNavTarget(target) });
      }
    }
    else {
      // Bare page path used as an item
      items.push(item);
    }
  }
  return items;
}

// Menu entries are collected while metadata files are walked, so their order follows the
// file system and is neither stable between runs nor alphabetical (packages and Lightning
// Web Components came out reversed, for instance). A generated menu is therefore sorted by
// label, case-insensitively, before it is written. The "All <type>" index page of a menu
// keeps its place at the top, and nested sub-menus are sorted the same way.
let allKnownNavIndexLabels: Set<string> | null = null;

function getMkDocsNavItemLabel(item: any): string {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.keys(item)[0] ?? '';
  }
  return String(item ?? '');
}

export function sortMkDocsNavItems(target: any): any {
  if (!Array.isArray(target)) {
    // Page path, or anything else that has no children to sort
    return target;
  }
  if (allKnownNavIndexLabels === null) {
    allKnownNavIndexLabels = buildAllKnownNavLabels(['docMdAll']);
  }
  const indexItems: any[] = [];
  const otherItems: any[] = [];
  for (const item of target) {
    const label = getMkDocsNavItemLabel(item);
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      item[label] = sortMkDocsNavItems(item[label]);
    }
    if (allKnownNavIndexLabels.has(label)) {
      indexItems.push(item);
    }
    else {
      otherItems.push(item);
    }
  }
  otherItems.sort((a, b) =>
    getMkDocsNavItemLabel(a).toLowerCase().localeCompare(getMkDocsNavItemLabel(b).toLowerCase(), 'en', { sensitivity: 'base' })
  );
  return [...indexItems, ...otherItems];
}

// js-yaml cannot parse unquoted "!!python/name:" tags, so they are quoted before load
// and unquoted again on dump, which keeps the file readable by Zensical.
export function readMkDocsFile(mkdocsYmlFile: string): any {
  let mkdocsYmlStr = fs.readFileSync(mkdocsYmlFile, 'utf-8');
  for (const legacyTag of LEGACY_EMOJI_TWEMOJI_TAGS) {
    mkdocsYmlStr = mkdocsYmlStr.replaceAll(legacyTag, EMOJI_TWEMOJI_TAG);
  }
  for (const legacyTag of LEGACY_EMOJI_TO_SVG_TAGS) {
    mkdocsYmlStr = mkdocsYmlStr.replaceAll(legacyTag, EMOJI_TO_SVG_TAG);
  }
  for (const tag of [EMOJI_TWEMOJI_TAG, EMOJI_TO_SVG_TAG, FENCE_CODE_FORMAT_TAG]) {
    mkdocsYmlStr = mkdocsYmlStr.replaceAll(tag, `'${tag}'`);
  }
  const mkdocsYml: any = yaml.load(mkdocsYmlStr);
  mkdocsYml.nav = normalizeMkDocsNav(mkdocsYml.nav);
  return mkdocsYml;
}

export async function writeMkDocsFile(mkdocsYmlFile: string, mkdocsYml: any) {
  let mkdocsYmlStr = yaml.dump(mkdocsYml, { lineWidth: -1 });
  for (const tag of [EMOJI_TWEMOJI_TAG, EMOJI_TO_SVG_TAG, FENCE_CODE_FORMAT_TAG]) {
    mkdocsYmlStr = mkdocsYmlStr.replaceAll(`'${tag}'`, tag);
  }
  await fs.writeFile(mkdocsYmlFile, mkdocsYmlStr);
  uxLog("action", this, c.cyan(t('updatedZensicalConfigFileAt', { mkdocsYmlFile: c.green(mkdocsYmlFile) })));
}

const alreadySaid: string[] = [];

export class SalesforceSetupUrlBuilder {
  /**
   * Map of metadata types to their Lightning Experience setup paths.
   */
  private static readonly setupAreaMap: Record<string, string> = {
    'ActionLinkGroupTemplate': '/lightning/setup/ActionLinkTemplates/home',
    'AppMenu': '/lightning/setup/NavigationMenus/home',
    'ApprovalProcess': '/lightning/setup/ApprovalProcesses/home',
    'AssignmentRules': '/lightning/setup/AssignmentRules/home',
    'AuthProvider': '/lightning/setup/AuthProviders/home',
    'AutoResponseRules': '/lightning/setup/AutoResponseRules/home',
    'ApexClass': '/lightning/setup/ApexClasses/home',
    'ApexPage': '/lightning/setup/VisualforcePages/home',
    'ApexTrigger': '/lightning/setup/ApexTriggers/home',
    'BusinessProcess': '/lightning/setup/ObjectManager/{objectName}/BusinessProcesses/view',
    'CompactLayout': '/lightning/setup/ObjectManager/{objectName}/CompactLayouts/view',
    'ConnectedApp': '/lightning/setup/ConnectedApps/home',
    'ContentAsset': '/lightning/setup/ContentAssets/home',
    'CustomApplication': '/lightning/setup/NavigationMenus/home',
    'CustomField': '/lightning/setup/ObjectManager/{objectName}/FieldsAndRelationships/{apiName}/view',
    'CustomHelpMenu': '/lightning/setup/CustomHelpMenu/home',
    'CustomLabel': '/lightning/setup/CustomLabels/home',
    'CustomMetadata': '/lightning/setup/CustomMetadataTypes/home',
    'CustomNotificationType': '/lightning/setup/CustomNotifications/home',
    'CustomObject': '/lightning/setup/ObjectManager/{objectName}/Details/view',
    'CustomPermission': '/lightning/setup/CustomPermissions/home',
    'CustomSetting': '/lightning/setup/ObjectManager/{objectName}/Details/view',
    'CustomSite': '/lightning/setup/Sites/home',
    'CustomTab': '/lightning/setup/Tabs/home',
    'Dashboard': '/lightning/setup/Dashboards/home',
    'DashboardFolder': '/lightning/setup/DashboardFolders/home',
    'DataCategoryGroup': '/lightning/setup/DataCategories/home',
    'EmailServicesFunction': '/lightning/setup/EmailServices/home',
    'EmailTemplate': '/lightning/setup/EmailTemplates/home',
    'EntitlementTemplate': '/lightning/setup/EntitlementTemplates/home',
    'EscalationRules': '/lightning/setup/EscalationRules/home',
    'EventSubscription': '/lightning/setup/PlatformEvents/home',
    'ExternalDataSource': '/lightning/setup/ExternalDataSources/home',
    'ExternalService': '/lightning/setup/ExternalServices/home',
    'FieldSet': '/lightning/setup/ObjectManager/{objectName}/FieldSets/view',
    'Flexipage': '/lightning/setup/FlexiPageList/home',
    'Flow': '/lightning/setup/Flows/home',
    'GlobalPicklist': '/lightning/setup/Picklists/home',
    'Group': '/lightning/setup/PublicGroups/home',
    'HomePageLayout': '/lightning/setup/HomePageLayouts/home',
    'Layout': '/lightning/setup/ObjectManager/{objectName}/PageLayouts/view',
    'LightningComponentBundle': '/lightning/setup/LightningComponents/home',
    'MilestoneType': '/lightning/setup/Milestones/home',
    'NamedCredential': '/lightning/setup/NamedCredentials/home',
    'OmniChannelSettings': '/lightning/setup/OmniChannelSettings/home',
    'PermissionSet': '/lightning/setup/PermissionSets/home',
    'PermissionSetGroup': '/lightning/setup/PermissionSetGroups/home',
    'PlatformEvent': '/lightning/setup/PlatformEvents/home',
    'Profile': '/lightning/setup/Profiles/home',
    'Queue': '/lightning/setup/Queues/home',
    'RecordType': '/lightning/setup/ObjectManager/{objectName}/RecordTypes/view',
    'RemoteSiteSetting': '/lightning/setup/RemoteSites/home',
    'Report': '/lightning/setup/Reports/home',
    'ReportFolder': '/lightning/setup/ReportFolders/home',
    'Role': '/lightning/setup/Roles/home',
    'ServiceChannel': '/lightning/setup/ServiceChannels/home',
    'SharingRules': '/lightning/setup/SharingRules/home',
    'StaticResource': '/lightning/setup/StaticResources/home',
    'Territory': '/lightning/setup/Territories/home',
    'TerritoryModel': '/lightning/setup/TerritoryManagement/home',
    'Translation': '/lightning/setup/Translations/home',
    'ValidationRule': '/lightning/setup/ObjectManager/{objectName}/ValidationRules/view',
    'VisualforcePage': '/lightning/setup/VisualforcePages/home',
    'Workflow': '/lightning/setup/Workflow/home',
    // Add more metadata types if needed
  };

  /**
   * Generates the setup URL for a given metadata type and API name (if required).
   * @param metadataType The metadata type (e.g., "CustomObject", "ApexClass").
   * @param apiName The API name of the metadata (optional, e.g., "Account").
   * @returns The constructed setup URL.
   * @throws Error if the metadata type is unsupported or the API name is missing for required types.
   */
  public static getSetupUrl(metadataType: string, apiName: string): string | null {
    const pathTemplate = this.setupAreaMap[metadataType];

    if (!pathTemplate) {
      if (!alreadySaid.includes(metadataType)) {
        //        uxLog("log", this, c.grey(`Unsupported metadata type for doc quick link: ${metadataType}`));
        alreadySaid.push(metadataType);
      }
      return null;
    }

    let apiNameFinal = apiName + "";
    let objectName = ""
    if (apiName.includes(".") && apiName.split(".").length === 2) {
      [objectName, apiNameFinal] = apiName.split(".")[1];
    }

    // Replace placeholders in the path template with the provided API name
    const urlPath = pathTemplate
      .replace(/\{objectName\}/g, objectName || '')
      .replace(/\{apiName\}/g, apiNameFinal || '');

    if (urlPath.includes('{apiName}') || urlPath.includes('{objectName}')) {
      uxLog("log", this, c.grey(t('wrongReplacementInWithValuesApinameAnd', { urlPath, apiNameFinal, objectName })));
    }

    return urlPath;
  }
}

export async function completeAttributesDescriptionWithAi(attributesMarkdown: string, objectName: string): Promise<string> {
  if (!attributesMarkdown) {
    return attributesMarkdown;
  }
  const aiCache = await UtilsAi.findAiCache("PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD", [attributesMarkdown], objectName);
  if (aiCache.success === true) {
    uxLog("log", this, c.grey(t('usedAiCacheForAttributesCompletionSet')));
    return aiCache.cacheText ? includeFromFile(aiCache.aiCacheDirFile, aiCache.cacheText) : attributesMarkdown;
  }
  if (await AiProvider.isAiAvailable()) {
    // Invoke AI Service
    const prompt = await AiProvider.buildPrompt("PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD", { "MARKDOWN": attributesMarkdown, "OBJECT_NAME": objectName });
    const aiResponse = await AiProvider.promptAi(prompt, "PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD");
    // Replace description in markdown
    if (aiResponse?.success) {
      const responseText = aiResponse.promptResponse || t('docMdNoAiDescriptionAvailable');
      await UtilsAi.writeAiCache("PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD", [attributesMarkdown], objectName, responseText);
      attributesMarkdown = includeFromFile(aiCache.aiCacheDirFile, responseText);
    }
  }
  return attributesMarkdown;
}

export async function replaceInFile(filePath: string, stringToReplace: string, replaceWith: string) {
  const fileContent = await fs.readFile(filePath, 'utf8');
  const newContent = fileContent.replaceAll(stringToReplace, replaceWith);
  await fs.writeFile(filePath, newContent);
}

// Python packages needed to build the site with Zensical.
// Zensical reads mkdocs.yml directly, so no config conversion is required.
const ZENSICAL_PIP_PACKAGES = "zensical mdx_truly_sane_lists";
const ZENSICAL_DOCKER_IMAGE = "zensical/zensical";

export async function generateMkDocsHTML() {
  const zensicalLocalOk = await installMkDocs();
  if (zensicalLocalOk) {
    // Generate HTML pages with local Zensical
    uxLog("action", this, c.cyan(t('generatingHtmlPagesWithZensical')));
    const buildCommands = ["zensical build", "python -m zensical build", "py -m zensical build"];
    const zensicalBuildRes = await execCommand(buildCommands.join(" || "), this, { fail: false, output: true, debug: false });
    if (zensicalBuildRes.status !== 0) {
      throw new SfError('Zensical build failed:\n' + zensicalBuildRes.stderr + "\n" + zensicalBuildRes.stdout);
    }
  }
  else {
    // Generate HTML pages with Docker
    uxLog("action", this, c.cyan(t('generatingHtmlPagesWithDocker')));
    const zensicalBuildRes = await execCommand(`docker run --rm -v $(pwd):/docs ${ZENSICAL_DOCKER_IMAGE} build`, this, { fail: false, output: true, debug: false });
    if (zensicalBuildRes.status !== 0) {
      throw new SfError('Zensical build with docker failed:\n' + zensicalBuildRes.stderr + "\n" + zensicalBuildRes.stdout);
    }
  }
}

export async function installMkDocs() {
  uxLog("action", this, c.cyan(t('managingZensicalLocalInstallation')));
  let zensicalLocalOk = false;
  const pipCommands = ["pip", "python -m pip", "py -m pip", "python3 -m pip", "py3 -m pip"]
    .map((pipCmd) => `${pipCmd} install ${ZENSICAL_PIP_PACKAGES}`);
  const installZensicalRes = await execCommand(pipCommands.join(" || "), this, { fail: false, output: true, debug: false });
  if (installZensicalRes.status === 0) {
    zensicalLocalOk = true;
  }
  return zensicalLocalOk;
}

export function getMetaHideLines(): string {
  return `---
hide:
  - path
---

`;
}

// Zensical has no glob-based search exclusion (the mkdocs-exclude-search plugin has no
// equivalent yet), so noisy generated pages opt out one by one with page front matter.
export function getMetaHideAndSearchExcludeLines(): string {
  return `---
hide:
  - path
search:
  exclude: true
---

`;
}

export function includeFromFile(cacheFilePath: string, content: string): string {
  // Detect if cacheFilePath contains a fingerprint at the end after the last "-"
  const fileNameWithoutExtension = cacheFilePath.substring(0, cacheFilePath.lastIndexOf("."));
  const fileExtensionWithDot = cacheFilePath.substring(cacheFilePath.lastIndexOf("."));
  const lastDashIndex = fileNameWithoutExtension.lastIndexOf("-");
  const cacheFileFingerprint = lastDashIndex !== -1 ? fileNameWithoutExtension.substring(lastDashIndex + 1) : "";
  // Check if the fingerprint is a valid number
  const isValidFingerprint = /^\d+$/.test(cacheFileFingerprint);
  if (isValidFingerprint) {
    // Remove the fingerprint from the cacheFilePath
    const cacheFilePathOverridden = fileNameWithoutExtension.substring(0, lastDashIndex) + fileExtensionWithDot;
    return `<!-- ${t('docMdAiGeneratedPartComment')} -->
<!-- ${t('docMdOverrideManuallyHint', { cacheFilePathOverridden: cacheFilePathOverridden })} -->
<!-- Cache file start: ${cacheFilePath} -->

${content}

<!-- Cache file end: ${cacheFilePath} -->
`
  }
  else {
    return `<!-- ${t('docMdAiGeneratedThenManuallyUpdated')} -->
<!-- ${t('docMdAiRecalculateHint', { cacheFilePath: cacheFilePath })} -->
<!-- Cache file: ${cacheFilePath} -->

${content}

<!-- Cache file end: ${cacheFilePath} -->`
  }

}
