<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:generate:gitdelta

## Description


## Command Behavior

**Generates a `package.xml` and `destructiveChanges.xml` representing the metadata differences between two Git commits.**

This command is a powerful tool for managing Salesforce metadata deployments by focusing only on the changes between specific points in your version control history. It leverages `sfdx-git-delta` to accurately identify added, modified, and deleted metadata components.

Key functionalities:

- **Commit-Based Comparison:** Allows you to specify a starting commit (`--fromcommit`) and an ending commit (`--tocommit`) to define the scope of the delta. If not provided, interactive prompts will guide you through selecting commits from your Git history.
- **Branch Selection:** You can specify a Git branch (`--branch`) to work with. If not provided, it will prompt you to select one.
- **`package.xml` Generation:** Creates a `package.xml` file that lists all metadata components that have been added or modified between the specified commits.
- **`destructiveChanges.xml` Generation:** Creates a `destructiveChanges.xml` file that lists all metadata components that have been deleted between the specified commits.
- **Temporary File Output:** The generated `package.xml` and `destructiveChanges.xml` files are placed in a temporary directory.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Git Integration:** Uses `simple-git` (`git()`) to interact with the Git repository, including fetching branches (`git().fetch()`), checking out branches (`git().checkoutBranch()`), and listing commit history (`git().log()`).
- **Interactive Prompts:** Leverages the `prompts` library to guide the user through selecting a Git branch and specific commits for delta generation if they are not provided as command-line arguments.
- **`sfdx-git-delta` Integration:** The core of the delta generation is handled by the `callSfdxGitDelta` utility function, which wraps the `sfdx-git-delta` tool. This tool performs the actual Git comparison and generates the `package.xml` and `destructiveChanges.xml` files.
- **Temporary Directory Management:** Uses `createTempDir` to create a temporary directory for storing the generated XML files, ensuring a clean working environment.
- **File System Operations:** Uses `fs-extra` to manage temporary files and directories.
- **User Feedback:** Provides clear messages to the user about the generated files and their locations.
</details>


## Parameters

| Name         |  Type   | Description                                                   | Default | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| branch       | option  | Git branch to use to generate delta                           |         |          |         |
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir    | option  | undefined                                                     |         |          |         |
| fromcommit   | option  | Hash of commit to start from                                  |         |          |         |
| json         | boolean | Format output as json.                                        |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |         |
| tocommit     | option  | Hash of commit to stop at                                     |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:project:generate:gitdelta
```


