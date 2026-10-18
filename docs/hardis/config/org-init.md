<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:config:org-init

## Description

Returns how the project initializes its scratch orgs and sandboxes, without connecting to any org.

## Command Behavior

**Gives configuration UIs (e.g. the Org Initialization panel of the [VS Code sfdx-hardis extension](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)) everything they need to show and edit the org initialization steps, so they never rebuild the list themselves.**

The payload contains:

- `steps[]`: the initialization steps in their run order, with their defaults filled (`enabled`, `orgTypes`, `allowFailure`, `runAtPoolFill`).
- `source`: `orgInitSteps` when the project defines the key, `legacy` when the list is built from the older keys (`initPermissionSets`, `scratchOrgInitApexScripts`, `sandboxOrgInitApexScripts`, `installedPackages`, `dataPackages` with `importInSandboxOrgs`, and the `scripts/data/ScratchInit` and `scripts/data/SandboxInit` folders).
- `legacyKeys[]`: the older keys still present in `.sfdx-hardis.yml`.
- `definitionErrors[]`: what prevents a step from running (unknown type, missing parameter, sources deployed to a sandbox...).
- `stepTypes[]`: the step types an org initialization accepts, with the org types each one can run on.
- `scratchDef`: the content of `config/project-scratch-def.json` and its validation issues.
- `scratchOrgDuration` and `scratchDefHints` (editions, features and settings names known by Salesforce CLI).

With `--validate-scratch-def`, the scratch org definition is read from that file instead, so a UI can validate a definition before writing it.

Three options read values from an org (`--source-org`, else the default Dev Hub, else the default org) so a UI can fill the definition from it:

- `--org-values` adds `orgValues`: the languages and countries of its users, and its API versions with their release names (current, previous, and the next one for `preview`).
- `--import-settings accountSettings,lightningExperienceSettings` adds `importedSettings`: those settings read with the Metadata API, written as a scratch org definition expects them.
- `--import-features-from-shape` creates an [org shape](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_shape_intro.htm) of the org and adds `importedShape` with its features. Org Shape must be enabled in that org.

Run [hardis:org:init](https://sfdx-hardis.cloudity.com/hardis/org/init/) to run the steps on an org.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:config:org-init --agent --json
```

The command has no prompt: agent mode behaves the same.

<details markdown="1">
<summary>Technical explanations</summary>

- The steps come from `getOrgInitSteps()` (`src/common/utils/orgInitUtils.ts`), the same function `hardis:scratch:create`, `hardis:org:create` and `hardis:org:init` use.
- The scratch org definition is validated with `ScratchOrgDefSchema` from `@salesforce/core`, then each `settings` entry is checked against the settings names of the Salesforce CLI JSON schema.
- Without the org options, the command is read-only and needs no org. `--import-features-from-shape` runs `sf org create shape` and waits for the `ShapeRepresentation` record to be active.
</details>


## Parameters

| Name                       |  Type   | Description                                                                                                 | Default | Required | Options |
|:---------------------------|:-------:|:------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent                      | boolean | Run in non-interactive mode for agents and automation                                                       |         |          |         |
| debug<br/>-d               | boolean | Activate debug mode (more logs)                                                                             |         |          |         |
| flags-dir                  | option  | Import flag values from a directory.                                                                        |         |          |         |
| import-features-from-shape | boolean | Create an org shape of the source org and return its features                                               |         |          |         |
| import-settings            | option  | Comma-separated settings names of a scratch org definition (accountSettings...) to read from the source org |         |          |         |
| json                       | boolean | Format output as json.                                                                                      |         |          |         |
| org-values                 | boolean | Add the languages, countries and releases of the source org                                                 |         |          |         |
| skipauth                   | boolean | Skip authentication check when a default username is required                                               |         |          |         |
| source-org                 | option  | Alias or username of the org to read values from. Default: the default Dev Hub, else the default org        |         |          |         |
| validate-scratch-def       | option  | Scratch org definition file to validate instead of config/project-scratch-def.json                          |         |          |         |
| websocket                  | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                   |         |          |         |

## Examples

```shell
$ sf hardis:config:org-init --json
```

```shell
$ sf hardis:config:org-init --validate-scratch-def ./tmp/project-scratch-def.json --json
```

```shell
$ sf hardis:config:org-init --org-values --json
```

```shell
$ sf hardis:config:org-init --import-settings accountSettings,securitySettings --source-org my-org --json
```

```shell
$ sf hardis:config:org-init --import-features-from-shape --source-org my-org --json
```

```shell
$ sf hardis:config:org-init --agent --json
```


