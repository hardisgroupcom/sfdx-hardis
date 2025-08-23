
import { parseXmlFile, writeXmlFile } from './xmlUtils.js';

type PackageType = {
  members: string[];
  name: string[];
};

type Cache = {
  recordTypes: PackageType | null | undefined;
  customFields: PackageType | null | undefined;
  customMetadata: PackageType | null | undefined;
  allLanguagesParsed: Array<string> | null;
  fullPackageTypes: Array<PackageType> | null;
};

const cache: Cache = {
  allLanguagesParsed: null,
  fullPackageTypes: null,
  recordTypes: null,
  customFields: null,
  customMetadata: null,
};

const allTypes = async (fullPackageFile: string): Promise<Array<PackageType>> => {
  if (cache.fullPackageTypes) {
    return cache.fullPackageTypes;
  }

  cache.fullPackageTypes = (await parseXmlFile(fullPackageFile)).Package.types;
  return cache.fullPackageTypes ?? [];
};

const allLanguages = async (fullPackageFile: string): Promise<Array<string>> => {
  if (cache.allLanguagesParsed) {
    return cache.allLanguagesParsed;
  }

  cache.allLanguagesParsed = (await allTypes(fullPackageFile)).find(type => type.name[0] === "Translations")?.members ?? [];
  return cache.allLanguagesParsed;
};

const addTypeIfMissing = (types: Array<PackageType>, typeToAdd: PackageType): boolean => {
  if (typeToAdd === null) {
    return false;
  }

  const existingNodeByName = types.find(type => type.name[0] === typeToAdd.name[0]);
  if (!existingNodeByName) {
    types.push(typeToAdd);
    return true;
  } else {
    const countBefore = existingNodeByName.members.length;
    existingNodeByName.members = [...new Set([...existingNodeByName.members, ...typeToAdd.members])];
    return countBefore !== existingNodeByName.members.length;
  }
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
    return { members: languages.map(languageSuffix => sobject + "-" + languageSuffix), name: ["CustomObjectTranslation"] };
  };

  const dashSeparatedObjectToObjectTranslation = async (member: string): Promise<PackageType | null> => {
    const parts = member.split('-');
    if (parts.length !== 2) {
      return null;
    }
    const sobject = parts[0];
    const languages = await allLanguages(fullPackageFile);
    return { members: languages.map(languageSuffix => sobject + "-" + languageSuffix), name: ["CustomObjectTranslation"] };
  };

  const objectTranslations = async (member: string): Promise<PackageType> => {
    const languages = await allLanguages(fullPackageFile);
    return { members: languages.map(suffix => member + "-" + suffix), name: ["CustomObjectTranslation"] };
  };

  const globalTranslations = async () => {
    const languages = await allLanguages(fullPackageFile);
    return { members: languages, name: ["Translations"] };
  }

  const allCustomMetadataRecords = async (member: string): Promise<PackageType | null> => {
    if (!member.includes('__mdt')) {
      return null;
    }
    const baseName = member.split('__mdt')[0];
    const types = await allTypes(fullPackageFile);
    const metadataRecords = 
      (cache.customMetadata ?? (cache.customMetadata = types.find(type => type.name[0] === "CustomMetadata")))
      ?.members
      .filter(member => member.startsWith(baseName));

    return metadataRecords?.length ? { members: metadataRecords, name: ["CustomMetadata"] } : null;
  }

  const allCustomFields = async (member: string): Promise<PackageType | null> => {
    const baseName = member.split('.')[0];
    const types = await allTypes(fullPackageFile);
    const metadataFields = 
      (cache.customFields ?? (cache.customFields = types.find(type => type.name[0] === "CustomField")))
      ?.members
      .filter(field => field.startsWith(baseName));

    return metadataFields?.length ? { members: metadataFields, name: ["CustomField"] } : null;
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

    const recordTypesMembers =
      (cache.recordTypes ?? (cache.recordTypes = types.find(type => type.name[0] === "RecordType")))
      ?.members
      .filter(member => member.startsWith(sobject + '.'));

    return recordTypesMembers?.length ? { members: recordTypesMembers, name: ["RecordType"] } : null;
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
  
  const xml = await parseXmlFile(deltaXmlFile);

  if (!xml?.Package?.types?.length) {
    return;
  }

  const clonedTypes = [...xml.Package.types];

  for (const typeNode of clonedTypes) {
    const metadataType = typeNode.name[0];
    if (Object.hasOwn(metadataProcessors, metadataType)) {
      for (const member of typeNode.members) {
        const processors = Array.isArray(metadataProcessors[metadataType]) ? metadataProcessors[metadataType] : [metadataProcessors[metadataType]];
        for (const processor of processors) {
          addTypeIfMissing(xml.Package.types, await processor(member));
        }
      }
    }
  }

  await writeXmlFile(deltaXmlFile, xml);
}
