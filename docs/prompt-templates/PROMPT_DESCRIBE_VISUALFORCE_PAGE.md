---
title: PROMPT_DESCRIBE_VISUALFORCE_PAGE
description: Prompt template for PROMPT_DESCRIBE_VISUALFORCE_PAGE
---

# PROMPT_DESCRIBE_VISUALFORCE_PAGE

## Variables
| Name | Description | Example |
| :------|:-------------|:---------|
| **VF_NAME** | The name of the Visualforce page to describe. | `AccountPage` |
| **VF_CODE** | The complete Visualforce page code (.page files), stripped of extra content for AI analysis. | `<apex:page standardController='Account'>...</apex:page>` |
| **APEX_PROPERTIES** | Apex properties of controllers/extensions associated with this Visualforce page. Provide name, type, visibility, and doc comments if any. | `[{ name: 'accountList', type: 'List<Account>', visibility: 'public', docComment: 'Stores related accounts.' }]` |
| **APEX_METHODS** | Apex methods of controllers/extensions associated with this Visualforce page. Provide name, type, visibility, parameters, and doc comments if any. | `[{ name: 'saveAccount', type: 'void', visibility: 'public', parameters: 'Account acc', docComment: 'Saves an account record.' }]` |

## Prompt

```
You are a Salesforce developer specialized in Visualforce and Apex. Your task is to explain the Visualforce page "{{VF_NAME}}" in plain English for both developers and business users.

### Instructions:

1. **Contextual Overview**:
    - Summarize the purpose and functionality of the Visualforce page.
    - Explain key components like apex:pageBlock, apex:form, inputs, buttons, apex:actionSupport, and outputPanels.
    - Include how users typically interact with the page and any AJAX updates.

2. **Technical Analysis**:
    - Describe all Apex controllers and extensions used, including their main properties and methods.
    - For each property/method, provide a concise single-sentence description, focusing on its purpose or effect.
    - Highlight any dependencies on Salesforce objects, fields, custom components (<c:...>), and static resources ($Resource...).

3. **Output Format**:
    - Provide your output as a valid JSON object with these fields:
      - "overview": 2-3 sentence summary of the VF page.
      - "purpose": 1-2 sentences explaining why this page exists and what problem it solves.
      - "keyFunctions": list 3-5 main functionalities of the page.
      - "pageBlocks": list pageBlock titles and their main sections.
      - "dependencies": object with "objects", "fields", "components", and "staticResources".
      - "properties": array of Apex properties with "descriptionAI".
      - "methods": array of Apex methods with "descriptionAI".

### Reference Data:

- Visualforce Page "{{VF_NAME}}" Code:
```
{{VF_CODE}}
```

- Associated Apex Properties:
```json
{{APEX_PROPERTIES}}
```

- Associated Apex Methods:
```json
{{APEX_METHODS}}
```

Return a strict JSON object only, without extra text or explanations.
```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_VISUALFORCE_PAGE.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
