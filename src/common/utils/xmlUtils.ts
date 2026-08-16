// XML Utils functions
import { SfError } from '@salesforce/core';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import * as util from 'util';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import { sortCrossPlatform, uxLog } from './index.js';
import { getApiVersion } from '../../config/index.js';
import { t } from './i18n.js';

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * Returns an XMLParser configured with a higher entity expansion limit (10 000)
 * to handle Salesforce metadata files with rich-text descriptions containing
 * many HTML entities without hitting the default security limit of 1 000.
 */
export function getLargeXmlParser(): XMLParser {
  return new XMLParser({ processEntities: { maxTotalExpansions: Infinity } });
}

/**
 * Returns an XMLParser producing the same object shape as the historical xml2js
 * parser (see xmlUtils.test.ts):
 * - every element value wrapped in an array (except the root), unless explicitArray is false
 * - attributes grouped under "$", text of attributed elements under "_"
 * - tag values kept as strings, empty leafs parsed as ""
 */
function getCompatXmlParser(options: { explicitArray?: boolean } = {}): XMLParser {
  const explicitArray = options.explicitArray !== false;
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    attributesGroupName: '$',
    textNodeName: '_',
    parseTagValue: false,
    parseAttributeValue: false,
    // trimValues false matches the historical xml2js trim:false default: significant
    // leading/trailing whitespace in values is preserved (e.g. a label ending with a
    // space). Whitespace-only text (indentation) is dropped by the post-processor below.
    trimValues: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    processEntities: { maxTotalExpansions: Infinity } as any,
    // htmlEntities also decodes numeric character references (&#233;), like the historical parser
    htmlEntities: true,
    // The isArray key must be absent (not undefined) when unused, or fast-xml-parser crashes
    ...(explicitArray ? { isArray: (name: string, jpath: any) => name !== '$' && String(jpath).includes('.') } : {}),
  });
}

// Reproduces the xml2js whitespace handling on the raw fast-xml-parser output:
// - whitespace-only text nodes (indentation between elements) are dropped
// - an element containing only whitespace text becomes the empty string
// - non-whitespace text keeps its leading/trailing whitespace untouched
function applyXml2jsWhitespaceSemantics(node: any): any {
  if (typeof node === 'string') {
    return /^\s*$/.test(node) ? '' : node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => applyXml2jsWhitespaceSemantics(item));
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (key === '$') {
        continue; // attribute values are kept as-is, like xml2js
      }
      if (key === '_') {
        if (typeof node._ === 'string' && /^\s*$/.test(node._)) {
          delete node._;
        }
        continue;
      }
      node[key] = applyXml2jsWhitespaceSemantics(node[key]);
    }
    if (Object.keys(node).length === 0) {
      return '';
    }
  }
  return node;
}

