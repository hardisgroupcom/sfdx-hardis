import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";

export class DocBuilderFlow extends DocBuilderRoot {

  public docType = "Flow";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_FLOW";
  public placeholder = "<!-- Flow description -->";
  public xmlRootKey = "Flow";

  public async stripXmlForAi(): Promise<string> {
    const xmlStringStripped = this.metadataXml.replace(/<locationX>.*?<\/locationX>\s*|<locationY>.*?<\/locationY>\s*/g, '');
    const xmlObj = new XMLParser().parse(xmlStringStripped);
    const xmlStripped = new XMLBuilder().build(xmlObj);
    return xmlStripped;
  }

}