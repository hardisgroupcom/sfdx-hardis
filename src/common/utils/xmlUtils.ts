// XML Utils functions
import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import * as util from "util";
import * as xml2js from "xml2js";
import { uxLog } from ".";
import { CONSTANTS } from "../../config";

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

export async function writeXmlFileFormatted(xmlFile: string, xmlString: string) {
  const xmlObject = await xml2js.parseStringPromise(xmlString);
  await writeXmlFile(xmlFile, xmlObject);
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
  let packageXmlContent = { Package: { types: [], version: [CONSTANTS.API_VERSION] } };
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

// Read package.xml files and build concatenated list of items
export async function appendPackageXmlFilesContent(packageXmlFileList: string[], outputXmlFile: string) {
  uxLog(this, c.cyan(`Appending ${packageXmlFileList.join(",")} into ${outputXmlFile}...`));
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
      throw new SfdxError("Unable to find Package XML element in " + packageXmlFile);
    }
    // Add metadata members in concatenation list of items & store doublings
    for (const typePkg of packageXmlMetadatasTypeLs) {
      if (typePkg.name == null) {
        continue;
      }
      const nameKey = typePkg.name[0];
      if (allPackageXmlFilesTypes[nameKey] != null && typePkg.members != null) {
        allPackageXmlFilesTypes[nameKey] = Array.from(new Set(allPackageXmlFilesTypes[nameKey].concat(typePkg.members))).sort();
      } else if (typePkg.members != null) {
        allPackageXmlFilesTypes[nameKey] = Array.from(new Set(typePkg.members)).sort();
      }
    }
  }
  // Sort result
  allPackageXmlFilesTypes = sortObject(allPackageXmlFilesTypes);
  // Write output file
  const appendTypesXml = [];
  for (const packageXmlType of Object.keys(allPackageXmlFilesTypes)) {
    appendTypesXml.push({ members: allPackageXmlFilesTypes[packageXmlType], name: packageXmlType });
  }
  firstPackageXmlContent.Package.types = appendTypesXml;
  await writeXmlFile(outputXmlFile, firstPackageXmlContent);
}

// Read package.xml files and remove the content of the
export async function removePackageXmlFilesContent(
  packageXmlFile: string,
  removePackageXmlFile: string,
  { outputXmlFile = null, logFlag = false, removedOnly = false, keepEmptyTypes = false }
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
  const processedTypes = [];
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
    if (removedOnly === true && typeMembers.includes("*")) {
      typeMembers = removeTypeMembers;
      uxLog(this, c.grey(c.italic(`Found wildcard * on type ${c.bold(type.name)}, kept items: ${typeMembers.length}`)));
    }
    // Manage * case contained in source
    else if (removeTypeMembers[0] && removeTypeMembers[0] === "*") {
      typeMembers = typeMembers.filter(() => checkRemove(false, removedOnly));
      uxLog(this, c.grey(c.italic(`Found wildcard * on type ${c.bold(type.name)} which have all been ${removedOnly ? "kept" : "removed"}`)));
    } else {
      // Filter members
      typeMembers = typeMembers.filter((member: string) => checkRemove(!removeTypeMembers.includes(member), removedOnly));
      uxLog(this, c.grey(c.italic(`Found type ${c.bold(type.name)}, ${typeMembers.length} items have been ${removedOnly ? "removed" : "kept"}`)));
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
    packageXmlMetadatasTypeLs = packageXmlMetadatasTypeLs.filter((type1: any) => processedTypes.includes(type1.name[0]));
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

export function sortObject(o) {
  return Object.keys(o)
    .sort()
    .reduce((r, k) => ((r[k] = o[k]), r), {});
}

function checkRemove(boolRes, removedOnly = false) {
  if (removedOnly === true) {
    return !boolRes;
  }
  return boolRes;
}

export async function applyAllReplacementsDefinitions(allMatchingSourceFiles: string[], referenceStrings: string[], replacementDefinitions: any[]) {
  uxLog(this, c.cyan(`Initializing replacements in files for ${referenceStrings.join(",")}...`));
  for (const ref of referenceStrings) {
    for (const replacementDefinition of replacementDefinitions) {
      replacementDefinition.refRegexes = replacementDefinition.refRegexes.map((refRegex) => {
        refRegex.regex = refRegex.regex.replace("{{REF}}", ref);
        return refRegex;
      });
      await applyReplacementDefinition(replacementDefinition, allMatchingSourceFiles, ref);
    }
  }
}

export async function applyReplacementDefinition(replacementDefinition: any, allMatchingSourceFiles: string[], ref: string) {
  for (const sourceFile of allMatchingSourceFiles.filter((file) => replacementDefinition.extensions.some((ext) => file.endsWith(ext)))) {
    let fileText = await fs.readFile(sourceFile, "utf8");
    let updated = false;
    // Replacement in all text
    if (replacementDefinition.replaceMode.includes("all")) {
      for (const regexReplace of replacementDefinition.refRegexes) {
        const updatedfileText = fileText.replace(new RegExp(regexReplace.regex, "gm"), regexReplace.replace);
        if (updatedfileText !== fileText) {
          updated = true ;
          fileText = updatedfileText;
        }
      }      
    }
    // Replacement by line
    let fileLines = fileText.split(/\r?\n/);
    if (replacementDefinition.replaceMode.includes("line")) {
      const updatedFileLines = fileLines.map((line) => {
        const trimLine = line.trim();
        if (trimLine.startsWith("/") || trimLine.startsWith("<!--")) {
          return line;
        }
        if (
          (replacementDefinition.type === "code" && line.includes(ref)) ||
          (replacementDefinition.type === "xml" &&
            (line.includes(">" + ref + "<") || line.includes("." + ref + "<") || line.includes(">" + ref + ".")))
        ) {
          updated = true;
          let regexReplaced = false;
          for (const regexReplace of replacementDefinition.refRegexes) {
            const updatedLine = line.replace(new RegExp(regexReplace.regex, "gm"), regexReplace.replace);
            if (updatedLine !== line) {
              line = updatedLine;
              regexReplaced = true;
              break;
            }
          }
          if (regexReplaced) {
            return replacementDefinition.type === "code" ? line + " // Updated by sfdx-hardis purge-references" : line;
          }
          return replacementDefinition.type === "code"
            ? "// " + line + " // Commented by sfdx-hardis purge-references"
            : replacementDefinition.type === "xml"
            ? "<!-- " + line + " Commented by sfdx-hardis purge-references --> "
            : line;
        }
        return line;
      });
      fileLines = updatedFileLines;
    }
    // Apply updates on file
    if (updated) {
      const updatedFileText = fileLines.join("\n");
      await fs.writeFile(sourceFile, updatedFileText);
      uxLog(this, c.grey(`- updated ${replacementDefinition.label}: ${sourceFile}`));
    }
  }
}
