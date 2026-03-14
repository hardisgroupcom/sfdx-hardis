<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:lint:access

## Description


## Command Behavior

**Checks if specified Salesforce metadata elements (Apex classes and custom fields) have at least one permission defined in any Permission Set or Profile.**

This command is crucial for maintaining proper access control and identifying potential security vulnerabilities or misconfigurations in your Salesforce project. It helps ensure that all custom elements are accessible to the intended users through appropriate permission assignments.

Key functionalities:

- **Element Validation:** Verifies that Apex classes and custom fields have `enabled` (for Apex classes) or `readable`/`editable` (for custom fields) access in at least one Permission Set or Profile.
- **Configurable Ignores:** Allows you to ignore specific elements or entire types of elements (e.g., all Apex classes, a particular custom field) using the `--elementsignored` flag or project configuration.
- **Permission Set/Profile Filtering:** You can specify Permission Sets or Profiles to ignore during the access check using the `--ignorerights` flag.
- **Reporting:** Generates a CSV report of all missing access elements, which can be used for auditing or further analysis.
- **Notifications:** Integrates with notification providers (Grafana, Slack, MS Teams) to alert about missing access issues, making it suitable for CI/CD monitoring.
- **Interactive Fix:** In non-CI environments, it offers an interactive prompt to automatically add missing accesses to selected Permission Sets.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-missing-access/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File System Traversal:** Uses `glob` to find all Apex class (`.cls`) and custom field (`.field-meta.xml`) files within the specified root folder.
- **XML Parsing:** Parses the XML content of Permission Set (`.permissionset-meta.xml`) and Profile (`.profile-meta.xml`) files to extract access configurations.
- **Element Filtering:** Filters out elements that are explicitly ignored (via flags or configuration) or are not subject to access checks (e.g., Master-Detail fields, required fields, Custom Metadata Types, Custom Settings).
- **Access Verification Logic:** Iterates through each element to check and verifies if it has the necessary access enabled in any of the non-ignored Permission Sets or Profiles.
- **Data Aggregation:** Collects all elements with missing access into a `missingElements` array and `missingElementsMap` for reporting and notification purposes.
</details>


## Parameters

| Name                   |  Type   | Description                                                       |  Default  | Required | Options |
|:-----------------------|:-------:|:------------------------------------------------------------------|:---------:|:--------:|:-------:|
| debug<br/>-d           | boolean | Activate debug mode (more logs)                                   |           |          |         |
| elementsignored<br/>-e | option  | Ignore specific elements separated by commas                      |           |          |         |
| flags-dir              | option  | undefined                                                         |           |          |         |
| folder<br/>-f          | option  | Root folder                                                       | force-app |          |         |
| ignorerights<br/>-i    | option  | Ignore permission sets or profiles                                |           |          |         |
| json                   | boolean | Format output as json.                                            |           |          |         |
| outputfile<br/>-x      | option  | Force the path and name of output report file. Must end with .csv |           |          |         |
| skipauth               | boolean | Skip authentication check when a default username is required     |           |          |         |
| target-org<br/>-o      | option  | undefined                                                         |           |          |         |
| websocket              | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |           |          |         |

## Examples

```shell
$ sf hardis:lint:access
```

```shell
$ sf hardis:lint:access -e "ApexClass:ClassA, CustomField:Account.CustomField"
```

```shell
$ sf hardis:lint:access -i "PermissionSet:permissionSetA, Profile"
```


