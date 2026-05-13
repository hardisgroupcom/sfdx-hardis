<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:configure:generic-prompt

## Description


## Command Behavior

**Deploys the `SfdxHardisGenericPrompt` GenAiPromptTemplate metadata to a Salesforce org, enabling AI prompt integration via sfdx-hardis.**

Key functionalities include:

- **Org Selection:** Prompts the user to select a target org (defaults to the current default org). In agent mode, uses the org provided via `--target-org`.
- **Deployment Confirmation:** Asks the user to confirm the deployment before proceeding.
- **Metadata Deployment:** Deploys the `SfdxHardisGenericPrompt.genAiPromptTemplate-meta.xml` file to the selected org using the Metadata API.
- **Production Org Handling:** If the target org is a production org, automatically selects a test class to satisfy Salesforce test requirements.
- **Permission Set Assignment:** Checks if the `EinsteinGPTPromptTemplateUser` Permission Set exists in the org and optionally assigns it to the current user.

### Agent Mode

When `--agent` is specified:
- The org provided via `--target-org` is used without prompting for org selection.
- Deployment proceeds without confirmation prompts.
- If the `EinsteinGPTPromptTemplateUser` Permission Set exists, it is assigned automatically.

<details markdown="1">
<summary>Technical explanations</summary>

- **Metadata Structure:** At runtime, a temporary MDAPI-format directory is created containing the `genAiPromptTemplates/` subdirectory and a `package.xml` manifest. The source file is read from `defaults/utils/SfdxHardisGenericPrompt.genAiPromptTemplate-meta.xml` in the sfdx-hardis package.
- **Production Org Detection:** Uses `isProductionOrg()` to determine if the target org is a production org. For production orgs, `RunSpecifiedTests` is used with a test class found by querying `ApexClass` via the Tooling API.
- **Test Class Selection:** Checks the `SFDX_HARDIS_TECH_DEPLOY_TEST_CLASS` environment variable first, then queries the org for an Apex class with "Test" in its name.
- **Permission Set Check:** Queries the org for the `EinsteinGPTPromptTemplateUser` Permission Set before prompting for assignment.
- **Deployment:** Uses `deployMetadatas()` from `deployUtils.ts` with `--metadata-dir` pointing to the temporary MDAPI directory.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined|nicolas.vuillamy@cloudity.com.integci|||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:org:configure:generic-prompt
```

```shell
$ sf hardis:org:configure:generic-prompt --agent
```


