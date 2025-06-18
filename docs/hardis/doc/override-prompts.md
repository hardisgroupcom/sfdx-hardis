<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:override-prompts

## Description

Create local override files for AI prompt templates and variables

This command creates a folder config/prompt-templates/ and copies all the default AI prompt templates and variables as .txt files that can be customized.

The templates are used by sfdx-hardis for:
- Generating documentation with AI
- Solving deployment errors
- Describing Salesforce metadata

The variables contain common instruction patterns that are reused across multiple templates, such as:
- Role definitions (business analyst, developer, etc.)
- Formatting requirements for markdown output
- Security caution instructions
- Output format specifications

You can customize these prompts and variables to match your organization's specific needs and terminology.

After running this command, you can modify any of the .txt files in config/prompt-templates/ to override the default prompts and variables.

**Important**: Once created, existing template and variable files will never be overwritten with newer versions from sfdx-hardis updates, unless you explicitly use the --overwrite flag. This ensures your customizations are preserved.

Available templates:
- PROMPT_SOLVE_DEPLOYMENT_ERROR
- PROMPT_DESCRIBE_FLOW
- PROMPT_DESCRIBE_FLOW_DIFF
- PROMPT_DESCRIBE_OBJECT
- PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD
- PROMPT_DESCRIBE_APEX
- PROMPT_DESCRIBE_PAGE
- PROMPT_DESCRIBE_PACKAGE
- PROMPT_DESCRIBE_PROFILE
- PROMPT_DESCRIBE_PERMISSION_SET
- PROMPT_DESCRIBE_PERMISSION_SET_GROUP
- PROMPT_DESCRIBE_ASSIGNMENT_RULES
- PROMPT_DESCRIBE_APPROVAL_PROCESS
- PROMPT_DESCRIBE_LWC
- PROMPT_DESCRIBE_AUTORESPONSE_RULES
- PROMPT_DESCRIBE_ESCALATION_RULES
- PROMPT_DESCRIBE_ROLES

Available variables:
- VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC
- VARIABLE_FORMATTING_REQUIREMENTS
- VARIABLE_ADDITIONAL_INSTRUCTIONS

More info on [AI Prompts documentation](https://sfdx-hardis.cloudity.com/salesforce-ai-prompts/)


## Parameters

| Name         |  Type   | Description                                                   | Default | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir    | option  | undefined                                                     |         |          |         |
| json         | boolean | Format output as json.                                        |         |          |         |
| overwrite    | boolean | Overwrite existing template files if they already exist       |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
sf hardis:doc:override-prompts
```

```shell
sf hardis:doc:override-prompts --overwrite
```


