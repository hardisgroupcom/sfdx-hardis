<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:metadata:findduplicates

## Description

find duplicate values in XML file(s).
  Find duplicate values in XML file(s). Keys to be checked can be configured in `config/sfdx-hardis.yml` using property metadataDuplicateFindKeys.

Default config :
metadataDuplicateFindKeys :
[object Object]


## Parameters

| Name         |  Type   | Description                                                   | Default | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| files<br/>-f | option  | XML metadata files path                                       |         |          |         |
| flags-dir    | option  | undefined                                                     |         |          |         |
| json         | boolean | Format output as json.                                        |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell

<?xml version="1.0" encoding="UTF-8"?>
<Layout xmlns="http://soap.sforce.com/2006/04/metadata">
  <layoutSections>
      ...
      <layoutColumns>
          <layoutItems>
              <behavior>Required</behavior>
              <field>Name</field>
          </layoutItems>
          <layoutItems>
              <behavior>Required</behavior>
              <field>Name</field>
          </layoutItems>
      </layoutColumns>
    </layoutSections>
</Layout>

```

```shell

$ sf hardis:project:metadata:findduplicates --file layout.layout-meta.xml
[sfdx-hardis] Duplicate values in layout.layout-meta.xml
  - Key    : Layout.layoutSections.layoutColumns.layoutItems.field
  - Values : Name

```

```shell

$ sf hardis:project.metadata:findduplicates -f "force-app/main/default/**/*.xml"
[sfdx-hardis] hardis:project:metadata:findduplicates execution time 0:00:00.397
[sfdx-hardis] Duplicate values in layout1.layout-meta.xml
  - Key    : Layout.layoutSections.layoutColumns.layoutItems.field
  - Values : CreatedById

[sfdx-hardis] Duplicate values in layout2.layout-meta.xml
  - Key    : Layout.layoutSections.layoutColumns.layoutItems.field
  - Values : LastModifiedById, Name

```


