
import { parsePackageXmlFile, writePackageXmlFile, removePackageXmlFilesContent, appendPackageXmlFilesContent } from './xmlUtils.js';
import { getFileAtCommit } from './gitUtils.js';
import fs from 'fs-extra';
import * as path from 'path';
import { createTempDir, uxLog } from './index.js';
import c from 'chalk';

type PackageType = {
  members: string[];
  name: string;
};

let fullPackageTypes = null;

async function getAllTypes(fullPackageFile: string): Promise<Map<string, string[]>> {
  if (fullPackageTypes) {
    return fullPackageTypes;
  }

  fullPackageTypes = await parsePackageXmlFile(fullPackageFile);
  return fullPackageTypes ?? new Map();
}

async function getAllLanguages(fullPackageFile: string): Promise<Array<string>> {
  return (await getAllTypes(fullPackageFile))["Translations"] ?? [];
}

function addTypeIfMissing(types: Map<string, string[]>, typeToAdd: PackageType) {
  if (typeToAdd === null) {
    return;
  }
  types[typeToAdd.name] = [...new Set([...(types[typeToAdd.name] ?? []), ...typeToAdd.members])];
}

// Generic processor factory
/* Config:
  - separator: optional, if provided, the member must contain this separator and will be split on it
  - skipCondition: optional, if provided, a function that takes the member and returns true if the member should be skipped
*/
function createProcessor(config: {
  separator?: string;
  skipCondition?: (member: string) => boolean;
  targetType: string;
  memberGenerator: (member: string, fullPackageFile: string, allTypesMap: Map<string, string[]>) => Promise<string[]>;
}) {
  return async function (member: string, fullPackageFile: string): Promise<PackageType | null> {
    if (config.skipCondition && config.skipCondition(member)) {
      return null;
    }

    if (config.separator) {
      const parts = member.split(config.separator);
      if (parts.length !== 2) {
        return null;
      }
    }
    const types = await getAllTypes(fullPackageFile);
    const members = await config.memberGenerator(member, fullPackageFile, types);
    return members.length ? { members, name: config.targetType } : null;
  };
}

/* Extends a delta package.xml file with dependencies found in a full package.xml file.
   For example, if the delta package.xml contains a CustomField, it will add the corresponding CustomObject and RecordTypes.
   It also adds translations for all languages found in the full package.xml file.
*/
export async function extendPackageFileWithDependencies(
  deltaXmlFile: string,
  fullPackageFile: string,
  deltaDestructiveXmlFile?: string
) {
  const languages = await getAllLanguages(fullPackageFile);

  const modificationProcessors = listMetadataProcessors(languages, 'modified');
  const deletionProcessors = listMetadataProcessors(languages, 'deleted');

  const deltaToExtend = await parsePackageXmlFile(deltaXmlFile);
  const destructiveTypes = deltaDestructiveXmlFile ? await parsePackageXmlFile(deltaDestructiveXmlFile) : {};
  const clonedDeltaTypes = structuredClone(deltaToExtend);

  await processMetadata(clonedDeltaTypes, deltaToExtend, modificationProcessors, fullPackageFile);
  await processMetadata(destructiveTypes, deltaToExtend, deletionProcessors, fullPackageFile);

  await writePackageXmlFile(deltaXmlFile, deltaToExtend);
}

async function processMetadata(
  typesToAnalyze: any,
  typesToExtend: any,
  metadataProcessors: any,
  fullPackageFile: string
) {
  for (const metadataType in typesToAnalyze) {
    const members = typesToAnalyze[metadataType];
    if (Object.hasOwn(metadataProcessors, metadataType)) {
      for (const member of members) {
        const processors = Array.isArray(metadataProcessors[metadataType]) ? metadataProcessors[metadataType] : [metadataProcessors[metadataType]];
        for (const processor of processors) {
          addTypeIfMissing(typesToExtend, await processor(member, fullPackageFile));
        }
      }
    }
  }
}

