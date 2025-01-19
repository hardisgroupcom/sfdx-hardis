import * as path from "path";
import c from 'chalk';
import fs from 'fs-extra';
import { uxLog } from "./index.js";
import * as yaml from 'js-yaml';
import { countPackageXmlItems, parsePackageXmlFile } from "./xmlUtils.js";
import { CONSTANTS } from "../../config/index.js";
import { SfError } from "@salesforce/core";
import { UtilsAi } from "../aiProvider/utils.js";
import { AiProvider } from "../aiProvider/index.js";

export async function generatePackageXmlMarkdown(inputFile: string | null, outputFile: string | null = null, packageXmlDefinition: any = null, rootSalesforceUrl: string = "") {
  // Find packageXml to parse if not defined
  if (inputFile == null) {
    inputFile = path.join(process.cwd(), "manifest", "package.xml");
    if (!fs.existsSync(inputFile)) {
      throw new SfError("No package.xml found. You need to send the path to a package.xml file in --inputfile option");
    }
  }
  // Build output file if not defined
  if (outputFile == null) {
    const packageXmlFileName = path.basename(inputFile);
    outputFile = path.join(process.cwd(), "docs", `${packageXmlFileName}.md`);
  }
  await fs.ensureDir(path.dirname(outputFile));

  uxLog(this, c.cyan(this, `Generating markdown doc from ${inputFile} to ${outputFile}...`));

  // Read content
  const packageXmlContent = await parsePackageXmlFile(inputFile);
  const metadataTypes = Object.keys(packageXmlContent);
  metadataTypes.sort();
  const nbItems = await countPackageXmlItems(inputFile);

  const mdLines: string[] = []

  if (packageXmlDefinition && packageXmlDefinition.description) {
    // Header
    mdLines.push(...[
      `## Content of ${path.basename(inputFile)}`,
      '',
      packageXmlDefinition.description,
      '',
      `Metadatas: ${nbItems}`,
      ''
    ]);
  }
  else {
    // Header
    mdLines.push(...[
      `## Content of ${path.basename(inputFile)}`,
      '',
      `Metadatas: ${nbItems}`,
      ''
    ]);
  }

  // Generate package.xml markdown
  for (const metadataType of metadataTypes) {
    const members = packageXmlContent[metadataType];
    members.sort();
    const memberLengthLabel = members.length === 1 && members[0] === "*" ? "*" : members.length;
    mdLines.push(`<details><summary>${metadataType} (${memberLengthLabel})</summary>\n\n`);
    for (const member of members) {
      const memberLabel = member === "*" ? "ALL (wildcard *)" : member;
      const setupUrl = SalesforceSetupUrlBuilder.getSetupUrl(metadataType, member);
      if (setupUrl && rootSalesforceUrl) {
        mdLines.push(`  • <a href="${rootSalesforceUrl}${setupUrl}" target="_blank">${memberLabel}</a><br/>`);
      }
      else {
        mdLines.push(`  • ${memberLabel}<br/>`);
      }
    }
    mdLines.push("");
    mdLines.push("</details>");
    mdLines.push("");
  }
  mdLines.push("");

  // Footer
  mdLines.push(`_Documentation generated with [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT})_`);

  // Write output file
  await fs.writeFile(outputFile, mdLines.join("\n") + "\n");

  uxLog(this, c.green(`Successfully generated ${path.basename(inputFile)} documentation into ${outputFile}`));

  return outputFile;
}

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
    .dump(mkdocsYml)
    .replace("!!python/name:materialx.emoji.twemoji", '!!python/name:material.extensions.emoji.twemoji')
    .replace("!!python/name:materialx.emoji.to_svg", '!!python/name:material.extensions.emoji.to_svg')
    .replace("'!!python/name:material.extensions.emoji.twemoji'", '!!python/name:material.extensions.emoji.twemoji')
    .replace("'!!python/name:material.extensions.emoji.to_svg'", '!!python/name:material.extensions.emoji.to_svg')
    .replace("'!!python/name:pymdownx.superfences.fence_code_format'", '!!python/name:pymdownx.superfences.fence_code_format');
  await fs.writeFile(mkdocsYmlFile, mkdocsYmlStr);
  uxLog(this, c.cyan(`Updated mkdocs-material config file at ${c.green(mkdocsYmlFile)}`));
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
        uxLog(this, c.grey(`Unsupported metadata type: ${metadataType}`));
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
      uxLog(this, c.grey(`Wrong replacement in ${urlPath} with values apiName:${apiNameFinal} and objectName:${objectName}`));
    }

    return urlPath;
  }
}

