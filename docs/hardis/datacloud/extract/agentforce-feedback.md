<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:datacloud:extract:agentforce-feedback

## Description


## Command Behavior

**Extracts Agentforce feedback data (Good/Bad) from Data Cloud and sends notifications.**

This command focuses on retrieving explicit feedback provided by users during or after Agentforce conversations. It helps in monitoring agent performance and user satisfaction by aggregating positive and negative feedback.

Key functionalities:

- **Feedback Extraction:** Queries Data Cloud specifically for conversations where feedback (GOOD or BAD) was recorded.
- **Transcript Context:** Retrieves the full conversation transcript to provide context for the feedback.
- **Filtering:** Supports filtering by date range or rolling window.
- **Report Generation:** Generates a CSV and XLSX report detailing:
  - User and Date
  - Feedback type (GOOD/BAD) and message
  - Full conversation context
  - Direct link to the conversation
- **Notifications:** Sends a summary notification (e.g., to Slack, Teams) with the count of Good vs. Bad feedback and attaches the report.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Targeted Query:** Executes a SQL query filtering `GenAIFeedback__dlm` for 'GOOD' or 'BAD' values, joining with generation and session tables.
- **Transcript Enrichment:** Fetches full transcripts for the sessions associated with the feedback to provide a complete view of the interaction.
- **Deduplication:** Implements logic to deduplicate feedback records, ensuring the most recent feedback for a conversation is used.
- **Statistics Calculation:** Computes aggregate statistics (count of Good vs. Bad feedback) for reporting.
- **Notification Integration:** Uses `NotifProvider` to broadcast the feedback summary and the generated report file to configured channels (Slack, MS Teams, etc.).
- **Exclusion Filters:** Supports excluding specific conversations or sessions via environment variables `AGENTFORCE_FEEDBACK_EXCLUDED_CONV_IDS` and `AGENTFORCE_EXCLUDED_SESSION_IDS` (comma-separated IDs).
</details>


## Parameters

| Name                     |  Type   | Description                                                                                   | Default | Required | Options |
|:-------------------------|:-------:|:----------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| conversation-time-filter | option  | Time filter (days) appended to the Lightning analytics URL when generating conversation links |   30    |          |         |
| date-from                | option  | Optional ISO-8601 timestamp (UTC) to include conversations starting from this date            |         |          |         |
| date-to                  | option  | Optional ISO-8601 timestamp (UTC) to include conversations up to this date                    |         |          |         |
| debug<br/>-d             | boolean | Activate debug mode (more logs)                                                               |         |          |         |
| flags-dir                | option  | undefined                                                                                     |         |          |         |
| json                     | boolean | Format output as json.                                                                        |         |          |         |
| last-n-days              | option  | Optional rolling window (days) to include only the most recent conversations                  |         |          |         |
| outputfile<br/>-f        | option  | Force the path and name of output report file. Must end with .csv                             |         |          |         |
| skipauth                 | boolean | Skip authentication check when a default username is required                                 |         |          |         |
| target-org<br/>-o        | option  | undefined                                                                                     |         |          |         |
| websocket                | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                     |         |          |         |

## Examples

```shell
$ sf hardis:datacloud:extract:agentforce-feedback
```

```shell
$ sf hardis:datacloud:extract:agentforce-feedback --target-org myorg@example.com
```

```shell
$ sf hardis:datacloud:extract:agentforce-feedback --outputfile ./reports/agentforce-feedback.csv
```


