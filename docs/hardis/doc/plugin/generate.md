<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:plugin:generate

## Description

Generate Markdown documentation ready for HTML conversion with mkdocs

After the first run, you need to update manually:

- mkdocs.yml
- .github/workflows/build-deploy-docs.yml
- docs/javascripts/gtag.js , if you want Google Analytics tracking

Then, activate Github pages, with "gh_pages" as target branch

At each merge into master/main branch, the GitHub Action build-deploy-docs will rebuild documentation and publish it in GitHub pages


## Parameters

| Name         |  Type   | Description                                                   | Default | Required |                        Options                        |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |                                                       |
| json         | boolean | format output as json                                         |         |          |                                                       |
| loglevel     | option  | logging level for this command invocation                     |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |                                                       |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |                                                       |

## Examples

```shell
$ sfdx hardis:doc:plugin:generate
```