export async function generateObjectMarkdown(objectName: string, objectXmlDefinition: string, allObjectsNames: string, objectLinksDetails: string, outputFile: string) {
  const mdLines = [
    `## ${objectName}`,
    '',
    '<!-- Object description -->',
    '',
    '<!-- Attributes tables -->',
    '',
    '<!-- Flows table -->'
  ];
  mdLines.push("");
  // Footer
  mdLines.push(`_Documentation generated with [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT})_`);
  let mdLinesStr = mdLines.join("\n") + "\n";
  mdLinesStr = await completeObjectDocWithAiDescription(mdLinesStr, objectName, objectXmlDefinition, allObjectsNames, objectLinksDetails);
  // Write output file
  await fs.writeFile(outputFile, mdLinesStr);
  uxLog(this, c.green(`Successfully generated ${objectName} documentation into ${outputFile}`));
  return outputFile;
}

export async function completeAttributesDescriptionWithAi(attributesMarkdown: string, objectName: string): Promise<string> {
  const aiCache = await UtilsAi.findAiCache("PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD", [attributesMarkdown]);
  if (aiCache.success === true) {
    uxLog(this, c.grey("Used AI cache for attributes completion (set IGNORE_AI_CACHE=true to force call to AI)"));
    return aiCache.cacheText ? `<!-- Cache file: ${aiCache.aiCacheDirFile} -->\n\n${aiCache.cacheText}` : attributesMarkdown;
  }
  if (AiProvider.isAiAvailable()) {
    // Invoke AI Service
    const prompt = AiProvider.buildPrompt("PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD", { "MARKDOWN": attributesMarkdown, "OBJECT_NAME": objectName });
    const aiResponse = await AiProvider.promptAi(prompt, "PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD");
    // Replace description in markdown
    if (aiResponse?.success) {
      const responseText = aiResponse.promptResponse || "No AI description available";
      await UtilsAi.writeAiCache("PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD", [attributesMarkdown], responseText);
      attributesMarkdown = `<!-- Cache file: ${aiCache.aiCacheDirFile} -->\n\n${responseText}`;
    }
  }
  return attributesMarkdown;
}

async function completeObjectDocWithAiDescription(objectMarkdownDoc: string, objectName: string, objectXml: string, allObjectsNames: string, objectLinksDetails: string): Promise<string> {
  const aiCache = await UtilsAi.findAiCache("PROMPT_DESCRIBE_OBJECT", [objectXml]);
  if (aiCache.success === true) {
    uxLog(this, c.grey("Used AI cache for object description (set IGNORE_AI_CACHE=true to force call to AI)"));
    const replaceText = `<!-- Cache file: ${aiCache.aiCacheDirFile} -->\n\n${aiCache.cacheText || ""}`;
    return objectMarkdownDoc.replace("<!-- Object description -->", replaceText);
  }
  if (AiProvider.isAiAvailable()) {
    // Invoke AI Service
    const prompt = AiProvider.buildPrompt("PROMPT_DESCRIBE_OBJECT", { "OBJECT_NAME": objectName, "OBJECT_XML": objectXml, "ALL_OBJECTS_LIST": allObjectsNames, "ALL_OBJECT_LINKS": objectLinksDetails });
    const aiResponse = await AiProvider.promptAi(prompt, "PROMPT_DESCRIBE_OBJECT");
    // Replace description in markdown
    if (aiResponse?.success) {
      let responseText = aiResponse.promptResponse || "No AI description available";
      if (responseText.startsWith("##")) {
        responseText = responseText.split("\n").slice(1).join("\n");
      }
      await UtilsAi.writeAiCache("PROMPT_DESCRIBE_OBJECT", [objectXml], responseText);
      const replaceText = `<!-- Cache file: ${aiCache.aiCacheDirFile} -->\n\n${responseText}`;
      const objectMarkdownDocUpdated = objectMarkdownDoc.replace("<!-- Object description -->", replaceText);
      return objectMarkdownDocUpdated;
    }
  }
  return objectMarkdownDoc;
}

export async function replaceInFile(filePath: string, stringToReplace: string, replaceWith: string) {
  const fileContent = await fs.readFile(filePath, 'utf8');
  const newContent = fileContent.replaceAll(stringToReplace, replaceWith);
  await fs.writeFile(filePath, newContent);
}
