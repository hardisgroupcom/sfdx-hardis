<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:datacloud:extract:agentforce-conversations

## Description


## Command Behavior

**Extracts Agentforce conversations data from Data Cloud and generates a detailed report.**

This command allows you to retrieve and analyze conversations between users and Agentforce agents. It fetches conversation details, including transcripts, user utterances, agent responses, and any associated feedback.

Key functionalities:

- **Data Extraction:** Queries Data Cloud for Agentforce conversation records.
- **Transcript Retrieval:** Fetches full conversation transcripts associated with the sessions.
- **Filtering:** Supports filtering by date range (from/to) or a rolling window (last N days).
- **Report Generation:** Creates a CSV and XLSX report containing:
  - User information
  - Date and time
  - Full conversation transcript
  - Feedback sentiment and message (if available)
  - Direct link to the conversation in Salesforce
- **Link Generation:** Generates clickable URLs to view the conversation in the Agentforce Analytics dashboard.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Data Cloud Query:** Executes a SQL query against Data Cloud tables (`GenAIGeneration__dlm`, `GenAIGatewayRequest__dlm`, etc.) to retrieve conversation metadata and individual turns.
- **Session Management:** Extracts session IDs from the initial query results.
- **Transcript Fetching:** Asynchronously fetches full conversation transcripts for the identified sessions in chunks to handle large volumes efficiently.
- **Data Merging:** Combines the SQL query results with the fetched transcripts, prioritizing full transcripts over individual turn data when available.
- **URL Construction:** dynamically builds deep links to the Salesforce Lightning Experience for each conversation based on the org's instance URL and conversation ID.
- **File Output:** Uses `generateCsvFile` to output the processed data into CSV and XLSX formats with custom column widths and formatting.
- **Exclusion Filters:** Supports excluding specific conversations or sessions via environment variables `AGENTFORCE_FEEDBACK_EXCLUDED_CONV_IDS` and `AGENTFORCE_EXCLUDED_SESSION_IDS` (comma-separated IDs).
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|date-from|option|Optional ISO-8601 timestamp (UTC) to include conversations starting from this date||||
|date-to|option|Optional ISO-8601 timestamp (UTC) to include conversations up to this date||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|last-n-days|option|Optional rolling window (days) to include only the most recent conversations||||
|outputfile<br/>-f|option|Force the path and name of output report file. Must end with .csv||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined|nicolas.vuillamy@cloudity.com.afterftd|||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:datacloud:extract:agentforce-conversations
```


