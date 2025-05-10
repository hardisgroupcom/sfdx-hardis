<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:mkdocs-to-cf

## Description

Generates MkDocs HTML pages and upload them to Cloudflare as a static pages

This command performs the following operations:

- Generates MkDocs HTML pages (using locally installed mkdocs-material, or using mkdocs docker image)
- Creates a Cloudflare pages app
- Assigns a policy restricting access to the application
- Opens the new WebSite in the default browser (only if not in CI context)

Note: the documentation must have been previously generated using "sf hardis:doc:project2markdown --with-history"

You can:

- Override default styles by customizing mkdocs.yml

More info on [Documentation section](https://sfdx-hardis.cloudity.com/salesforce-project-documentation/)


| Variable                                        | Description | Default |
| :-----------------------------------------      | :---------- | :-----: |
| `CLOUDFLARE_EMAIL`                            | Cloudflare account email | <!--- Required --> |
| `CLOUDFLARE_API_TOKEN`                        | Cloudflare API token | <!--- Required --> |
| `CLOUDFLARE_ACCOUNT_ID`                       | Cloudflare account | <!--- Required --> |
| `CLOUDFLARE_PROJECT_NAME`                     | Project name, that will also be used for site URL | Built from git branch name |
| `CLOUDFLARE_DEFAULT_LOGIN_METHOD_TYPE`        | Cloudflare default login method type | `onetimepin` |
| `CLOUDFLARE_DEFAULT_ACCESS_EMAIL_DOMAIN`      | Cloudflare default access email domain | `@cloudity.com` |
| `CLOUDFLARE_EXTRA_ACCESS_POLICY_ID_LIST`    | Policies to assign to every application access | <!--- Optional --> |



## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:doc:mkdocs-to-cf
```


