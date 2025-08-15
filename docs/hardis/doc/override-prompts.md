<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:override-prompts

## Description


## Command Behavior

**Creates local override files for AI prompt templates and variables, allowing for customization of sfdx-hardis AI interactions.**

This command sets up a `config/prompt-templates/` folder within your project. It populates this folder with `.txt` files containing the default AI prompt templates and variables used by sfdx-hardis. This enables you to tailor the AI's behavior and responses to your organization's specific needs, terminology, and coding standards.

Key functionalities:

- **Template Customization:** Modify templates used for generating documentation, solving deployment errors, and describing Salesforce metadata.
- **Variable Customization:** Adjust common instruction patterns (e.g., role definitions, formatting requirements, security cautions) that are reused across multiple templates.
- **Persistent Overrides:** Once created, these local files will override the default sfdx-hardis templates and variables, and they will not be overwritten by future sfdx-hardis updates unless explicitly requested with the `--overwrite` flag.

**Important:** After running this command, you can modify any of the `.txt` files in `config/prompt-templates/` to customize the AI's behavior.

Available templates:
- PROMPT_SOLVE_DEPLOYMENT_ERROR\n- PROMPT_DESCRIBE_FLOW\n- PROMPT_DESCRIBE_FLOW_DIFF\n- PROMPT_DESCRIBE_OBJECT\n- PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD\n- PROMPT_DESCRIBE_APEX\n- PROMPT_DESCRIBE_PAGE\n- PROMPT_DESCRIBE_PACKAGE\n- PROMPT_DESCRIBE_PROFILE\n- PROMPT_DESCRIBE_PERMISSION_SET\n- PROMPT_DESCRIBE_PERMISSION_SET_GROUP\n- PROMPT_DESCRIBE_ASSIGNMENT_RULES\n- PROMPT_DESCRIBE_APPROVAL_PROCESS\n- PROMPT_DESCRIBE_LWC\n- PROMPT_DESCRIBE_AUTORESPONSE_RULES\n- PROMPT_DESCRIBE_ESCALATION_RULES\n- PROMPT_DESCRIBE_ROLES

Available variables:
- VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC\n- VARIABLE_FORMATTING_REQUIREMENTS\n- VARIABLE_ADDITIONAL_INSTRUCTIONS

More info on [AI Prompts documentation](https://sfdx-hardis.cloudity.com/salesforce-ai-prompts/)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Directory Creation:** Ensures the `config/prompt-templates/` directory exists using `fs.ensureDirSync()`.
- **File Copying:** Iterates through predefined `PROMPT_TEMPLATES` and `PROMPT_VARIABLES` objects. For each template/variable, it extracts the English text content and writes it to a corresponding `.txt` file in the `config/prompt-templates/` directory.
- **Overwrite Logic:** Checks if a file already exists. If the `--overwrite` flag is provided, it overwrites the existing file; otherwise, it skips the file and logs a message.
- **User Feedback:** Provides detailed logs about created, overwritten, and skipped files, along with instructions on how to use the customized prompts and variables.
- **Dynamic Content:** The description itself dynamically lists available templates and variables by iterating over `PROMPT_TEMPLATES` and `PROMPT_VARIABLES` objects.
</details>


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
$ sf hardis:doc:override-prompts
```

```shell
$ sf hardis:doc:override-prompts --overwrite
```


