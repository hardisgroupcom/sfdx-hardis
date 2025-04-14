import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { buildGenericMarkdownTable, prettifyFieldName } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";

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
        icon: "fa-solid fa-folder",
        a_attr: { href: null },
        children: [],
      }
      for (const element of attributeValue) {
        const subElement: any = {
          text: element.name || element.apexClass || element.flow || element.apexPage || element.object || element.tab || element.recordType || element.application || element.field || element.layout || element.externalDataSource,
          icon:
            // Common properties
            element.visible === true ? "fa-solid eye icon-success" :
              element.visible === false ? "fa-solid eye-slash icon-error" :
                element.enabled === true ? "fa-solid fa-circle-check icon-success" :
                  element.enabled === false ? "fa-solid fa-circle-xmark icon-error" :
                    // Custom fields 
                    element.editable === true ? "fa-solid fa-square-pen icon-success" :
                      element.readable === true ? "fa-solid fa-eye icon-success" :
                        element.readable === false ? "fa-solid fa-eye-slash icon-error" :
                          // Custom objects
                          element.allowEdit === true ? "fa-solid fa-square-pen icon-success" :
                            element.allowRead === true ? "fa-solid fa-eye icon-success" :
                              element.allowRead === false ? "fa-solid fa-eye-slash icon-error" :
                                // Tabs
                                element.visibility === "DefaultOn" ? "fa-solid fa-circle-check icon-success" :
                                  element.visibility === "hidden" ? "fa-solid fa-circle-xmark icon-error" :
                                    "fa-solid fa-file",
          a_attr: { href: null },
          children: [],
        }
        subElement.children = Object.keys(element).map((key) => {
          const icon =
            element[key] === true ? "fa-solid fa-circle-check icon-success" :
              (element[key] === false || element[key] === "Hidden") ? "fa-solid fa-circle-xmark icon-error" :
                "";
          return {
            text: prettifyFieldName(key) + ": " + element[key],
            icon: icon,
            a_attr: { href: null },
          };
        });
        attributeTreeRoot.children.push(subElement);
      }
      attributeTreeRoot.text = attributeTreeRoot.text + " (" + attributeTreeRoot.children.length + ")";
      treeElements.push(attributeTreeRoot);
    }
    return treeElements;
  }

}