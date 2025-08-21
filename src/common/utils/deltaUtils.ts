
import { parseXmlFile, writeXmlFile } from './xmlUtils.js';

let allLanguagesParsed: Array<string> | null = null;
let fullPackageTypes : Array<PackageType> | null = null;

type PackageType = {
  members: string[];
  name: string[];
};

const allTypes = async (fullPackageFile: string): Promise<Array<PackageType> | null> => {
  if (fullPackageTypes !== null) {
    return fullPackageTypes;
  }

  fullPackageTypes = (await parseXmlFile(fullPackageFile)).Package.types;
  return fullPackageTypes;
};

const allLanguages = async (fullPackageFile: string): Promise<Array<string>> => {
  if (allLanguagesParsed !== null) {
    return allLanguagesParsed;
  }

  allLanguagesParsed = (await allTypes(fullPackageFile))?.find(type => type.name[0] === "Translations")?.members ?? [];
  return allLanguagesParsed;
};

export async function extendPackageFileWithDependencies(
  deltaXmlFile: string,
  fullPackageFile: string,
) {

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
 
  const dotSeparatedObjectToObjectTranslation = async (member: string): Promise<PackageType | null> => {
    const parts = member.split('.');
    if (parts.length !== 2) {
      return null;
    }
    const sobject = parts[0];
    const languages = await allLanguages(fullPackageFile);
    return { members: languages.map(languageSuffix => sobject + "-" + languageSuffix), name: ["CustomObjectTranslation"] };
  };

  const convertToType = (typeName: string, splitBy: string, suffix?: string) => {
    return (member: string): PackageType => {
      const parts = member.split(splitBy);
      const baseName = parts[0];

      return { members: [baseName + (suffix ?? '')], name: [typeName] };
    };
  }

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
    if (types === null) {
      return null;
    }
    const metadataRecords = 
      types
      .find(type => type.name[0] === "CustomMetadata")
      ?.members
      .filter(member => member.startsWith(baseName));

    if (!metadataRecords || metadataRecords.length === 0) {
      return null;
    }
    return { members: metadataRecords, name: ["CustomMetadata"] };
  }

  const metadataProcessors = {
    "Layout" : async (member: string): Promise<PackageType> => {
      const sobject = member.split('-')[0];
      const languages = await allLanguages(fullPackageFile);
      return { members : languages.map(suffix => sobject + "-" + suffix), name : ["CustomObjectTranslation"] }
    },
    "CustomObject" : async (member: string): Promise<PackageType> => {
      const languages = await allLanguages(fullPackageFile);
      return { members : languages.map(suffix => member + "-" + suffix), name : ["CustomObjectTranslation"] }
    },
    "ValidationRule" : dotSeparatedObjectToObjectTranslation,
    "QuickAction" : dotSeparatedObjectToObjectTranslation,
    "RecordType" : dotSeparatedObjectToObjectTranslation,
    "CustomMetadata" : convertToType("CustomObject", '.', '_mdt'),
    "CustomLabel" : globalTranslations,
    "CustomPageWebLink" : globalTranslations,
    "CustomTab" : globalTranslations,
    "ReportType" : globalTranslations,
    "CustomField" : allCustomMetadataRecords, //dotSeparatedObjectToObjectTranslation],
  };
  
  const xml = await parseXmlFile(deltaXmlFile);
  const clonedTypes = [...xml.Package.types];

  for (const typeNode of clonedTypes) {
    const metadataType = typeNode.name[0];
    if (Object.hasOwn(metadataProcessors, metadataType)) {
      for (const member of typeNode.members) {
        addTypeIfMissing(xml.Package.types, await metadataProcessors[metadataType](member));
      }
    }
  }

  await writeXmlFile(deltaXmlFile, xml);
}
