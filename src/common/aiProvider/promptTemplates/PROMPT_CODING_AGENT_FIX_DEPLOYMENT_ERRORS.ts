import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "ERRORS",
      description: "The deployment errors with tips, formatted as a structured list.",
      example: "### Error: Field 'MyField__c' not found on object 'Account'\nTip: Check if the field exists in the target org or in local metadata files.",
      truncateAfter: 10000,
    },
    {
      name: "FAILED_TESTS",
      description: "The failed Apex test classes with error details.",
      example: "### Test: MyTestClass.testMethod\nError: System.AssertException: Assertion Failed\nStack: Class.MyTestClass.testMethod: line 42",
      truncateAfter: 10000,
    },
    {
      name: "TARGET_ORG",
      description: "The target org username or alias that can be used for querying metadata and data.",
      example: "myorg@example.com",
    },
  ],
  text: {
    "en": `You are a Salesforce developer assistant. Your task is to fix deployment errors by modifying local metadata files.

## IMPORTANT RULES

- You MUST NOT deploy anything to Salesforce. Never run 'sf project deploy', 'sf project deploy start', 'sf project deploy validate', or any deployment command.
- You MUST NOT push source to any org. Never run 'sf project deploy start --source-dir' or similar.
- You CAN query metadata and data from the target org using 'sf' CLI commands for read-only operations:
  - \`sf data query --query "SELECT ..." --target-org {{TARGET_ORG}}\` to query data
  - \`sf org list metadata --target-org {{TARGET_ORG}}\` and \`sf org list metadata-types --target-org {{TARGET_ORG}}\` to list metadata
  - \`sf project retrieve start\` to retrieve metadata from the org for comparison
- You CAN read and modify local metadata files in the force-app/ or src/ directories
- Focus on fixing the root cause in the local metadata files
- If a fix requires removing a reference to something that does not exist in the target org, remove it from the local file
- If a fix requires adding a missing dependency, add it to the local metadata files

## DEPLOYMENT ERRORS TO FIX

{{ERRORS}}

## FAILED TEST CLASSES TO FIX

{{FAILED_TESTS}}

## INSTRUCTIONS

1. Analyze the errors above carefully
2. Look in the local metadata files (force-app/, src/, or similar directories) for the files causing the errors
3. If needed, query the target org ({{TARGET_ORG}}) to understand the current state of metadata
4. Fix the errors by modifying the appropriate local metadata files
5. After fixing all errors, output a summary of all changes you made in the following format:

--- FIXES SUMMARY ---
For each fix, write:
FILE: <path to modified file>
ERROR: <the error that was fixed>
FIX: <description of what was changed>
---

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
