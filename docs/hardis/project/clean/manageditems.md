<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:manageditems

## Description


## Command Behavior

**Removes unwanted managed package items from your Salesforce DX project sources.**

This command helps clean up your local Salesforce project by deleting metadata files that belong to a specific managed package namespace. This is particularly useful when you retrieve metadata from an org that contains managed packages, and you only want to keep the unmanaged or custom metadata in your local repository.

Key functionalities:

- **Namespace-Based Filtering:** Requires a `--namespace` flag to specify which managed package namespace's files should be removed.
- **Targeted File Deletion:** Scans for files and folders that start with the specified namespace prefix (e.g., `yourNamespace__*`).
- **Intelligent Folder Handling:** Prevents the deletion of managed folders if they contain local custom items. This ensures that if you have custom metadata within a managed package's folder structure, only the managed components are removed, preserving your local customizations.
- **Object Metadata Preservation:** Specifically, it will not remove .object-meta.xml files if there are local custom items defined within that object's folder.
- **Custom Items on Managed Objects:** Preserves custom Layouts and QuickActions whose filename starts with a managed object's API name but whose own item name is not namespaced (e.g., `conference360__Event__c.New_Event_Item.quickAction-meta.xml` is kept, while `conference360__Event__c.conference360__Managed_Action.quickAction-meta.xml` is removed).
- **Managed Workflow Files with Custom Sub-items:** For `.workflow-meta.xml` files attached to a managed object, the XML is parsed and the file is preserved when at least one inner `<fullName>` (alert, rule, fieldUpdate, task, outboundMessage, ...) is not namespaced.
- **Managed Sharing Rules Files with Custom Sub-items:** For `.sharingRules-meta.xml` files attached to a managed object, the same logic applies: the file is preserved when at least one `sharingCriteriaRules`, `sharingOwnerRules`, `sharingTerritoryRules`, or `sharingGuestRules` sub-item has a `<fullName>` that is not namespaced.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Namespace Validation:** Ensures that a namespace is provided, throwing an `SfError` if it's missing.
- **File Discovery:** Uses `glob` to find all files and directories within the specified `folder` (defaults to `force-app`) that match the managed package namespace pattern (`**/${this.namespace}__*`).
- **Folder Content Check:** For identified managed folders, the `folderContainsLocalItems` function is called. This function uses `glob` again to check for the presence of any files within that folder that *do not* start with the managed package namespace, indicating local customizations.
- **Conditional Deletion:** Based on the `folderContainsLocalItems` check, it conditionally removes files and folders using `fs.remove`. If a managed folder contains local items, it is skipped to prevent accidental deletion of custom work.
- **Compound Filename Detection:** For Layouts (`<Object>-<Name>.layout-meta.xml`), and QuickActions (`<Object>.<Name>.quickAction-meta.xml`), the filename is split into its object and item parts. When the object part is namespaced but the item part is not, the file is preserved as a custom item on a managed object.
- **XML Item-Name Inspection:** `.workflow-meta.xml` and `.sharingRules-meta.xml` files are parsed via `parseXmlFile`. A generic `metadataXmlContainsLocalItems` helper, driven by the top-level `XML_ITEM_INSPECTION_SPECS` table (`suffix`, `rootElement`, `itemNameField`, `i18nKey`), iterates every child of the configured XML root element and preserves the file when any sub-item carries an item-name (e.g. `fullName`, configurable per type) that is not prefixed with `<namespace>__`. Adding a new metadata type is a one-line addition to that table. If the file cannot be parsed, it is kept to avoid accidental data loss.
- **Logging:** Provides clear messages about which managed items are being removed.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:clean:manageditems --agent
```

In agent mode, all interactive prompts are skipped and default values are used.



## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|folder<br/>-f|option|Root folder|force-app|||
|json|boolean|Format output as json.||||
|namespace<br/>-n|option|Namespace to remove||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:clean:manageditems --namespace crta
```

```shell
$ sf hardis:project:clean:manageditems --agent
```


