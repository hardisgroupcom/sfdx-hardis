---
title: PROMPT_DESCRIBE_WORKFLOW_RULE
description: Prompt template for PROMPT_DESCRIBE_WORKFLOW_RULE
---

# PROMPT_DESCRIBE_WORKFLOW_RULE

## Variables
| Name                  | Description                                           | Example                            |
|:----------------------|:------------------------------------------------------|:-----------------------------------|
| **WORKFLOWRULE_NAME** | The name of the Salesforce Workflow Rule to describe. | `Account.HighValue_Alert`          |
| **WORKFLOWRULE_XML**  | The XML metadata for the Salesforce Workflow Rule.    | `<workflowRule>...</workflowRule>` |

## Prompt

```
You are a skilled business analyst working on a Salesforce project. Your goal is to explain what the Salesforce Workflow Rule "{{WORKFLOWRULE_NAME}}" does in plain English, providing a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Summarize the business purpose of this workflow rule.
    - Explain the main criteria that trigger the rule and the actions it performs.

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The metadata XML for Workflow Rule "{{WORKFLOWRULE_NAME}}" is:
{{WORKFLOWRULE_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_WORKFLOW_RULE.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
