---
title: PROMPT_SOLVE_DEPLOYMENT_ERROR
description: Prompt template for PROMPT_SOLVE_DEPLOYMENT_ERROR
---

# PROMPT_SOLVE_DEPLOYMENT_ERROR

## Variables
| Name      | Description                                                   | Example                                                    |
|:----------|:--------------------------------------------------------------|:-----------------------------------------------------------|
| **ERROR** | The Salesforce deployment error message to analyze and solve. | `Cannot deploy component: missing field 'X' on object 'Y'` |

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

3. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The deployment error returned by Salesforce CLI is:
{{ERROR}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_SOLVE_DEPLOYMENT_ERROR.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
