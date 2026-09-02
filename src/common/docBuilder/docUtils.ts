import c from 'chalk';
import fs from '../utils/fsUtils.js';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

import * as yaml from 'js-yaml';
import { glob } from 'glob';
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

// Folders of the documentation that project2markdown writes itself. Pages a user added by
// hand outside of them are never rewritten by the dead link cleanup below.
export const GENERATED_DOC_FOLDERS = [
  'apex',
  'approvalProcesses',
  'assignmentRules',
  'aura',
  'autoResponseRules',
  'escalationRules',
  'flows',
  'lwc',
  'objects',
  'packages',
  'pages',
  'permissionsetgroups',
  'permissionsets',
  'processBuilders',
  'profiles',
  'visualforce',
  'workflowRules',
];

// [label](target.md) or [label](target.md#anchor), the only link shape the generated pages use
const MARKDOWN_PAGE_LINK_REGEX = /\[([^\]\n]*)\]\(([^)\s#]+\.md)(#[^)\s]*)?\)/g;

// A page whose name holds a space is linked as profiles/Chatter%20Free%20User.md
function decodeMarkdownLinkPath(linkPath: string): string {
  try {
    return decodeURIComponent(linkPath);
  } catch {
    // Percent sign that is not an escape sequence: the path is already the one to look for
    return linkPath;
  }
}

function encodeMarkdownLinkPath(linkPath: string): string {
  return linkPath.replaceAll(' ', '%20');
}

// A generated page regularly links to a page that was never generated: a permission set the
// org owns but the project does not, an Apex class ApexDocGen skipped, a component another
// one references but that is absent from the repository. Zensical reports each of them as
// "page does not exist" and the reader gets a link leading nowhere, so all the links are
// checked once the whole documentation is written. A target that exists under another case
// is repaired (a Visualforce page declares standardController="account", the page is
// objects/Account.md), a target that does not exist at all loses its link and keeps its
// label. Case matters even on Windows: the site generator resolves page paths itself, and
// a link the local file system happily opens still breaks once the site is built.
export async function removeDeadDocumentationLinks(docsRoot: string): Promise<number> {
  if (!fs.existsSync(docsRoot)) {
    return 0;
  }
  const allPages = (await glob('**/*.md', { cwd: docsRoot, nodir: true })).map(page => page.replace(/\\/g, '/'));
  const pagesByLowerCase = new Map<string, string>();
  for (const page of allPages) {
    pagesByLowerCase.set(page.toLowerCase(), page);
  }
  const existingPages = new Set(allPages);
  let fixedLinksNb = 0;
  for (const page of allPages) {
    if (!GENERATED_DOC_FOLDERS.includes(page.split('/')[0])) {
      continue;
    }
    const pageFile = path.join(docsRoot, page);
    const pageContent = await fs.readFile(pageFile, 'utf8');
    const pageDir = path.posix.dirname(page);
    let pageFixedLinksNb = 0;
    const updatedContent = pageContent.replace(MARKDOWN_PAGE_LINK_REGEX, (link, label, target, anchor) => {
      if (target.includes('://') || target.startsWith('/')) {
        // External link, or a link the site generator resolves from its own root
        return link;
      }
      const targetPage = path.posix.normalize(
        path.posix.join(pageDir, decodeMarkdownLinkPath(target.replace(/\\/g, '/')))
      );
      if (existingPages.has(targetPage)) {
        return link;
      }
      pageFixedLinksNb++;
      const targetPageOtherCase = pagesByLowerCase.get(targetPage.toLowerCase());
      if (targetPageOtherCase) {
        return `[${label}](${encodeMarkdownLinkPath(path.posix.relative(pageDir, targetPageOtherCase))}${anchor || ''})`;
      }
      // Nothing to link to: keep the label, unless it is only an icon that would be left alone
      return /[\p{L}\p{N}]/u.test(label) ? label : '';
    });
    if (pageFixedLinksNb > 0) {
      await fs.writeFile(pageFile, updatedContent);
      fixedLinksNb += pageFixedLinksNb;
    }
  }
  return fixedLinksNb;
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

// Index tables used to be rendered in the order the metadata files happened to be walked in:
// the Lightning Web Components table came out reversed, and an object page listed its related
// components in an order that matched neither the menu nor the section index. Sorted in place,
// so the arrays that feed several tables are only ever sorted once.
export function sortDescriptionsByName(descriptions: any[]): any[] {
  return descriptions.sort((a, b) =>
    String(a?.name ?? "").localeCompare(String(b?.name ?? ""), 'en', { sensitivity: 'base' })
  );
}

// [Label](Something.md) or [Label](../flows/Something.md), never an http(s) link of the page footer.
// A page name can hold a space ("Case.Case creation Auto-Response.md"), so only the closing
// parenthesis and the end of the line stop the target.
const MARKDOWN_PAGE_LINK_IN_INDEX_REGEX = /\]\((?!\w+:)[^)\n]+\.md[)#]/;

// A section index page is written even when its section stayed empty, so its existence says
// nothing. It counts as documented once it lists at least one page. Counting the files of its
// folder would not do: Process Builders have an index of their own, but their pages are written
// among the Flows.
export function indexPageListsPages(indexContent: string): boolean {
  return MARKDOWN_PAGE_LINK_IN_INDEX_REGEX.test(indexContent);
}

// A section that documents nothing still kept an index.md carrying a title and a footer and not a
// single link: a page missing from the navigation and from the home page, that the site generator
// still built and that a search engine could still send a reader to. Sections whose metadata is
// gone since the last run leave the same page behind. Both are removed here, along with the folder
// once nothing is left in it. Only the folders sfdx-hardis writes itself are looked at, so a page
// someone added by hand is never touched.
export async function removeEmptySectionIndexPages(docsRoot: string): Promise<string[]> {
  const removedSections: string[] = [];
  for (const folder of GENERATED_DOC_FOLDERS) {
    const sectionFolder = path.join(docsRoot, folder);
    if (!fs.existsSync(sectionFolder)) {
      continue;
    }
    const indexFile = path.join(sectionFolder, 'index.md');
    if (fs.existsSync(indexFile) && !indexPageListsPages(await fs.readFile(indexFile, 'utf8'))) {
      await fs.remove(indexFile);
      removedSections.push(folder);
    }
    // A section that documents nothing is still given its folder before it gives up, and an empty
    // folder left in the documentation is one more thing to wonder about when reading the diff.
    if ((await fs.readdir(sectionFolder)).length === 0) {
      await fs.remove(sectionFolder);
    }
  }
  return removedSections;
}

// Checksum of the home page a run wrote, so a later run can tell a page nobody touched from a page
// the project made its own. Git can check the page out with CRLF line endings, and an editor can
// leave a blank line at the end, so neither counts as a change.
const HOME_PAGE_STAMP_REGEX = /^<!-- sfdx-hardis-home-page: ([0-9a-f]{64}) -->\r?$/m;

// Link of the footer every generated page ends with, the only mark a home page written before the
// stamp existed carries.
const GENERATED_PAGE_FOOTER_MARK = 'hardis/doc/project2markdown/';

function homePageChecksum(homePageContent: string): string {
  return createHash('sha256').update(homePageContent.replace(/\r\n/g, '\n').trimEnd()).digest('hex');
}

export function stampGeneratedHomePage(homePageContent: string): string {
  return `${homePageContent.trimEnd()}\n\n<!-- sfdx-hardis-home-page: ${homePageChecksum(homePageContent)} -->\n`;
}

// DO_NOT_OVERWRITE_INDEX_MD keeps the home page a project wrote for itself. A project that set the
// variable and then never touched the page used to stay forever on the home page of the sfdx-hardis
// version that generated it: the page is refreshed as long as it is still, to the character, what a
// previous run wrote. Editing it, even by a word, hands it over to the project for good.
export function isUntouchedGeneratedHomePage(homePageContent: string): boolean {
  const stamp = HOME_PAGE_STAMP_REGEX.exec(homePageContent);
  if (stamp) {
    return homePageChecksum(homePageContent.replace(HOME_PAGE_STAMP_REGEX, '')) === stamp[1];
  }
  // Written before the stamp existed: the sfdx-hardis footer is all there is to go on
  return homePageContent.includes(GENERATED_PAGE_FOOTER_MARK);
}

// A page takes its title from its first level 1 heading, and falls back to the file name when
// it has none. Every generated index.md was therefore called "Index": in the browser tab, in
// the search results and as the heading at the top of the page. The table that opens a section
// index already carries the section name as a level 2 heading, so it is promoted to level 1.
export function promoteSectionIndexTitle(indexLines: string[]): string[] {
  const promoted = [...indexLines];
  const titleIndex = promoted.findIndex(line => line.startsWith("## "));
  if (titleIndex > -1) {
    promoted[titleIndex] = promoted[titleIndex].slice(1);
  }
  return promoted;
}

// Zensical has no glob-based search exclusion (the mkdocs-exclude-search plugin has no
// equivalent yet), so noisy generated pages opt out one by one with page front matter.
export function getSearchExcludeLines(): string {
  return `---
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
