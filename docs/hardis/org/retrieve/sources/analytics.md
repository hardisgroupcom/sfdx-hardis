<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:retrieve:sources:analytics

## Description


## Command Behavior

**Retrieves all CRM Analytics (formerly Tableau CRM or Einstein Analytics) sources from a Salesforce org, including workarounds for known SFDX bugs.**

This command is designed to extract the complete configuration of your CRM Analytics assets, such as dashboards, dataflows, lenses, and recipes. It's essential for version controlling your Analytics development, migrating assets between environments, or backing up your Analytics configurations.

Key functionalities:

- **Comprehensive Retrieval:** Fetches all supported CRM Analytics metadata types.
- **SFDX Bug Workarounds:** Incorporates internal logic to handle common issues or limitations encountered when retrieving CRM Analytics metadata using standard Salesforce CLI commands.
- **Target Org Selection:** Allows you to specify the Salesforce org from which to retrieve the Analytics sources. If not provided, it will prompt for selection.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Full Org Manifest Generation:** It first generates a complete `package.xml` for the target org using `buildOrgManifest`. This ensures that all available metadata, including CRM Analytics components, are identified.
- **Analytics Metadata Filtering:** It then filters this comprehensive `package.xml` to include only the CRM Analytics-related metadata types (e.g., `WaveApplication`, `WaveDashboard`, `WaveDataflow`, `WaveLens`, `WaveRecipe`, `WaveXmd`).
- **Filtered `package.xml` Creation:** A new `package.xml` file containing only the filtered CRM Analytics metadata is created temporarily.
- **Salesforce CLI Retrieval:** It executes the `sf project retrieve start` command, using the newly created Analytics-specific `package.xml` to retrieve the sources to your local project.
- **Temporary File Management:** It uses `createTempDir` to manage temporary files and directories created during the process.
- **Interactive Org Selection:** Uses `promptOrgUsernameDefault` to guide the user in selecting the target Salesforce org if not provided via flags.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:org:retrieve:sources:analytics
```


