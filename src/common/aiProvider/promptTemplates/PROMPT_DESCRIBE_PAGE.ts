import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "PAGE_NAME",
      description: "The name of the Salesforce Lightning Page to describe.",
      example: "Account_Record_Page"
    },
    {
      name: "PAGE_XML",
      description: "The XML metadata for the Lightning Page.",
      example: "<FlexiPage>...</FlexiPage>"
    }
  ],
  text: {
    "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce Lightning Page "{{PAGE_NAME}}" in plain English, providing a detailed explanation suitable for a business user.  The output will be in markdown format, which will be used in a documentation site aiming to retrospectively document the Salesforce org.

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
`,
  },
};

export default template;
