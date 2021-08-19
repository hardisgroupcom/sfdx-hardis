// XML Utils functions
import * as fs from "fs-extra";
import * as path from "path";
import * as xml2js from "xml2js";

export async function parseXmlFile(xmlFile: string) {
  const packageXmlString = await fs.readFile(xmlFile, "utf8");
  const parsedXml = await xml2js.parseStringPromise(packageXmlString);
  return parsedXml;
}

export async function writeXmlFile(xmlFile: string, xmlObject: any) {
  const builder = new xml2js.Builder();
  const updatedFileContent = builder.buildObject(xmlObject);
  await fs.ensureDir(path.dirname(xmlFile));
  await fs.writeFile(xmlFile, updatedFileContent);
}

export async function parsePackageXmlFile(packageXmlFile: string) {
  const targetOrgPackage = await parseXmlFile(packageXmlFile);
  const targetOrgContent: any = {};
  for (const type of targetOrgPackage.Package.types || []) {
    const mdType = type.name[0];
    const members = type.members || [];
    targetOrgContent[mdType] = members;
  }
  return targetOrgContent;
}

export async function writePackageXmlFile(packageXmlFile: string, packageXmlObject: any) {
  const packageXmlContent = await parseXmlFile(packageXmlFile);
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
export async function isPackageXmlEmpty(packageXmlFile: string, options: {ignoreStandaloneParentItems:boolean} = {ignoreStandaloneParentItems:false}) {
  const packageXmlContent = await parseXmlFile(packageXmlFile);
  if (
    packageXmlContent &&
    packageXmlContent.Package &&
    packageXmlContent.Package.types &&
    packageXmlContent.Package.types.length > 0
  ) {
    if (options.ignoreStandaloneParentItems === true) {
      // Check if only contains SharingRule without SharingOwnerRule
      if (packageXmlContent.Package.types.length === 1 &&
          packageXmlContent.Package.types[0].name === 'SharingRules'
        ) {
        return true ;
      }
    }
    // no standalone parent items found package.xml is considered not empty
    return false ;
  }
  return true ;
}
