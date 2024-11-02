<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:multi-org-query

## Description

Executes a SOQL query in multiple orgs and generate a single report from it
  
You can send a custom query using --query, or use one of the predefined queries using --query-template.

If you use the command from a CI/CD job, you must previously authenticate to the usernames present in --target-orgs.

[![Use in VsCode SFDX Hardis !](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/multi-org-query-demo.gif)](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)


## Parameters

| Name                  |  Type   | Description                                                       | Default | Required |          Options           |
|:----------------------|:-------:|:------------------------------------------------------------------|:-------:|:--------:|:--------------------------:|
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                   |         |          |                            |
| flags-dir             | option  | undefined                                                         |         |          |                            |
| json                  | boolean | Format output as json.                                            |         |          |                            |
| outputfile<br/>-f     | option  | Force the path and name of output report file. Must end with .csv |         |          |                            |
| query<br/>-q          | option  | SOQL Query to run on multiple orgs                                |         |          |                            |
| query-template<br/>-t | option  | Use one of predefined SOQL Query templates                        |         |          | active-users<br/>all-users |
| skipauth              | boolean | Skip authentication check when a default username is required     |         |          |                            |
| target-orgs<br/>-x    | option  | List of org usernames or aliases.                                 |         |          |                            |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |         |          |                            |

## Examples

```shell
sf hardis:org:multi-org-query
```

```shell
sf hardis:org:multi-org-query --query "SELECT Id,Username FROM User"
```

```shell
sf hardis:org:multi-org-query --query "SELECT Id,Username FROM User" --target-orgs nico@cloudity.com nico@cloudity.com.preprod nico@cloudity.com.uat
```

```shell
sf hardis:org:multi-org-query --query-template active-users --target-orgs nico@cloudity.com nico@cloudity.com.preprod nico@cloudity.com.uat
```


