<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:misc:purge-references

## Description


## Command Behavior

**Purges references to specified strings within your Salesforce metadata files before deployment.**

This command is a powerful, yet dangerous, tool designed to modify your local Salesforce metadata by removing or altering references to specific strings. It's primarily intended for advanced use cases, such as refactoring a custom field's API name (e.g., changing a Master-Detail relationship to a Lookup) where direct string replacement across many files is necessary.

**USE WITH EXTREME CAUTION AND CAREFULLY READ ALL MESSAGES!** Incorrect usage can lead to data loss or metadata corruption.

Key functionalities:

- **Reference String Input:** You can provide a comma-separated list of strings (e.g., `Affaire__c,MyField__c`) that you want to find and modify within your metadata.
- **Automatic Related Field Inclusion:** If a custom field API name (ending with `__c`) is provided, it automatically includes its relationship name (ending with `__r`) in the list of references to purge, ensuring comprehensive cleanup.
- **Source Synchronization Check:** Prompts you to confirm if your local sources are up-to-date with the target org, offering to retrieve metadata if needed.
- **Targeted File Scan:** Scans `.cls`, `.trigger`, and `.xml` files within your SFDX project to identify occurrences of the specified reference strings.
- **Configurable Replacements:** Applies predefined replacement rules based on file type (e.g., Apex classes, XML files) to modify the content where references are found.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Interactive Input:** Uses `prompts` to get the list of reference strings from the user if not provided via flags.
- **Metadata Retrieval:** If the user indicates that local sources are not up-to-date, it executes `sf project retrieve start` to fetch the latest metadata from the target org.
- **File System Scan:** It uses `glob` to efficiently find all relevant source files (`.cls`, `.trigger`, `.xml`) within the project's package directories.
- **Content Matching:** Reads the content of each source file and checks for the presence of any of the specified reference strings.

The core utility function for replacements is called `applyAllReplacementsDefinitions`. It is responsible for iterating through the identified files and applying the defined replacement rules. These rules are structured to target specific patterns (for example, `,{{REF}},` or `{{REF}}[ |=].+` in Apex code) and replace them with a desired string (often an empty string or a modified version).

- **Regular Expressions:** The replacement rules heavily rely on regular expressions (`regex`) to precisely match and modify the content.
- **User Feedback:** Provides real-time feedback using `ora` for spinners and `uxLog` for logging messages about the progress and results of the operation.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| references<br/>-r | option  | Comma-separated list of references to find in metadatas       |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:misc:purge-references
```


