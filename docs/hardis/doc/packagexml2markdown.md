<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:packagexml2markdown

## Description


## Command Behavior

**Generates a Markdown documentation file from a Salesforce `package.xml` file.**

This command provides a convenient way to visualize and document the metadata components defined within a `package.xml` file. It's particularly useful for:

- **Understanding Project Scope:** Quickly grasp what metadata types and components are included in a specific deployment or retrieval.
- **Documentation:** Create human-readable documentation of your project's metadata structure.
- **Collaboration:** Share a clear overview of metadata changes with team members or stakeholders.

Key features:

- **Flexible Input:** You can specify the path to a `package.xml` file using the `--inputfile` flag. If not provided, the command will automatically look for `package.xml` files in the `manifest` folder.
- **Customizable Output:** You can force the path and name of the output Markdown file using the `--outputfile` flag.
- **VS Code Integration:** Automatically opens the generated Markdown file in a new VS Code tab for immediate review.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **XML Parsing:** It reads the content of the specified `package.xml` file and parses its XML structure to extract the metadata types and their members.
- **Markdown Generation:** It utilizes the `DocBuilderPackageXML.generatePackageXmlMarkdown` utility to transform the parsed `package.xml` data into a structured Markdown format. This utility handles the formatting and organization of the metadata information.
- **File System Operations:** It uses `fs-extra` (implicitly through `DocBuilderPackageXML`) to read the input `package.xml` and write the generated Markdown file.
- **WebSocket Communication:** It interacts with a WebSocket client (`WebSocketClient.requestOpenFile`) to open the generated Markdown file in a VS Code tab, enhancing user experience.
- **Salesforce Org Context:** It can optionally use the `target-org` flag to provide context, such as the instance URL, which might be used for generating links or additional information within the Markdown.
</details>


## Parameters

| Name              |  Type   | Description                                                                          | Default | Required | Options |
|:------------------|:-------:|:-------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                      |         |          |         |
| flags-dir         | option  | undefined                                                                            |         |          |         |
| inputfile<br/>-x  | option  | Path to package.xml file. If not specified, the command will look in manifest folder |         |          |         |
| json              | boolean | Format output as json.                                                               |         |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .md                     |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                        |         |          |         |
| target-org<br/>-o | option  | undefined                                                                            |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                            |         |          |         |

## Examples

```shell
$ sf hardis:doc:packagexml2markdown
```

```shell
$ sf hardis:doc:packagexml2markdown --inputfile manifest/package-all.xml
```


