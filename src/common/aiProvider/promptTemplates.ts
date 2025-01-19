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
      "en": `You are a business analyst working on a Salesforce project. Your goal is to describe the Salesforce object "{{OBJECT_NAME}}" in plain English, providing a detailed explanation suitable for a business user.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role and purpose of the object "{{OBJECT_NAME}}" in the Salesforce org.
    - Explain its significance in the project, its purpose in the org's implementation, and any key business processes it supports.

2. **Relationships**:
    - Use the provided object model data to describe how "{{OBJECT_NAME}}" relates to other objects.
    - Include:
        - Direct relationships (MasterDetail and Lookup fields on the object).
        - Inverse relationships (other objects referencing "{{OBJECT_NAME}}").
        - Highlight any key dependencies or implications of these relationships in plain English.

3. **Detailed Metadata**:
    - If applicable, include metadata details in the following formats:
        - **Fields**: Display in a markdown table with columns:
            - Field Name
            - Type (e.g., Text, Number, Lookup)
            - Description (business explanation of the field's purpose)
            - Additional Details (e.g., required, unique, history tracking).
        - **Record Types**: Display in a markdown table with columns:
            - Record Type Name
            - Description (purpose and key distinctions).
        - **Validation Rules**: Display in a markdown table with columns:
            - Rule Name
            - Condition (logical statement triggering the rule)
            - Description (business reasoning for the rule).
        - **List Views**: Display in a markdown table with columns:
            - View Name
            - Filters (criteria applied to display the view)
            - Description (purpose of the view).
    - Ensure tables are in markdown format and fully readable (no truncated lines).

4. **Additional Guidance**:
    - Use the acronyms provided to interpret metadata names (e.g., TR: Trigger, VR: Validation Rule, WF: Workflow).
    - If the XML metadata contains sensitive information (e.g., tokens, passwords), replace them with a placeholder (e.g., \`[REDACTED]\`).

5. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (\`##\`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The list of all objects in the Salesforce org is: {{ALL_OBJECTS_LIST}}

- The object model (MasterDetail and Lookup relationships) is: {{ALL_OBJECT_LINKS}}

- The metadata XML for "{{OBJECT_NAME}}" is:
{{OBJECT_XML}}

Caution: Redact any sensitive information and replace with \`[REDACTED]\`. Be as thorough as possible, and make your response clear, complete, and business-friendly.
`
    }

  }
}