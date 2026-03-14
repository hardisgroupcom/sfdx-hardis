<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:plugin:generate

## Description


## Command Behavior

**Generates Markdown documentation for an SF CLI plugin, ready for conversion into HTML with MkDocs.**

This command automates the creation of comprehensive documentation for your Salesforce CLI plugin. It processes your plugin's commands and their flags to generate structured Markdown files, which can then be used with MkDocs to produce a professional-looking website.

Key functionalities:

- **Command Documentation:** Generates a dedicated Markdown file for each command, including its description, parameters (flags), and examples.
- **Index and Commands Pages:** Creates an `index.md` and `commands.md` file that list all available commands, providing an overview and easy navigation.
- **MkDocs Integration:** Sets up the basic MkDocs project structure and updates the `mkdocs.yml` navigation to include the generated command documentation.
- **Default File Copying:** Copies essential MkDocs configuration files and GitHub Actions workflows to your project, streamlining the setup for continuous documentation deployment.

**Post-Generation Steps:**

After the initial run, you will need to manually update:

- `mkdocs.yml`: Customize the project title, theme, and other MkDocs settings.
- `.github/workflows/build-deploy-docs.yml`: Configure the GitHub Actions workflow for automatic documentation deployment.
- `docs/javascripts/gtag.js`: If desired, set up Google Analytics tracking.

Finally, activate GitHub Pages with `gh_pages` as the target branch. This will enable automatic documentation rebuilding and publishing to GitHub Pages upon each merge into your `master`/`main` branch.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Plugin Configuration Loading:** It loads the SF CLI plugin's configuration using `@oclif/core`'s `Config.load()`, which provides access to all registered commands and their metadata.
- **Command Iteration:** It iterates through each command defined in the plugin's configuration.
- **Markdown File Generation:** For each command, it constructs a Markdown file (`.md`) containing:
  - The command ID as the main heading.
  - The command's `description` property.
  - A table of parameters (flags), including their name, type, description, default value, required status, and available options. It dynamically extracts this information from the command's `flags` property.
  - Code blocks for each example provided in the command's `examples` property.
- **Navigation Structure:** It builds a nested JavaScript object (`commandsNav`) that mirrors the command hierarchy, which is then converted to YAML and inserted into `mkdocs.yml` to create the navigation menu.
- **Index and Commands Page Generation:** It reads the project's `README.md` and extracts relevant sections to create the `index.md` file. It also generates a separate `commands.md` file listing all commands.
- **File System Operations:** It uses `fs-extra` to create directories, copy default MkDocs files (`defaults/mkdocs`), and write the generated Markdown and YAML files.
- **YAML Serialization:** It uses `js-yaml` to serialize the navigation object into YAML format for `mkdocs.yml`.
</details>


## Parameters

| Name         |  Type   | Description                                                   | Default | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir    | option  | undefined                                                     |         |          |         |
| json         | boolean | Format output as json.                                        |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:doc:plugin:generate
```


