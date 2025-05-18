---
title: PROMPT_DESCRIBE_ESCALATION_RULES
description: Prompt template for PROMPT_DESCRIBE_ESCALATION_RULES
---

# PROMPT_DESCRIBE_ESCALATION_RULES

## Variables
| Name | Description | Example |
| :------|:-------------|:---------|
| **ESCALATIONRULES_NAME** | The name of the Salesforce Escalation Rule to describe. | `Case_Escalation_Rule` |
| **ESCALATIONRULES_XML** | The XML metadata for the Salesforce Escalation Rule. | `<EscalationRules>...</EscalationRules>` |

## Prompt

```
You are a skilled business analyst working on a Salesforce project. Your goal is to explain the what is the Salesforce Escalation Rule "{{ESCALATIONRULES_NAME}}" about in plain English, provide a detailed explanation suitable for a business user.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose of the escalation rule.
    - List the key functionalities and business logic implemented in the escalation rule.

2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (`##`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The metadata XML for Escalation Rule "{{ESCALATIONRULES_NAME}}" is:
{{ESCALATIONRULES_XML}}

Caution: Redact any sensitive information and replace with `[REDACTED]`. Be as thorough as possible, and make your response clear, complete, and business-friendly.

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_ESCALATION_RULES.txt**

If you do so, please don't forget to use the replacement variables :)
