<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:audit:callincallout

## Description


## Command Behavior

**Audits Apex classes for inbound (Call-In) and outbound (Call-Out) API calls, providing insights into integration points.**

This command helps developers and architects understand the integration landscape of their Salesforce project by identifying where Apex code interacts with external systems or exposes functionality for external consumption. It's useful for security reviews, refactoring efforts, and documenting system integrations.

Key functionalities:

- **Inbound Call Detection:** Identifies Apex methods exposed as web services (`webservice static`) or REST resources (`@RestResource`).
- **Outbound Call Detection:** Detects HTTP callouts (`new HttpRequest`).
- **Detailed Information:** Extracts relevant details for each detected call, such as endpoint URLs for outbound calls or resource names for inbound calls.
- **Test Class Exclusion:** Automatically skips test classes (`@isTest`) to focus on production code.
- **CSV Report Generation:** Generates a CSV report summarizing all detected call-ins and call-outs, including their type, subtype (protocol), file name, namespace, and extracted details.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses `glob` to find all Apex class (`.cls`) and trigger (`.trigger`) files within the project.
- **Content Analysis:** Reads the content of each Apex file and uses regular expressions to identify patterns indicative of inbound or outbound calls.
- **Pattern Matching:** Defines a set of `catchers`, each with a `type` (INBOUND/OUTBOUND), `subType` (SOAP/REST/HTTP), and `regex` to match specific API call patterns. It also includes `detail` regexes to extract additional information.
- **`catchMatches` Utility:** This utility function is used to apply the defined `catchers` to each Apex file and extract all matching occurrences.
- **Data Structuring:** Organizes the extracted information into a structured format, including the file name, namespace, and detailed matches.
- **Reporting:** Uses `generateReports` to create a CSV report and display a table in the console, summarizing the audit findings.
- **Filtering:** Filters out files that start with 'hidden' or contain `@isTest` to focus on relevant code.
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
$ sf hardis:project:audit:callouts
```


