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
You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce Lightning Page "{{PAGE_NAME}}" in plain English, providing a detailed explanation suitable for a business user.  {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the lightning page.
    - List the key tabs, sections, views, related lists and actions described in the lightning page.

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The metadata XML for Lightning page "{{PAGE_NAME}}" is:
{{PAGE_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_PAGE.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
