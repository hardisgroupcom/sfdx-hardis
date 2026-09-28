<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:metadata-deps

## Description


## Command Behavior

**Finds which Salesforce metadata components use one selected component, or which components it uses.**

Select a common metadata type and API name interactively, pass `--type` and `--name`, or pass a local source file with `--source-file`. The command resolves the component to a Salesforce Id, queries Tooling API `MetadataComponentDependency`, and reports its dependencies in one direction.

- **Both directions:** `--direction used-by` (default) lists the components that use the selected one. `--direction uses` lists the components the selected one uses (fields, objects, classes...).

- **Any metadata type:** The component is found by its API name, the one of its source file (`Account.Status__c`, `MyFolder/MyReport`, `Account-Account Layout`, `Account.MyValidationRule`...), whatever its type.
- **Org, not local files:** Dependencies are read from the target org. Even with `--source-file`, the file only tells which component to look up: changes not deployed yet are not taken into account.
- **Local file:** Pass `--source-file` with the path of a metadata source file (an Apex class, a Flow, a field, a layout, any file of a LWC or Aura bundle...) to find what uses it, or what it uses. The VS Code extension uses it from the right-click menu of metadata files.
- **Standard objects:** `--type CustomObject --name Account` looks up standard objects too. Standard fields are not in the Salesforce dependency data, only custom fields are.
- **Direct Id:** Pass `--id` to skip lookup. Without `--type`, dependencies are not filtered on the selected component type.
- **Type filter:** Pass `--component-type Flow` (for example) to keep only one type of component on the other side of the dependency.
- **Large graphs:** Pass `--bulk` to run a Tooling API Bulk API 2.0 query job, including Report dependencies and graphs that can exceed 2,000 rows. Developer Edition orgs reject Bulk queries on this object.
- **VS Code panel:** In VS Code, the Metadata Dependencies panel shows the result in both directions, opens the files and the Setup pages of the components, drills down and retrieves them. It runs this command with `--json --skip-report`.
- **Reports:** Writes a CSV and an Excel workbook with a Summary sheet and a Used by (or Uses) sheet under `hardis-report/metadata-deps/<api-name>-<type>/`.

![Metadata Dependencies panel](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/metadata-dependencies.png)

`MetadataComponentDependency` is a beta Salesforce object. Its coverage depends on the org and Salesforce release. Profiles, Permission Sets, List Views, approval processes, sharing rules and some relationship metadata may be absent from the graph.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:doc:metadata-deps --agent --target-org myOrgAlias --type ApexClass --name MyClass
```

In agent mode, pass either `--source-file`, `--id`, or both `--type` and `--name`, and `--direction uses` to list what the component uses. If lookup returns several records, rerun with `--id`. No prompt is displayed.

<details markdown="1">
<summary>Technical explanations</summary>

- In `used-by` mode the selected component is the `RefMetadataComponent*` side of `MetadataComponentDependency`, and each `MetadataComponent*` side is a component that uses it. `uses` swaps the sides: the query filters on `MetadataComponentId`, and `--component-type` on `RefMetadataComponentType`.
- The `--json` result is `{ direction, selected, dependencies, reportFiles }`. `selected` is the searched component (`id`, `name`, `type`, `org`), and each item of `dependencies` is the component on the other side: `id`, `name` (as stored in the dependency data: a label or a DeveloperName), `type`, `apiName` (its Metadata API name, from the cached listing matched on the Id, empty for types that cannot be listed), `setupPath`, `localFile` (its source file in the project, empty when absent) and, for a Flow, `versions`.
- The Id comes from the Metadata API `listMetadata` call for the type (in the folder of the name for Report, Dashboard, Document and EmailTemplate): the component whose `fullName` is the given name, URL-encoded or not. It is the Id `MetadataComponentDependency` uses, including the active version of a Flow.
- The `listMetadata` and `EntityDefinition` results are cached for 30 days per org Id under `~/.sfdx/sfdx-hardis-cache/orgs/<orgId>/` (`SFDX_HARDIS_ORG_API_CACHE_TTL_DAYS` changes the duration, `NO_CACHE` disables it, `sf hardis:cache:clear` empties it). Only the name to Id mapping is cached, never the dependencies: a dependency created in Setup a second ago is found. The mapping is checked again when it could be outdated: a name missing from a cached list is listed again (a component created since), a cached Id with no dependency is listed again (a component deleted then created again with the same name), and Flows are never cached (activating another version changes the Id).
- A standard object is listed without an Id: it is looked up through `EntityDefinition`, whose `DurableId` is the object API name, and queried as `StandardEntity`.
- When `listMetadata` finds nothing (a Tooling-only type, or a name that is not an API name such as a custom object without its `__c` suffix), the command queries the Tooling object of the type by `Name` or `DeveloperName`.
- `setupPath` is `/<Id>` (Salesforce redirects it to the Setup page of the component), Flow Builder for a Flow, the Object Manager for a standard object, and the list page for LWC and Aura bundles. A standard object (`StandardEntity`, on the used side) is named by its API name. `--skip-report` skips the CSV and Excel files.
- Salesforce records the dependencies of each Flow version. The Flow versions are resolved with a Tooling query on `Flow` (`Definition.DeveloperName`, `VersionNumber`, `Status`) and merged into one row per Flow, which keeps the active version (else the newest) as its Id and lists its versions in `versions` (the `versions` column of the CSV).
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
|direction|option|used-by: the components that use the selected one; uses: the components the selected one uses|used-by||used-by<br/>uses|
|flags-dir|option|undefined||||
|id|option|Salesforce Id of the selected component (15 or 18 characters); skips name lookup||||
|json|boolean|Format output as json.||||
|name|option|API name of the selected component (for example MyClass or Account.Status__c)||||
|skip-report|boolean|Do not write the CSV and Excel reports nor print the result table: the caller shows the --json result itself (the VS Code panel)||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|source-file|option|Local metadata source file (for example force-app/main/default/classes/MyClass.cls); resolves --type and --name||||
|target-org<br/>-o|option|undefined|nicolas.vuillamy@cloudity.com|||
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
$ sf hardis:doc:metadata-deps --target-org myOrgAlias --type ApexClass --name MyClass --direction uses
```

```shell
$ sf hardis:doc:metadata-deps --target-org myOrgAlias --source-file force-app/main/default/objects/Account/fields/Status__c.field-meta.xml
```

```shell
$ sf hardis:doc:metadata-deps --agent --target-org myOrgAlias --source-file force-app/main/default/classes/MyClass.cls
```

```shell
$ sf hardis:doc:metadata-deps --agent --target-org myOrgAlias --source-file force-app/main/default/flows/MyFlow.flow-meta.xml --direction uses --json
```

```shell
$ sf hardis:doc:metadata-deps --agent --target-org myOrgAlias --type ApexClass --name MyClass --component-type Flow
```

```shell
$ sf hardis:doc:metadata-deps --agent --target-org myOrgAlias --type Report --id 00Oxx0000000001AAA --bulk
```


