<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:package:version:create

## Description


## Command Behavior

**Creates a new version of a Salesforce package (2GP or Unlocked) in your Dev Hub.**

This command is a crucial step in the package development lifecycle, allowing you to iterate on your Salesforce functionalities and prepare them for deployment or distribution. It automates the process of creating a new, immutable package version.

Key functionalities:

- **Package Selection:** Prompts you to select an existing package from your `sfdx-project.json` file if not specified via the `--package` flag.
- **Installation Key:** Allows you to set an installation key (password) for the package version, protecting it from unauthorized installations. This can be provided via the `--installkey` flag or interactively.
- **Code Coverage:** Automatically includes code coverage checks during package version creation.
- **Post-Creation Actions:**
  - **Delete After Creation (`--deleteafter`):** Deletes the newly created package version immediately after its creation. This is useful for testing the package creation process without accumulating unnecessary versions.
  - **Install After Creation (`--install`):** Installs the newly created package version on your default Salesforce org. This is convenient for immediate testing or validation.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Package Directory Identification:** It identifies the package directory from your `sfdx-project.json` based on the selected package name.
- **Interactive Prompts:** Uses the `prompts` library to guide the user through package selection and installation key input if not provided as command-line arguments.
- **Configuration Persistence:** Stores the `defaultPackageInstallationKey` in your project's configuration (`.sfdx-hardis.yml`) for future use.
- **Salesforce CLI Integration:** It constructs and executes the `sf package version create` command, passing the package ID, installation key, and other flags.
- **`execSfdxJson`:** This utility is used to execute the Salesforce CLI command and capture its JSON output, which includes the `SubscriberPackageVersionId` of the newly created version.
- **Post-Creation Command Execution:** If `--deleteafter` or `--install` flags are set, it executes `sf package version delete` or delegates to `MetadataUtils.installPackagesOnOrg` respectively.
- **Error Handling:** Includes checks for missing package arguments and handles errors during package version creation or post-creation actions.
</details>


## Parameters

| Name                  |  Type   | Description                                                               | Default | Required | Options |
|:----------------------|:-------:|:--------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                           |         |          |         |
| deleteafter           | boolean | Delete package version after creating it                                  |         |          |         |
| flags-dir             | option  | undefined                                                                 |         |          |         |
| install<br/>-i        | boolean | Install package version on default org after generation                   |         |          |         |
| installkey<br/>-k     | option  | Package installation key                                                  |         |          |         |
| json                  | boolean | Format output as json.                                                    |         |          |         |
| package<br/>-p        | option  | Package identifier that you want to use to generate a new package version |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required             |         |          |         |
| target-dev-hub<br/>-v | option  | undefined                                                                 |         |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration                 |         |          |         |

## Examples

```shell
$ sf hardis:package:version:create
```


