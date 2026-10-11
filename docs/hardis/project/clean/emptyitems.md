<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:emptyitems

## Description


## Command Behavior

**Removes empty or irrelevant metadata items from your Salesforce DX project sources.**

This command helps maintain a clean and efficient Salesforce codebase by deleting metadata files that are essentially empty or contain no meaningful configuration. These files can sometimes be generated during retrieval processes or remain after refactoring, contributing to unnecessary clutter in your project.

Key functionalities:

- **Targeted Cleaning:** Specifically targets and removes empty instances of:
  - Global Value Set Translations (`.globalValueSetTranslation-meta.xml`)
  - Standard Value Sets (`.standardValueSet-meta.xml`)
  - Sharing Rules (`.sharingRules-meta.xml`)
  - Custom Objects (`.object-meta.xml`) with no attribute at all. Salesforce CLI writes `<CustomObject></CustomObject>` when a field, list view, record type or validation rule is retrieved without its object. Committed, it makes the deployment fail with `Must specify a non-empty label for the CustomObject`.
- **Never a destructive change:** Deleting a file that git already has would make the next delta delete the component in the target org. With `--delta-from <commit>` (passed by [hardis:work:save](https://sfdx-hardis.cloudity.com/hardis/work/save/)), a file that already exists at that commit is kept and named in a warning. Without it, an empty CustomObject file already committed is kept the same way.
- **package.xml kept consistent:** When an empty CustomObject file is deleted, its member is removed from `manifest/package.xml` if it is listed there, with a log line.
- **Scope:** The package directories of `sfdx-project.json` are scanned, or `--folder` when given. `--metadata-type` restricts the cleaning to some types: the VS Code Metadata Retriever calls `--metadata-type CustomObject` after a retrieve that wrote new object files. An unknown `--delta-from` commit (for example a branch that was never fetched) is reported, and only the empty files not committed yet are removed.
- **Automatic cleaning:** Add `emptyItems` to `autoCleanTypes` in `.sfdx-hardis.yml` to run this cleaning each time a user story is saved.
- **Content-Based Deletion:** It checks the XML content of these files for the presence of specific tags (e.g., `valueTranslation` for Global Value Set Translations) to determine if they are truly empty or lack relevant data. A CustomObject file is empty when its root element has no child.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses `glob` to find files matching predefined patterns for Global Value Set Translations, Standard Value Sets, Sharing Rules and Custom Objects within the package directories of `sfdx-project.json`, or the folder given with `--folder`.
- **XML Parsing:** For each matching file, it reads and parses the XML content using `parseXmlFile`.
- **Content Validation:** It then checks the parsed XML object for the existence of specific nested properties (e.g., `xmlContent.GlobalValueSetTranslation.valueTranslation`). If these properties are missing or empty, the file is considered empty.
- **File Deletion:** If a file is determined to be empty, it is removed from the file system using `fs.remove`.
- **Git check:** `git cat-file -e <commit>:<file>` tells whether the file exists at the `--delta-from` commit (or at `HEAD` for CustomObject files when no commit is given). Outside a git repository, empty files are always deleted.
- **package.xml:** `parsePackageXmlFile` / `writePackageXmlFile` remove the CustomObject members of deleted files from `manifest/package.xml`: `hardis:work:save` computes that file from the git delta before running the cleanings, so it already lists them.
- **Logging:** Provides clear messages about which files are being removed and a summary of the total number of items cleaned.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:clean:emptyitems --agent
```

In agent mode, all interactive prompts are skipped and default values are used.



## Parameters

| Name          |  Type   | Description                                                                                                                                      | Default | Required |                                     Options                                      |
|:--------------|:-------:|:-------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:--------------------------------------------------------------------------------:|
| agent         | boolean | Run in non-interactive mode for agents and automation                                                                                            |         |          |                                                                                  |
| debug<br/>-d  | boolean | Activate debug mode (more logs)                                                                                                                  |         |          |                                                                                  |
| delta-from    | option  | Git commit or ref the next delta starts from: empty files that already exist there are kept, as deleting them would generate destructive changes |         |          |                                                                                  |
| flags-dir     | option  | Import flag values from a directory.                                                                                                             |         |          |                                                                                  |
| folder<br/>-f | option  | Root folder (default: the package directories of sfdx-project.json)                                                                              |         |          |                                                                                  |
| json          | boolean | Format output as json.                                                                                                                           |         |          |                                                                                  |
| metadata-type | option  | Only clean these metadata types (default: all of them)                                                                                           |         |          | GlobalValueSetTranslation<br/>StandardValueSet<br/>SharingRules<br/>CustomObject |
| skipauth      | boolean | Skip authentication check when a default username is required                                                                                    |         |          |                                                                                  |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                        |         |          |                                                                                  |

## Examples

```shell
$ sf hardis:project:clean:emptyitems
```

```shell
$ sf hardis:project:clean:emptyitems --metadata-type CustomObject
```

```shell
$ sf hardis:project:clean:emptyitems --delta-from origin/integration
```

```shell
$ sf hardis:project:clean:emptyitems --agent
```


