<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:generate:packagexmlfull

## Description


## Command Behavior

**Generates a comprehensive `package.xml` file for a Salesforce org, including all metadata components, even managed ones.**

This command is essential for various Salesforce development and administration tasks, especially when you need a complete snapshot of an org's metadata. It goes beyond typical source tracking by including managed package components, which is crucial for understanding the full metadata footprint of an org.

Key functionalities:

- **Full Org Metadata Retrieval:** Connects to a specified Salesforce org (or prompts for one if not provided) and retrieves a complete list of all metadata types and their members.
- **Managed Package Inclusion:** Unlike standard source retrieval, this command explicitly includes metadata from managed packages, providing a truly comprehensive `package.xml`.
- **Customizable Output:** Allows you to specify the output file path for the generated `package.xml`.
- **Interactive Org Selection:** If no target org is specified, it interactively prompts the user to choose an org. (or use --no-prompt to skip this step)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce Metadata API Interaction:** It leverages the Salesforce Metadata API to list all available metadata types and then retrieve all components for each type.
- **`buildOrgManifest` Utility:** The core logic for querying the org's metadata and constructing the `package.xml` is encapsulated within the `buildOrgManifest` utility function.
- **XML Generation:** It dynamically builds the XML structure of the `package.xml` file, including the `types` and `members` elements for all retrieved metadata.
- **File System Operations:** It writes the generated `package.xml` file to the specified output path.
- **Interactive Prompts:** Uses `promptOrgUsernameDefault` to guide the user in selecting the target Salesforce org.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| no-prompt<br/>-n  | boolean | Do not prompt for org username, use the default one           |         |          |         |
| outputfile        | option  | Output package.xml file                                       |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:org:generate:packagexmlfull
```

```shell
$ sf hardis:org:generate:packagexmlfull --outputfile /tmp/packagexmlfull.xml
```

```shell
$ sf hardis:org:generate:packagexmlfull --target-org nico@example.com
```


