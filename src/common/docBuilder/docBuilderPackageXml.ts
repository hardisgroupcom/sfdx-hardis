import c from 'chalk';
import * as path from 'path';
import fs from 'fs-extra';
import { SfError } from '@salesforce/core';
import { sortCrossPlatform, uxLog } from '../utils/index.js';
import { countPackageXmlItems, parsePackageXmlFile } from '../utils/xmlUtils.js';
import { SalesforceSetupUrlBuilder } from './docUtils.js';
import { CONSTANTS } from '../../config/index.js';
import { prettifyFieldName } from '../utils/flowVisualiser/nodeFormatUtils.js';

export class DocBuilderPackageXML {

  public static async buildIndexTable(outputPackageXmlMarkdownFiles: any[]) {
    const packageLines: string[] = [];
    const packagesForMenu: any = { "All manifests": "manifests.md" }
    packageLines.push(...[
      "## Package XML files",
      "",
      "| Package name | Description |",
      "| :----------- | :---------- |"
    ]);

    for (const outputPackageXmlDef of outputPackageXmlMarkdownFiles) {
      const metadataNb = await countPackageXmlItems(outputPackageXmlDef.path);
      const packageMdFile = path.basename(outputPackageXmlDef.path) + ".md";
      const label = outputPackageXmlDef.name ? `Package folder: ${outputPackageXmlDef.name}` : path.basename(outputPackageXmlDef.path);
      const packageTableLine = `| [${label}](${packageMdFile}) (${metadataNb}) | ${outputPackageXmlDef.description} |`;
      packageLines.push(packageTableLine);
      packagesForMenu[label] = packageMdFile;
    }
    packageLines.push("");
    packageLines.push("___");
    packageLines.push("");
    return { packageLines, packagesForMenu };
  }

  public static async generatePackageXmlMarkdown(inputFile: string | null, outputFile: string | null = null, packageXmlDefinition: any = null, rootSalesforceUrl: string = "") {
    // Find packageXml to parse if not defined
    if (inputFile == null) {
      inputFile = path.join(process.cwd(), "manifest", "package.xml");
      if (!fs.existsSync(inputFile)) {
        throw new SfError("No package.xml found. You need to send the path to a package.xml file in --inputfile option");
      }
    }
    // Build output file if not defined
    if (outputFile == null) {
      const packageXmlFileName = path.basename(inputFile);
      outputFile = path.join(process.cwd(), "docs", `${packageXmlFileName}.md`);
    }
    await fs.ensureDir(path.dirname(outputFile));

    uxLog("other", this, `Generating markdown doc from ${inputFile} to ${outputFile}...`);

    // Read content
    const packageXmlContent = await parsePackageXmlFile(inputFile);
    const metadataTypes = Object.keys(packageXmlContent);
    metadataTypes.sort();
    const nbItems = await countPackageXmlItems(inputFile);

    const mdLines: string[] = []

    if (packageXmlDefinition && packageXmlDefinition.description) {
      // Header
      mdLines.push(...[
        `## Content of ${path.basename(inputFile)}`,
        '',
        packageXmlDefinition.description,
        '',
        '<div id="jstree-container"></div>',
        '',
        `Metadatas: ${nbItems}`,
        ''
      ]);
    }
    else {
      // Header
      mdLines.push(...[
        `## Content of ${path.basename(inputFile)}`,
        '',
        '<div id="jstree-container"></div>',
        '',
        `Metadatas: ${nbItems}`,
        ''
      ]);
    }

    // Generate package.xml markdown
    for (const metadataType of metadataTypes) {
      const members = packageXmlContent[metadataType];
      sortCrossPlatform(members);
      const memberLengthLabel = members.length === 1 && members[0] === "*" ? "*" : members.length;
      mdLines.push(`<details><summary>${metadataType} (${memberLengthLabel})</summary>\n\n`);
      for (const member of members) {
        const memberLabel = member === "*" ? "ALL (wildcard *)" : member;
        const setupUrl = SalesforceSetupUrlBuilder.getSetupUrl(metadataType, member);
        if (setupUrl && rootSalesforceUrl) {
          mdLines.push(`  • <a href="${rootSalesforceUrl}${setupUrl}" target="_blank">${memberLabel}</a><br/>`);
        }
        else {
          mdLines.push(`  • ${memberLabel}<br/>`);
        }
      }
      mdLines.push("");
      mdLines.push("</details>");
      mdLines.push("");
    }
    mdLines.push("");

    // Footer
    mdLines.push(`_Documentation generated with [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT})_`);

    // Write output file
    await fs.writeFile(outputFile, mdLines.join("\n") + "\n");
    uxLog("success", this, c.green(`Successfully generated ${path.basename(inputFile)} documentation into ${outputFile}`));

    const jsonTree = await this.generateJsonTree(metadataTypes, packageXmlContent);
    if (jsonTree) {
      const packageXmlFileName = path.basename(outputFile, ".md");
      const jsonFile = `./docs/json/root-${packageXmlFileName}.json`;
      await fs.ensureDir(path.dirname(jsonFile));
      await fs.writeFile(jsonFile, JSON.stringify(jsonTree, null, 2));
      uxLog("success", this, c.green(`Successfully generated ${packageXmlFileName} JSON into ${jsonFile}`));
    }

    return outputFile;
  }