// xml2js escaped &, < and > in text values (not quotes), and also quotes in attribute values
function escapeXmlText(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXmlAttribute(value: unknown): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

/**
 * Parses an XML string into the xml2js-compatible object shape.
 * Throws an Error on malformed XML (fast-xml-parser alone is lenient, so the
 * document is validated first to keep the historical failure behavior).
 */
export function parseXmlString(xmlString: string, options: { explicitArray?: boolean } = {}): any {
  const validation = XMLValidator.validate(xmlString);
  if (validation !== true) {
    throw new Error(validation.err?.msg || 'Invalid XML document');
  }
  return applyXml2jsWhitespaceSemantics(getCompatXmlParser(options).parse(xmlString));
}

export async function parseXmlFile(xmlFile: string) {
  const packageXmlString = await fs.readFile(xmlFile, 'utf8');
  try {
    return parseXmlString(packageXmlString);
  } catch (e: any) {
    throw new SfError(`Error parsing ${xmlFile}: ${e.message}`);
  }
}

/**
 * Builds an XML document string from an xml2js-shaped object, byte-compatible
 * with the historical xml2js Builder output: XML declaration, pretty print,
 * "\n" newlines, empty leafs rendered as self-closing tags, no trailing newline.
 */
export function buildXmlString(xmlObject: any, indent?: string): string {
  const builder = new XMLBuilder({
    format: true,
    indentBy: indent ?? (process.env.SFDX_XML_INDENT || '    '),
    ignoreAttributes: false,
    attributeNamePrefix: '',
    attributesGroupName: '$',
    textNodeName: '_',
    suppressEmptyNode: true,
    suppressBooleanAttributes: false,
    processEntities: false,
    tagValueProcessor: (name: string, value: unknown) => escapeXmlText(value),
    attributeValueProcessor: (name: string, value: unknown) => escapeXmlAttribute(value),
  } as any);
  const body: string = builder.build(xmlObject);
  return XML_DECLARATION + '\n' + body.replace(/\n$/, '');
}

export async function writeXmlFile(xmlFile: string, xmlObject: any) {
  const updatedFileContent = buildXmlString(xmlObject);
  await fs.ensureDir(path.dirname(xmlFile));
  await fs.writeFile(xmlFile, updatedFileContent);
}

export async function writeXmlFileFormatted(xmlFile: string, xmlString: string) {
  const xmlObject = parseXmlString(xmlString);
  await writeXmlFile(xmlFile, xmlObject);
}

export async function parsePackageXmlFile(packageXmlFile: string) {
  const targetOrgPackage = await parseXmlFile(packageXmlFile);
  const targetOrgContent: any = {};
  for (const type of targetOrgPackage?.Package?.types || []) {
    const mdType = type.name[0];
    const members = type.members || [];
    targetOrgContent[mdType] = members;
  }
  return targetOrgContent;
}

/**
 * Returns true when a package.xml member belongs to a managed package namespace
 * and should therefore be excluded from a deployment or filtered manifest.
 *
 * Rules:
 *  - Top-level item whose API name starts with `<ns>__` (e.g. `SBQQ__Quote__c`) → managed.
 *  - Child item (dotted) whose **child** part starts with `<ns>__`
 *    (e.g. `Account.SBQQ__Field__c` or `SBQQ__Obj__c.SBQQ__Field__c`) → managed.
 *  - Child item whose parent is namespaced but child is NOT
 *    (e.g. `SBQQ__Obj__c.MyCustomField__c`) → NOT managed (custom work on managed object).
 */
export function isManagedPackageMember(member: string, namespaces: string[]): boolean {
  return namespaces.some((ns) => {
    const prefix = `${ns}__`;
    // Top-level namespaced item (no child separator)
    if (!member.includes('.') && member.startsWith(prefix)) return true;
    // Child item: namespaced when the child segment starts with the prefix
    if (member.includes(`.${prefix}`)) return true;
    return false;
  });
}

export async function countPackageXmlItems(packageXmlFile: string): Promise<number> {
  const packageXmlParsed = await parsePackageXmlFile(packageXmlFile);
  let counter = 0;
  for (const type of Object.keys(packageXmlParsed)) {
    counter += packageXmlParsed[type].length || 0;
  }
  return counter;
}

export async function writePackageXmlFile(packageXmlFile: string, packageXmlObject: any) {
  let packageXmlContent: any = { Package: { types: [], version: [getApiVersion()] } };
  if (fs.existsSync(packageXmlFile)) {
    packageXmlContent = await parseXmlFile(packageXmlFile);
  }
  packageXmlContent.Package.types = Object.keys(packageXmlObject).map((typeKey) => {
    const type = {
      members: packageXmlObject[typeKey],
      name: [typeKey],
    };
    return type;
  });
  await writeXmlFile(packageXmlFile, packageXmlContent);
}

// Check if a package.xml is empty
export async function isPackageXmlEmpty(
  packageXmlFile: string,
  options: { ignoreStandaloneParentItems: boolean } = { ignoreStandaloneParentItems: false }
) {
  const packageXmlContent = await parseXmlFile(packageXmlFile);
  if (
    packageXmlContent &&
    packageXmlContent.Package &&
    packageXmlContent.Package.types &&
    packageXmlContent.Package.types.length > 0
  ) {
    if (options.ignoreStandaloneParentItems === true) {
      // Check if only contains SharingRules without SharingOwnerRule
      if (
        packageXmlContent.Package.types.length === 1 &&
        packageXmlContent.Package.types[0].name[0] === 'SharingRules'
      ) {
        return true;
      }
      // Check if only contains SharingOwnerRule without SharingRules
      if (
        packageXmlContent.Package.types.length === 1 &&
        packageXmlContent.Package.types[0].name[0] === 'SharingOwnerRule'
      ) {
        return true;
      }
    }
    // no standalone parent items found package.xml is considered not empty
    return false;
  }
  return true;
}

// Read package.xml files and build concatenated list of items
export async function appendPackageXmlFilesContent(packageXmlFileList: string[], outputXmlFile: string) {
  uxLog("log", this, c.grey(t('appendingInto', { packageXmlFileList: packageXmlFileList.join(', '), outputXmlFile })));
  let firstPackageXmlContent: any = null;
  let allPackageXmlFilesTypes = {};
  // loop on packageXml files
  for (const packageXmlFile of packageXmlFileList) {
    const result: any = await parseXmlFile(packageXmlFile);
    if (firstPackageXmlContent == null) {
      firstPackageXmlContent = result;
    }
    let packageXmlMetadatasTypeLs: any[];
    // Get metadata types in current loop packageXml
    try {
      packageXmlMetadatasTypeLs = result.Package.types || [];
    } catch {
      throw new SfError('Unable to find Package XML element in ' + packageXmlFile);
    }
    // Add metadata members in concatenation list of items & store doublings
    for (const typePkg of packageXmlMetadatasTypeLs) {
      if (typePkg.name == null) {
        continue;
      }
      const nameKey = typePkg.name[0];
      if (allPackageXmlFilesTypes[nameKey] != null && typePkg.members != null) {
        sortCrossPlatform(allPackageXmlFilesTypes[nameKey] = Array.from(
          new Set(allPackageXmlFilesTypes[nameKey].concat(typePkg.members))
        ));
      } else if (typePkg.members != null) {
        sortCrossPlatform(allPackageXmlFilesTypes[nameKey] = Array.from(new Set(typePkg.members)));
      }
    }
  }
  // Sort result
  allPackageXmlFilesTypes = sortObject(allPackageXmlFilesTypes);
  // Write output file
  const appendTypesXml: any[] = [];
  for (const packageXmlType of Object.keys(allPackageXmlFilesTypes)) {
    appendTypesXml.push({ members: allPackageXmlFilesTypes[packageXmlType], name: packageXmlType });
  }
  firstPackageXmlContent.Package.types = appendTypesXml;
  await writeXmlFile(outputXmlFile, firstPackageXmlContent);
}

// Build an inline remove-types structure from lists of type names and TypeName:MemberName specs.
// Used as an alternative to providing a removePackageXmlFile.
export function buildInlineRemoveTypes(metadataTypes: string[], metadataNames: string[]): any[] {
  const typesMap: Record<string, string[]> = {};
  // Types with wildcard - remove all members of each type
  for (const typeName of metadataTypes) {
    typesMap[typeName] = ['*'];
  }
  // Specific TypeName:MemberName pairs
  for (const nameSpec of metadataNames) {
    const colonIdx = nameSpec.indexOf(':');
    if (colonIdx === -1) continue;
    const typeName = nameSpec.substring(0, colonIdx).trim();
    const memberName = nameSpec.substring(colonIdx + 1).trim();
    if (!typesMap[typeName]) {
      typesMap[typeName] = [];
    }
    // Skip if wildcard already covers this type
    if (!typesMap[typeName].includes('*')) {
      typesMap[typeName].push(memberName);
    }
  }
  return Object.entries(typesMap).map(([typeName, members]) => ({
    name: [typeName],
    members,
  }));
}

// Read package.xml files and remove the content of the
export async function removePackageXmlFilesContent(
  packageXmlFile: string,
  removePackageXmlFile: string,
  // context selects domain wording for the per-type log lines ('delta', 'delta-destructive',
  // 'no-overwrite-keep', 'no-overwrite-remove'): the generic "kept/removed by filter file"
  // wording reads as internal plumbing and users cannot tell what it means for their deployment
  { outputXmlFile = '', logFlag = false, removedOnly = false, keepEmptyTypes = false, inlineRemoveTypes = null as any, context = '' }
) {
  // Read package.xml file to update
  const parsedPackageXml: any = await parseXmlFile(packageXmlFile);
  if (logFlag) {
    uxLog("other", this, `Parsed ${packageXmlFile}:\n` + util.inspect(parsedPackageXml, false, null));
  }
  let packageXmlMetadatasTypeLs: any;
  // get metadata types in parse result
  try {
    packageXmlMetadatasTypeLs = parsedPackageXml.Package.types || [];
  } catch {
    throw new SfError('Unable to parse package Xml file ' + packageXmlFile);
  }

  let packageXmlRemoveMetadatasTypeLs: any;
  if (inlineRemoveTypes) {
    // Use the pre-built types structure provided by the caller
    packageXmlRemoveMetadatasTypeLs = inlineRemoveTypes;
  } else {
    // Read package.xml file to use for filtering first file
    const parsedPackageXmlRemove: any = await parseXmlFile(removePackageXmlFile);
    if (logFlag) {
      uxLog("log", this, c.grey(`Parsed ${removePackageXmlFile}:\n` + util.inspect(parsedPackageXmlRemove, false, null)));
    }
    // get metadata types in parse result
    try {
      packageXmlRemoveMetadatasTypeLs = parsedPackageXmlRemove.Package.types || [];
    } catch {
      throw new SfError('Unable to parse package Xml file ' + removePackageXmlFile);
    }
  }

  // Filter main package.xml file
  const processedTypes: any[] = [];
  for (const removeType of packageXmlRemoveMetadatasTypeLs) {
    const removeTypeName = removeType.name[0] || null;
    if (removeTypeName) {
      processedTypes.push(removeTypeName);
    }
    if (removeTypeName === null) {
      continue;
    }
    const removeTypeMembers = removeType.members || [];
    const types = packageXmlMetadatasTypeLs.filter((type1: any) => type1.name[0] === removeTypeName);
    if (types.length === 0) {
      continue;
    }
    const type = types[0];
    let typeMembers = type.members || [];
    // Manage * case contained in target
    if (removedOnly === true && typeMembers.includes('*')) {
      typeMembers = removeTypeMembers;
      const wildcardKeptKey = context === 'no-overwrite-keep' ? 'noOverwriteTypeWildcardProtected' : 'foundWildcardOnTypeKeptItems';
      uxLog("log", this, c.grey(c.italic(t(wildcardKeptKey, { type: c.bold(type.name), typeMembers: typeMembers.length }))));
    }
    // Manage * case contained in source
    else if (removeTypeMembers[0] && removeTypeMembers[0] === '*') {
      typeMembers = typeMembers.filter(() => checkRemove(false, removedOnly));
      uxLog("log", this, c.grey(c.italic(
        removedOnly
          ? t('wildcardInFilterAllKept', { type: c.bold(type.name) })
          : t('wildcardInFilterAllRemoved', { type: c.bold(type.name) })
      )));
    } else {
      // Filter members (supports glob wildcards in filter patterns, e.g. "*__dlm")
      const originalCount = typeMembers.length;
      // A Report or a Dashboard listed in package-no-overwrite.xml and present in the target org under
      // another folder is the same component: deploying it would move it, not create a second one,
      // so it must be detected as already existing whatever the folder it sits in
      const apiNameOnly =
        context.startsWith('no-overwrite') && ORG_UNIQUE_FOLDER_METADATA_TYPES.includes(type.name[0]);
      typeMembers = typeMembers.filter((member: string) =>
        checkRemove(
          !removeTypeMembers.some((pattern: string) => memberMatchesPattern(member, pattern, apiNameOnly)),
          removedOnly
        )
      );
      if (removedOnly) {
        const keptKey =
          context === 'delta' || context === 'delta-destructive' ? 'deltaTypeItemsKept' :
            context === 'no-overwrite-keep' ? 'noOverwriteTypeItemsProtected' :
              'typeItemsKeptFromFilter';
        uxLog("log", this, c.grey(c.italic(t(keptKey, { type: c.bold(type.name), count: typeMembers.length }))));
      } else {
        const removedCount = originalCount - typeMembers.length;
        const remainKey = context === 'no-overwrite-remove' ? 'noOverwriteTypeItemsRemoved' : 'typeItemsRemainAfterRemoval';
        uxLog("log", this, c.grey(c.italic(t(remainKey, { type: c.bold(type.name), count: typeMembers.length, removed: removedCount }))));
      }
    }
    if (typeMembers.length > 0 || keepEmptyTypes === true) {
      // Update members for type
      packageXmlMetadatasTypeLs = packageXmlMetadatasTypeLs.map((type1: any) => {
        if (type1.name[0] === type.name[0]) {
          type1.members = typeMembers;
        }
        return type1;
      });
    } else {
      // No more member, do not let empty type
      packageXmlMetadatasTypeLs = packageXmlMetadatasTypeLs.filter((type1: any) => {
        return type1.name[0] !== type.name[0];
      });
    }
  }

  // If removedOnly mode, remove types which were not present in removePackageXml
  if (removedOnly) {
    packageXmlMetadatasTypeLs = packageXmlMetadatasTypeLs.filter((type1: any) =>
      processedTypes.includes(type1.name[0])
    );
  }

  // display in logs if requested
  if (logFlag) {
    uxLog("other", this, 'Package.xml remove results:\n' + util.inspect(packageXmlMetadatasTypeLs, false, null));
  }

  // Write in output file if required
  if (outputXmlFile) {
    parsedPackageXml.Package.types = packageXmlMetadatasTypeLs;
    await writeXmlFile(outputXmlFile, parsedPackageXml);
    if (logFlag) {
      uxLog("other", this, 'Generated package.xml file: ' + outputXmlFile);
    }
  }
  return packageXmlMetadatasTypeLs;
}

export function sortObject(o) {
  return Object.keys(o)
    .sort()
    .reduce((r, k) => ((r[k] = o[k]), r), {});
}

// Folder based metadata types whose API name is unique in the whole org: the same API name in two
// different folders is the same component, and deploying it just moves it from one folder to the other
export const ORG_UNIQUE_FOLDER_METADATA_TYPES = ['Dashboard', 'Report'];

// Returns the API name of a folder based member ("Mercury/My_Report" -> "My_Report").
// A folder entry ("Mercury/") has no API name and returns an empty string.
function getMemberApiName(member: string): string {
  const lastSlashPos = member.lastIndexOf('/');
  return lastSlashPos === -1 ? member : member.substring(lastSlashPos + 1);
}

// Lists the ORG_UNIQUE_FOLDER_METADATA_TYPES members of a package.xml that share their API name with
// another member sitting in a different folder. Deploying them does not create one component per folder:
// Salesforce moves the single existing component to the folder of the last deployed member.
export async function listDuplicateFolderMetadataApiNames(
  packageXmlFile: string
): Promise<{ type: string; apiName: string; members: string[] }[]> {
  const parsedPackageXml: any = await parseXmlFile(packageXmlFile);
  const duplicates: { type: string; apiName: string; members: string[] }[] = [];
  for (const type of parsedPackageXml?.Package?.types || []) {
    const typeName = type?.name?.[0];
    if (!ORG_UNIQUE_FOLDER_METADATA_TYPES.includes(typeName)) {
      continue;
    }
    const membersByApiName: { [apiName: string]: string[] } = {};
    for (const member of type.members || []) {
      const apiName = getMemberApiName(member);
      // Skip wildcards and folder entries, that hold no API name
      if (apiName === '' || apiName === '*' || !member.includes('/')) {
        continue;
      }
      membersByApiName[apiName] = (membersByApiName[apiName] || []).concat([member]);
    }
    for (const apiName of Object.keys(membersByApiName)) {
      if (membersByApiName[apiName].length > 1) {
        duplicates.push({ type: typeName, apiName: apiName, members: sortCrossPlatform(membersByApiName[apiName]) });
      }
    }
  }
  return duplicates;
}

// Returns true when member matches pattern, supporting * as a glob wildcard (e.g. "*__dlm", "Account*").
// When apiNameOnly is set, an exact pattern also matches a member holding the same API name in another folder.
function memberMatchesPattern(member: string, pattern: string, apiNameOnly = false): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) {
    if (member === pattern) return true;
    if (apiNameOnly) {
      const memberApiName = getMemberApiName(member);
      // Folder entries have no API name: they must not all match each other
      return memberApiName !== '' && memberApiName === getMemberApiName(pattern);
    }
    return false;
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(member);
}

