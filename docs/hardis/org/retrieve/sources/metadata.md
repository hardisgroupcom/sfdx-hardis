<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:retrieve:sources:metadata

## Description


## Command Behavior

**Retrieves Salesforce metadata from an org into a local directory, primarily for backup and monitoring purposes.**

This command is designed to pull metadata from any Salesforce org, providing a snapshot of its configuration. It's particularly useful in monitoring contexts where you need to track changes in an org's metadata over time.

Key functionalities:

- **Metadata Retrieval:** Connects to a target Salesforce org and retrieves metadata based on a specified `package.xml`.
- **Managed Package Filtering:** By default, it filters out metadata from managed packages to reduce the volume of retrieved data. This can be overridden with the `--includemanaged` flag.
- **Monitoring Integration:** Designed to be used within a monitoring CI/CD job, it performs additional post-retrieval actions like running Apex tests and checking for legacy API usage.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Git Repository Check:** Ensures the current directory is a Git repository and initializes it if necessary.
- **`MetadataUtils.retrieveMetadatas`:** This utility is the core of the retrieval process. It connects to the Salesforce org, retrieves metadata based on the provided `package.xml` and filtering options (e.g., `filterManagedItems`), and places the retrieved files in a specified folder.
- **File System Operations:** Uses `fs-extra` to manage directories and copy retrieved files to the target folder.
- **Post-Retrieval Actions (for Monitoring Jobs):** If the command detects it's running within a monitoring CI/CD job (`isMonitoringJob()`):
  - It updates the `.gitlab-ci.yml` file if `AUTO_UPDATE_GITLAB_CI_YML` is set.
  - It converts the retrieved metadata into SFDX format using `sf project convert mdapi`.
  - It executes `sf hardis:org:test:apex` to run Apex tests.
  - It executes `sf hardis:org:diagnose:legacyapi` to check for legacy API usage.
  - It logs warnings if post-actions fail or if the monitoring version is deprecated.
- **Error Handling:** Includes robust error handling for retrieval failures and post-action execution.
</details>


## Parameters

| Name               |  Type   | Description                                                   | Default | Required | Options |
|:-------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d       | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir          | option  | undefined                                                     |         |          |         |
| folder<br/>-f      | option  | Folder                                                        |    .    |          |         |
| includemanaged     | boolean | Include items from managed packages                           |         |          |         |
| instanceurl<br/>-r | option  | URL of org instance                                           |         |          |         |
| json               | boolean | Format output as json.                                        |         |          |         |
| packagexml<br/>-p  | option  | Path to package.xml manifest file                             |         |          |         |
| skipauth           | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o  | option  | undefined                                                     |         |          |         |
| websocket          | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:org:retrieve:sources:metadata
```

```shell
$ SFDX_RETRIEVE_WAIT_MINUTES=200 sf hardis:org:retrieve:sources:metadata
```


