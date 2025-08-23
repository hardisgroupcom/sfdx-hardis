<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:misc:servicenow-report

## Description

This command retrieves user stories from Salesforce and enriches them with data from ServiceNow.

Define the following environment variables (in CICD variables or locally in a **.env** file):

- SERVICENOW_URL: The base URL of the ServiceNow API (ex: https://your-instance.service-now.com/)
- SERVICENOW_USERNAME: The username for ServiceNow API authentication.
- SERVICENOW_PASSWORD: The password for ServiceNow API authentication.

You also need to define JSON configuration file(e) in folder **config/user-stories/**

Example:

```json
{
    "userStoriesConfig": {
        "fields": [
            "Id",
            "Name",
            "Ticket_Number__c",
            "copado__User_Story_Title__c",
            "CreatedBy.Name",
            "copado__Release__r.Name",
            "copado__Environment__r.Name"
        ],
        "table": "copado__User_Story__c",
        "where": "copado__Environment__r.Name ='UAT'",
        "whereChoices": {
          "UAT all": "copado__Environment__r.Name ='UAT'",
          "UAT postponed": "copado__Environment__r.Name ='UAT' AND copado__Release__r.Name = 'postponed'",
          "UAT in progress": "copado__Environment__r.Name ='UAT' AND copado__Release__r.Name != 'postponed' AND copado__Release__r.Name != 'cancelled'"
        },
        "orderBy": "Ticket_Number__c ASC",
        "ticketField": "Ticket_Number__c",
        "reportFields": [
            { "key": "US Name", "path": "Name" },
            { "key": "US SN Identifier", "path": "Ticket_Number__c" },
            { "key": "US Title", "path": "copado__User_Story_Title__c" },
            { "key": "US Created By", "path": "CreatedBy.Name" },
            { "key": "US Environment", "path": "copado__Environment__r.Name" },
            { "key": "US Release", "path": "copado__Release__r.Name" },
            { "key": "SN Identifier", "path": "serviceNowInfo.number", "default": "NOT FOUND" },
            { "key": "SN Title", "path": "serviceNowInfo.short_description", "default": "NOT FOUND" },
            { "key": "SN Status", "path": "serviceNowInfo.state", "default": "NOT FOUND" },
            { "key": "SN Created By", "path": "serviceNowInfo.sys_created_by", "default": "NOT FOUND" },
            { "key": "SN URL", "special": "serviceNowTicketUrl" }
        ]
    },
    "serviceNowConfig": {
        "tables": [
            { "tableName": "demand" },
            { "tableName": "incident" }
        ]
    }
}
```
  

## Parameters

| Name                |  Type   | Description                                                                                                 | Default | Required | Options |
|:--------------------|:-------:|:------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| config<br/>-c       | option  | Path to JSON config file containing user stories and ServiceNow configuration                               |         |          |         |
| debug<br/>-d        | boolean | Activate debug mode (more logs)                                                                             |         |          |         |
| flags-dir           | option  | undefined                                                                                                   |         |          |         |
| json                | boolean | Format output as json.                                                                                      |         |          |         |
| outputfile<br/>-f   | option  | Force the path and name of output report file. Must end with .csv                                           |         |          |         |
| skipauth            | boolean | Skip authentication check when a default username is required                                               |         |          |         |
| target-org<br/>-o   | option  | undefined                                                                                                   |         |          |         |
| websocket           | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                   |         |          |         |
| where-choice<br/>-w | option  | Where selection for user stories. If not provided, you will be prompted to select one from the config file. |         |          |         |

## Examples

```shell
$ sf hardis:misc:servicenow-report
```


