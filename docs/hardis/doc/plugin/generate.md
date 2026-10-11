<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:plugin:generate

## Description


## Command Behavior

**Generates Markdown documentation for an SF CLI plugin, ready for conversion into HTML with MkDocs.**

This command automates the creation of comprehensive documentation for your Salesforce CLI plugin. It processes your plugin's commands and their flags to generate structured Markdown files, which can then be used with Zensical to produce a professional-looking website.

Key functionalities:

- **Command Documentation:** Generates a dedicated Markdown file for each command, including its description, parameters (flags), and examples.
- **Index and Commands Pages:** Creates an `index.md` and `commands.md` file that list all available commands, providing an overview and easy navigation.
- **Zensical Integration:** Sets up the basic documentation project structure and updates the `mkdocs.yml` navigation to include the generated command documentation.
- **Default File Copying:** Copies the documentation configuration files and GitHub Actions workflows to your project, so continuous documentation deployment works out of the box.
- **Selected commands only:** With `--commands`, only the pages of the commands you name are written. It takes command ids and `*` patterns, separated by commas or by repeating the flag, and stops when one of them matches no command. `index.md`, `commands.md` and the navigation are then rewritten only when a command was added or removed. A new command always gets its page, even when it is not named.
- **Removed commands:** When a command no longer exists, its page is not deleted: it is replaced by a short page saying so, which keeps old links working. That page is left out of the navigation, the lists of commands and the search, and you can edit it, for example to name the command to use instead.

The pages are built from the compiled commands of the plugin: compile it before running this command.

**Post-Generation Steps:**

After the initial run, you will need to manually update:

- `mkdocs.yml`: Customize the project title, theme, and other site settings. Zensical reads this file directly.
- `.github/workflows/build-deploy-docs.yml`: Configure the GitHub Actions workflow for automatic documentation deployment.
- `mkdocs.yml`, key `extra.analytics`: If desired, set up Google Analytics tracking with your own measurement id.

Finally, activate GitHub Pages with `gh_pages` as the target branch. This will enable automatic documentation rebuilding and publishing to GitHub Pages upon each merge into your `master`/`main` branch.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Plugin Configuration Loading:** It loads the SF CLI plugin's configuration using `@oclif/core`'s `Config.load()`, which provides access to all registered commands and their metadata. Every command is loaded, with or without `--commands`.
- **Command Selection:** `--commands` values are matched against the command ids. `*` stands for any sequence of characters, `:` included, and an id typed with spaces is read as its colon form.
- **Markdown File Generation:** For each selected command, it constructs a Markdown file (`.md`) containing:
  - The command ID as the main heading.
  - The command's `description` property.
  - A table of parameters (flags), including their name, type, description, default value, required status, and available options. It dynamically extracts this information from the command's `flags` property. A default that depends on the machine building the documentation, such as the default org, is left out.
  - Code blocks for each example provided in the command's `examples` property.
- **Table Alignment:** The tables of the generated pages are padded the way `markdown-table-formatter` pads them, so a formatter run on the documentation changes nothing.
- **Navigation Structure:** It builds a nested JavaScript object (`commandsNav`) that mirrors the command hierarchy, which is then converted to YAML and inserted into the `Commands` entry of `mkdocs.yml` to create the navigation menu.
- **Index and Commands Page Generation:** It reads the project's `README.md` and extracts relevant sections to create the `index.md` file. It also generates a separate `commands.md` file listing all commands.
- **Command List Changes:** A generated page is recognized by its header comment and its title. A command without such a page is new, and such a page without a command is replaced by the removed command page.
- **File System Operations:** It uses Node.js `fs` to create directories, copy the default site files (`defaults/mkdocs`), and write the generated Markdown and YAML files.
- **YAML Serialization:** It uses `js-yaml` to serialize the navigation object into YAML format for `mkdocs.yml`.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:doc:plugin:generate --agent
sf hardis:doc:plugin:generate --agent --commands hardis:org:monitor:backup
```

In agent mode:

- The command never prompts, with or without `--agent`.
- `--commands` limits the pages written to the commands it names. Without it, every page is written.
- The `--json` result lists the files written, the pages of removed commands, and whether the index pages and the navigation were rebuilt.



## Parameters

| Name            |  Type   | Description                                                                                                                                             | Default | Required | Options |
|:----------------|:-------:|:--------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent           | boolean | Run in non-interactive mode for agents and automation                                                                                                   |         |          |         |
| commands<br/>-c | option  | Commands to generate the documentation of: ids or patterns with *, separated by commas or by repeating the flag. If not set, all commands are processed |         |          |         |
| debug<br/>-d    | boolean | Activate debug mode (more logs)                                                                                                                         |         |          |         |
| flags-dir       | option  | Import flag values from a directory.                                                                                                                    |         |          |         |
| json            | boolean | Format output as json.                                                                                                                                  |         |          |         |
| skipauth        | boolean | Skip authentication check when a default username is required                                                                                           |         |          |         |
| websocket       | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                               |         |          |         |

## Examples

```shell
$ sf hardis:doc:plugin:generate
```

```shell
$ sf hardis:doc:plugin:generate --commands hardis:org:monitor:backup
```

```shell
$ sf hardis:doc:plugin:generate --commands "hardis:project:action:*,hardis:work:save"
```

```shell
$ sf hardis:doc:plugin:generate --agent
```


