import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "APPROVALPROCESS_NAME",
      description: "The name of the Salesforce Approval Process to describe.",
      example: "Opportunity_Approval"
    },
    {
      name: "APPROVALPROCESS_XML",
      description: "The XML metadata for the Salesforce Approval Process.",
      example: "<ApprovalProcess>...</ApprovalProcess>"
    }
  ],
  text: {
    "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to explain the what is the Salesforce Approval Process "{{APPROVALPROCESS_NAME}}" about in plain English, provide a detailed explanation suitable for a business user.  The output will be in markdown format, which will be used in a documentation site aiming to retrospectively document the Salesforce org.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose of the approval process.
    - List the key functionalities and business logic implemented in the approval process.

2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (\`##\`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The metadata XML for Approval Process "{{APPROVALPROCESS_NAME}}" is:
{{APPROVALPROCESS_XML}}

Caution: Redact any sensitive information and replace with \`[REDACTED]\`. Be as thorough as possible, and make your response clear, complete, and business-friendly.
`,
  },
};

export default template;
