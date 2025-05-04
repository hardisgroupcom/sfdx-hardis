import { UtilsAi } from "./utils.js";

export type PromptTemplate =
  "PROMPT_SOLVE_DEPLOYMENT_ERROR" |
  "PROMPT_DESCRIBE_FLOW" |
  "PROMPT_DESCRIBE_FLOW_DIFF" |
  "PROMPT_DESCRIBE_OBJECT" |
  "PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD" |
  "PROMPT_DESCRIBE_APEX" |
  "PROMPT_DESCRIBE_PAGE" |
  "PROMPT_DESCRIBE_PROFILE" |
  "PROMPT_DESCRIBE_PERMISSION_SET" |
  "PROMPT_DESCRIBE_PERMISSION_SET_GROUP" |
  "PROMPT_DESCRIBE_APPROVAL_PROCESS" |
  "PROMPT_DESCRIBE_LWC"
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

3. **Additional Guidance**:
    - **Do NOT include** fields table or validation rules table in the response
    - Use the acronyms provided to interpret metadata names (e.g., TR: Trigger, VR: Validation Rule, WF: Workflow).
    - If the XML metadata contains sensitive information (e.g., tokens, passwords), replace them with a placeholder (e.g., \`[REDACTED]\`).

4. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (\`##\`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The list of all objects in the Salesforce org is: {{ALL_OBJECTS_LIST}}

- The object model (MasterDetail and Lookup relationships) is: {{ALL_OBJECT_LINKS}}

- The metadata XML for "{{OBJECT_NAME}}" is:
{{OBJECT_XML}}

Caution: Redact any sensitive information and replace with \`[REDACTED]\`. Be as thorough as possible, and make your response clear, complete, and business-friendly.
`
    }
  },
  "PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD": {
    variables: ["OBJECT_NAME", "MARKDOWN"],
    text: {
      "en": `You are a skilled Business Analyst working on a Salesforce project. Your task is to review and refine the fields and validation rules of the Salesforce object "{{OBJECT_NAME}}" and describe them in plain English. The goal is to create a detailed, user-friendly explanation of each field and validation rule that a non-technical business user can easily understand.

## Instructions:
1. **Enhancing Fields Descriptions**:
   - If an field's description is missing, generate a meaningful description using the context provided by the other column values (e.g., name, data type, or usage).
   - If a field description already exists, improve its clarity and comprehensiveness by incorporating insights from the other column values.
   - If an attribute's label is missing, generate a meaningful label using the context provided by the other column values.

2. **Enhancing Validation Rules Descriptions**:
   - If an field's description is missing, generate a meaningful description using the context provided by the other column values (especially formula column).
   - If a validation rule description already exists, improve its clarity and comprehensiveness by incorporating insights from the other column values (especially formula column).
   - If an validation rule label is missing, generate a meaningful label using the context provided by the other column values.

3. **Output Format**:
   - Return the updated descriptions in the **Markdown tables** format provided below.
   - Ensure the tables aligns with Markdown syntax conventions for proper rendering.

4. **Tone and Style**:
   - Use plain English suitable for business users with minimal technical jargon.
   - Focus on clarity, completeness, and practical usage examples if applicable.

5. **Output Requirements**:
   - Respond **only in Markdown** format.
   - Do not include any additional text or commentary outside of the Markdown.

## Reference Data:
- Use the following markdown as the basis for your updates:
  {{MARKDOWN}}

## Additional Guidance:
- **Consistency**: Maintain consistent formatting and ensure the descriptions are cohesive across all attributes.
- **Use Examples**: When applicable, include simple examples to illustrate the attribute's purpose or use case.
 `
    }
  },
  "PROMPT_DESCRIBE_APEX": {
    variables: ["CLASS_NAME", "APEX_CODE"],
    text: {
      "en": `You are a developer working on a Salesforce project. Your goal is to summarize the behavior of the Salesforce Apex class "{{CLASS_NAME}}" in plain English, providing a detailed explanation suitable for a business user.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the apex class.
    - List the key functionalities and business logic implemented in the class.

2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (\`##\`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The code for Apex class "{{CLASS_NAME}}" is:
{{APEX_CODE}}

Caution: Redact any sensitive information and replace with \`[REDACTED]\`. Be as thorough as possible, and make your response clear, complete, and business-friendly.
`
    },
  },
  "PROMPT_DESCRIBE_PAGE": {
    variables: ["PAGE_NAME", "PAGE_XML"],
    text: {
      "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce Lightning Page "{{PAGE_NAME}}" in plain English, providing a detailed explanation suitable for a business user.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the lightning page.
    - List the key tabs, sections, views, related lists and actions described in the lightning page.

2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (\`##\`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The metadata XML for Lightning page "{{PAGE_NAME}}" is:
{{PAGE_XML}}

Caution: Redact any sensitive information and replace with \`[REDACTED]\`. Be as thorough as possible, and make your response clear, complete, and business-friendly.
`
    }
  },
  "PROMPT_DESCRIBE_PROFILE": {
    variables: ["PROFILE_NAME", "PROFILE_XML"],
    text: {
      "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce Profile "{{PROFILE_NAME}}" in plain English, providing a detailed explanation suitable for a business user.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the Salesforce Profile that you can guess according to the content of the XML. Try to guess the role of users assigned to this profile according to applicationVisibilities, objectVisibilities and userPermissions.
    - List the key features of the Profiles.
      - The most important features are License, Applications, User Permissions ,features with default values ,Custom Objects and Record Types
      - Ignore Apex classes and Custom Fields
      - Ignore blocks who has access or visibility set to "false"

2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (\`##\`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The metadata XML for Salesforce Profile "{{PROFILE_NAME}}" is:
{{PROFILE_XML}}

Caution: Redact any sensitive information and replace with \`[REDACTED]\`. Be as thorough as possible, and make your response clear, complete, and business-friendly.
`
    }
  },
  "PROMPT_DESCRIBE_PERMISSION_SET": {
    variables: ["PERMISSIONSET_NAME", "PERMISSIONSET_XML"],
    text: {
      "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce PermissionSet "{{PERMISSIONSET_NAME}}" in plain English, providing a detailed explanation suitable for a business user.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the Salesforce PermissionSet that you can guess according to the content of the XML. Try to guess the role of users assigned to this permission set according to applicationVisibilities, objectVisibilities and userPermissions.
    - List the key features of the Permission Set.
      - The most important features are License, Applications, User Permissions ,features with default values ,Custom Objects and Record Types
      - Ignore Apex classes and Custom Fields
      - Ignore blocks who has access or visibility set to "false"

2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (\`##\`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The metadata XML for Salesforce Permission Set "{{PERMISSIONSET_NAME}}" is:
{{PERMISSIONSET_XML}}

Caution: Redact any sensitive information and replace with \`[REDACTED]\`. Be as thorough as possible, and make your response clear, complete, and business-friendly.
`
    }
  },
  "PROMPT_DESCRIBE_PERMISSION_SET_GROUP": {
    variables: ["PERMISSIONSETGROUP_NAME", "PERMISSIONSETGROUP_XML"],
    text: {
      "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce PermissionSetGroup "{{PERMISSIONSETGROUP_NAME}}" in plain English, providing a detailed explanation suitable for a business user.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the Salesforce PermissionSetGroup that you can guess according to the content of the XML. Try to guess the role of users assigned to this permission set group according to the name, description and related Permission Sets
    - List the key features of the Permission Set.

2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (\`##\`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The metadata XML for Salesforce Permission Set Group "{{PERMISSIONSETGROUP_NAME}}" is:
{{PERMISSIONSETGROUP_XML}}

Caution: Redact any sensitive information and replace with \`[REDACTED]\`. Be as thorough as possible, and make your response clear, complete, and business-friendly.
`
    }
  },
  "PROMPT_DESCRIBE_APPROVAL_PROCESS": {
    variables: ["APPROVALPROCESS_NAME", "APPROVALPROCESS_XML"],
    text: {
      "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to explain the what is the Salesforce Approval Process "{{APPROVALPROCESS_NAME}}" about in plain English, provide a detailed explanation suitable for a business user.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose of the approval process.
    - List the key functionalities and business logic implemented in the approval process.

2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (\`##\`).
    - Add a new empty line before each bulleted list so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The metadata XML for Approval Process "{{APPROVALPROCESS_NAME}}" is:
{{APPROVALPROCESS_XML}}

Caution: Redact any sensitive information and replace with \`[REDACTED]\`. Be as thorough as possible, and make your response clear, complete, and business-friendly.
`
    },
  },
  "PROMPT_DESCRIBE_LWC": {
    variables: ["LWC_NAME", "LWC_CODE"],
    text: {
      "en": `You are a skilled Salesforce developer working on a Lightning Web Components (LWC) project. Your goal is to explain the Salesforce Lightning Web Component "{{LWC_NAME}}" in plain English, providing a detailed explanation suitable for other developers and business users.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose and functionality of the Lightning Web Component.
    - Describe the key features and capabilities it provides to users.
    - Explain how it interacts with Salesforce data or other components.

2. **Technical Analysis**:
    - Describe the main JavaScript methods and their purposes.
    - Explain how the component handles data binding and events.
    - Mention any wire services, apex methods, or external services the component uses.
    - Identify any custom properties, CSS customizations, or special configurations.

3. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (\`##\`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The code for Lightning Web Component "{{LWC_NAME}}" is:
\`\`\`
{{LWC_CODE}}
\`\`\`

Caution: Redact any sensitive information and replace with \`[REDACTED]\`. Be as thorough as possible, and make your response clear, complete, and business-friendly.
`
    },
  },
}
