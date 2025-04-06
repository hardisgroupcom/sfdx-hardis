import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { buildGenericMarkdownTable } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";

export class DocBuilderProfile extends DocBuilderRoot {

  public docType = "Profile";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_PROFILE";
  public placeholder = "<!-- Profile description -->";
  public xmlRootKey = "Profile";

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
      '<!-- Profile description -->',
      '',
      buildGenericMarkdownTable(this.parsedXmlObject, ["allFields"], "## Profile attributes", []),
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
      xmlObj.Profile.applicationVisibilities = xmlObj.Profile.applicationVisibilities.filter(applicationVisibility => applicationVisibility.visible === 'true');
    }
    // Keep only visible recordTypes
    if (xmlObj?.Profile?.recordTypeVisibilities) {
      if (!Array.isArray(xmlObj.Profile.recordTypeVisibilities)) {
        xmlObj.Profile.recordTypeVisibilities = [xmlObj.Profile.recordTypeVisibilities];
      }
      xmlObj.Profile.recordTypeVisibilities = xmlObj.Profile.recordTypeVisibilities.filter(rt => rt.visible === 'true');
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

}