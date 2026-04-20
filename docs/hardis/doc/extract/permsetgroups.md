<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:extract:permsetgroups

## Description


## Command Behavior

**Extracts and documents Salesforce Permission Set Groups and their assigned Permission Sets.**

This command generates two types of output: a CSV file and a Markdown file, providing a clear overview of how Permission Set Groups are structured and what Permission Sets they contain within your Salesforce project. This is particularly useful for:

- **Documentation:** Creating human-readable documentation of your permission architecture.
- **Auditing:** Understanding the composition of permission sets for security and compliance checks.
- **Analysis:** Gaining insights into how permissions are bundled and assigned in your Salesforce environment.

The generated CSV file provides a structured, machine-readable format, while the Markdown file offers a more descriptive, human-friendly view, including the group's name, label, description, and a list of its constituent permission sets.

## Technical explanations

The command performs the following technical steps:

- **File Discovery:** It uses `glob` to find all `.permissionsetgroup-meta.xml` files within the current working directory, respecting `.gitignore` patterns.
- **XML Parsing:** For each discovered Permission Set Group XML file, it parses the XML content using `parseXmlFile` to extract relevant information such as the group's name, label, description, and the names of the Permission Sets it contains.
- **Data Structuring:** The extracted data is then structured into a list of objects, making it easy to process.
- **CSV Generation:** It constructs a CSV file with two columns: 'Permission set group' and 'Permission sets'. The 'Permission sets' column lists all assigned permission sets for each group, enclosed in quotes and separated by commas. The CSV file is saved to a temporary directory or a user-specified path.
- **Markdown Generation:** It generates a Markdown file (`docs/permission-set-groups.md`) that includes a title, a table of contents, and detailed sections for each Permission Set Group. Each section lists the group's name, label, description, and a bulleted list of its assigned Permission Sets.
- **File System Operations:** It uses `fs-extra` to ensure output directories exist and to write the generated CSV and Markdown files.
- **VS Code Integration:** It uses `WebSocketClient.requestOpenFile` to automatically open the generated CSV and Markdown files in VS Code, enhancing the user experience.


## Parameters

| Name              |  Type   | Description                                                       | Default | Required | Options |
|:------------------|:-------:|:------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                   |         |          |         |
| flags-dir         | option  | undefined                                                         |         |          |         |
| json              | boolean | Format output as json.                                            |         |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |         |          |         |

## Examples

```shell
$ sf hardis:doc:extract:permsetgroups
```


