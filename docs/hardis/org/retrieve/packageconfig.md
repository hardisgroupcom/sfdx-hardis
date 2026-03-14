<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:retrieve:packageconfig

## Description


**Retrieves the installed package configuration from a Salesforce org and optionally updates the local project configuration.**

This command is useful for maintaining an accurate record of installed packages within your Salesforce project, which is crucial for managing dependencies and ensuring consistent deployments across environments.

Key functionalities:

- **Package Listing:** Connects to a specified Salesforce org (or prompts for one if not provided) and retrieves a list of all installed packages.
- **Configuration Update:** Offers the option to update your local project's configuration with the retrieved list of installed packages. This can be beneficial for automating package installations during environment setup or CI/CD processes.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Org Connection:** It establishes a connection to the target Salesforce org using the provided or prompted username.
- **Metadata Retrieval:** It utilizes `MetadataUtils.listInstalledPackages` to query the Salesforce org and obtain details about the installed packages.
- **Interactive Prompt:** It uses the `prompts` library to ask the user whether they want to update their local project configuration with the retrieved package list.
- **Configuration Management:** If the user confirms, it calls `managePackageConfig` to update the project's configuration file (likely `.sfdx-hardis.yml`) with the new package information.
- **User Feedback:** Provides clear messages to the user about the success of the package retrieval and configuration update.
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
$ sf hardis:org:retrieve:packageconfig
```

```shell
sf hardis:org:retrieve:packageconfig -u myOrg
```


