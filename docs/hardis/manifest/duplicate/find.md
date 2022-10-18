<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:manifest:duplicate:find

## Description

find duplicate values in XML file(s).
  Find duplicate values in XML file(s). Keys to be checked can be configured in `config/sfdx-hardis.yml` using property manifestDuplicateFindKeys.

Default config :
manifestDuplicateFindKeys :
[object Object]


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|files<br/>-f|option|XML metadata files path||||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|

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

$ sfdx hardis:manifest:duplicate:find --file layout.layout-meta.xml
[sfdx-hardis] Duplicate values in layout.layout-meta.xml
  - Key    : Layout.layoutSections.layoutColumns.layoutItems.field
  - Values : Name

```

```shell

$ sfdx hardis:manifest:duplicate:find -f "force-app/main/default/**/*.xml" 
[sfdx-hardis] hardis:manifest:duplicate:find execution time 0:00:00.397
[sfdx-hardis] Duplicate values in layout1.layout-meta.xml
  - Key    : Layout.layoutSections.layoutColumns.layoutItems.field
  - Values : CreatedById

[sfdx-hardis] Duplicate values in layout2.layout-meta.xml
  - Key    : Layout.layoutSections.layoutColumns.layoutItems.field
  - Values : LastModifiedById, Name

```


