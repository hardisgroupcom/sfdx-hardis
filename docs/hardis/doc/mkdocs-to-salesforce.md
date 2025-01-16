<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:mkdocs-to-salesforce

## Description

Generates MkDocs HTML pages and upload them to Salesforce as a static resource

This command performs the following operations:

- Generates MkDocs HTML pages (using locally installed mkdocs-material, or using mkdocs docker image)
- Creates a Static Resource, a VisualForce page and a Custom Tab metadata
- Upload the metadatas to the default org
- Opens the Custom Tab in the default browser (only if not in CI context)

Note: the documentation must have been previously generated using "sf hardis:doc:project2markdown --with-history"

You can:

- Specify the type of documentation to generate (CICD or Monitoring) using the --type flag. Default is CICD.
- Override default styles by customizing mkdocs.yml

More info on [Documentation section](https://sfdx-hardis.cloudity.com/salesforce-project-documentation/)


## Parameters

| Name              |  Type   | Description                                                   | Default | Required |       Options       |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------------------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |                     |
| flags-dir         | option  | undefined                                                     |         |          |                     |
| json              | boolean | Format output as json.                                        |         |          |                     |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |                     |
| target-org<br/>-o | option  | undefined                                                     |         |          |                     |
| type<br/>-t       | option  | Type of the documentation to generate. Default is "all"       |  CICD   |          | CICD<br/>Monitoring |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |                     |

## Examples

```shell
sf hardis:doc:mkdocs-to-salesforce
```


