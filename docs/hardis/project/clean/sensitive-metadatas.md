<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:sensitive-metadatas

## Description

Sensitive data like credentials and certificates are not supposed to be stored in Git, to avoid security breaches.

This command detects the related metadata and replaces their sensitive content by "HIDDEN_BY_SFDX_HARDIS"

Can be automated at each **hardis:work:save** if **sensitiveMetadatas** is added in .sfdx-hardis.yml **autoCleanTypes** property  

Example in config/.sfdx-hardis.yml:

```yaml
autoCleanTypes:
  - destructivechanges
  - sensitiveMetadatas
```


## Parameters

| Name          |  Type   | Description                                                   |  Default  | Required | Options |
|:--------------|:-------:|:--------------------------------------------------------------|:---------:|:--------:|:-------:|
| debug<br/>-d  | boolean | Activate debug mode (more logs)                               |           |          |         |
| flags-dir     | option  | undefined                                                     |           |          |         |
| folder<br/>-f | option  | Root folder                                                   | force-app |          |         |
| json          | boolean | Format output as json.                                        |           |          |         |
| skipauth      | boolean | Skip authentication check when a default username is required |           |          |         |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |           |          |         |

## Examples

```shell
sf hardis:project:clean:sensitive-metadatas
```


