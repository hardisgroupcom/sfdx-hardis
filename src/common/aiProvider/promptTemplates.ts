import { UtilsAi } from "./utils.js";

export type PromptTemplate =
  "PROMPT_SOLVE_DEPLOYMENT_ERROR" |
  "PROMPT_DESCRIBE_FLOW" |
  "PROMPT_DESCRIBE_FLOW_DIFF" |
  "PROMPT_DESCRIBE_OBJECT"
  ;

export function buildPromptFromTemplate(template: PromptTemplate, variables: object): string {
  // Get matching prompt
  const templateData = getPromptTemplate(template);
  // Check for missing input variables
  const missingVariables = templateData.variables.filter((variable) => !variables[variable]);
  if (missingVariables.length > 0) {
    throw new Error(`Missing variables for prompt template ${template}: ${missingVariables.join(", ")}`);
  }
  // Get prompt language and check if it is an allowed one
  const promptsLanguage = UtilsAi.getPromptsLanguage();
  // Build prompt
  let prompt: string = process.env?.[template] || templateData.text?.[promptsLanguage] || (templateData.text?.["en"] + `\nPlease answer using the language corresponding to "${promptsLanguage}"`);
  for (const variable in variables) {
    prompt = prompt.replaceAll(`{{${variable}}}`, variables[variable]);
  }
  return prompt;
}

function getPromptTemplate(template: PromptTemplate): any {
  const templateData = PROMPT_TEMPLATES[template];
  if (!templateData) {
    throw new Error(`Unknown prompt template: ${template}`);
  }
  return templateData;
}

export const PROMPT_TEMPLATES = {
  "PROMPT_SOLVE_DEPLOYMENT_ERROR": {
    variables: ["ERROR"],
    text: {
      "en": `You are a Salesforce release manager using Salesforce CLI commands to perform deployments 
How to solve the following Salesforce deployment error ?
- Please answer using sfdx source format, not metadata format.
- Please provide XML example if applicable. 
- Please skip the part of the response about how to retrieve or deploy the changes with Salesforce CLI
The error is: 
{{ERROR}}
`,

    },
  },
  "PROMPT_DESCRIBE_FLOW": {
    variables: ["FLOW_XML"],
    text: {
      "en": `You are a business analyst working on a Salesforce project.
Please describe the following flow using plain English that can be understood by a business user.
Please respond with markdown format, that can be embedded in a level 2 header (##).
Add a new line before starting a bullet list so mkdocs-material displays it correctly, including for sub-bullets.
Caution: If the XML contains secret tokens or password, please replace them with a placeholder.
The flow XML is:
{{FLOW_XML}}
`,

    }

  },
  "PROMPT_DESCRIBE_FLOW_DIFF": {
    variables: ["FLOW_XML_NEW", "FLOW_XML_PREVIOUS"],
    text: {
      "en": `You are a business analyst working on a Salesforce project.
Please describe the differences between new version of the flow and previous version of the flow, using plain English that can be understood by a business user.
Ignore tags related to location attributes (locationX and locationY) or positions: do not mention them in your response
Ignore nodes and elements that have not changed: do not mention them in your response
Ignore connector changes: do not mention them in your response
Please respond with markdown format, that can be embedded in a level 2 header (##).
Add a new line before starting a bullet list so mkdocs-material displays it correctly, including for sub-bullets and sub-sub-bullets.
If the XML contains secret tokens or password, please replace them with a placeholder.
The new version flow XML is:
{{FLOW_XML_NEW}}

The previous version flow XML is:
{{FLOW_XML_PREVIOUS}}
`,

    }
  },
  "PROMPT_DESCRIBE_OBJECT": {
    variables: ["OBJECT_NAME", "OBJECT_XML", "ALL_OBJECTS_LIST", "ALL_OBJECT_LINKS"],
    text: {
      "en": `You are a business analyst working on a Salesforce project.
Please describe Salesforce object "{{OBJECT_NAME}}", using plain English that can be understood by a business user.

To help you understand the org implementation, the complete list of objects in the Salesforce org is the following: {{ALL_OBJECTS_LIST}}

To help you understand the org Object model, so you can better explain the relationships of {{OBJECT_NAME}} in it, here is the list of MasterDetail and Lookups of all org objects:
{{ALL_OBJECT_LINKS}}

Explain object {{OBJECT_NAME}}'s place in the project, its role in the org, importance, etc.

Explain object {{OBJECT_NAME}} relationships with other objects in the org, using MasterDetail and Lookups defined on {{OBJECT_NAME}}, but also using inverse relationships having {{OBJECT_NAME}} as target object reference. Give as many details as possible about direct and inverse relationships.

If the object contains fields, display them in a markdown table format, including columns with detailed field types and detailed description. Do not truncate the table lines.
If the object contains record types, display them in a markdown table format, including columns with detailed description. Do not truncate the table lines.
If the object contains validation rules, display them in a markdown table format, including columns with detailed description. Do not truncate the table lines.
If the object contains list views, display them in a markdown table format, including columns with detailed description. Do not truncate the table lines.

The following acronyms are used in metadata names:
- TR: Trigger
- VR: Validation Rule
- WF: Workflow 

Please reply with markdown format, that can be embedded in a level 2 header (##).
Add a new line before starting a bullet list so mkdocs-material displays it correctly, including for sub-bullets.

Caution: If the XML contains secret tokens or password, please replace them with a placeholder.

The {{OBJECT_NAME}} object metadata XML is:
{{OBJECT_XML}}
`
    }

  }
}