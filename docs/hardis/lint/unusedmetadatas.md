<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:lint:unusedmetadatas

## Description


## Command Behavior

**Checks for unused custom labels and custom permissions within your Salesforce DX project.**

This command helps identify and report on custom labels and custom permissions that are defined in your project but do not appear to be referenced anywhere in your codebase. Identifying unused metadata is crucial for:

- **Code Cleanliness:** Removing dead code and unnecessary metadata improves project maintainability.
- **Performance:** Reducing the overall size of your metadata, which can positively impact deployment times and org performance.
- **Clarity:** Ensuring that all defined components serve a purpose, making the codebase easier to understand.

It specifically scans for references to custom labels (e.g., `$Label.MyLabel`) and custom permissions (by their API name or label) across various file types (Apex, JavaScript, HTML, XML, etc.).

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-unused-metadata/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** It uses `glob` to find all relevant project files (Apex classes, triggers, JavaScript, HTML, XML, Aura components, Visualforce pages) and custom label (`CustomLabels.labels-meta.xml`) and custom permission (`.customPermission-meta.xml`) definition files.
- **XML Parsing:** It uses `xml2js` to parse the XML content of `CustomLabels.labels-meta.xml` and custom permission files to extract the full names of labels and permissions.
- **Content Scanning:** For each label and custom permission, it iterates through all other project files and checks if their names or associated labels are present in the file content. It performs case-insensitive checks for labels.
- **Usage Tracking:** It maintains a count of how many times each custom permission is referenced. Labels are checked for any inclusion.
- **Unused Identification:** Elements with no or very few references (for custom permissions, less than 2 to account for their own definition file) are flagged as unused.
- **Data Aggregation:** All identified unused labels and custom permissions are collected into a list.
- **Report Generation:** It generates a CSV report (`lint-unusedmetadatas.csv`) containing details of all unused metadata elements.
- **Notification Integration:** It integrates with the `NotifProvider` to send notifications (e.g., to Slack, MS Teams, Grafana) about the presence and count of unused metadata, making it suitable for automated monitoring in CI/CD pipelines.
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
$ sf hardis:lint:unusedmetadatas
```