function checkRemove(boolRes, removedOnly = false) {
  if (removedOnly === true) {
    return !boolRes;
  }
  return boolRes;
}

export async function applyAllReplacementsDefinitions(
  allMatchingSourceFiles: string[],
  referenceStrings: string[],
  replacementDefinitions: any[]
) {
  uxLog("action", this, c.cyan(t('initializingReplacementsInFilesFor', { referenceStrings: referenceStrings.join(', ') })));
  for (const ref of referenceStrings) {
    for (const replacementDefinition of replacementDefinitions) {
      replacementDefinition.refRegexes = replacementDefinition.refRegexes.map((refRegex) => {
        refRegex.regex = refRegex.regex.replace(new RegExp(`{{REF}}`), ref);
        return refRegex;
      });
      await applyReplacementDefinition(replacementDefinition, allMatchingSourceFiles, ref);
    }
  }
}

export async function applyReplacementDefinition(
  replacementDefinition: any,
  allMatchingSourceFiles: string[],
  ref: string
) {
  for (const sourceFile of allMatchingSourceFiles.filter((file) =>
    replacementDefinition.extensions.some((ext) => file.endsWith(ext))
  )) {
    let fileText = await fs.readFile(sourceFile, 'utf8');
    let updated = false;
    // Replacement in all text
    if (replacementDefinition.replaceMode.includes('all')) {
      for (const regexReplace of replacementDefinition.refRegexes) {
        const updatedfileText = fileText.replace(new RegExp(regexReplace.regex, 'gm'), regexReplace.replace);
        if (updatedfileText !== fileText) {
          updated = true;
          fileText = updatedfileText;
        }
      }
    }
    // Replacement by line
    let fileLines = fileText.split(/\r?\n/);
    if (replacementDefinition.replaceMode.includes('line')) {
      const updatedFileLines = fileLines.map((line) => {
        const trimLine = line.trim();
        if (trimLine.startsWith('/') || trimLine.startsWith('<!--')) {
          return line;
        }
        if (
          (replacementDefinition.type === 'code' && line.includes(ref)) ||
          (replacementDefinition.type === 'xml' &&
            (line.includes('>' + ref + '<') || line.includes('.' + ref + '<') || line.includes('>' + ref + '.')))
        ) {
          updated = true;
          let regexReplaced = false;
          for (const regexReplace of replacementDefinition.refRegexes) {
            const updatedLine = line.replace(new RegExp(regexReplace.regex, 'gm'), regexReplace.replace);
            if (updatedLine !== line) {
              line = updatedLine;
              regexReplaced = true;
              break;
            }
          }
          if (regexReplaced) {
            return replacementDefinition.type === 'code' ? line + ' // Updated by sfdx-hardis purge-references' : line;
          }
          return replacementDefinition.type === 'code'
            ? '// ' + line + ' // Commented by sfdx-hardis purge-references'
            : replacementDefinition.type === 'xml'
              ? '<!-- ' + line + ' Commented by sfdx-hardis purge-references --> '
              : line;
        }
        return line;
      });
      fileLines = updatedFileLines;
    }
    // Apply updates on file
    if (updated) {
      const updatedFileText = fileLines.join('\n');
      await fs.writeFile(sourceFile, updatedFileText);
      uxLog("log", this, c.grey(`- updated ${replacementDefinition.label}: ${sourceFile}`));
    }
  }
}
