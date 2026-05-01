---
title: Data Workspaces with AI Coding Agents
description: Use the /hardis-data Claude Code skill to create, configure, and run SFDMU data workspaces in natural language - including complex export.json generation, data import/export, anonymization, and deployment actions integration
---
<!-- markdownlint-disable MD013 -->

# Data Workspaces with AI Coding Agents

AI coding agents such as [Claude Code](https://docs.anthropic.com/en/docs/claude-code) can generate complete SFDMU data workspace configurations from natural-language descriptions, then trigger data exports and imports using sfdx-hardis commands.

This page documents:

- The **`/hardis-data`** Claude Code skill definition (ready to copy)
- The complete **SFDMU export.json reference** the skill relies on
- How to wire data workspaces into **deployment actions**

---

## The `/hardis-data` Skill

### Installation

Create `.claude/skills/hardis-data/SKILL.md` in your project with the following content:

````markdown
---
name: hardis-data
description: Generate, edit, and run SFDMU data workspaces for Salesforce data migration - create export.json configs, trigger imports/exports, set up data anonymization, and wire data actions into deployment pipelines. Use when the user asks to create a data workspace, export/import data, anonymize fields, configure SFDMU, manage CSV data, or add a data deployment action. Use this skill even if the user says "create data workspace", "export accounts", "import test data", "anonymize contacts", "set up SFDMU", "add data step to deployment", "migrate data", "seed scratch org data", or "delete old records".
argument-hint: "[description of data workspace or operation]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
user-invocable: true
---

You are a Salesforce data migration expert. You help users create, edit, and run SFDMU
data workspaces managed by sfdx-hardis.

## CRITICAL: External ID Resolution

**Every** object with an `Upsert`, `Update`, or `Readonly` operation MUST have a verified `externalId`.
Never guess or blindly default to `Name`. Follow this procedure for each object:

### Step 1: Look for a declared External ID field

**Option A -- Local metadata (preferred when available):**
Search for `.field-meta.xml` files of the object in the local project and look for
`<externalId>true</externalId>`:

```bash
grep -rl "<externalId>true</externalId>" force-app/**/objects/<ObjectName>/fields/ 2>/dev/null
```

**Option B -- Tooling API on target org (when local metadata is incomplete or absent):**

```bash
sf data query --query "SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '<ObjectName>' AND IsExternalId = true" --target-org <orgAlias> --json
```

If either method returns one or more External ID fields, use the most appropriate one.
**Never use an AutoNumber field as externalId** -- AutoNumber values are generated independently
per org and will not match between source and target, causing every record to be treated as new.

### Step 2: No External ID field exists -- build a composite key

If no declared External ID field is found, you must identify a combination of fields whose
values are **unique across all records** in the table. Candidates: `Name`, `DeveloperName`,
`Email`, `Username`, lookup relationships combined with a name field, etc.

**Verify uniqueness by querying the org:**

```bash
sf data query --query "SELECT <Field1>, <Field2>, COUNT(Id) cnt FROM <ObjectName> GROUP BY <Field1>, <Field2> HAVING COUNT(Id) > 1" --target-org <orgAlias> --json
```

- If the query returns **zero rows**, the combination is unique -- use it as a composite
  external ID with semicolons: `"externalId": "Field1;Field2"`
- If the query returns rows, those fields have duplicates -- try a different/wider
  combination and re-check.
- For standard objects with well-known unique fields, you may skip the query:
  - `User` -> `Username`
  - `RecordType` -> `DeveloperName;SobjectType` (or `DeveloperName;NamespacePrefix;SobjectType`)
  - `Profile` -> `Name`
  - `Group` -> `DeveloperName`
  - `BusinessProcess` -> `Name;SobjectType`

### Step 3: Same-org Update or Delete operations

When the operation is `Update` or `Delete`/`DeleteSource` targeting the **same org** the data
was exported from, `"externalId": "Id"` is acceptable -- the Salesforce record ID is the
primary key.

### Summary

| Scenario | externalId to use |
|---|---|
| Object has a declared External ID field | That field (e.g. `External_Key__c`) |
| Standard object with well-known unique field | The known field (e.g. `Username` for User) |
| No External ID, combination of fields is unique | Composite key: `"Field1;Field2"` |
| Same-org Update/Delete only | `"Id"` |

**Never use `Name` as external ID without first confirming it is either a declared External ID
or genuinely unique for that object in the org.**

**Never use an AutoNumber field as externalId** -- AutoNumber values are generated per org and
will differ between source and target, making matching impossible.

## Data Workspace Structure

Workspaces live under `scripts/data/<WorkspaceName>/` and contain:

- `export.json` -- the SFDMU configuration file (see full reference below)
- `*.csv` -- exported data files (one per object, auto-generated)
- `logs/` -- execution logs (auto-created)

## Creating a Data Workspace

1. Create the folder: `scripts/data/<PascalCaseName>/`
2. Write `export.json` inside it following the specification below
3. The workspace is immediately usable for export/import

## Running Data Operations

```bash
# Export data from an org to CSV files
sf hardis:org:data:export --agent --path scripts/data/<WorkspaceName> --target-org <orgAlias>

# Import CSV data into an org
sf hardis:org:data:import --agent --path scripts/data/<WorkspaceName> --target-org <orgAlias>

# Delete records from an org
sf hardis:org:data:delete --agent --path scripts/data/<WorkspaceName> --target-org <orgAlias>
```

## Wiring Data into Deployment Actions

To run a data import automatically during deployments, create a deployment action:

```bash
sf hardis:project:action:create --agent \
  --scope <project|branch|pr> --when <pre-deploy|post-deploy> \
  --type data --label "<description>" --sfdmu-project <WorkspaceName> \
  [--pr-id <id>] [--context process-deployment-only]
```

Or add it directly in the YAML config:

```yaml
# config/.sfdx-hardis.yml (project scope) or scripts/actions/.sfdx-hardis.<prId>.yml
commandsPostDeploy:
  - id: importMyData
    label: Import reference data
    type: data
    parameters:
      sfdmuProject: MyWorkspaceName
    context: process-deployment-only
```

## Auto-Import in Scratch Orgs

To auto-import data when creating scratch orgs, add to `config/.sfdx-hardis.yml`:

```yaml
dataPackages:
  - dataPath: scripts/data/<WorkspaceName>
    importInScratchOrgs: true
```

## export.json Reference

### Root-Level Properties

| Property | Type | Default | Description |
|---|---|---|---|
| `sfdxHardisLabel` | string | -- | Display name for the workspace (sfdx-hardis specific) |
| `sfdxHardisDescription` | string | -- | Description (sfdx-hardis specific) |
| `objects` | ScriptObject[] | -- | Array of object migration definitions (required) |
| `objectSets` | ScriptObjectSet[] | -- | Groups of objects processed as sub-jobs |
| `allOrNone` | boolean | false | Abort if any record fails |
| `bulkApiVersion` | string | "2.0" | "1.0" or "2.0" |
| `bulkThreshold` | integer | 200 | Record count triggering Bulk API for CRUD |
| `concurrencyMode` | string | "Parallel" | "Serial" or "Parallel" (Bulk API V1) |
| `apiVersion` | string | auto | Salesforce API version (e.g. "62.0") |
| `simulationMode` | boolean | false | Preview mode without updating target |
| `promptOnMissingParentObjects` | boolean | true | Prompt on missing parents |
| `promptOnIssuesInCSVFiles` | boolean | true | Prompt on CSV issues |
| `createTargetCSVFiles` | boolean | true | Generate target CSV reports |
| `excludeIdsFromCSVFiles` | boolean | false | Omit ID columns from CSV |
| `keepObjectOrderWhileExecute` | boolean | false | Preserve array order (false = smart order) |
| `bulkApiV1BatchSize` | integer | 9500 | Batch size for Bulk API V1 |
| `queryBulkApiThreshold` | integer | 30000 | Record count triggering Bulk API for queries |
| `restApiBatchSize` | integer | -- | REST API batch size |
| `parallelBulkJobs` | integer | 1 | Concurrent Bulk API jobs |
| `parallelRestJobs` | integer | 1 | Concurrent REST API jobs |
| `allowFieldTruncation` | boolean | false | Truncate values to metadata lengths |
| `csvFileDelimiter` | string | "," | CSV delimiter |
| `csvFileEncoding` | string | "utf8" | CSV encoding |
| `csvInsertNulls` | boolean | true | Null handling for CSV |
| `csvUseEuropeanDateFormat` | boolean | false | Day-first date parsing |
| `binaryDataCache` | string | "InMemory" | "InMemory", "CleanFileCache", "FileCache" |
| `sourceRecordsCache` | string | "InMemory" | "InMemory", "CleanFileCache", "FileCache" |
| `pollingIntervalMs` | integer | 5000 | Bulk API polling interval |
| `runnableInProduction` | boolean | false | Required true for delete in production |
| `beforeAddons` | AddonDef[] | -- | Add-ons before migration |
| `afterAddons` | AddonDef[] | -- | Add-ons after migration |
| `dataRetrievedAddons` | AddonDef[] | -- | Add-ons after retrieval |
| `excludedObjects` | string[] | -- | Global object exclusion list |

### ScriptObject Properties (each entry in `objects`)

| Property | Type | Default | Description |
|---|---|---|---|
| `query` | string | **required** | SOQL query (supports `SELECT all FROM Object` shorthand) |
| `operation` | string | "Readonly" | Operation type (see values below) |
| `externalId` | string | "Name" | External ID field for matching -- **must be resolved using the procedure above, never guessed** |
| `master` | boolean | true | Master object in hierarchy |
| `deleteOldData` | boolean | false | Delete old target records first |
| `deleteFromSource` | boolean | false | Delete from source org |
| `deleteByHierarchy` | boolean | false | Cascading hierarchical deletion |
| `deleteQuery` | string | -- | SOQL WHERE for old-data deletion |
| `hardDelete` | boolean | false | Bypass Recycle Bin |
| `excluded` | boolean | false | Exclude object from migration |
| `excludedFields` | string[] | -- | Fields to omit |
| `excludedFromUpdateFields` | string[] | -- | Fields retrieved but not updated |
| `skipExistingRecords` | boolean | false | Skip updates for existing records |
| `skipRecordsComparison` | boolean | false | Skip source/target comparison |
| `useQueryAll` | boolean | false | Include deleted/archived records |
| `queryAllTarget` | boolean | false | Query all target records |
| `useSourceCSVFile` | boolean | false | Use CSV as data source |
| `sourceRecordsFilter` | string | -- | AlaSQL filter on source records |
| `targetRecordsFilter` | string | -- | AlaSQL filter on target records |
| `useFieldMapping` | boolean | false | Enable field mapping |
| `fieldMapping` | MappingItem[] | -- | Field mapping definitions |
| `useValuesMapping` | boolean | false | Enable ValueMapping.csv |
| `updateWithMockData` | boolean | false | Enable data anonymization |
| `mockFields` | MockField[] | -- | Anonymization field definitions |
| `bulkApiV1BatchSize` | integer | -- | Object-level batch size |
| `restApiBatchSize` | integer | -- | Object-level REST batch size |
| `parallelBulkJobs` | integer | 1 | Object-level parallel bulk jobs |
| `parallelRestJobs` | integer | 1 | Object-level parallel REST jobs |
| `alwaysUseRestApi` | boolean | false | Force REST API |
| `alwaysUseBulkApi` | boolean | false | Force Bulk API |
| `alwaysUseBulkApiToUpdateRecords` | boolean | false | Force Bulk API for DML only |
| `beforeAddons` | AddonDef[] | -- | Add-ons before this object |
| `afterAddons` | AddonDef[] | -- | Add-ons after this object |
| `filterRecordsAddons` | AddonDef[] | -- | Record filter add-ons |

**Operation values:** `Insert`, `Update`, `Upsert`, `Readonly`, `Delete`, `HardDelete`, `DeleteSource`, `DeleteHierarchy`

### MockField Properties (data anonymization)

| Property | Type | Description |
|---|---|---|
| `name` | string | Field to anonymize (or `"all"` for all fields) |
| `pattern` | string | Fake data type (see patterns below) |
| `locale` | string | Locale code (e.g. `"en_US"`, `"fr_FR"`) |
| `excludedRegex` | string | JS regex to exclude values |
| `includedRegex` | string | JS regex to include values |
| `excludeNames` | string[] | Fields to skip when name is `"all"` |

**Pattern values:** `country`, `city`, `street`, `address`, `zip`, `name`, `full_name`, `username`, `first_name`, `last_name`, `email`, `sentence`, `title`, `text`, `word`, `ip`, `domain`, `url`, `integer`, `date`, `time`, `year`, `ids`

**Special functions:**
- `c_seq_number('prefix', startNum, increment)` -- sequential numbers
- `c_seq_date('YYYY-MM-DD', step)` -- sequential dates (steps: `d`, `m`, `y`, `-d`, `s`, `ms`)
- `c_set_value('value')` -- fixed constant

### MappingItem Properties (field mapping)

| Property | Type | Description |
|---|---|---|
| `targetObject` | string | Destination object (first item only) |
| `sourceField` | string | Source field name |
| `targetField` | string | Target field name |

### Composite External ID

Use semicolons for composite keys: `"externalId": "Field1;Field2"`

### Polymorphic Lookups

Use `$` syntax: `ParentId$Account`, `WhatId$Opportunity`, `WhoId$Contact`

### Field Multiselect Keywords (in SOQL)

`all`, `custom_true`, `custom_false`, `readonly_true`, `readonly_false`, `createable_true`, `updateable_true`, `lookup_true`, `lookup_false`, `type_string`, `type_boolean`, etc.

### core:RecordsTransform Add-On

```json
{
  "module": "core:RecordsTransform",
  "args": {
    "fields": [
      { "alias": "varName", "sourceObject": "Account", "sourceField": "Name" }
    ],
    "transformations": [
      { "targetObject": "Contact", "targetField": "Description", "formula": "'Account: ' + formula.varName" }
    ]
  }
}
```

### core:ExportFiles Add-On

```json
{
  "module": "core:ExportFiles",
  "args": { "operation": "Upsert", "externalId": "Title", "deleteOldData": true }
}
```

## Examples

### Simple reference data (upsert by Name)

```json
{
  "sfdxHardisLabel": "Reference Data",
  "sfdxHardisDescription": "Upsert core reference data",
  "objects": [
    { "query": "SELECT Id, Name FROM RecordType WHERE IsActive = true", "operation": "Readonly", "externalId": "DeveloperName;SobjectType" },
    { "query": "SELECT all FROM Account WHERE Type = 'Reference'", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM Contact", "operation": "Upsert", "externalId": "Email", "master": false }
  ],
  "promptOnMissingParentObjects": false,
  "promptOnIssuesInCSVFiles": false
}
```

### Anonymize contacts

```json
{
  "sfdxHardisLabel": "Anonymize Contacts",
  "sfdxHardisDescription": "Anonymize contact emails and names",
  "objects": [
    {
      "query": "SELECT Id, FirstName, LastName, Email, Phone FROM Contact",
      "operation": "Update",
      "externalId": "Id",
      "updateWithMockData": true,
      "mockFields": [
        { "name": "FirstName", "pattern": "first_name" },
        { "name": "LastName", "pattern": "last_name" },
        { "name": "Email", "pattern": "email" },
        { "name": "Phone", "pattern": "integer" }
      ]
    }
  ],
  "allOrNone": true
}
```

### Delete records

```json
{
  "sfdxHardisLabel": "Clean Test Data",
  "sfdxHardisDescription": "Delete test records from org",
  "runnableInProduction": false,
  "objects": [
    { "query": "SELECT Id FROM Case WHERE Subject LIKE 'TEST%'", "operation": "DeleteSource", "deleteFromSource": true },
    { "query": "SELECT Id FROM Account WHERE Name LIKE 'TEST%'", "operation": "DeleteSource", "deleteFromSource": true }
  ]
}
```

### CPQ configuration (complex, multi-object)

```json
{
  "sfdxHardisLabel": "CPQ Configuration",
  "sfdxHardisDescription": "Export/import Salesforce CPQ configuration objects",
  "allOrNone": true,
  "concurrencyMode": "Serial",
  "bulkApiVersion": "1.0",
  "promptOnMissingParentObjects": false,
  "promptOnIssuesInCSVFiles": false,
  "objects": [
    { "query": "SELECT all FROM Product2", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__ProductFeature__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__ProductOption__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM Pricebook2", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM PricebookEntry", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__ProductRule__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__PriceRule__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__DiscountSchedule__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT Name FROM Account", "operation": "Readonly", "externalId": "Name" }
  ]
}
```

### With field mapping and RecordsTransform

```json
{
  "sfdxHardisLabel": "Cross-Org Migration",
  "sfdxHardisDescription": "Migrate accounts with field remapping between orgs",
  "objects": [
    {
      "query": "SELECT Id, Name, BillingCity, Industry FROM Account",
      "operation": "Upsert",
      "externalId": "Name",
      "useFieldMapping": true,
      "fieldMapping": [
        { "targetObject": "Account" },
        { "sourceField": "BillingCity", "targetField": "ShippingCity" }
      ]
    }
  ],
  "dataRetrievedAddons": [
    {
      "module": "core:RecordsTransform",
      "args": {
        "fields": [
          { "alias": "acctName", "sourceObject": "Account", "sourceField": "Name" }
        ],
        "transformations": [
          { "targetObject": "Account", "targetField": "Description", "formula": "'Migrated: ' + formula.acctName" }
        ]
      }
    }
  ]
}
```

## Design Guidelines

When generating an export.json:

1. **Always include** `sfdxHardisLabel` and `sfdxHardisDescription` at the root
2. **Always set** `promptOnMissingParentObjects: false` and `promptOnIssuesInCSVFiles: false` for CI/CD compatibility
3. **Order objects** so parent objects come before children (e.g. Account before Contact)
4. **Include Readonly objects** for reference data that must exist but should not be modified (RecordType, User, etc.)
5. **Use `SELECT all`** when all fields are needed; list specific fields when only a subset is required or for performance
6. **Always resolve externalId** using the "External ID Resolution" procedure above -- search local metadata or query the Tooling API for declared External ID fields first, fall back to a verified-unique composite key, never blindly use `Name`
7. **Use `master: false`** on child objects that depend on parent relationships
8. **For production safety**: never set `runnableInProduction: true` unless explicitly asked; always default to `false`
9. **For delete workspaces**: use `operation: "DeleteSource"` with `deleteFromSource: true`; keep these in separate workspaces from upsert workspaces
10. **Folder naming**: use PascalCase for workspace folder names (e.g. `ReferenceData`, `CPQConfig`, `ContactAnonymize`)

$ARGUMENTS
````

---

## Quick Start

### 1. Generate a workspace with natural language

With the skill installed, ask your coding agent:

> "Create a data workspace to export Account, Contact, and Opportunity records from my org, using Email as the external ID for Contact and Name for everything else"

The agent will create `scripts/data/AccountContactOpportunity/export.json` with the appropriate SFDMU configuration.

### 2. Export data

```bash
sf hardis:org:data:export --agent --path scripts/data/AccountContactOpportunity --target-org myOrg
```

This runs SFDMU to export records from the org into CSV files in the workspace folder.

### 3. Import data

```bash
sf hardis:org:data:import --agent --path scripts/data/AccountContactOpportunity --target-org targetOrg
```

This reads the CSV files and upserts them into the target org.

### 4. Delete records

```bash
sf hardis:org:data:delete --agent --path scripts/data/CleanTestData --target-org targetOrg
```

Requires `deleteFromSource: true` or `operation: "DeleteSource"` in the workspace's export.json.

---

## Data Workspace Folder Structure

```
scripts/data/
  MyWorkspace/
    export.json          -- SFDMU configuration
    Account.csv          -- exported records (auto-generated)
    Contact.csv
    source/              -- source CSV snapshots (auto-created)
    target/              -- target CSV reports (auto-created)
    logs/                -- execution logs (auto-created)
```

---

## Integrating Data Workspaces with Deployment Actions

Data imports can be wired into the CI/CD pipeline as **deployment actions** - steps that run before or after metadata deployment.

### Using the CLI

```bash
# Add a post-deploy data import for a pull request
sf hardis:project:action:create --agent \
  --scope pr --pr-id 123 --when post-deploy \
  --type data --label "Import email templates" --sfdmu-project EmailTemplates

# Add a pre-deploy data import at project level
sf hardis:project:action:create --agent \
  --scope project --when pre-deploy \
  --type data --label "Load reference data" --sfdmu-project ReferenceData
```

### Using YAML configuration directly

**Pull Request scope** (`scripts/actions/.sfdx-hardis.123.yml`):

```yaml
commandsPostDeploy:
  - id: importEmailTemplates
    label: Import email templates
    type: data
    parameters:
      sfdmuProject: EmailTemplates
    context: process-deployment-only
```

**Project scope** (`config/.sfdx-hardis.yml`):

```yaml
commandsPostDeploy:
  - id: loadReferenceData
    label: Load reference data
    type: data
    parameters:
      sfdmuProject: ReferenceData
    context: all
```

**Branch scope** (`config/branches/.sfdx-hardis.integration.yml`):

```yaml
commandsPreDeploy:
  - id: cleanTestRecords
    label: Clean test records before deploy
    type: data
    parameters:
      sfdmuProject: CleanTestData
    context: process-deployment-only
```

### Context values

| Value | Description |
|---|---|
| `all` | Run on every deployment (check and process) |
| `check-deployment-only` | Run only during validation/simulation |
| `process-deployment-only` | Run only during actual deployment |

### Auto-import in scratch orgs

Add to `config/.sfdx-hardis.yml`:

```yaml
dataPackages:
  - dataPath: scripts/data/ReferenceData
    importInScratchOrgs: true
  - dataPath: scripts/data/TestData
    importInScratchOrgs: true
    importInSandboxOrgs: false
```

These workspaces are automatically imported after metadata deployment during scratch org creation (`sf hardis:scratch:create`).

---

## Complete export.json Reference

### Root-Level (Script) Properties

| Property | Type | Default | Description |
|---|---|---|---|
| `sfdxHardisLabel` | string | -- | Display name (sfdx-hardis) |
| `sfdxHardisDescription` | string | -- | Description (sfdx-hardis) |
| `objects` | ScriptObject[] | -- | Object definitions (required unless objectSets used) |
| `objectSets` | ScriptObjectSet[] | -- | Groups of objects as sub-jobs |
| `orgs` | ScriptOrg[] | -- | Org credentials (omit to use CLI auth) |
| `allOrNone` | boolean | false | Abort if any record fails; REST API rolls back |
| `allowFieldTruncation` | boolean | false | Truncate values to metadata-defined lengths |
| `alwaysUseRestApiToUpdateRecords` | boolean | false | Force REST API, bypassing bulkThreshold |
| `apiVersion` | string | auto | API version (e.g. "62.0") |
| `bulkApiV1BatchSize` | integer | 9500 | Records per Bulk API V1 batch |
| `bulkApiVersion` | string | "2.0" | "1.0" or "2.0" |
| `bulkThreshold` | integer | 200 | Record count triggering Bulk API |
| `concurrencyMode` | string | "Parallel" | "Serial" or "Parallel" |
| `createTargetCSVFiles` | boolean | true | Generate target CSV reports |
| `csvAlwaysQuoted` | boolean | true | Quote all CSV values |
| `csvFileDelimiter` | string | "," | CSV delimiter |
| `csvFileEncoding` | string | "utf8" | utf8, utf16le, latin1, ascii, base64 |
| `csvInsertNulls` | boolean | true | Null handling for CSV |
| `csvUseEuropeanDateFormat` | boolean | false | Day-first date parsing |
| `csvUseUtf8Bom` | boolean | true | UTF-8 BOM in CSV output |
| `csvWriteUpperCaseHeaders` | boolean | false | Uppercase CSV headers |
| `excludeIdsFromCSVFiles` | boolean | false | Omit ID/lookup columns from CSV |
| `excludedObjects` | string[] | -- | Global object exclusion list |
| `importCSVFilesAsIs` | boolean | false | Skip CSV validation/repair |
| `keepObjectOrderWhileExecute` | boolean | false | Preserve array order vs. smart order |
| `parallelBinaryDownloads` | integer | 20 | Concurrent binary transfers |
| `parallelBulkJobs` | integer | 1 | Concurrent Bulk API jobs |
| `parallelRestJobs` | integer | 1 | Concurrent REST API jobs |
| `pollingIntervalMs` | integer | 5000 | Bulk API poll interval (ms) |
| `pollingQueryTimeoutMs` | integer | 240000 | SOQL query timeout (ms) |
| `promptOnIssuesInCSVFiles` | boolean | true | Prompt on CSV issues |
| `promptOnMissingParentObjects` | boolean | true | Prompt on missing parents |
| `proxyUrl` | string | -- | Proxy server URL |
| `queryBulkApiThreshold` | integer | 30000 | Record count triggering Bulk API for queries |
| `restApiBatchSize` | integer | -- | REST API batch size |
| `simulationMode` | boolean | false | Dry run without persisting |
| `sourceRecordsCache` | string | "InMemory" | "InMemory", "CleanFileCache", "FileCache" |
| `binaryDataCache` | string | "InMemory" | "InMemory", "CleanFileCache", "FileCache" |
| `useSeparatedCSVFiles` | boolean | false | Separate CSV dirs per object set |
| `validateCSVFilesOnly` | boolean | false | Validate CSV without running migration |
| `runnableInProduction` | boolean | false | Required true for production deletes (sfdx-hardis) |
| `beforeAddons` | AddonDef[] | -- | Add-ons before entire migration |
| `afterAddons` | AddonDef[] | -- | Add-ons after entire migration |
| `dataRetrievedAddons` | AddonDef[] | -- | Add-ons after data retrieval |

### ScriptObject Properties

| Property | Type | Default | Description |
|---|---|---|---|
| `query` | string | **required** | SOQL query string |
| `operation` | string | "Readonly" | See operation values below |
| `externalId` | string | "Name" | External ID field for matching -- **must be resolved using the procedure above, never guessed** |
| `master` | boolean | true | Master object in hierarchy |
| `excluded` | boolean | false | Exclude from migration |
| `excludedFields` | string[] | -- | Fields omitted from migration |
| `excludedFromUpdateFields` | string[] | -- | Retrieved but not updated |
| `deleteOldData` | boolean | false | Delete old target records first |
| `deleteFromSource` | boolean | false | Delete from source org |
| `deleteByHierarchy` | boolean | false | Cascading hierarchical delete |
| `deleteQuery` | string | -- | SOQL for old-data selection |
| `hardDelete` | boolean | false | Bypass Recycle Bin |
| `skipExistingRecords` | boolean | false | Skip existing record updates |
| `skipRecordsComparison` | boolean | false | Skip source/target comparison |
| `useQueryAll` | boolean | false | Include deleted/archived records |
| `queryAllTarget` | boolean | false | Query all target records |
| `useSourceCSVFile` | boolean | false | Use CSV as data source |
| `sourceRecordsFilter` | string | -- | AlaSQL filter on source |
| `targetRecordsFilter` | string | -- | AlaSQL filter on target |
| `useFieldMapping` | boolean | false | Enable field mapping |
| `fieldMapping` | MappingItem[] | -- | Field mappings |
| `useValuesMapping` | boolean | false | Enable ValueMapping.csv |
| `updateWithMockData` | boolean | false | Enable anonymization |
| `mockFields` | MockField[] | -- | Anonymization definitions |
| `bulkApiV1BatchSize` | integer | -- | Object-level Bulk batch size |
| `restApiBatchSize` | integer | -- | Object-level REST batch size |
| `parallelBulkJobs` | integer | 1 | Parallel Bulk jobs |
| `parallelRestJobs` | integer | 1 | Parallel REST jobs |
| `alwaysUseRestApi` | boolean | false | Force REST API |
| `alwaysUseBulkApi` | boolean | false | Force Bulk API |
| `alwaysUseBulkApiToUpdateRecords` | boolean | false | Force Bulk API for DML |
| `respectOrderByOnDeleteRecords` | boolean | false | Force REST single-record delete |
| `beforeAddons` | AddonDef[] | -- | Add-ons before object |
| `afterAddons` | AddonDef[] | -- | Add-ons after object |
| `beforeUpdateAddons` | AddonDef[] | -- | Add-ons before update batch |
| `afterUpdateAddons` | AddonDef[] | -- | Add-ons after update batch |
| `filterRecordsAddons` | AddonDef[] | -- | Record filter add-ons |

### Operation Values

| Operation | Description |
|---|---|
| `Insert` | Create new records only |
| `Update` | Update existing records only |
| `Upsert` | Insert or update based on external ID match |
| `Readonly` | Retrieve without modification (reference data) |
| `Delete` | Remove from target org |
| `HardDelete` | Delete bypassing Recycle Bin |
| `DeleteSource` | Delete from source org |
| `DeleteHierarchy` | Cascading hierarchical deletion |

### MockField Properties

| Property | Type | Description |
|---|---|---|
| `name` | string | Field to anonymize, or `"all"` for all fields |
| `pattern` | string | Fake data type |
| `locale` | string | Locale code (e.g. `"en_US"`, `"fr_FR"`) |
| `excludedRegex` | string | JS regex to exclude values from anonymization |
| `includedRegex` | string | JS regex to include values |
| `excludeNames` | string[] | Fields to skip when name is `"all"` |

**Available patterns:** `country`, `city`, `street`, `address`, `zip`, `name`, `full_name`, `username`, `first_name`, `last_name`, `email`, `sentence`, `title`, `text`, `word`, `ip`, `domain`, `url`, `integer`, `date`, `time`, `year`, `ids`

**Special pattern functions:**

| Function | Description | Example |
|---|---|---|
| `c_seq_number('prefix', start, step)` | Sequential numbers | `c_seq_number('ACC-', 1000, 1)` |
| `c_seq_date('YYYY-MM-DD', step)` | Sequential dates (steps: d, m, y, -d, s, ms) | `c_seq_date('2024-01-01', 'd')` |
| `c_set_value('value')` | Fixed constant value | `c_set_value('ANONYMIZED')` |

### MappingItem Properties

First item must include `targetObject`. Subsequent items map fields:

```json
{
  "useFieldMapping": true,
  "fieldMapping": [
    { "targetObject": "Contact" },
    { "sourceField": "AccountId", "targetField": "Account__c" },
    { "sourceField": "ExternalID__c", "targetField": "External_ID__c" }
  ]
}
```

### ScriptObjectSet

Groups objects into sub-jobs processed sequentially after the main `objects` array:

```json
{
  "objectSets": [
    {
      "objects": [
        { "query": "SELECT Id, Body, ParentId$Account FROM Attachment", "operation": "Insert" }
      ]
    }
  ]
}
```

### Composite External ID Keys

Use semicolons to create composite keys:

```json
"externalId": "DeveloperName;NamespacePrefix;SobjectType"
```

### Polymorphic Lookup Fields

Use `$` to bind a polymorphic field to a specific parent object:

```
ParentId$Account     -- Attachment/Note ParentId to Account
ParentId$Case        -- FeedItem ParentId to Case
WhatId$Opportunity   -- Activity WhatId to Opportunity
WhoId$Contact        -- Activity WhoId to Contact
```

A polymorphic field can only bind to one parent type at a time.

### SOQL Field Multiselect Keywords

Use these keywords in `SELECT` instead of listing individual fields:

| Keyword | Description |
|---|---|
| `all` | All object fields |
| `custom_true` / `custom_false` | Custom vs standard fields |
| `readonly_true` / `readonly_false` | Non-modifiable vs modifiable fields |
| `createable_true` / `createable_false` | By creation capability |
| `updateable_true` / `updateable_false` | By update capability |
| `lookup_true` / `lookup_false` | Relationship vs non-relationship fields |
| `type_string`, `type_boolean`, etc. | By specific field data type |

Example: `SELECT Id, Name, custom_true, lookup_false FROM Account`

### Target Records Filter (AlaSQL syntax)

| Syntax | Meaning |
|---|---|
| `"FieldName"` | Field is not null |
| `"NOT FieldName"` | Field is null |
| `"Field1 AND Field2"` | Both conditions |
| `"Field1 = Field2"` | Field comparison |

### core:RecordsTransform Add-On

Transform records using JavaScript formulas after retrieval:

```json
{
  "module": "core:RecordsTransform",
  "args": {
    "fields": [
      {
        "alias": "acctName",
        "sourceObject": "Account",
        "sourceField": "Name",
        "lookupSource": "source",
        "isConstant": false
      }
    ],
    "transformations": [
      {
        "targetObject": "Contact",
        "targetField": "Description",
        "formula": "'Account: ' + formula.acctName"
      }
    ]
  }
}
```

**Field properties:** `alias` (required), `sourceObject` (required), `sourceField` (required), `valueSource` ("source"/"target"), `lookupSource` ("source"/"target"), `isConstant` (boolean), `lookupExpression` (JS), `includeFields` (string[])

**Transformation properties:** `targetObject` (required), `targetField` (required), `formula` (required, JS), `expressions` (JS array, pre-formula)

### core:ExportFiles Add-On

Migrate ContentVersion, Attachment, and Note files:

```json
{
  "query": "SELECT all FROM Account",
  "operation": "Upsert",
  "externalId": "Name",
  "afterAddons": [
    {
      "module": "core:ExportFiles",
      "args": {
        "operation": "Upsert",
        "externalId": "Title",
        "deleteOldData": false,
        "sourceWhere": "FileType = 'PDF'",
        "maxFileSize": 38797312
      }
    }
  ]
}
```

---

## Complete Examples

### Example 1: Simple reference data

```json
{
  "sfdxHardisLabel": "Reference Data",
  "sfdxHardisDescription": "Core reference data for scratch orgs and sandboxes",
  "promptOnMissingParentObjects": false,
  "promptOnIssuesInCSVFiles": false,
  "objects": [
    {
      "query": "SELECT Id FROM RecordType WHERE IsActive = true",
      "operation": "Readonly",
      "externalId": "DeveloperName;NamespacePrefix;SobjectType"
    },
    {
      "query": "SELECT Id FROM User WHERE IsActive = true",
      "operation": "Readonly",
      "externalId": "Username"
    },
    {
      "query": "SELECT all FROM Account WHERE Type = 'Customer'",
      "operation": "Upsert",
      "externalId": "Name"
    },
    {
      "query": "SELECT all FROM Contact",
      "operation": "Upsert",
      "externalId": "Email",
      "master": false
    }
  ]
}
```

### Example 2: Data anonymization

```json
{
  "sfdxHardisLabel": "Anonymize PII",
  "sfdxHardisDescription": "Anonymize personal data in contacts and accounts",
  "allOrNone": true,
  "objects": [
    {
      "query": "SELECT Id, Name, Phone, Website FROM Account",
      "operation": "Update",
      "externalId": "Id",
      "updateWithMockData": true,
      "mockFields": [
        { "name": "Name", "pattern": "name" },
        { "name": "Phone", "pattern": "integer" },
        { "name": "Website", "pattern": "url" }
      ]
    },
    {
      "query": "SELECT Id, FirstName, LastName, Email, Phone, MailingStreet, MailingCity FROM Contact",
      "operation": "Update",
      "externalId": "Id",
      "updateWithMockData": true,
      "mockFields": [
        { "name": "FirstName", "pattern": "first_name" },
        { "name": "LastName", "pattern": "last_name" },
        { "name": "Email", "pattern": "email" },
        { "name": "Phone", "pattern": "integer" },
        { "name": "MailingStreet", "pattern": "street" },
        { "name": "MailingCity", "pattern": "city" }
      ]
    }
  ]
}
```

### Example 3: Delete old records

```json
{
  "sfdxHardisLabel": "Clean Test Data",
  "sfdxHardisDescription": "Remove test records created during QA",
  "runnableInProduction": false,
  "objects": [
    {
      "query": "SELECT Id FROM Case WHERE Subject LIKE 'TEST%'",
      "operation": "DeleteSource",
      "deleteFromSource": true
    },
    {
      "query": "SELECT Id FROM Opportunity WHERE Name LIKE 'TEST%'",
      "operation": "DeleteSource",
      "deleteFromSource": true
    },
    {
      "query": "SELECT Id FROM Account WHERE Name LIKE 'TEST%'",
      "operation": "DeleteSource",
      "deleteFromSource": true
    }
  ]
}
```

### Example 4: CPQ configuration (complex multi-object)

```json
{
  "sfdxHardisLabel": "CPQ Configuration",
  "sfdxHardisDescription": "Export/import Salesforce CPQ configuration objects",
  "allOrNone": true,
  "concurrencyMode": "Serial",
  "bulkApiVersion": "1.0",
  "promptOnMissingParentObjects": false,
  "promptOnIssuesInCSVFiles": false,
  "objects": [
    { "query": "SELECT all FROM SBQQ__PricingGuidance__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM Product2", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__ProductFeature__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__ProductOption__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM Pricebook2", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM PricebookEntry", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__ProductRule__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__ConfigurationRule__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__PriceRule__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__DiscountSchedule__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__DiscountCategory__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__ErrorCondition__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__PriceCondition__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__PriceAction__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__ProductAction__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__SummaryVariable__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT all FROM SBQQ__LookupQuery__c", "operation": "Upsert", "externalId": "Name" },
    { "query": "SELECT Name FROM Account", "operation": "Readonly", "externalId": "Name" },
    { "query": "SELECT Name FROM Order", "operation": "Readonly", "externalId": "Name" }
  ]
}
```

### Example 5: Cross-org migration with field mapping and transformations

```json
{
  "sfdxHardisLabel": "Cross-Org Account Migration",
  "sfdxHardisDescription": "Migrate accounts between orgs with different field structures",
  "excludeIdsFromCSVFiles": true,
  "promptOnMissingParentObjects": false,
  "promptOnIssuesInCSVFiles": false,
  "objects": [
    {
      "query": "SELECT Id FROM RecordType WHERE IsActive = true",
      "operation": "Readonly",
      "externalId": "DeveloperName;SobjectType"
    },
    {
      "query": "SELECT Id, Name, BillingStreet, BillingCity, BillingState, Phone, Industry FROM Account",
      "operation": "Upsert",
      "externalId": "Name",
      "useFieldMapping": true,
      "fieldMapping": [
        { "targetObject": "Account" },
        { "sourceField": "BillingStreet", "targetField": "ShippingStreet" },
        { "sourceField": "BillingCity", "targetField": "ShippingCity" },
        { "sourceField": "BillingState", "targetField": "ShippingState" }
      ]
    },
    {
      "query": "SELECT Id, FirstName, LastName, Email, AccountId, Title FROM Contact",
      "operation": "Upsert",
      "externalId": "Email",
      "master": false
    }
  ],
  "dataRetrievedAddons": [
    {
      "module": "core:RecordsTransform",
      "args": {
        "fields": [
          { "alias": "acctName", "sourceObject": "Account", "sourceField": "Name" },
          { "alias": "acctIndustry", "sourceObject": "Account", "sourceField": "Industry" }
        ],
        "transformations": [
          {
            "targetObject": "Account",
            "targetField": "Description",
            "formula": "'Migrated from source. Industry: ' + (formula.acctIndustry || 'N/A')"
          }
        ]
      }
    }
  ]
}
```

### Example 6: Files and attachments migration

```json
{
  "sfdxHardisLabel": "Account Files",
  "sfdxHardisDescription": "Migrate accounts with their attached files",
  "promptOnMissingParentObjects": false,
  "promptOnIssuesInCSVFiles": false,
  "objects": [
    {
      "query": "SELECT all FROM Account WHERE CreatedDate > LAST_N_DAYS:365",
      "operation": "Upsert",
      "externalId": "Name",
      "afterAddons": [
        {
          "module": "core:ExportFiles",
          "args": {
            "operation": "Upsert",
            "externalId": "Title",
            "deleteOldData": false
          }
        }
      ]
    }
  ]
}
```

### Example 7: Conga configuration

```json
{
  "sfdxHardisLabel": "Conga Configuration",
  "sfdxHardisDescription": "Export/import Conga templates, queries, email templates and solutions",
  "objects": [
    { "query": "SELECT all FROM APXTConga4__Conga_Template__c", "operation": "Upsert", "externalId": "APXTConga4__Key__c" },
    { "query": "SELECT all FROM APXTConga4__Conga_Merge_Query__c", "operation": "Upsert", "externalId": "APXTConga4__Key__c" },
    { "query": "SELECT all FROM APXTConga4__Conga_Email_Template__c", "operation": "Upsert", "externalId": "APXTConga4__Key__c" },
    { "query": "SELECT all FROM APXTConga4__Conga_Solution__c", "operation": "Upsert", "externalId": "Name" }
  ]
}
```

---

## Troubleshooting

| Issue | Solution |
|---|---|
| `sfdmu plugin not found` | Install it: `sf plugins install sfdmu` |
| `Cannot modify production org` | Set `sfdmuCanModify` in `.sfdx-hardis.yml` or `SFDMU_CAN_MODIFY` env var |
| `export.json contains deletion info` | Delete workspaces and import workspaces must be separate; use `sf hardis:org:data:delete` for deletion workspaces |
| `Missing parent records` | Add parent objects as `Readonly` entries before child objects in the `objects` array |
| `External ID mismatch` | Verify the `externalId` field exists and is populated in both source and target |
| `Bulk API timeout` | Reduce `bulkApiV1BatchSize`, switch to `concurrencyMode: "Serial"`, or use `alwaysUseRestApi: true` |
| `CSV encoding issues` | Set `csvFileEncoding` and `csvUseUtf8Bom` in export.json |

---

## See Also

- [SFDMU Documentation](https://help.sfdmu.com/) - complete SFDMU reference
- [Deployment actions](salesforce-ci-cd-work-on-task-deployment-actions.md) - all deployment action types
- [Using sfdx-hardis with AI Coding Agents](salesforce-ci-cd-agent-skills.md) - other agent skills
- [AI Agents Overview](salesforce-agentic-automation.md) - all agent-compatible commands
- [`hardis:org:data:export` command reference](hardis/org/data/export.md)
- [`hardis:org:data:import` command reference](hardis/org/data/import.md)
- [`hardis:org:data:delete` command reference](hardis/org/data/delete.md)
- [`hardis:org:configure:data` command reference](hardis/org/configure/data.md)
- [sfdx-hardis for CPQ](salesforce-ci-cd-cpq.md)
- [sfdx-hardis for Conga](salesforce-ci-cd-conga.md)
