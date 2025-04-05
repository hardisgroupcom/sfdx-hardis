import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { buildGenericMarkdownTable } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";

export class DocBuilderProfile extends DocBuilderRoot {

  public docType = "Profile";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_PROFILE";
  public placeholder = "<!-- Profile description -->";
  public xmlRootKey = "Profile";

  public async buildInitialMarkdownLines(): Promise<string[]> {
    return [
      `## ${this.metadataName}`,
      '',
      '<!-- Profile description -->',
      '',
      buildGenericMarkdownTable(this.parsedXmlObject, ["allFields"], "## Profile attributes", []),
    ];
  }

}