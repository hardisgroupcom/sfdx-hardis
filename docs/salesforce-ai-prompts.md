---
title: Sfdx-hardis prompt templates
description: Learn how to use and override prompt templates to generate documentation or solve Salesforce CLI deployment errors
---
<!-- markdownlint-disable MD013 -->

Sfdx-hardis uses a set of predefined prompt templates to interact with AI providers for various Salesforce-related tasks. These prompts are designed to cover common use cases such as describing metadata, generating documentation, and solving deployment errors.

## How Prompts Work

Each prompt template defines a specific task and includes variables that are dynamically filled in at runtime. The templates are maintained in the codebase and are documented for transparency and customization.

## Overriding Prompts

You can override any predefined prompt template by providing a local text file with the same name as the template. This allows you to tailor the AI's behavior to your organization's needs without modifying the core plugin code.

- Place your custom prompt text files in the appropriate override directory as described in the documentation.
- The system will automatically use your custom version instead of the default if it is present.

### Example

Create a file `config/prompt-templates/PROMPT_DESCRIBE_APPROVAL_PROCESS.txt` with the following content.

```
Describe Salesforce Approval Process "{{APPROVALPROCESS_NAME}}".

### Instructions:

1. Some instructions that you'd like to use

2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (`##`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Some other formatting requirements...

### Reference Data:

- The metadata XML for Approval Process "{{APPROVALPROCESS_NAME}}" is:
{{APPROVALPROCESS_XML}}
```

## Available Prompt Templates

Below is the list of available prompt templates. Click on any template to view its documentation and variable details:

- [Complete Object Attributes](prompt-templates/PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD.md)
- [Describe Apex](prompt-templates/PROMPT_DESCRIBE_APEX.md)
- [Describe Approval Process](prompt-templates/PROMPT_DESCRIBE_APPROVAL_PROCESS.md)
- [Describe Assignment Rules](prompt-templates/PROMPT_DESCRIBE_ASSIGNMENT_RULES.md)
- [Describe AutoResponse Rules](prompt-templates/PROMPT_DESCRIBE_AUTORESPONSE_RULES.md)
- [Describe Escalation Rules](prompt-templates/PROMPT_DESCRIBE_ESCALATION_RULES.md)
- [Describe Flow](prompt-templates/PROMPT_DESCRIBE_FLOW.md)
- [Describe Flow Diff](prompt-templates/PROMPT_DESCRIBE_FLOW_DIFF.md)
- [Describe LWC](prompt-templates/PROMPT_DESCRIBE_LWC.md)
- [Describe Object](prompt-templates/PROMPT_DESCRIBE_OBJECT.md)
- [Describe Page](prompt-templates/PROMPT_DESCRIBE_PAGE.md)
- [Describe Permission Set](prompt-templates/PROMPT_DESCRIBE_PERMISSION_SET.md)
- [Describe Permission Set Group](prompt-templates/PROMPT_DESCRIBE_PERMISSION_SET_GROUP.md)
- [Describe Profile](prompt-templates/PROMPT_DESCRIBE_PROFILE.md)
- [Solve Deployment Error](prompt-templates/PROMPT_SOLVE_DEPLOYMENT_ERROR.md)
