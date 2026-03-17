---
title: PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD
description: Prompt template for PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD
---

# PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD

## Variables
| Name            | Description                                                                                  | Example                                                                                    |
|:----------------|:---------------------------------------------------------------------------------------------|:-------------------------------------------------------------------------------------------|
| **OBJECT_NAME** | The API name of the Salesforce object whose fields and validation rules are being described. | `Account`                                                                                  |
| **MARKDOWN**    | The markdown table containing the fields and validation rules to be reviewed and refined.    | `\| Field \| Label \| Description \| ... \|<br>\|-------\|-------\|-------------\| ... \|` |

## Prompt

```
You are a skilled Business Analyst working on a Salesforce project. Your task is to review and refine the fields and validation rules of the Salesforce object "{{OBJECT_NAME}}" and describe them in plain English. The goal is to create a detailed, user-friendly explanation of each field and validation rule that a non-technical business user can easily understand.  {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

## Instructions:
1. **Enhancing Fields Descriptions**:
   - If an field's description is missing, generate a meaningful description using the context provided by the other column values (e.g., name, data type, or usage).
   - If a field description already exists, improve its clarity and comprehensiveness by incorporating insights from the other column values.
   - If an attribute's label is missing, generate a meaningful label using the context provided by the other column values.

2. **Enhancing Validation Rules Descriptions**:
   - If an field's description is missing, generate a meaningful description using the context provided by the other column values (especially formula column).
   - If a validation rule description already exists, improve its clarity and comprehensiveness by incorporating insights from the other column values (especially formula column).
   - If an validation rule label is missing, generate a meaningful label using the context provided by the other column values.

3. **Output Format**:
   - Return the updated descriptions in the **Markdown tables** format provided below.
   - Ensure the tables aligns with Markdown syntax conventions for proper rendering.

4. **Tone and Style**:
   - Use plain English suitable for business users with minimal technical jargon.
   - Focus on clarity, completeness, and practical usage examples if applicable.

5. **Output Requirements**:
   - Respond **only in Markdown** format.
   - Do not include any additional text or commentary outside of the Markdown.

## Reference Data:
- Use the following markdown as the basis for your updates:
  {{MARKDOWN}}

## Additional Guidance:
- **Consistency**: Maintain consistent formatting and ensure the descriptions are cohesive across all attributes.
- **Use Examples**: When applicable, include simple examples to illustrate the attribute's purpose or use case.
 
```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
