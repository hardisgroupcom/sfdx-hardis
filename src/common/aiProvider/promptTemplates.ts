import { UtilsAi } from "./utils.js";
import path from "path";
import fs from "fs-extra";
import { PromptTemplateDefinition } from "./promptTemplates/types.js";
import { PROMPT_TEMPLATES as IMPORTED_PROMPT_TEMPLATES } from "./promptTemplates/index.js";
import { PROMPT_VARIABLES, PromptVariable } from "./promptTemplates/variablesIndex.js";
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
  "PROMPT_DESCRIBE_ROLES" |
  "PROMPT_DESCRIBE_ASSIGNMENT_RULES" |
  "PROMPT_DESCRIBE_APPROVAL_PROCESS" |
  "PROMPT_DESCRIBE_LWC" |
  "PROMPT_DESCRIBE_AUTORESPONSE_RULES" |
  "PROMPT_DESCRIBE_ESCALATION_RULES" |
  "PROMPT_DESCRIBE_VF";

// Loads a template, allowing override from local file, with caching
const promptTemplateCache: Record<string, PromptTemplateDefinition> = {};

function getPromptTemplate(template: PromptTemplate): PromptTemplateDefinition {
  if (promptTemplateCache[template]) {
    return promptTemplateCache[template];
  }

  const templateData = { ...IMPORTED_PROMPT_TEMPLATES[template] };
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
      uxLog("log", this, `Loaded local prompt template for ${template} from ${localPath}`);
    } catch (e: any) {
      // fallback to default if error
      uxLog("warning", this, `Error loading local template for ${template}: ${e.message}`);
    }
  }

  promptTemplateCache[template] = templateData;
  return templateData;
}

// Loads a prompt variable, allowing override from local file, with caching
const promptVariableCache: Record<string, string> = {};

function getPromptVariable(variable: PromptVariable): string {
  if (promptVariableCache[variable]) {
    return promptVariableCache[variable];
  }

  const variableData = PROMPT_VARIABLES[variable];
  if (!variableData) {
    throw new Error(`Unknown prompt variable: ${variable}`);
  }

  // Check for local override (Text file)
  const localPath = path.resolve(process.cwd(), "config", "prompt-templates", `${variable}.txt`);
  if (fs.existsSync(localPath)) {
    try {
      const localVariable = fs.readFileSync(localPath, "utf-8");
      uxLog("log", this, `Loaded local prompt variable for ${variable} from ${localPath}`);
      promptVariableCache[variable] = localVariable;
      return localVariable;
    } catch (e: any) {
      // fallback to default if error
      uxLog("warning", this, `Error loading local variable for ${variable}: ${e.message}`);
    }
  }

  const promptsLanguage = UtilsAi.getPromptsLanguage();
  const value = variableData.text?.[promptsLanguage] || variableData.text?.["en"] || "";
  promptVariableCache[variable] = value;
  return value;
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

  // Replace prompt variables first (format: {{VARIABLE_NAME}})
  for (const variableName of Object.keys(PROMPT_VARIABLES) as PromptVariable[]) {
    const variableContent = getPromptVariable(variableName);
    prompt = prompt.replaceAll(`{{${variableName}}}`, variableContent);
  }

  // Then replace user variables
  for (const variable in variables) {
    prompt = prompt.replaceAll(`{{${variable}}}`, variables[variable]);
  }

  return prompt;
}


