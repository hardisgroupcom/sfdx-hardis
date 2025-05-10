import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "ERROR",
      description: "The Salesforce deployment error message to analyze and solve.",
      example: "Cannot deploy component: missing field 'X' on object 'Y'"
    }
  ],
  text: {
    "en": `You are a Salesforce release manager using Salesforce CLI commands to perform deployments. Your goal is to help solve the following Salesforce deployment error in a clear, actionable way for a technical user.

### Instructions:

1. **Error Analysis**:
    - Analyze the error message and identify the root cause.
    - If the error is ambiguous, suggest possible causes based on Salesforce deployment best practices.

2. **Solution Proposal**:
    - Provide a step-by-step solution to resolve the error.
    - If applicable, include the correct sfdx source format or XML example.
    - Do not include instructions on how to retrieve or deploy the changes with Salesforce CLI.

3. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (##).
    - Add new lines before starting bullet lists so mkdocs-material displays them correctly, including for sub-bullets.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The error is:
{{ERROR}}

Caution: If the error message contains secret tokens or passwords, please replace them with a placeholder (e.g., [REDACTED]). Be as thorough as possible, and make your response clear, complete, and actionable.
`,
  },
};

export default template;
