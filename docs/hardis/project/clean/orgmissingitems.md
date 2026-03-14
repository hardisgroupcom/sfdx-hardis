<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:orgmissingitems

## Description


## Command Behavior

**Cleans Salesforce DX project sources by removing metadata components that are not present in a target Salesforce org or the local `package.xml` file.**

This command helps maintain a lean and accurate codebase by identifying and removing metadata that is either obsolete in the target org or not explicitly included in your project's `package.xml`. This is particularly useful for:

- **Reducing Deployment Size:** Eliminating unnecessary metadata reduces the size of deployments, leading to faster deployments and fewer conflicts.
- **Ensuring Consistency:** Synchronizing your local codebase with the actual state of a Salesforce org.
- **Cleaning Up Orphaned Metadata:** Removing components that might have been deleted from the org but still exist in your local project.

Key features:

- **Target Org Integration:** Connects to a specified Salesforce org (or prompts for one) to retrieve its metadata manifest.
- **`package.xml` Comparison:** Compares your local project's metadata with the target org's metadata and your local `package.xml` to identify missing items.
- **Report Type Cleaning:** Specifically targets and cleans `reportType-meta.xml` files by removing references to fields or objects that are not present in the target org or your `package.xml`.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves several steps:

- **Org Manifest Generation:** If not provided, it generates a full `package.xml` from the target Salesforce org using `buildOrgManifest`.
- **XML Parsing and Merging:** It parses the generated org manifest and merges it with the local `package.xml` and `destructiveChanges.xml` files to create a comprehensive list of existing and deleted metadata.
- **Metadata Analysis:** It iterates through specific metadata types (currently `reportType-meta.xml` files) within the configured source folder.
- **Field and Object Validation:** For each `reportType-meta.xml` file, it examines the columns and filters out references to custom fields or objects that are not found in the merged `package.xml` content or are marked for destruction.
- **XML Modification:** If changes are detected, it updates the `reportType-meta.xml` file by writing the modified XML content back to the file using `writeXmlFile`.
- **File System Operations:** It uses `fs-extra` for file system operations and `glob` for pattern matching to find relevant metadata files.
- **SOQL Queries:** The `buildOrgManifest` utility (used internally) performs SOQL queries to retrieve metadata information from the Salesforce org.
</details>


## Parameters

| Name          |  Type   | Description                     |  Default  | Required | Options |
|:--------------|:-------:|:--------------------------------|:---------:|:--------:|:-------:|
| debug<br/>-d  | boolean | Activate debug mode (more logs) |           |          |         |
| flags-dir     | option  | undefined                       |           |          |         |
| folder<br/>-f | option  | Root folder                     | force-app |          |         |
| json          | boolean | Format output as json.          |           |          |         |
|packagexmlfull<br/>-p|option|Path to packagexml used for cleaning.
Must contain also standard CustomObject and CustomField elements.
If not provided, it will be generated from a remote org||||
|packagexmltargetorg<br/>-t|option|Target org username or alias to build package.xml (SF CLI must be authenticated).
If not provided, will be prompted to the user.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:clean:orgmissingitems
```


