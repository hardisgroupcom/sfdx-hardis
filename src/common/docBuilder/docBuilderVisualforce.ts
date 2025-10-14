import fs from "fs-extra";
import path from "path";
import { DocBuilderRoot } from "./docBuilderRoot.js";
import { AiProvider } from "../aiProvider/index.js";
import { uxLog } from '../utils/index.js';

export class DocBuilderVisualforce extends DocBuilderRoot {
  constructor(metadataName: string, metadataXml: string, outputFile: string, additionalVariables: any = {}) {
    super(metadataName, metadataXml, outputFile, additionalVariables);
    this.docType = "Visualforce";
    this.promptKey = "PROMPT_DESCRIBE_VISUALFORCE_PAGE";
    this.placeholder = "<!-- VISUALFORCE_DESCRIPTION -->";
    this.docsSection = "visualforce";
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    const { VF_LABEL, VF_API_VERSION, VF_DESCRIPTION, VF_FILE, VF_CONTROLLER_FILE } = this.additionalVariables;

    const controllerName = VF_CONTROLLER_FILE ? path.basename(VF_CONTROLLER_FILE, ".cls") : "None";

    const lines: string[] = [
      `## ${this.metadataName}`,
      "",
    ];

    if (VF_LABEL || VF_API_VERSION || VF_DESCRIPTION) {
      lines.push("**Metadata Information:**");
      if (VF_LABEL) lines.push(`- **Label:** ${VF_LABEL}`);
      if (VF_API_VERSION) lines.push(`- **API Version:** ${VF_API_VERSION}`);
      if (VF_DESCRIPTION) lines.push(`- **Description:** ${VF_DESCRIPTION}`);
      lines.push("");
    }

    lines.push(`**Controller:** ${controllerName}`, "");

    // Placeholder for AI/fallback description
    lines.push(this.placeholder, "");

    // Files section
    lines.push("## Files", "");
    lines.push(`- \`${path.basename(VF_FILE)}\``);
    if (VF_CONTROLLER_FILE) lines.push(`- \`${path.basename(VF_CONTROLLER_FILE)}\``);
    const metaFilePath = VF_FILE.replace(".page", ".page-meta.xml");
    if (await fs.pathExists(metaFilePath)) {
      lines.push(`- \`${path.basename(metaFilePath)}\``);
    }

    return lines;
  }

  public async stripXmlForAi(): Promise<string> {
    const vfCode = await fs.readFile(this.additionalVariables.VF_FILE, "utf-8");
    let controllerCode = "";
    if (this.additionalVariables.VF_CONTROLLER_FILE && await fs.pathExists(this.additionalVariables.VF_CONTROLLER_FILE)) {
      controllerCode = await fs.readFile(this.additionalVariables.VF_CONTROLLER_FILE, "utf-8");
    }
    return `// Visualforce Page\n${vfCode}\n\n// Apex Controller\n${controllerCode}`;
  }

  public async generateManualDescription(): Promise<string> {
    const vfCode = await fs.readFile(this.additionalVariables.VF_FILE, "utf-8");

    const apexTags = [...new Set((vfCode.match(/<apex:[a-zA-Z]+/g) || []).map(t => t.replace("<", "")))];
    const bindings = [...new Set((vfCode.match(/{![^}]+}/g) || []))];

    const lines: string[] = [];
    lines.push("This Visualforce page uses standard Salesforce components.");
    if (apexTags.length) lines.push(`It includes tags: ${apexTags.slice(0, 5).join(", ")}`);
    if (bindings.length) lines.push(`It uses bindings: ${bindings.slice(0, 5).join(", ")}`);
    lines.push("_AI not available: description auto-generated._");

    return lines.join(" ");
  }

  public async completeDocWithAiDescription(): Promise<string> {
    try {
      // Strip XML content for AI prompt
      const xmlStripped = await this.stripXmlForAi();

      let description: string;

      if (AiProvider.isAiAvailable()) {
        // Use centralized helper
        description = await AiProvider.getAiDescription(this.promptKey, xmlStripped, this.metadataName);
      } else {
        // Fallback if AI not available
        description = await this.generateManualDescription();
        uxLog("log", this, "AI not available: inserting fallback Visualforce description.");
      }

      // Replace placeholder in markdown
      this.markdownDoc = this.markdownDoc.replace(this.placeholder, description);

      return this.markdownDoc;
    } catch (error) {
      uxLog("error", this, `Error generating AI description for ${this.metadataName}: ${error}`);
      return this.markdownDoc.replace(this.placeholder, "_AI description failed_");
    }
  }


  public async generateJsonTree(): Promise<any> {
    const vfCode = await fs.readFile(this.additionalVariables.VF_FILE, "utf-8");
    const apexTags = [...new Set((vfCode.match(/<apex:[a-zA-Z]+/g) || []).map(t => t.replace("<", "")))];
    return {
      name: this.metadataName,
      controller: this.additionalVariables.VF_CONTROLLER_FILE ? path.basename(this.additionalVariables.VF_CONTROLLER_FILE) : null,
      apexTags,
    };
  }
}
