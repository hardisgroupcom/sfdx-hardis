---
title: PROMPT_DESCRIBE_AUTORESPONSE_RULES
description: Prompt template for PROMPT_DESCRIBE_AUTORESPONSE_RULES
---

# PROMPT_DESCRIBE_AUTORESPONSE_RULES

## Variables
| Name                       | Description                                                | Example                                      |
|:---------------------------|:-----------------------------------------------------------|:---------------------------------------------|
| **AUTORESPONSERULES_NAME** | The name of the Salesforce AutoResponse Rules to describe. | `Case_AutoResponse_Rules`                    |
| **AUTORESPONSERULES_XML**  | The XML metadata for the Salesforce AutoResponse Rules.    | `<AutoResponseRules>...</AutoResponseRules>` |

## Prompt

```
You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce AutoResponse Rules "{{AUTORESPONSERULES_NAME}}" in plain English, providing a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by explaining the role of the Salesforce AutoResponse Rules that you can guess according to the content of the XML and the name.
    Try to guess the role of users assigned to this AutoResponse rule. Do not mention the email of assigned users, but you can mention type of assigned users.
    - Analyze all the AutoResponse rules for objects and in the description tell what are the aim of those rules. What is the role of the object in the system, based by the AutoResponse rules.
    - Based by Criteria items, explain what would be the response to the user, if the criteria are met.

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The metadata XML for Salesforce AutoResponse Rule "{{AUTORESPONSERULES_NAME}}" is:
{{AUTORESPONSERULES_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_AUTORESPONSE_RULES.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
