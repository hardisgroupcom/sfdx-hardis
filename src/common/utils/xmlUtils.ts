// XML Utils functions
import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import * as util from "util";
import * as xml2js from "xml2js";
import { uxLog } from ".";

export async function parseXmlFile(xmlFile: string) {
  const packageXmlString = await fs.readFile(xmlFile, "utf8");
  const parsedXml = await xml2js.parseStringPromise(packageXmlString);
  return parsedXml;
}

export async function writeXmlFile(xmlFile: string, xmlObject: any) {
  const builder = new xml2js.Builder({
    renderOpts: {
      pretty: true,
      indent: process.env.SFDX_XML_INDENT || "    ",
      newline: "\n",
    },
    xmldec: { version: "1.0", encoding: "UTF-8" },
  });
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
export async function isPackageXmlEmpty(
  packageXmlFile: string,
  options: { ignoreStandaloneParentItems: boolean } = { ignoreStandaloneParentItems: false }
) {
  const packageXmlContent = await parseXmlFile(packageXmlFile);
  if (packageXmlContent && packageXmlContent.Package && packageXmlContent.Package.types && packageXmlContent.Package.types.length > 0) {
    if (options.ignoreStandaloneParentItems === true) {
      // Check if only contains SharingRules without SharingOwnerRule
      if (packageXmlContent.Package.types.length === 1 && packageXmlContent.Package.types[0].name[0] === "SharingRules") {
        return true;
      }
      // Check if only contains SharingOwnerRule without SharingRules
      if (packageXmlContent.Package.types.length === 1 && packageXmlContent.Package.types[0].name[0] === "SharingOwnerRule") {
        return true;
      }
    }
    // no standalone parent items found package.xml is considered not empty
    return false;
  }
  return true;
}

// Read package.xml files and remove the content of the
export async function removePackageXmlFilesContent(
  packageXmlFile: string,
  removePackageXmlFile: string,
  { outputXmlFile = null, logFlag = false, removedOnly = false }
) {
  // Read package.xml file to update
  const parsedPackageXml: any = await parseXmlFile(packageXmlFile);
  if (logFlag) {
    uxLog(this, `Parsed ${packageXmlFile} :\n` + util.inspect(parsedPackageXml, false, null));
  }
  let packageXmlMetadatasTypeLs: any;
  // get metadata types in parse result
  try {
    packageXmlMetadatasTypeLs = parsedPackageXml.Package.types || [];
  } catch {
    throw new SfdxError("Unable to parse package Xml file " + packageXmlFile);
  }

  // Read package.xml file to use for filtering first file
  const parsedPackageXmlRemove: any = await parseXmlFile(removePackageXmlFile);
  if (logFlag) {
    uxLog(this, c.grey(`Parsed ${removePackageXmlFile} :\n` + util.inspect(parsedPackageXmlRemove, false, null)));
  }
  let packageXmlRemoveMetadatasTypeLs: any;
  // get metadata types in parse result
  try {
    packageXmlRemoveMetadatasTypeLs = parsedPackageXmlRemove.Package.types || [];
  } catch {
    throw new SfdxError("Unable to parse package Xml file " + removePackageXmlFile);
  }

  // Filter main package.xml file
  for (const removeType of packageXmlRemoveMetadatasTypeLs) {
    const removeTypeName = removeType.name[0] || null;
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
    // Manage * case
    if (removeTypeMembers[0] && removeTypeMembers[0] === "*") {
      typeMembers = typeMembers.filter(() => checkRemove(false, removedOnly));
    } else {
      // Filter members
      typeMembers = typeMembers.filter((member: string) => checkRemove(!removeTypeMembers.includes(member), removedOnly));
    }
    if (typeMembers.length > 0) {
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
  // display in logs if requested
  if (logFlag) {
    uxLog(this, "Package.xml remove results :\n" + util.inspect(packageXmlMetadatasTypeLs, false, null));
  }

  // Write in output file if required
  if (outputXmlFile) {
    parsedPackageXml.Package.types = packageXmlMetadatasTypeLs;
    await writeXmlFile(outputXmlFile, parsedPackageXml);
    if (logFlag) {
      uxLog(this, "Generated package.xml file: " + outputXmlFile);
    }
  }
  return packageXmlMetadatasTypeLs;
}

function checkRemove(boolRes, removedOnly = false) {
  if (removedOnly === true) {
    return !boolRes;
  }
  return boolRes;
}
