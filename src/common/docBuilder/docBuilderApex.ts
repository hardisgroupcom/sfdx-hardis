import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";

export class DocBuilderApex extends DocBuilderRoot {

  public docType = "APEX";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_APEX";
  public placeholder = "<!-- Apex description -->";

}