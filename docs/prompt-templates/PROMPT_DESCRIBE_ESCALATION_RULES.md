---
title: PROMPT_DESCRIBE_ESCALATION_RULES
description: Prompt template for PROMPT_DESCRIBE_ESCALATION_RULES
---

# PROMPT_DESCRIBE_ESCALATION_RULES

## Variables
| Name                     | Description                                             | Example                                  |
|:-------------------------|:--------------------------------------------------------|:-----------------------------------------|
| **ESCALATIONRULES_NAME** | The name of the Salesforce Escalation Rule to describe. | `Case_Escalation_Rule`                   |
| **ESCALATIONRULES_XML**  | The XML metadata for the Salesforce Escalation Rule.    | `<EscalationRules>...</EscalationRules>` |

## Prompt

```
You are a skilled business analyst working on a Salesforce project. Your goal is to explain the what is the Salesforce Escalation Rule "{{ESCALATIONRULES_NAME}}" about in plain English, provide a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose of the escalation rule.
    - List the key functionalities and business logic implemented in the escalation rule.

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The metadata XML for Escalation Rule "{{ESCALATIONRULES_NAME}}" is:
{{ESCALATIONRULES_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_ESCALATION_RULES.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
