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
    "en": `You are a Salesforce release manager using Salesforce CLI commands to perform deployments
How to solve the following Salesforce deployment error ?
- Please answer using sfdx source format, not metadata format.
- Please provide XML example if applicable.
- Please skip the part of the response about how to retrieve or deploy the changes with Salesforce CLI
The error is:
{{ERROR}}
`,
  },
};

export default template;
