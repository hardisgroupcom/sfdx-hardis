<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:monitor:backup

## Description

Retrieve sfdx sources in the context of a monitoring backup

The command exists in 2 modes: filtered(default & recommended) and full.

## Filtered mode (default, better performances)

Automatically skips metadatas from installed packages with namespace.  

You can remove more metadata types from backup, especially in case you have too many metadatas and that provokes a crash, using:

- Manual update of `manifest/package-skip-items.xml` config file (then commit & push in the same branch)

- Environment variable MONITORING_BACKUP_SKIP_METADATA_TYPES (example: `MONITORING_BACKUP_SKIP_METADATA_TYPES=CustomLabel,StaticResource,Translation`): that will be applied to all monitoring branches.

## Full mode

Activate it with **--full** parameter, or variable MONITORING_BACKUP_MODE_FULL=true

Ignores filters (namespaces items & manifest/package-skip-items.xml) to retrieve ALL metadatas, including those you might not care about (reports, translations...)

As we can retrieve only 10000 files by call, the list of all metadatas will be chunked to make multiple calls (and take more time than filtered mode)

- if you use `--full-apply-filters` , manifest/package-skip-items.xml and MONITORING_BACKUP_SKIP_METADATA_TYPES filters will be applied anyway
- if you use `--exclude-namespaces` , namespaced items will be ignored

_With those both options, it's like if you are not using --full, but with chunked metadata download_

## In CI/CD

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-metadata-backup/) and can output Grafana, Slack and MsTeams Notifications.

## Documentation

[Doc generation (including visual flows)](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/) is triggered at the end of the command.

If you want to also upload HTML Documentation on your Salesforce Org as static resource, use variable **SFDX_HARDIS_DOC_DEPLOY_TO_ORG="true"**

If Flow history doc always display a single state, you probably need to update your workflow configuration:

- on Gitlab: Env variable [`GIT_FETCH_EXTRA_FLAGS: --depth 10000`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/.gitlab-ci.yml#L11)
- on GitHub: [`fetch-depth: 0`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/.github/workflows/org-monitoring.yml#L58)
- on Azure: [`fetchDepth: "0"`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/azure-pipelines.yml#L39)
- on Bitbucket: [`step: clone: depth: full`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/bitbucket-pipelines.yml#L18)


## Parameters

| Name                      |  Type   | Description                                                                                                                                | Default | Required | Options |
|:--------------------------|:-------:|:-------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d              | boolean | Activate debug mode (more logs)                                                                                                            |         |          |         |
| exclude-namespaces<br/>-e | boolean | If mode --full is activated, exclude namespaced metadatas                                                                                  |         |          |         |
| flags-dir                 | option  | undefined                                                                                                                                  |         |          |         |
| full                      | boolean | Dot not take in account filtering using package-skip-items.xml and MONITORING_BACKUP_SKIP_METADATA_TYPES. Efficient but much much slower ! |         |          |         |
| full-apply-filters<br/>-z | boolean | If mode --full is activated, apply filters of manifest/package-skip-items.xml and MONITORING_BACKUP_SKIP_METADATA_TYPES anyway             |         |          |         |
| json                      | boolean | Format output as json.                                                                                                                     |         |          |         |
| max-by-chunk<br/>-m       | option  | If mode --full is activated, maximum number of metadatas in a package.xml chunk                                                            |  3000   |          |         |
| outputfile<br/>-f         | option  | Force the path and name of output report file. Must end with .csv                                                                          |         |          |         |
| skip-doc                  | boolean | Skip the generation of project documentation at the end of the command                                                                     |         |          |         |
| skipauth                  | boolean | Skip authentication check when a default username is required                                                                              |         |          |         |
| target-org<br/>-o         | option  | undefined                                                                                                                                  |         |          |         |
| websocket                 | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                  |         |          |         |

## Examples

```shell
sf hardis:org:monitor:backup
```

```shell
sf hardis:org:monitor:backup --full
```

```shell
sf hardis:org:monitor:backup --full --exclude-namespaces
```

```shell
sf hardis:org:monitor:backup --full --exclude-namespaces --full-apply-filters
```


