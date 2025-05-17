import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { buildGenericMarkdownTable, prettifyFieldName } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";
/* jscpd:ignore-start */
export class DocBuilderProfile extends DocBuilderRoot {

  public docType = "Profile";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_PROFILE";
  public placeholder = "<!-- Profile description -->";
  public xmlRootKey = "Profile";
  public docsSection = "profiles";

  public static buildIndexTable(prefix: string, profileDescriptions: any[], filterObject: string | null = null) {
    const filteredProfiles = filterObject ? profileDescriptions.filter(profile => profile.impactedObjects.includes(filterObject)) : profileDescriptions;
    if (filteredProfiles.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? "## Related Profiles" : "## Profiles",
      "",
      "| Profile | User License |",
      "| :----      | :--: | "
    ]);
    for (const profile of filteredProfiles) {
      const profileNameCell = `[${profile.name}](${prefix}${encodeURIComponent(profile.name)}.md)`;
      lines.push(...[
        `| ${profileNameCell} | ${profile.userLicense} |`
      ]);
    }
    lines.push("");
    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    return [
      `## ${this.metadataName}`,
      '',
      '<div id="jstree-container"></div>',
      '',
      buildGenericMarkdownTable(this.parsedXmlObject, ["userLicense", "custom"], "## Profile attributes", []),
      '',
      '<!-- Profile description -->',
      '',
    ];
  }

  public stripXmlForAi(): Promise<string> {
    const xmlObj = new XMLParser().parse(this.metadataXml);
    // Remove class access: not relevant for prompt
    if (xmlObj?.Profile?.classAccesses) {
      delete xmlObj.Profile.classAccesses;
    }
    // Remove fieldPermissions: not relevant for prompt
    if (xmlObj?.Profile?.fieldPermissions) {
      delete xmlObj.Profile.fieldPermissions;
    }
    // Remove flowAccesses: not relevant for prompt
    if (xmlObj?.Profile?.flowAccesses) {
      delete xmlObj.Profile.flowAccesses;
    }
    // Remove layoutAssignments: not relevant for prompt
    if (xmlObj?.Profile?.layoutAssignments) {
      delete xmlObj.Profile.layoutAssignments;
    }
    // Remove pageAccesses: not relevant for prompt
    if (xmlObj?.Profile?.pageAccesses) {
      delete xmlObj.Profile.pageAccesses;
    }
    // Keep only visible applications
    if (xmlObj?.Profile?.applicationVisibilities) {
      if (!Array.isArray(xmlObj.Profile.applicationVisibilities)) {
        xmlObj.Profile.applicationVisibilities = [xmlObj.Profile.applicationVisibilities];
      }
      xmlObj.Profile.applicationVisibilities = xmlObj.Profile.applicationVisibilities.filter(applicationVisibility => applicationVisibility.visible === true);
    }
    // Keep only visible recordTypes
    if (xmlObj?.Profile?.recordTypeVisibilities) {
      if (!Array.isArray(xmlObj.Profile.recordTypeVisibilities)) {
        xmlObj.Profile.recordTypeVisibilities = [xmlObj.Profile.recordTypeVisibilities];
      }
      xmlObj.Profile.recordTypeVisibilities = xmlObj.Profile.recordTypeVisibilities.filter(rt => rt.visible === true);
    }
    // Keep only visible tabs
    if (xmlObj?.Profile?.tabVisibilities) {
      if (!Array.isArray(xmlObj.Profile.tabVisibilities)) {
        xmlObj.Profile.tabVisibilities = [xmlObj.Profile.tabVisibilities];
      }
      xmlObj.Profile.tabVisibilities = xmlObj.Profile.tabVisibilities.filter(tab => tab.visibility === 'Hidden');
    }
    const xmlStripped = new XMLBuilder().build(xmlObj);
    return xmlStripped
  }

  // Generate json for display with jsTree npm library 
  public async generateJsonTree(): Promise<any> {
    const xmlObj = new XMLParser().parse(this.metadataXml);
    const treeElements: any[] = [];
    for (const profileRootAttribute of Object.keys(xmlObj?.Profile || {})) {
      if (["custom", "userLicense"].includes(profileRootAttribute)) {
        continue;
      }
      let attributeValue = xmlObj.Profile[profileRootAttribute];
      if (!Array.isArray(attributeValue)) {
        attributeValue = [attributeValue]
      }
      const attributeTreeRoot: any = {
        text: prettifyFieldName(profileRootAttribute),
        icon: "fa-solid fa-folder icon-blue",
        a_attr: { href: null },
        children: [],
      }
      if (profileRootAttribute === "fieldPermissions") {
        // Sort custom fields by object name
        this.buildObjectFieldsTree(attributeValue, attributeTreeRoot);
      }
      else {
        for (const element of attributeValue) {
          if (!this.isAccessibleElement(element)) {
            continue;
          }
          const subElement: any = this.getSubElement(element);
          attributeTreeRoot.children.push(subElement);
        }
        attributeTreeRoot.text = attributeTreeRoot.text + " (" + attributeTreeRoot.children.length + ")";
      }
      if (attributeTreeRoot.children.length > 0) {
        treeElements.push(attributeTreeRoot);
      }
    }
    return treeElements;
  }

  public buildObjectFieldsTree(attributeValue: any, attributeTreeRoot: any) {
    const elementsByObject: any = [];
    for (const element of attributeValue) {
      const objectName = element.field.split('.')[0];
      if (!elementsByObject[objectName]) {
        elementsByObject[objectName] = [];
      }
      elementsByObject[objectName].push(element);
    }
    // Create object nodes and fields as children
    let totalFields = 0;
    for (const objectName of Object.keys(elementsByObject)) {
      const objectNode: any = {
        text: objectName + " (" + elementsByObject[objectName].length + ")",
        icon: "fa-solid fa-folder icon-blue",
        a_attr: { href: null },
        children: [],
      };
      for (const element of elementsByObject[objectName]) {
        if (!this.isAccessibleElement(element)) {
          continue;
        }
        const subElement: any = this.getSubElement(element);
        objectNode.children.push(subElement);
      }
      if (objectNode.children.length > 0) {
        attributeTreeRoot.children.push(objectNode);
        totalFields += objectNode.children.length;
      }
    }
    attributeTreeRoot.text = attributeTreeRoot.text + " (" + totalFields + ")";
  }

  public isAccessibleElement(element: any) {
    if (element.visible === false) {
      return false;
    }
    if (element.readable === false) {
      return false;
    }
    if (element.allowRead === false) {
      return false;
    }
    if (element.enabled === false) {
      return false;
    }
    return true;
  }

  public getSubElement(element: any) {
    const subElement: any = {
      text: element.name || element.apexClass || element.flow || element.apexPage || element.object || element.tab || element.application || element.field || element.layout || element.recordType || element.externalDataSource || element.startAddress || element.dataspaceScope || "ERROR: " + JSON.stringify(element),
      icon:
        // Common properties
        element.default === true ? "fa-solid fa-star icon-success" :
          element.visible === true ? "fa-solid fa-eye icon-success" :
            element.visible === false ? "fa-solid fa-eye-slash icon-error" :
              element.enabled === true ? "fa-solid fa-circle-check icon-success" :
                element.enabled === false ? "fa-solid fa-circle-xmark icon-error" :
                  // Custom fields 
                  element.editable === true ? "fa-solid fa-square-pen icon-success" :
                    element.readable === true ? "fa-solid fa-eye icon-success" :
                      element.readable === false ? "fa-solid fa-eye-slash icon-error" :
                        // Custom objects
                        element.modifyAllRecords === true ? "fa-solid fa-web-awesome icon-success" :
                          element.viewAllRecords === true && element.allowEdit === false ? "fa-solid fa-magnifying-glass icon-success" :
                            element.allowEdit === true ? "fa-solid fa-square-pen icon-success" :
                              element.allowRead === true ? "fa-solid fa-eye icon-success" :
                                element.allowRead === false ? "fa-solid fa-eye-slash icon-error" :
                                  // Tabs
                                  ["DefaultOn", "Visible"].includes(element.visibility) ? "fa-solid fa-eye icon-success" :
                                    element.visibility === "DefaultOff" ? "fa-solid fa-circle-notch icon-warning" :
                                      element.visibility === "Hidden" ? "fa-solid fa-eye-slash icon-error" :
                                        "fa-solid fa-file",
      a_attr: { href: null },
      children: [],
    };
    subElement.children = Object.keys(element).map((key) => {
      const icon = (element[key] === true) ? "fa-solid fa-circle-check icon-success" :
        (element[key] === false) ? "fa-solid fa-circle-xmark icon-error" :
          (["DefaultOn", "Visible"].includes(element[key])) ? "fa-solid fa-eye icon-success" :
            (element[key] === "Hidden") ? "fa-solid fa-eye-slash icon-error" :
              (element[key] === "DefaultOff") ? "fa-solid fa-circle-notch icon-warning" :
                "";
      return {
        text: prettifyFieldName(key) + ": " + element[key],
        icon: icon,
        a_attr: { href: null },
      };
    });
    // Sort subElement.children to put text as first element
    subElement.children.sort((a: any, b: any) => {
      if (a.text.endsWith(subElement.text)) return -1;
      if (b.text.endsWith(subElement.text)) return 1;
      return 0;
    });
    return subElement;
  }
}
/* jscpd:ignore-end */