function listMetadataProcessors(languages: string[], deltaAction: "modified" | "deleted") {

  const allCustomFields = createProcessor({
    targetType: "CustomField",
    memberGenerator: async (member, _, allTypesMap) => {
      const baseName = member.split('.')[0];
      return allTypesMap["CustomField"]?.filter(field => field.startsWith(baseName)) ?? [];
    }
  });

  const allCustomMetadataRecords = createProcessor({
    skipCondition: (member) => !member.includes('__mdt'),
    targetType: "CustomMetadata",
    memberGenerator: async (member, _, allTypesMap) => {
      const baseName = member.split('__mdt')[0];
      return allTypesMap["CustomMetadata"]?.filter(member => member.startsWith(baseName)) ?? [];
    }
  });

  const allObjectRecordTypes = createProcessor({
    separator: '.',
    skipCondition: (member) => member.includes("__mdt"),
    targetType: "RecordType",
    memberGenerator: async (member, _, allTypesMap) => {
      const sobject = member.split('.')[0];
      return allTypesMap["RecordType"]?.filter(member => member.startsWith(sobject + '.')) ?? [];
    }
  });

  const dashSeparatedObjectToObjectTranslation = createProcessor({
    separator: '-',
    targetType: "CustomObjectTranslation",
    memberGenerator: async (member) => {
      const sobject = member.split('-')[0];
      return languages.map(languageSuffix => sobject + "-" + languageSuffix);
    }
  });

  const dotSeparatedObjectToObjectTranslation = createProcessor({
    separator: '.',
    skipCondition: (member) => member.includes("__mdt"),
    targetType: "CustomObjectTranslation",
    memberGenerator: async (member) => {
      const sobject = member.split('.')[0];
      return languages.map(languageSuffix => sobject + "-" + languageSuffix);
    }
  });

  const globalTranslations = createProcessor({
    targetType: "Translations",
    memberGenerator: async () => languages
  });

  const leadConvertSettings = createProcessor({
    skipCondition: (member) => !member.startsWith('Opportunity') && !member.includes('Account') && !member.includes('Contact') && !member.includes('Lead'),
    targetType: "LeadConvertSettings",
    memberGenerator: async (_, __, allTypesMap) => {
      return allTypesMap["LeadConvertSettings"] ?? [];
    }
  });

  const objectTranslations = createProcessor({
    targetType: "CustomObjectTranslation",
    memberGenerator: async (member) => {
      return languages.map(suffix => member + "-" + suffix);
    }
  });

  // Map of metadata types to their processors
  if (deltaAction === "modified") {
    return {
      "CustomField": [allObjectRecordTypes, allCustomMetadataRecords, dotSeparatedObjectToObjectTranslation, leadConvertSettings],
      "CustomLabel": globalTranslations,
      "CustomMetadata": allCustomFields,
      "CustomObject": objectTranslations,
      "CustomPageWebLink": globalTranslations,
      "CustomTab": globalTranslations,
      "Layout": dashSeparatedObjectToObjectTranslation,
      "QuickAction": dotSeparatedObjectToObjectTranslation,
      "RecordType": dotSeparatedObjectToObjectTranslation,
      "ReportType": globalTranslations,
      "ValidationRule": dotSeparatedObjectToObjectTranslation,
    };
  } else if (deltaAction === "deleted") {
    return {
      "Flow": globalTranslations,
      "CustomApplication": globalTranslations,
      "CustomLabel": globalTranslations,
      "CustomTab": globalTranslations,
    };
  }
}


export async function appendPackageModifications(
  fromCommit: string,
  toCommit: string,
  sourcePackageFilename: string,
  targetPackageFilename: string
) {
  const packageFrom = (await getFileAtCommit(fromCommit, sourcePackageFilename)).toString();
  const packageTo = (await getFileAtCommit(toCommit, sourcePackageFilename)).toString();

  if (packageFrom == packageTo) {
    uxLog("log", this, c.grey(c.italic(`Found no changes in ${sourcePackageFilename}`)));
    return;
  }
  uxLog("action", this, c.cyan('[DeltaDeployment] Extending package.xml with manifest changes ...'));

  const tmpDir = await createTempDir();

  const tempFromFile = path.join(tmpDir, 'packageFrom.xml');
  const tempToFile = path.join(tmpDir, 'packageTo.xml');
  const tempDiffFile = path.join(tmpDir, 'packageDiff.xml');

  await fs.writeFile(tempFromFile, packageFrom);
  await fs.writeFile(tempToFile, packageTo);

  const diffTypes = await removePackageXmlFilesContent(tempToFile, tempFromFile, { removedOnly: false, outputXmlFile: tempDiffFile });

  if (diffTypes.length > 0) {
    uxLog("log", this, c.grey(c.italic(`Found some added types in ${sourcePackageFilename}, adding them to final delta manifest.`)));
    await appendPackageXmlFilesContent([tempDiffFile, targetPackageFilename], targetPackageFilename);
  } else {
    uxLog("log", this, c.grey(c.italic(`Found no added types in ${sourcePackageFilename}`)));
  }

  fs.removeSync(tmpDir);
}