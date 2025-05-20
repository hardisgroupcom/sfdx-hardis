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
You are a business analyst working on a Salesforce project. Your goal is to describe the Salesforce Flow in plain English, providing a detailed explanation suitable for a business user.  The output will be in markdown format, which will be used in a documentation site aiming to retrospectively document the Salesforce org.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose and business context of the flow.
    - Explain what business process or automation this flow supports.

2. **Step-by-Step Description**:
    - Describe the main steps, decisions, and actions in the flow.
    - Use plain English and avoid technical jargon when possible.
    - If there are sub-flows or important conditions, mention them clearly.

3. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (##).
    - Add a new line before starting a bullet list so mkdocs-material displays it correctly, including for sub-bullets.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The flow XML is:
{{FLOW_XML}}

Caution: If the XML contains secret tokens or passwords, please replace them with a placeholder (e.g., [REDACTED]). Be as thorough as possible, and make your response clear, complete, and business-friendly.

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_FLOW.txt**

If you do so, please don't forget to use the replacement variables :)
