import { DocBuilderRoot } from "./docBuilderRoot.js";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import jsdoc2md from "jsdoc-to-markdown";
import fs from "fs-extra";
import path from "path";

export class DocBuilderLwc extends DocBuilderRoot {

  public docType = "Lwc";
  public placeholder = "<!-- LWC description -->";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_LWC";
  public xmlRootKey = "";
  public docsSection = "lwc";

  public static buildIndexTable(prefix: string, lwcDescriptions: any, filterObject: string | null = null) {
    const filteredLwcs = filterObject 
      ? lwcDescriptions.filter(lwc => lwc.impactedObjects.includes(filterObject)) 
      : lwcDescriptions;
    
    if (filteredLwcs.length === 0) {
      return [];
    }
    
    const lines: string[] = [];
    lines.push(...[
      filterObject ? "## Related Lightning Web Components" : "## Lightning Web Components",
      "",
      "| Component | Description | Exposed | Targets |",
      "| :-------- | :---------- | :-----: | :------------- |"
    ]);

    for (const lwc of filteredLwcs) {
      const lwcNameCell = `[${lwc.name}](${prefix}${lwc.name}.md)`;
      const exposedCell = lwc.isExposed ? "✅" : "❌";
      lines.push(...[
        `| ${lwcNameCell} | ${lwc.description || ""} | ${exposedCell} | ${lwc.targets || ""} |`
      ]);
    }
    lines.push("");

    return lines;
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    return [
      `## ${this.metadataName}`,
      '',
      '<!-- LWC description -->',
      '',
      '## JS Documentation',
      '',
      await this.generateJsDocumentation(),
      '',
      '## Files',
      '',
      await this.listComponentFiles(),
      ''
    ];
  }

  private async generateJsDocumentation(): Promise<string> {
    try {
      const lwcPath = this.additionalVariables.LWC_PATH;
      const jsFile = path.join(lwcPath, `${this.metadataName}.js`);
      
      if (fs.existsSync(jsFile)) {
        const jsdocOutput = await jsdoc2md.render({ files: jsFile });
        return jsdocOutput || "No JSDoc documentation available for this component.";
      } else {
        return "No JavaScript file found for this component.";
      }
    } catch (error) {
      return `Error generating JS documentation: ${(error as any).message}`;
    }
  }

  private async listComponentFiles(): Promise<string> {
    try {
      const lwcPath = this.additionalVariables.LWC_PATH;
      const files = await fs.readdir(lwcPath);
      
      let fileList = "";
      for (const file of files) {
        const stats = await fs.stat(path.join(lwcPath, file));
        if (stats.isFile()) {
          fileList += `- \`${file}\`\n`;
        }
      }
      
      return fileList || "No files found for this component.";
    } catch (error) {
      return `Error listing component files: ${(error as any).message}`;
    }
  }

  public async stripXmlForAi(): Promise<string> {
    const lwcPath = this.additionalVariables.LWC_PATH;
    const files = await fs.readdir(lwcPath);
    
    let componentCode = "";
    for (const file of files) {
      const filePath = path.join(lwcPath, file);
      const stats = await fs.stat(filePath);
      
      if (stats.isFile()) {
        // Skip CSS files
        if (file.endsWith('.css')) {
          continue;
        }
        
        const fileContent = await fs.readFile(filePath, 'utf-8');
        componentCode += `// File: ${file}\n${fileContent}\n\n`;
      }
    }
    
    return componentCode;
  }
}