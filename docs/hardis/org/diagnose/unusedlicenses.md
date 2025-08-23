<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:unusedlicenses

## Description


## Command Behavior

**Detects and suggests the deletion of unused Permission Set License Assignments in a Salesforce org.**

When a Permission Set (PS) linked to a Permission Set License (PSL) is assigned to a user, a Permission Set License Assignment (PSLA) is automatically created. However, when that PS is unassigned from the user, the PSLA is *not* automatically deleted. This can lead to organizations being charged for unused PSLAs, representing a hidden cost and technical debt.

This command identifies such useless PSLAs and provides options to delete them, helping to optimize license usage and reduce unnecessary expenses.

Key functionalities:

- **PSLA Detection:** Queries the Salesforce org to find all active PSLAs.
- **Usage Verification:** Correlates PSLAs with actual Permission Set Assignments and Permission Set Group Assignments to determine if the underlying Permission Sets are still assigned to the user.
- **Special Case Handling:** Accounts for specific scenarios where profiles might implicitly assign PSLAs (e.g., `Salesforce API Only` profile assigning `SalesforceAPIIntegrationPsl`) and allows for always excluding certain PSLAs from the unused check.
- **Reporting:** Generates a CSV report of all identified unused PSLAs, including the user and the associated Permission Set License.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams) with a summary of unused PSLAs.
- **Interactive Deletion:** In non-CI environments, it offers an interactive prompt to bulk delete the identified unused PSLAs.

Many thanks to [Vincent Finet](https://www.linkedin.com/in/vincentfinet/) for the inspiration during his great speaker session at [French Touch Dreamin '23](https://frenchtouchdreamin.com/), and his kind agreement for reusing such inspiration in this command :)

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-unused-licenses/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves extensive querying of Salesforce objects and data correlation:

- **SOQL Queries (Bulk API):** It uses `bulkQuery` and `bulkQueryChunksIn` to efficiently retrieve large volumes of data from `PermissionSetLicenseAssign`, `PermissionSetLicense`, `PermissionSet`, `PermissionSetGroupComponent`, and `PermissionSetAssignment` objects.
- **Data Correlation:** It meticulously correlates data across these objects to determine if a `PermissionSetLicenseAssign` record has a corresponding active assignment to a Permission Set or Permission Set Group for the same user.
- **Filtering Logic:** It applies complex filtering logic to exclude PSLAs that are genuinely in use or are part of predefined exceptions (e.g., `alwaysExcludeForActiveUsersPermissionSetLicenses`).
- **Bulk Deletion:** If the user opts to delete unused PSLAs, it uses `bulkUpdate` with the `delete` operation to efficiently remove multiple records.
- **Report Generation:** It uses `generateCsvFile` to create the CSV report of unused PSLAs.
- **Notification Integration:** It integrates with the `NotifProvider` to send notifications, including attachments of the generated CSV report and metrics for monitoring dashboards.
- **User Interaction:** Uses `prompts` for interactive confirmation before performing deletion operations.
</details>


## Parameters

| Name              |  Type   | Description                                                       | Default | Required | Options |
|:------------------|:-------:|:------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                   |         |          |         |
| flags-dir         | option  | undefined                                                         |         |          |         |
| json              | boolean | Format output as json.                                            |         |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required     |         |          |         |
| target-org<br/>-o | option  | undefined                                                         |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |         |          |         |

## Examples

```shell
$ sf hardis:org:diagnose:unusedlicenses
```

```shell
$ sf hardis:org:diagnose:unusedlicenses --fix
```


