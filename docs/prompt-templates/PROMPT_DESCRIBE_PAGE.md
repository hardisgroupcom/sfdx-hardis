---
title: PROMPT_DESCRIBE_PAGE
description: Prompt template for PROMPT_DESCRIBE_PAGE
---

# PROMPT_DESCRIBE_PAGE

## Variables

| Name          | Description                                            | Example                      |
|:--------------|:-------------------------------------------------------|:-----------------------------|
| **PAGE_NAME** | The name of the Salesforce Lightning Page to describe. | `Account_Record_Page`        |
| **PAGE_XML**  | The XML metadata for the Lightning Page.               | `<FlexiPage>...</FlexiPage>` |

## Prompt

```
You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce Lightning Page "{{PAGE_NAME}}" in plain English, providing a detailed explanation suitable for a business user.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the lightning page.
    - List the key tabs, sections, views, related lists and actions described in the lightning page.

2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (`##`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The metadata XML for Lightning page "{{PAGE_NAME}}" is:
{{PAGE_XML}}

Caution: Redact any sensitive information and replace with `[REDACTED]`. Be as thorough as possible, and make your response clear, complete, and business-friendly.

```

## How to override

To define your own prompt text, you can define a local file **prompt-templates/PROMPT_DESCRIBE_PAGE.txt**

If you do so, please don't forget to use the replacement variables :)
