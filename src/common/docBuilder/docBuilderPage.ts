import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { buildGenericMarkdownTable } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";

export class DocBuilderPage extends DocBuilderRoot {

  public docType = "Page";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_PAGE";
  public placeholder = "<!-- Page description -->";
  public xmlRootKey = "FlexiPage";

  public async buildInitialMarkdownLines(): Promise<string[]> {
    return [
      `## ${this.metadataName}`,
      '',
      buildGenericMarkdownTable(this.parsedXmlObject, ["sobjectType", "type", "masterLabel", "template"], "## Lightning Page attributes", []),
      '',
      '<!-- Page description -->',
      '',
    ];
  }

}