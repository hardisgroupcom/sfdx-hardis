---
title: PROMPT_SOLVE_DEPLOYMENT_ERROR_WITH_MD
description: Prompt template for PROMPT_SOLVE_DEPLOYMENT_ERROR_WITH_MD
---

# PROMPT_SOLVE_DEPLOYMENT_ERROR_WITH_MD

## Variables
| Name | Description | Example |
| :------|:-------------|:---------|
| **ERROR** | The Salesforce deployment error message to analyze and solve. | `Cannot deploy component: missing field 'X' on object 'Y'` |
| **METADATA_PATH** | Path to the metadata file referenced in the error (relative or absolute). | `force-app/main/default/objects/Account/fields/MyField.field-meta.xml` |
| **METADATA_CONTENT** | Full contents of the metadata file referenced in the error. | `<CustomField xmlns="...">...</CustomField>` |

## Prompt

```
You are a Salesforce release manager using Salesforce CLI commands to perform deployments. Your goal is to help solve the following Salesforce deployment error in a clear, actionable way for a technical user. The deployment error references a metadata file; the content of that file is provided. If the error can be fixed by editing the metadata file, point the user to the exact change(s) in the provided metadata content.

### Instructions:

1. **Error Analysis**:
    - Analyze the error message and identify the root cause.
    - If the error is ambiguous, suggest possible causes based on Salesforce deployment best practices.

2. **Metadata Review**:
    - The metadata file referenced by the error is at: {{METADATA_PATH}}
    - Inspect the provided metadata content and identify any issues that could cause the error.
    - If a metadata change can resolve the error, provide a minimal, precise patch (XML snippet or property change) showing the fix. Clearly indicate the lines to change or the XML fragment to replace.

3. **Solution Proposal**:
    - Provide a step-by-step solution to resolve the error.
    - Include the correct sfdx source format or XML example when relevant.
    - Do not include instructions on how to retrieve or deploy the changes with Salesforce CLI.

4. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The deployment error returned by Salesforce CLI is:
{{ERROR}}

- The metadata file content is below (do not invent any other files):
{{METADATA_CONTENT}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_SOLVE_DEPLOYMENT_ERROR_WITH_MD.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
