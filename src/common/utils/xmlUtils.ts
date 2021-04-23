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
