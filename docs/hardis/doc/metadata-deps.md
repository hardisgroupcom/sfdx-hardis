<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:metadata-deps

## Description


## Command Behavior

**Finds which Salesforce metadata components use one selected component.**

Select a common metadata type and API name interactively, pass `--type` and `--name`, or pass a local source file with `--source-file`. The command resolves the component to a Salesforce Id, queries Tooling API `MetadataComponentDependency`, and reports the inbound (used-by) dependencies.

- **Any metadata type:** The component is found by its API name, the one of its source file (`Account.Status__c`, `MyFolder/MyReport`, `Account-Account Layout`, `Account.MyValidationRule`...), whatever its type.
- **Org, not local files:** Dependencies are read from the target org. Even with `--source-file`, the file only tells which component to look up: changes not deployed yet are not taken into account.
- **Local file:** Pass `--source-file` with the path of a metadata source file (an Apex class, a Flow, a field, a layout, any file of a LWC or Aura bundle...) to find what uses it. The VS Code extension uses it from the right-click menu of metadata files.
- **Standard objects:** `--type CustomObject --name Account` looks up standard objects too. Standard fields are not in the Salesforce dependency data, only custom fields are.
- **Direct Id:** Pass `--id` to skip lookup. Without `--type`, dependencies are not filtered on the selected component type.
- **Dependent type filter:** Pass `--component-type Flow` (for example) to keep only one type of dependent component.
- **Large graphs:** Pass `--bulk` to run a Tooling API Bulk API 2.0 query job, including Report dependencies and graphs that can exceed 2,000 rows. Developer Edition orgs reject Bulk queries on this object.
- **Reports:** Writes a Used by CSV and an Excel workbook with Summary and Used by sheets under `hardis-report/metadata-deps/<api-name>-<type>/`.

`MetadataComponentDependency` is a beta Salesforce object. Its coverage depends on the org and Salesforce release. Profiles, Permission Sets, List Views, approval processes, sharing rules and some relationship metadata may be absent from the graph.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:doc:metadata-deps --agent --target-org myOrgAlias --type ApexClass --name MyClass
```

In agent mode, pass either `--source-file`, `--id`, or both `--type` and `--name`. If lookup returns several records, rerun with `--id`. No prompt is displayed.

<details markdown="1">
<summary>Technical explanations</summary>

- The selected component is the `RefMetadataComponent*` side of `MetadataComponentDependency`; each `MetadataComponent*` row is a component that uses it.
- The Id comes from the Metadata API `listMetadata` call for the type (in the folder of the name for Report, Dashboard, Document and EmailTemplate): the component whose `fullName` is the given name, URL-encoded or not. It is the Id `MetadataComponentDependency` uses, including the active version of a Flow.
- The `listMetadata` and `EntityDefinition` results are cached for 30 days per org Id under `~/.sfdx/sfdx-hardis-cache/orgs/<orgId>/` (`SFDX_HARDIS_ORG_API_CACHE_TTL_DAYS` changes the duration, `NO_CACHE` disables it, `sf hardis:cache:clear` empties it). Only the name to Id mapping is cached, never the dependencies: a dependency created in Setup a second ago is found. The mapping is checked again when it could be outdated: a name missing from a cached list is listed again (a component created since), a cached Id with no dependency is listed again (a component deleted then created again with the same name), and Flows are never cached (activating another version changes the Id).
- A standard object is listed without an Id: it is looked up through `EntityDefinition`, whose `DurableId` is the object API name, and queried as `StandardEntity`.
- When `listMetadata` finds nothing (a Tooling-only type, or a name that is not an API name such as a custom object without its `__c` suffix), the command queries the Tooling object of the type by `Name` or `DeveloperName`.
- `--bulk` creates a query job on `/services/data/vXX.X/tooling/jobs/query`, polls it, and reads the CSV results page by page.
- `--source-file` resolves the file with the `@salesforce/source-deploy-retrieve` metadata resolver, then runs the same lookup as `--type` and `--name`. It cannot be combined with `--id`, `--type` or `--name`.
- Salesforce does not allow `RefMetadataComponentType = 'StandardEntity'`; for this type the command filters by Id only.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|bulk|boolean|Use a Tooling API Bulk API 2.0 query job for large dependency graphs and Reports||||
|component-type|option|Only return dependent components of this Tooling metadata type||||
|flags-dir|option|undefined||||
|id|option|Salesforce Id of the selected component (15 or 18 characters); skips name lookup||||
|json|boolean|Format output as json.||||
|name|option|API name of the selected component (for example MyClass or Account.Status__c)||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|source-file|option|Local metadata source file (for example force-app/main/default/classes/MyClass.cls); resolves --type and --name||||
|target-org<br/>-o|option|undefined|veurtio+demo.73193ee31bf8@agentforce.com|||
|type|option|Tooling metadata type of the selected component (for example ApexClass, Flow or CustomField)||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:doc:metadata-deps
```

```shell
$ sf hardis:doc:metadata-deps --target-org myOrgAlias --type Flow --name MyFlow
```

```shell
$ sf hardis:doc:metadata-deps --target-org myOrgAlias --type CustomField --name Account.Status__c
```

```shell
$ sf hardis:doc:metadata-deps --target-org myOrgAlias --id 01pxx0000000001AAA --type ApexClass
```

```shell
$ sf hardis:doc:metadata-deps --target-org myOrgAlias --source-file force-app/main/default/objects/Account/fields/Status__c.field-meta.xml
```

```shell
$ sf hardis:doc:metadata-deps --agent --target-org myOrgAlias --source-file force-app/main/default/classes/MyClass.cls
```

```shell
$ sf hardis:doc:metadata-deps --agent --target-org myOrgAlias --type ApexClass --name MyClass --component-type Flow
```

```shell
$ sf hardis:doc:metadata-deps --agent --target-org myOrgAlias --type Report --id 00Oxx0000000001AAA --bulk
```


