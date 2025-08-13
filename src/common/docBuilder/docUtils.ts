import c from 'chalk';
import fs from 'fs-extra';

import * as yaml from 'js-yaml';
import { SfError } from "@salesforce/core";
import { UtilsAi } from "../aiProvider/utils.js";
import { AiProvider } from "../aiProvider/index.js";
import { uxLog, execCommand } from "../utils/index.js";


export function readMkDocsFile(mkdocsYmlFile: string): any {
  const mkdocsYml: any = yaml.load(
    fs
      .readFileSync(mkdocsYmlFile, 'utf-8')
      .replace('!!python/name:materialx.emoji.twemoji', "!!python/name:material.extensions.emoji.twemoji")
      .replace('!!python/name:materialx.emoji.to_svg', "!!python/name:material.extensions.emoji.to_svg")
      .replace('!!python/name:material.extensions.emoji.twemoji', "'!!python/name:material.extensions.emoji.twemoji'")
      .replace('!!python/name:material.extensions.emoji.to_svg', "'!!python/name:material.extensions.emoji.to_svg'")
      .replace('!!python/name:pymdownx.superfences.fence_code_format', "'!!python/name:pymdownx.superfences.fence_code_format'")
  );
  if (!mkdocsYml.nav) {
    mkdocsYml.nav = {}
  }
  return mkdocsYml;
}

export async function writeMkDocsFile(mkdocsYmlFile: string, mkdocsYml: any) {
  const mkdocsYmlStr = yaml
    .dump(mkdocsYml, { lineWidth: -1 })
    .replace("!!python/name:materialx.emoji.twemoji", '!!python/name:material.extensions.emoji.twemoji')
    .replace("!!python/name:materialx.emoji.to_svg", '!!python/name:material.extensions.emoji.to_svg')
    .replace("'!!python/name:material.extensions.emoji.twemoji'", '!!python/name:material.extensions.emoji.twemoji')
    .replace("'!!python/name:material.extensions.emoji.to_svg'", '!!python/name:material.extensions.emoji.to_svg')
    .replace("'!!python/name:pymdownx.superfences.fence_code_format'", '!!python/name:pymdownx.superfences.fence_code_format');
  await fs.writeFile(mkdocsYmlFile, mkdocsYmlStr);
  uxLog("action", this, c.cyan(`Updated mkdocs-material config file at ${c.green(mkdocsYmlFile)}`));
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
        uxLog("log", this, c.grey(`Unsupported metadata type for doc quick link: ${metadataType}`));
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
      uxLog("log", this, c.grey(`Wrong replacement in ${urlPath} with values apiName:${apiNameFinal} and objectName:${objectName}`));
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
    uxLog("log", this, c.grey("Used AI cache for attributes completion (set IGNORE_AI_CACHE=true to force call to AI)"));
    return aiCache.cacheText ? includeFromFile(aiCache.aiCacheDirFile, aiCache.cacheText) : attributesMarkdown;
  }
  if (AiProvider.isAiAvailable()) {
    // Invoke AI Service
    const prompt = AiProvider.buildPrompt("PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD", { "MARKDOWN": attributesMarkdown, "OBJECT_NAME": objectName });
    const aiResponse = await AiProvider.promptAi(prompt, "PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD");
    // Replace description in markdown
    if (aiResponse?.success) {
      const responseText = aiResponse.promptResponse || "No AI description available";
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

export async function generateMkDocsHTML() {
  const mkdocsLocalOk = await installMkDocs();
  if (mkdocsLocalOk) {
    // Generate MkDocs HTML pages with local MkDocs
    uxLog("action", this, c.cyan("Generating HTML pages with mkdocs..."));
    const mkdocsBuildRes = await execCommand("mkdocs build -v || python -m mkdocs build -v || py -m mkdocs build -v", this, { fail: false, output: true, debug: false });
    if (mkdocsBuildRes.status !== 0) {
      throw new SfError('MkDocs build failed:\n' + mkdocsBuildRes.stderr + "\n" + mkdocsBuildRes.stdout);
    }
  }
  else {
    // Generate MkDocs HTML pages with Docker
    uxLog("action", this, c.cyan("Generating HTML pages with Docker..."));
    const mkdocsBuildRes = await execCommand("docker run --rm -v $(pwd):/docs squidfunk/mkdocs-material build -v", this, { fail: false, output: true, debug: false });
    if (mkdocsBuildRes.status !== 0) {
      throw new SfError('MkDocs build with docker failed:\n' + mkdocsBuildRes.stderr + "\n" + mkdocsBuildRes.stdout);
    }
  }
}

export async function installMkDocs() {
  uxLog("action", this, c.cyan("Managing mkdocs-material local installation..."));
  let mkdocsLocalOk = false;
  const installMkDocsRes = await execCommand("pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists || python -m pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists || py -m pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists || python3 -m pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists || py3 -m pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists", this, { fail: false, output: true, debug: false });
  if (installMkDocsRes.status === 0) {
    mkdocsLocalOk = true;
  }
  return mkdocsLocalOk;
}

export function getMetaHideLines(): string {
  return `---
hide:
  - path
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
    return `<!-- The following part has been generated by AI. -->
<!-- If you want to override it manually, rename the cache file into ${cacheFilePathOverridden} then update it with the content you want. -->
<!-- Cache file start: ${cacheFilePath} -->

${content}

<!-- Cache file end: ${cacheFilePath} -->
`
  }
  else {
    return `<!-- The following part has been generated by AI then manually updated -->
<!-- If you want AI to recalculate it again, you can delete file ${cacheFilePath} -->
<!-- Cache file: ${cacheFilePath} -->

${content}

<!-- Cache file end: ${cacheFilePath} -->`
  }

}
