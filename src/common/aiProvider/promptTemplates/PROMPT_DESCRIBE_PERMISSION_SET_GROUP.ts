import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
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
`,
  },
};

export default template;
