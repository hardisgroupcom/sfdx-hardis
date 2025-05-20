import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "CLASS_NAME",
      description: "The name of the Salesforce Apex class to describe.",
      example: "MyCustomController"
    },
    {
      name: "APEX_CODE",
      description: "The full source code of the Apex class.",
      example: "public class MyCustomController { ... }"
    }
  ],
  text: {
    "en": `You are a developer working on a Salesforce project. Your goal is to summarize the behavior of the Salesforce Apex class "{{CLASS_NAME}}" in plain English, providing a detailed explanation suitable for a business user.  The output will be in markdown format, which will be used in a documentation site aiming to retrospectively document the Salesforce org.

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
`,
  },
};

export default template;
