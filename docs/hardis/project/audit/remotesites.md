<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:audit:remotesites

## Description


## Command Behavior

**Audits Salesforce Remote Site Settings in your project, providing a comprehensive overview of external endpoints accessed by your Salesforce org.**

This command is crucial for security reviews, compliance checks, and understanding the external integrations of your Salesforce environment. It helps identify all configured remote sites, their URLs, activity status, and associated protocols.

Key functionalities:

- **Remote Site Discovery:** Scans your project for RemoteSiteSetting metadata files (.remoteSite-meta.xml or .remoteSite).
- **URL Extraction:** Extracts the URL, active status, and description for each remote site.
- **Protocol and Domain Identification:** Determines the protocol (HTTP/HTTPS) and extracts the domain from each URL, providing a clearer picture of the external systems being accessed.
- **Reporting:** Generates a CSV report summarizing all detected remote sites, including their protocol, domain, name, URL, active status, and description.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses `glob` to find all RemoteSiteSetting metadata files within the project.
- **Content Analysis:** Reads the content of each XML file and uses regular expressions (/<url>(.*?)<\/url>/gim, /<isActive>(.*?)<\/isActive>/gim, /<description>(.*?)<\/description>/gim) to extract relevant details.
- **`catchMatches` Utility:** This utility function is used to apply the defined regular expressions to each file and extract all matching occurrences.
- **URL Parsing:** Uses Node.js's `url` module to parse the extracted URLs and `psl` (Public Suffix List) to extract the domain name from the hostname.
- **Data Structuring:** Organizes the extracted information into a structured format, including the remote site's name, file name, namespace, URL, active status, description, protocol, and domain.
- **Reporting:** Uses `generateReports` to create a CSV report and display a table in the console, summarizing the audit findings.
</details>


## Parameters

| Name         |  Type   | Description                                                   | Default | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir    | option  | undefined                                                     |         |          |         |
| json         | boolean | Format output as json.                                        |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:project:audit:remotesites
```


