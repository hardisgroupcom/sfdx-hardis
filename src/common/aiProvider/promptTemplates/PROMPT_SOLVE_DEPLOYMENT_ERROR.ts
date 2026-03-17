import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "ERROR",
      description: "The Salesforce deployment error message to analyze and solve.",
      example: "Cannot deploy component: missing field 'X' on object 'Y'"
    }
  ], text: {
    "en": `You are a Salesforce release manager using Salesforce CLI commands to perform deployments. Your goal is to help solve the following Salesforce deployment error in a clear, actionable way for a technical user. 

### Instructions:

1. **Error Analysis**:
    - Analyze the error message and identify the root cause.
    - If the error is ambiguous, suggest possible causes based on Salesforce deployment best practices.

2. **Solution Proposal**:
    - Provide a step-by-step solution to resolve the error.
    - If applicable, include the correct sfdx source format or XML example.
    - Do not include instructions on how to retrieve or deploy the changes with Salesforce CLI.

3. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The deployment error returned by Salesforce CLI is:
{{ERROR}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
