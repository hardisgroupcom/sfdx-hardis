---
title: PROMPT_DESCRIBE_AURA_BUNDLE
description: Prompt template for PROMPT_DESCRIBE_AURA_BUNDLE
---

# PROMPT_DESCRIBE_AURA_BUNDLE

## Variables
| Name                      | Description                                                                                                     | Example                                                                 |
|:--------------------------|:----------------------------------------------------------------------------------------------------------------|:------------------------------------------------------------------------|
| **AURA_NAME**             | The name of the Aura bundle to describe.                                                                        | `accountSummary`                                                        |
| **AURA_TYPE**             | The kind of Aura metadata: Component, Application, Event, Interface or Tokens.                                  | `Component`                                                             |
| **AURA_SOURCES**          | The concatenated source files of the Aura bundle (markup, controller, helper, renderer, design, documentation). | `// File: accountSummary.cmp`<br>`<aura:component>...</aura:component>` |
| **AURA_META**             | The metadata file of the Aura bundle.                                                                           | `<AuraDefinitionBundle>...</AuraDefinitionBundle>`                      |
| **AURA_APEX_CONTROLLERS** | The names of the Apex controllers called by the bundle, or "none".                                              | `AccountSummaryController`                                              |

## Prompt

```
You are a skilled Salesforce developer working on an Aura Components project. Your goal is to explain the Salesforce Aura {{AURA_TYPE}} "{{AURA_NAME}}" in plain English, providing a detailed explanation suitable for other developers and business users. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose of the bundle and the business need it answers.
    - Describe what a user sees and can do with it.
    - Explain which Salesforce records or objects it reads and writes.

2. **Interface**:
    - List the attributes declared by the bundle (`aura:attribute`), and for each of them its type, whether it is required, its default value and what the bundle does with it.
    - List the events it registers and the events it handles, and say what each of them means.
    - Mention the interfaces it implements and the component it extends, and what they make possible (for example being usable as a tab, a record page component or a quick action).

3. **Technical Analysis**:
    - Describe the main functions of the controller, the helper and the renderer, and their purpose.
    - Explain how the bundle loads and saves data, and how it reports errors to the user.
    - Mention the Apex methods, other Aura components, Lightning Web Components, static resources and external libraries it relies on.

Important: only the sources of the bundle and its metadata are provided. The source of the Apex controllers is NOT provided: name them and describe the role you can infer from how the bundle calls them, but do not speculate about their internal implementation.

{{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The Apex controllers called by "{{AURA_NAME}}": {{AURA_APEX_CONTROLLERS}}

- The source files of "{{AURA_NAME}}":
```
{{AURA_SOURCES}}
```

- The metadata of "{{AURA_NAME}}":
```
{{AURA_META}}
```

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_AURA_BUNDLE.md**

> For backward compatibility, **config/prompt-templates/PROMPT_DESCRIBE_AURA_BUNDLE.txt** is also supported, but **.md is preferred**.

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
