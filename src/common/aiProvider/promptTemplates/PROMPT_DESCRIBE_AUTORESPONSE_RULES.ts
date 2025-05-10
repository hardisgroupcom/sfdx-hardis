import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: ["AUTORESPONSERULES_NAME", "AUTORESPONSERULES_XML"],
  text: {
    "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce AutoResponse Rules "{{AUTORESPONSERULES_NAME}}" in plain English, providing a detailed explanation suitable for a business user.
### Instructions:
1. **Contextual Overview**:
    - Begin by explaining the role of the Salesforce AutoResponse Rules that you can guess according to the content of the XML and the name.
    Try to guess the role of users assigned to this AutoResponse rule. Do not mention the email of assigned users, but you can mention type of assigned users.
    - Analyze all the AutoResponse rules for objects and in the description tell what are the aim of those rules. What is the role of the object in the system, based by the AutoResponse rules.
    - Based by Criteria items, explain what would be the response to the user, if the criteria are met.
2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (\`##\`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.
### Reference Data:
- The metadata XML for Salesforce AutoResponse Rule "{{AUTORESPONSERULES_NAME}}" is:
{{AUTORESPONSERULES_XML}}
Caution: Redact any sensitive information and replace with \`[REDACTED]\`. Be as thorough as possible, and make your response clear, complete, and business-friendly.
`,
  },
};

export default template;
