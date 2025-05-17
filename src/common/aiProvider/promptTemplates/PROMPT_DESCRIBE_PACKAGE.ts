import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "PACKAGE_NAME",
      description: "The name of the package to describe.",
      example: "Pardot"
    },
    {
      name: "PACKAGE_XML",
      description: "The JsonL metadata for the package",
      example: "{\"SubscriberPackageName\":\"Pardot\",\"SubscriberPackageNamespace\":\"pi\",\"SubscriberPackageVersionNumber\":\"1.0.0\",\"SubscriberPackageVersionId\":\"04t1t0000000abcAAA\",\"SubscriberPackageVersionName\":\"Pardot Version 1.0\"}"
    }
  ],
  text: {
    "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce Installed package "{{PACKAGE_NAME}}" in plain English, providing a detailed explanation suitable for a business user.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the package.
    - Continue by decribing the package main features and functionalities.
    - If you can find links to documentation on internet, include them.

2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (\`##\`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The attributes for Installed pakage "{{PACKAGE_NAME}}" is:
{{PACKAGE_XML}}

Caution: Redact any sensitive information and replace with \`[REDACTED]\`. Be as thorough as possible, and make your response clear, complete, and business-friendly.
`,
  },
};

export default template;
