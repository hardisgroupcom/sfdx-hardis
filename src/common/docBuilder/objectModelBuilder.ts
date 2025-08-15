import c from "chalk";
import { glob } from "glob";
import fs from "fs-extra";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";
import { GLOB_IGNORE_PATTERNS } from "../utils/projectUtils.js";
import { uxLog } from "../utils/index.js";

let ALL_LINKS_CACHE: any[] = [];
let ALL_OBJECTS_CACHE: any[] = [];

export class ObjectModelBuilder {
  protected mainCustomObject: string;
  protected relatedCustomObjects: string[];
  protected allLinks: any[] = [];
  protected allObjects: any[] = [];
  protected selectedObjectsNames: Set<string> = new Set<string>();
  protected selectedObjects: any[] = []
  protected selectedLinks: any[] = []

  constructor(mainCustomObject: string = "all", relatedCustomObjects: string[] = []) {
    this.mainCustomObject = mainCustomObject;
    if (this.mainCustomObject !== "all") {
      this.selectedObjectsNames.add(this.mainCustomObject);
    }
    this.relatedCustomObjects = relatedCustomObjects;
  }

  async buildObjectsMermaidSchema() {
    await this.buildAllLinks();
    await this.buildAllObjects();
    await this.selectObjects();
    await this.selectLinks();
    const mermaidSchema = await this.generateMermaidSchema();
    return mermaidSchema;
  }

  async generateMermaidSchema() {
    let mermaidSchema = `graph TD\n`;
    for (const object of this.selectedObjects) {
      const objectClass =
        object.name === this.mainCustomObject ? "mainObject" :
          !object.name.endsWith("__c") ? "object" :
            object.name.split("__").length > 2 ? "customObjectManaged" :
              "customObject";
      mermaidSchema += `${object.name}["${object.label}"]:::${objectClass}\n`;
      if (fs.existsSync(`docs/objects/${object.name}.md`)) {
        mermaidSchema += `click ${object.name} "/objects/${object.name}/"\n`;
      }
    }
    mermaidSchema += `\n`;
    let pos = 0;
    const masterDetailPos: number[] = [];
    const lookupPos: number[] = [];
    for (const link of this.selectedLinks) {
      if (link.type === "MasterDetail") {
        mermaidSchema += `${link.from} ==>|${link.field}| ${link.to}\n`;
        masterDetailPos.push(pos);
      }
      else {
        mermaidSchema += `${link.from} -->|${link.field}| ${link.to}\n`;
        lookupPos.push(pos);
      }
      pos++;
    }
    mermaidSchema += `\n`;
    mermaidSchema += `classDef object fill:#D6E9FF,stroke:#0070D2,stroke-width:3px,rx:12px,ry:12px,shadow:drop,color:#333;
classDef customObject fill:#FFF4C2,stroke:#CCAA00,stroke-width:3px,rx:12px,ry:12px,shadow:drop,color:#333;
classDef customObjectManaged fill:#FFD8B2,stroke:#CC5500,stroke-width:3px,rx:12px,ry:12px,shadow:drop,color:#333;
classDef mainObject fill:#FFB3B3,stroke:#A94442,stroke-width:4px,rx:14px,ry:14px,shadow:drop,color:#333,font-weight:bold;
`;

    if (masterDetailPos.length > 0) {
      mermaidSchema += "linkStyle " + masterDetailPos.join(",") + " stroke:#4C9F70,stroke-width:4px;\n";
    }
    if (lookupPos.length > 0) {
      mermaidSchema += "linkStyle " + lookupPos.join(",") + " stroke:#A6A6A6,stroke-width:2px;\n";
    }

    // Use Graph LR if there are too many lines for a nice mermaid display
    if (mermaidSchema.split("\n").length > 50) {
      mermaidSchema = mermaidSchema.replace("graph TD", "graph LR");
    }

    return mermaidSchema;
  }

