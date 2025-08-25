
import { parsePackageXmlFile, writePackageXmlFile } from './xmlUtils.js';

type PackageType = {
  members: string[];
  name: string;
};

let fullPackageTypes = null;

const allTypes = async (fullPackageFile: string): Promise<Map<string, string[]>> => {
  if (fullPackageTypes) {
    return fullPackageTypes;
  }

  fullPackageTypes = await parsePackageXmlFile(fullPackageFile);
  return fullPackageTypes ?? new Map();
};

const allLanguages = async (fullPackageFile: string): Promise<Array<string>> => {
 
  return (await allTypes(fullPackageFile))["Translations"] ?? [];
};

const addTypeIfMissing = (types: Map<string, string[]>, typeToAdd: PackageType) => {
  if (typeToAdd === null) {
    return;
  }

  types[typeToAdd.name] = [...new Set([...(types[typeToAdd.name] ?? []), ...typeToAdd.members])];
};

export async function extendPackageFileWithDependencies(
  deltaXmlFile: string,
  fullPackageFile: string,
) {
 
  const dotSeparatedObjectToObjectTranslation = async (member: string): Promise<PackageType | null> => {
    const parts = member.split('.');
    if (parts.length !== 2) {
      return null;
    }
    const sobject = parts[0];
    if (sobject.includes("__mdt")) {
      return null;
    }
    const languages = await allLanguages(fullPackageFile);
    return { members: languages.map(languageSuffix => sobject + "-" + languageSuffix), name: "CustomObjectTranslation" };
  };

  const dashSeparatedObjectToObjectTranslation = async (member: string): Promise<PackageType | null> => {
    const parts = member.split('-');
    if (parts.length !== 2) {
      return null;
    }
    const sobject = parts[0];
    const languages = await allLanguages(fullPackageFile);
    return { members: languages.map(languageSuffix => sobject + "-" + languageSuffix), name: "CustomObjectTranslation" };
  };

  const objectTranslations = async (member: string): Promise<PackageType> => {
    const languages = await allLanguages(fullPackageFile);
    return { members: languages.map(suffix => member + "-" + suffix), name: "CustomObjectTranslation" };
  };

  const globalTranslations = async () => {
    const languages = await allLanguages(fullPackageFile);
    return { members: languages, name: "Translations" };
  }

  const allCustomMetadataRecords = async (member: string): Promise<PackageType | null> => {
    if (!member.includes('__mdt')) {
      return null;
    }
    const baseName = member.split('__mdt')[0];
    const types = await allTypes(fullPackageFile);
    const metadataRecords = types["CustomMetadata"]?.filter(member => member.startsWith(baseName));

    return metadataRecords?.length ? { members: metadataRecords, name: "CustomMetadata" } : null;
  }

  const allCustomFields = async (member: string): Promise<PackageType | null> => {
    const baseName = member.split('.')[0];
    const types = await allTypes(fullPackageFile);
    const metadataFields = types["CustomField"]?.filter(field => field.startsWith(baseName));

    return metadataFields?.length ? { members: metadataFields, name: "CustomField" } : null;
  }

  const allObjectRecordTypes = async (member: string): Promise<PackageType | null> => {
    
    if (member.includes("__mdt")) {
      return null;
    }
    const parts = member.split('.');
    if (parts.length !== 2) {
      return null;
    }
    const types = await allTypes(fullPackageFile);
    const sobject = parts[0];

    const recordTypesMembers = types["RecordType"]?.filter(member => member.startsWith(sobject + '.'));

    return recordTypesMembers?.length ? { members: recordTypesMembers, name: "RecordType" } : null;
  };

  const metadataProcessors = {
    "Layout" : dashSeparatedObjectToObjectTranslation,
    "CustomObject" : objectTranslations,
    "ValidationRule" : dotSeparatedObjectToObjectTranslation,
    "QuickAction" : dotSeparatedObjectToObjectTranslation,
    "RecordType" : dotSeparatedObjectToObjectTranslation,
    "CustomMetadata" : [allCustomFields],
    "CustomLabel" : globalTranslations,
    "CustomPageWebLink" : globalTranslations,
    "CustomTab" : globalTranslations,
    "ReportType" : globalTranslations,
    "CustomField" : [allObjectRecordTypes, allCustomMetadataRecords, dotSeparatedObjectToObjectTranslation],
  };
  
  const parsedTypes = await parsePackageXmlFile(deltaXmlFile);
  const clonedTypes = structuredClone(parsedTypes);

  for (const metadataType in clonedTypes) {
    const members = clonedTypes[metadataType];
    if (Object.hasOwn(metadataProcessors, metadataType)) {
      for (const member of members) {
        const processors = Array.isArray(metadataProcessors[metadataType]) ? metadataProcessors[metadataType] : [metadataProcessors[metadataType]];
        for (const processor of processors) {
          addTypeIfMissing(parsedTypes, await processor(member));
        }
      }
    }
  }

  await writePackageXmlFile(deltaXmlFile, parsedTypes);
}