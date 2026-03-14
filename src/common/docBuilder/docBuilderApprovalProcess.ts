import { buildGenericMarkdownTable } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { t } from '../utils/i18n.js';

export class DocBuilderApprovalProcess extends DocBuilderRoot {

  public docType = "ApprovalProcess";
  public placeholder = "<!-- ApprovalProcess description -->";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_APPROVAL_PROCESS";
  public xmlRootKey = "ApprovalProcess";

  public static buildIndexTable(prefix: string, approvalProcessDescriptions: any, filterObject: string | null = null) {
    const filteredApprovalProcesses = filterObject ? approvalProcessDescriptions.filter(appProcess => appProcess.impactedObjects.includes(filterObject)) : approvalProcessDescriptions;
    if (filteredApprovalProcesses.length === 0) {
      return [];
    }
    const lines: string[] = [];
    lines.push(...[
      filterObject ? `## ${t('docMdRelatedApprovalProcesses')}` : `## ${t('docMdApprovalProcesses')}`,
      "",
      `| ${t('docMdColApprovalProcess')} | ${t('docMdColIsActive')} |`,
      "| :----            |    :--:   |"
    ]);

    for (const approvalProcess of filteredApprovalProcesses) {
      const approvalProcessNameCell = `[${approvalProcess.name}](${prefix}${approvalProcess.name}.md)`;
      lines.push(...[
        `| ${approvalProcessNameCell} | ${approvalProcess.active} |`
      ]);
    }
    lines.push("");

    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    return [
      `## ${this.metadataName}`,
      '',
      buildGenericMarkdownTable(this.parsedXmlObject, [
        "label",
        "active",
        "description",
      ], `## ${t('docMdApprovalProcessAttributes')}`, []),
      '',
      '<!-- ApprovalProcess description -->',
      '',
    ];
  }

  public async stripXmlForAi(): Promise<string> {

    const xmlObj = new XMLParser().parse(this.metadataXml);

    // Remove var that defines if Approval History is enabled: not relevant for prompt
    if (xmlObj?.ApprovalProcess?.showApprovalHistory) {
      delete xmlObj.ApprovalProcess.showApprovalHistory;
    }

    // Remove var that defines if user has access to AP on mobile devices: not relevant for prompt
    if (xmlObj?.ApprovalProcess?.enableMobileDeviceAccess) {
      delete xmlObj.ApprovalProcess.enableMobileDeviceAccess;
    }

    // Remove settings that define if the record is editable while locked: not relevant for prompt
    if (xmlObj?.ApprovalProcess?.recordEditability) {
      delete xmlObj.ApprovalProcess.recordEditability;
    }

    return new XMLBuilder().build(xmlObj);
  }
}
