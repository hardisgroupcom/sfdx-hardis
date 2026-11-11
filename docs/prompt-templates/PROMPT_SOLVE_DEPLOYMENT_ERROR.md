---
title: PROMPT_SOLVE_DEPLOYMENT_ERROR
description: Prompt template for PROMPT_SOLVE_DEPLOYMENT_ERROR
---

# PROMPT_SOLVE_DEPLOYMENT_ERROR

## Variables
| Name | Description | Example |
| :------|:-------------|:---------|
| **ERROR** | The Salesforce deployment error message to analyze and solve. | `Cannot deploy component: missing field 'X' on object 'Y'` |
| **DEPLOYMENT_ACTION_HINTS** | What sfdx-hardis deployment actions can do that a metadata deployment cannot (Setup settings applied in a browser...), or None. | `A sfdx-hardis deployment action of type "browser" applies Salesforce Setup settings that the Metadata API cannot deploy. Its settings:`<br>`  - recordTypes: RecordTypes - Deletes inactive record types` |

## Prompt

```
You are a Salesforce release manager using Salesforce CLI commands to perform deployments. Your goal is to help solve the following Salesforce deployment error in a clear, actionable way for a technical user. 

### Instructions:

1. **Error Analysis**:
    - Analyze the error message and identify the root cause.
    - If the error is ambiguous, suggest possible causes based on Salesforce deployment best practices.

2. **Solution Proposal**:
    - Provide a step-by-step solution to resolve the error.
    - If applicable, include the correct sfdx source format or XML example.
    - Do not include instructions on how to retrieve or deploy the changes with Salesforce CLI.
    - When the error comes from a setting that one of the deployment actions below can apply, suggest that deployment action, with its command.

3. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The deployment error returned by Salesforce CLI is:
{{ERROR}}

- The sfdx-hardis deployment actions that can solve what a metadata deployment cannot:
{{DEPLOYMENT_ACTION_HINTS}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_SOLVE_DEPLOYMENT_ERROR.md**

> For backward compatibility, **config/prompt-templates/PROMPT_SOLVE_DEPLOYMENT_ERROR.txt** is also supported, but **.md is preferred**.

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
