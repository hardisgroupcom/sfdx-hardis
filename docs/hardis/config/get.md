<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:config:get

## Description


## Command Behavior

**Retrieves and displays the sfdx-hardis configuration for a specified level.**

This command allows you to inspect the configuration that is currently in effect for your project, which is useful for debugging and understanding how sfdx-hardis will behave.

- **Configuration levels:** It can retrieve configuration from three different levels:
  - **Project:** The configuration defined in the project's `.sfdx-hardis.yml` file.
  - **Branch:** The configuration defined in a branch-specific configuration file (e.g., `.sfdx-hardis.production.yml`).
  - **User:** The global user-level configuration.

## Technical explanations

The command's logic is straightforward:

- **`getConfig` function:** It calls the `getConfig` utility function, passing the desired configuration level as an argument.
- **Configuration loading:** The `getConfig` function is responsible for finding the appropriate configuration file, reading its contents, and parsing it as YAML or JSON.
- **Output:** The retrieved configuration is then displayed to the user as a JSON string.


## Parameters

| Name         |  Type   | Description                                                   | Default | Required |           Options           |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:---------------------------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |                             |
| flags-dir    | option  | undefined                                                     |         |          |                             |
| json         | boolean | Format output as json.                                        |         |          |                             |
| level<br/>-l | option  | project,branch or user                                        | project |          | project<br/>branch<br/>user |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |                             |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |                             |

## Examples

```shell
$ sf hardis:project:deploy:sources:metadata
```


