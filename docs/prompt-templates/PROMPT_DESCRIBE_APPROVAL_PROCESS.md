---
title: PROMPT_DESCRIBE_APPROVAL_PROCESS
description: Prompt template for PROMPT_DESCRIBE_APPROVAL_PROCESS
---

# PROMPT_DESCRIBE_APPROVAL_PROCESS

## Variables
| Name                     | Description                                              | Example                                  |
|:-------------------------|:---------------------------------------------------------|:-----------------------------------------|
| **APPROVALPROCESS_NAME** | The name of the Salesforce Approval Process to describe. | `Opportunity_Approval`                   |
| **APPROVALPROCESS_XML**  | The XML metadata for the Salesforce Approval Process.    | `<ApprovalProcess>...</ApprovalProcess>` |

## Prompt

```
You are a skilled business analyst working on a Salesforce project. Your goal is to explain the what is the Salesforce Approval Process "{{APPROVALPROCESS_NAME}}" about in plain English, provide a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose of the approval process.
    - List the key functionalities and business logic implemented in the approval process.

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The metadata XML for Approval Process "{{APPROVALPROCESS_NAME}}" is:
{{APPROVALPROCESS_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_APPROVAL_PROCESS.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