  async buildAllLinks() {
    if (ALL_LINKS_CACHE.length > 0) {
      this.allLinks = ALL_LINKS_CACHE;
      return;
    }
    // List all object links in the project
    const findFieldsPattern = `**/objects/**/fields/**.field-meta.xml`;
    const matchingFieldFiles = (await glob(findFieldsPattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS })).map(file => file.replace(/\\/g, '/'));
    for (const fieldFile of matchingFieldFiles) {
      const objectName = fieldFile.substring(fieldFile.indexOf('objects/')).split("/")[1];
      if (objectName.endsWith("__dlm") || objectName.endsWith("__dll")) {
        continue;
      }
      const fieldXml = fs.readFileSync(fieldFile, "utf8").toString();
      const fieldDetail = new XMLParser().parse(fieldXml);
      if (fieldDetail?.CustomField?.type === "MasterDetail" || fieldDetail?.CustomField?.type === "Lookup") {
        const fieldName = path.basename(fieldFile, ".field-meta.xml");
        if (fieldDetail?.CustomField?.referenceTo) {
          const link = {
            from: objectName,
            to: fieldDetail.CustomField.referenceTo,
            field: fieldName,
            relationshipName: fieldDetail?.CustomField?.relationshipName || fieldDetail?.CustomField?.referenceTo,
            type: fieldDetail.CustomField.type
          };
          this.allLinks.push(link);
        }
        else {
          uxLog("warning", this, c.yellow(`Warning: ${objectName}.${fieldName} has no referenceTo value so has been ignored.`));
        }
      }
    }
    ALL_LINKS_CACHE = [...this.allLinks];
  }

  async buildAllObjects() {
    if (ALL_OBJECTS_CACHE.length > 0) {
      this.allObjects = ALL_OBJECTS_CACHE;
      return;
    }
    // Get custom objects info
    const findObjectsPattern = `**/objects/**/*.object-meta.xml`;
    const matchingObjectFiles = (await glob(findObjectsPattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS })).map(file => file.replace(/\\/g, '/'));
    for (const objectFile of matchingObjectFiles) {
      const objectName = path.basename(objectFile, ".object-meta.xml");
      const objectXml = fs.readFileSync(objectFile, "utf8").toString();
      const objectDetail = new XMLParser().parse(objectXml);
      const object = {
        name: objectName,
        label: objectDetail?.CustomObject?.label || objectName,
        description: objectDetail?.CustomObject?.description || '',
      };
      this.allObjects.push(object);
    }
    ALL_OBJECTS_CACHE = [...this.allObjects];
  }

  async selectObjects() {
    for (const link of this.allLinks) {
      if (this.relatedCustomObjects.includes(link.from) || this.relatedCustomObjects.includes(link.to)) {
        this.selectedObjectsNames.add(link.from);
        this.selectedObjectsNames.add(link.to);
      }
      else if (this.mainCustomObject === "all") {
        this.selectedObjectsNames.add(link.from);
        this.selectedObjectsNames.add(link.to);
      }
      else {
        if (link.from === this.mainCustomObject || link.to === this.mainCustomObject) {
          this.selectedObjectsNames.add(link.from);
          this.selectedObjectsNames.add(link.to);
        }
      }
    }
    for (const object of this.allObjects) {
      if (this.selectedObjectsNames.has(object.name)) {
        this.selectedObjects.push(object);
      }
    }
    // Complete with objects with missing .object-meta.xml file
    for (const object of this.selectedObjectsNames) {
      if (!this.selectedObjects.some(obj => obj.name === object)) {
        this.selectedObjects.push({ name: object, label: object, description: '' });
      }
    }
  }

  async selectLinks() {
    if (this.selectedObjectsNames.size > 10) {
      for (const link of this.allLinks) {
        if ((link.from === this.mainCustomObject || link.to === this.mainCustomObject) &&
          (this.selectedObjectsNames.has(link.from) && this.selectedObjectsNames.has(link.to))
        ) {
          this.selectedLinks.push(link);
        }
      }
    }
    else {
      for (const link of this.allLinks) {
        if (this.selectedObjectsNames.has(link.from) && this.selectedObjectsNames.has(link.to)) {
          this.selectedLinks.push(link);
        }
      }
    }
  }

}



