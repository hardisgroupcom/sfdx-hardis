---
title: PROMPT_DESCRIBE_VISUALFORCE_PAGE
description: Prompt template for PROMPT_DESCRIBE_VISUALFORCE_PAGE
---

# PROMPT_DESCRIBE_VISUALFORCE_PAGE

## Variables

| Name                             | Description                                                                | Example                                              |
|:---------------------------------|:---------------------------------------------------------------------------|:-----------------------------------------------------|
| **VISUALFORCE_NAME**             | The name of the Visualforce page to describe.                              | `AccountSummaryPage`                                 |
| **VISUALFORCE_MARKUP**           | The Visualforce markup of the page.                                        | `<apex:page standardController="Account">...`        |
| **VISUALFORCE_META**             | The metadata file of the Visualforce page.                                 | `<ApexPage>...</ApexPage>`                           |
| **VISUALFORCE_APEX_CONTROLLERS** | The names of the Apex controller and extensions declared by the page.      | `AccountSummaryController, AccountSummaryExtension`  |

## Prompt

```
You are a skilled Salesforce developer working on a Visualforce project. Your goal is to explain the Salesforce Visualforce page "{{VISUALFORCE_NAME}}" in plain English, providing a detailed explanation suitable for other developers and business users. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose of the Visualforce page and the business need it answers.
    - Describe what a user sees and can do on the page.
    - Explain which Salesforce records or objects the page reads and writes.

2. **Technical Analysis**:
    - Describe the page structure: forms, blocks, tables, tabs, and the data bindings they use.
    - Explain the actions available on the page (buttons, links, action functions) and what each of them triggers.
    - Mention the custom components, static resources, JavaScript and stylesheets the page relies on.
    - Point out the page attributes that matter, for example the standard controller, the Apex controller and extensions, the rendering mode, or the availability on mobile.

Important: only the markup and the metadata of the page are provided. The source of the Apex controller and extensions is NOT provided: name them and describe the role you can infer from how the page calls them, but do not speculate about their internal implementation.

{{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The Apex controller and extensions declared by page "{{VISUALFORCE_NAME}}": {{VISUALFORCE_APEX_CONTROLLERS}}

- The Visualforce markup of page "{{VISUALFORCE_NAME}}":
```
{{VISUALFORCE_MARKUP}}
```

- The metadata of page "{{VISUALFORCE_NAME}}":
```
{{VISUALFORCE_META}}
```

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_VISUALFORCE_PAGE.md**

> For backward compatibility, **config/prompt-templates/PROMPT_DESCRIBE_VISUALFORCE_PAGE.txt** is also supported, but **.md is preferred**.

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
