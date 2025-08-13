import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import fs from "fs-extra";
import path from "path";
import { uxLog } from "../utils/index.js";
import c from "chalk";
import { UtilsAi } from "../aiProvider/utils.js";
import { AiProvider } from "../aiProvider/index.js";

export class DocBuilderRoles {

  public placeholder = "<!-- Roles description -->";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_ROLES";

  public static async generateMarkdownFileFromRoles(roleDescriptions: any[], outputFile: string) {
    const mdLines: string[] = [
      '<!-- This file is auto-generated. if you do not want it to be overwritten, set TRUE in the line below -->',
      '<!-- DO_NOT_OVERWRITE_DOC=FALSE -->',
      '',
      '# Organization roles',
      '',
      '<div id="jstree-container"></div>',
      '',
    ];
    const aiDescription = await DocBuilderRoles.getDescriptionWithAI(roleDescriptions);
    if (aiDescription) {
      mdLines.push("");
      mdLines.push("## AI-Generated Description", "");
      mdLines.push(...aiDescription.split("\n"));
      mdLines.push("");
    }
    await fs.ensureDir(path.dirname(outputFile));
    await fs.writeFile(outputFile, mdLines.join("\n") + "\n");

    await this.generateJsonTreeFileFromRoles(roleDescriptions);

  }

  public static async getDescriptionWithAI(roleDescriptions: any[]): Promise<string> {
    const promptKey = "PROMPT_DESCRIBE_ROLES";
    const metadataName = "Roles"
    const rolesStrings = roleDescriptions.map(role => {
      return `- **${role.name} (id:${role.apiName} )**: ${role.description || "No description available"} (parentId: ${role.parentRole || "ROOT"}`;
    }).join("\n");
    const aiCache = await UtilsAi.findAiCache(promptKey, [rolesStrings], metadataName);
    if (aiCache.success) {
      uxLog("success", this, c.green(`Using cached AI response for Roles`));
      return aiCache.cacheText || '';
    }
    if (AiProvider.isAiAvailable()) {
      const variables = {
        ROLES_DESCRIPTION: rolesStrings
      };
      const prompt = AiProvider.buildPrompt(promptKey, variables);
      const aiResponse = await AiProvider.promptAi(prompt, promptKey);
      if (aiResponse?.success) {
        let responseText = aiResponse.promptResponse || "No AI description available";
        if (responseText.startsWith("##")) {
          responseText = responseText.split("\n").slice(1).join("\n");
        }
        await UtilsAi.writeAiCache(promptKey, [rolesStrings], metadataName, responseText);
        return responseText;
      }
    }
    return '';
  }

  public static async generateJsonTreeFileFromRoles(roleDescriptions: any[]) {
    const jsonTree = this.buildHierarchyTree(roleDescriptions);
    const jsonFile = `./docs/json/root-roles.json`;
    await fs.ensureDir(path.dirname(jsonFile));
    await fs.writeFile(jsonFile, JSON.stringify(jsonTree, null, 2));
    uxLog("success", this, c.green(`Successfully generated Roles JSON into ${jsonFile}`));
  }

  public static buildHierarchyTree(roleDescriptions: any[]): any[] {
    // Build a tree structure for roles based on parent-child relationships
    const roleMap = new Map();
    const rootRoles: any[] = [];

    // First pass: create all role nodes
    for (const role of roleDescriptions) {
      roleMap.set(role.apiName, {
        text: role.name,
        icon: "fa-solid fa-users icon-blue",
        children: [],
        roleData: role
      });
    }

    // Second pass: build parent-child relationships
    for (const role of roleDescriptions) {
      const roleNode = roleMap.get(role.apiName);
      if (role.parentRole && roleMap.has(role.parentRole)) {
        const parentNode = roleMap.get(role.parentRole);
        parentNode.children.push(roleNode);
      } else {
        // This is a root role (no parent)
        rootRoles.push(roleNode);
      }
    }

    // Sort children by name for each node
    const sortChildren = (node: any) => {
      if (node.children && node.children.length > 0) {
        node.children.sort((a: any, b: any) => a.text.localeCompare(b.text));
        node.children.forEach(sortChildren);
        // Update text to show count
        node.text = `${node.roleData.name} (${node.children.length})`;
      }
    };
    rootRoles.forEach(sortChildren);
    rootRoles.sort((a: any, b: any) => a.roleData.name.localeCompare(b.roleData.name));

    return rootRoles;
  }


}