  public static listPackageXmlCandidates(): any[] {
    return [
      // CI/CD package files
      {
        path: "manifest/package.xml",
        description: "Contains all deployable metadatas of the SFDX project"
      },
      {
        path: "manifest/packageDeployOnce.xml",
        description: "Contains all metadatas that will never be overwritten during deployment if they are already existing in the target org"
      },
      {
        path: "manifest/package-no-overwrite.xml",
        description: "Contains all metadatas that will never be overwritten during deployment if they are already existing in the target org"
      },
      {
        path: "manifest/destructiveChanges.xml",
        description: "Contains all metadatas that will be deleted during deployment, in case they are existing in the target org"
      },
      // Monitoring package files
      {
        path: "manifest/package-all-org-items.xml",
        description: "Contains the entire list of metadatas that are present in the monitored org (not all of them are in the git backup)"
      },
      {
        path: "manifest/package-backup-items.xml",
        description: "Contains the list of metadatas that are in the git backup"
      },
      {
        path: "manifest/package-skip-items.xml",
        description: "Contains the list of metadatas that are excluded from the backup.<br/>Other metadata types might be skipped using environment variable MONITORING_BACKUP_SKIP_METADATA_TYPES"
      },
    ];
  }

  // Generate json for display with jsTree npm library 
  public static async generateJsonTree(metadataTypes: any, packageXmlContent: any): Promise<any> {
    if (metadataTypes === "all") {
      metadataTypes = Object.keys(packageXmlContent);
      metadataTypes.sort();
    }
    const treeElements: any[] = [];
    for (const metadataType of metadataTypes) {
      const members = packageXmlContent[metadataType] || [];
      sortCrossPlatform(members);
      const memberLengthLabel = members.length === 1 && members[0] === "*" ? "all" : members.length;
      const typeRoot: any = {
        text: prettifyFieldName(metadataType) + " (" + memberLengthLabel + ")",
        icon: memberLengthLabel !== "all" ? "fa-solid fa-folder icon-blue" : "fa-solid fa-folder icon-warning",
        a_attr: { href: null },
        children: [],
      }
      if (memberLengthLabel !== "all") {
        if (metadataType === "CustomField") {
          // Sort custom fields by object name
          DocBuilderPackageXML.createCustomFieldsTree(members, typeRoot);
        }
        else {
          DocBuilderPackageXML.createMembersTree(members, typeRoot);
        }
      }
      treeElements.push(typeRoot);
    }
    return treeElements;
  }

  private static createCustomFieldsTree(members: any, typeRoot: any) {
    const elementsByObject: any = [];
    for (const element of members) {
      const objectName = element.split('.')[0];
      if (!elementsByObject[objectName]) {
        elementsByObject[objectName] = [];
      }
      elementsByObject[objectName].push(element);
    }
    // Create object nodes and fields as children
    for (const objectName of Object.keys(elementsByObject)) {
      const objectNode: any = {
        text: objectName + " (" + elementsByObject[objectName].length + ")",
        icon: "fa-solid fa-folder icon-blue",
        a_attr: { href: null },
        children: [],
      };
      for (const element of elementsByObject[objectName]) {
        const subElement: any = {
          text: element,
          icon: "fa-solid fa-circle-check icon-success",
          a_attr: { href: null },
        };
        objectNode.children.push(subElement);
      }
      typeRoot.children.push(objectNode);
    }
  }

  private static createMembersTree(members: any, typeRoot: any) {
    for (const member of members) {
      const subElement: any = {
        text: member,
        icon: "fa-solid fa-circle-check icon-success",
        a_attr: { href: null },
      };
      typeRoot.children.push(subElement);
    }
  }
}