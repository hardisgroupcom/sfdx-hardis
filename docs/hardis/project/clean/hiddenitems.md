<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:hiddenitems

## Description


## Command Behavior

**Removes hidden or temporary metadata items from your Salesforce DX project sources.**

This command helps clean up your local Salesforce project by deleting files that are marked as hidden or are temporary artifacts.
Salesforce CLI can retrieve `(hidden)` file bodies for metadata that belongs to installed managed packages, because the implementation is not visible in subscriber orgs.
Those placeholder files, and their companion metadata files, are not deployable source and should not be kept in version control.

Key functionalities:

- **Targeted File Scan:** Scans for files with specific extensions (`.app`, `.cmp`, `.evt`, `.tokens`, `.html`, `.css`, `.js`, `.xml`, `.cls`, `.trigger`, `.component`) within the specified root folder (defaults to `force-app`).
- **Hidden Content Detection:** Identifies files whose content starts with (hidden), allowing an initial BOM or whitespace. This is a convention used by some Salesforce tools to mark temporary or internal files.
- **Component Folder Removal:** If a hidden file is part of a Lightning Web Component (LWC) or Aura component folder, the entire component folder is removed to ensure a complete cleanup.
- **Companion Metadata Removal:** If a hidden source file has a sibling `*-meta.xml` file (for example `.cls-meta.xml`, `.trigger-meta.xml`, `.component-meta.xml`), the companion metadata file is removed as well.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses `glob` to find files matching the specified patterns within the `folder`.
- **Content Reading:** Reads the content of each file.
- **Hidden Marker Check:** Checks if the file content starts with the literal string (hidden), after an optional BOM or whitespace.
- **Folder or File Removal:** If a file is identified as hidden:
  - If it's within an lwc or aura component folder, the entire component folder is removed using `fs.remove`.
  - Otherwise, the individual file and its optional `*-meta.xml` companion file are removed.
- **Logging:** Provides clear messages about which items are being removed and a summary of the total number of hidden items cleaned.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:clean:hiddenitems --agent
```

In agent mode, all interactive prompts are skipped and default values are used.



## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|folder<br/>-f|option|Root folder|force-app|||
|json|boolean|Format output as json.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:clean:hiddenitems
```

```shell
$ sf hardis:project:clean:hiddenitems --agent
```


