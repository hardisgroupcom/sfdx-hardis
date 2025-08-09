---
title: PROMPT_DESCRIBE_FLOW
description: Prompt template for PROMPT_DESCRIBE_FLOW
---

# PROMPT_DESCRIBE_FLOW

## Variables
| Name         | Description                                            | Example            |
|:-------------|:-------------------------------------------------------|:-------------------|
| **FLOW_XML** | The XML definition of the Salesforce Flow to describe. | `<Flow>...</Flow>` |

## Prompt

```
You are a business analyst working on a Salesforce project. Your goal is to describe the Salesforce Flow in plain English, providing a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose and business context of the flow.
    - Explain what business process or automation this flow supports.

2. **Step-by-Step Description**:
    - Describe the main steps, decisions, and actions in the flow.
    - Use plain English and avoid technical jargon when possible.
    - If there are sub-flows or important conditions, mention them clearly.

3. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The flow XML is:
{{FLOW_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_FLOW.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
