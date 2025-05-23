import { UtilsAi } from "./utils.js";
import path from "path";
import fs from "fs-extra";
import { PromptTemplateDefinition } from "./promptTemplates/types.js";
import { PROMPT_TEMPLATES as IMPORTED_PROMPT_TEMPLATES } from "./promptTemplates/index.js";
import { uxLog } from "../utils/index.js";

export type PromptTemplate =
  "PROMPT_SOLVE_DEPLOYMENT_ERROR" |
  "PROMPT_DESCRIBE_FLOW" |
  "PROMPT_DESCRIBE_FLOW_DIFF" |
  "PROMPT_DESCRIBE_OBJECT" |
  "PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD" |
  "PROMPT_DESCRIBE_APEX" |
  "PROMPT_DESCRIBE_PAGE" |
  "PROMPT_DESCRIBE_PACKAGE" |
  "PROMPT_DESCRIBE_PROFILE" |
  "PROMPT_DESCRIBE_PERMISSION_SET" |
  "PROMPT_DESCRIBE_PERMISSION_SET_GROUP" |
  "PROMPT_DESCRIBE_ASSIGNMENT_RULES" |
  "PROMPT_DESCRIBE_APPROVAL_PROCESS" |
  "PROMPT_DESCRIBE_LWC" |
  "PROMPT_DESCRIBE_AUTORESPONSE_RULES" |
  "PROMPT_DESCRIBE_ESCALATION_RULES";

// Loads a template, allowing override from local JSON if present
function getPromptTemplate(template: PromptTemplate): PromptTemplateDefinition {
  const templateData = IMPORTED_PROMPT_TEMPLATES[template];
  if (!templateData) {
    throw new Error(`Unknown prompt template: ${template}`);
  }
  // Check for local override (Text file)
  const localPath = path.resolve(process.cwd(), "config", "prompt-templates", `${template}.txt`);
  if (fs.existsSync(localPath)) {
    try {
      const localTemplate = fs.readFileSync(localPath, "utf-8");
      templateData.text = {
        "en": localTemplate,
      };
      uxLog(this, `Loaded local prompt template for ${template} from ${localPath}`);
    } catch (e: any) {
      // fallback to default if error
      uxLog(this, `Error loading local template for ${template}: ${e.message}`);
    }
  }
  return templateData;
}

export function buildPromptFromTemplate(template: PromptTemplate, variables: object): string {
  const templateData = getPromptTemplate(template);
  const missingVariables = templateData.variables.filter((variable) => !variables[variable.name]);
  if (missingVariables.length > 0) {
    throw new Error(`Missing variables for prompt template ${template}: ${missingVariables.map(variable => variable.name).join(", ")}`);
  }
  // Truncate variable values if necessary
  for (const variable of templateData.variables) {
    if (variable.truncateAfter && variables[variable.name]?.length > variable.truncateAfter) {
      variables[variable.name] = variables[variable.name].slice(0, variable.truncateAfter) + "(truncated first " + variable.truncateAfter + " characters on a total of " + variables[variable.name].length + " characters)";
    }
  }
  const promptsLanguage = UtilsAi.getPromptsLanguage();
  let prompt: string = process.env?.[template] || templateData.text?.[promptsLanguage] || (templateData.text?.["en"] + `\n\nIMPORTANT: Please reply in the language corresponding to ISO code "${promptsLanguage}" (for example, in french for "fr", in english for "en", in german for "de", etc.)`);
  for (const variable in variables) {
    prompt = prompt.replaceAll(`{{${variable}}}`, variables[variable]);
  }
  return prompt;
}


