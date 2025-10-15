import { requiredOrgFlagWithDeprecations, SfCommand } from '@salesforce/sf-plugins-core';
import { Flags } from '@salesforce/sf-plugins-core';
import { Connection } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import sortArray from 'sort-array';
import { generateReports, uxLog, uxLogTable } from '../../../common/utils/index.js';
import { soqlQuery, soqlQueryTooling } from '../../../common/utils/apiUtils.js';

export default class HardisDocFieldusage extends SfCommand<any> {

  public static flags: any = {
    'target-org': requiredOrgFlagWithDeprecations,
    'sObjects': Flags.string({
      char: 's',
      description: 'Comma-separated list of sObjects to filter',
      required: false,
    }),
  };

  public static description = `
## Command Behavior

**Retrieves and displays the usage of custom fields within a Salesforce org, based on metadata dependencies.**

This command helps identify where custom fields are referenced across various metadata components in your Salesforce environment. It's particularly useful for impact analysis before making changes to fields, or for understanding the complexity and interconnectedness of your Salesforce customizations.

- **Targeted sObjects:** You can specify a comma-separated list of sObjects (e.g., \`Account,Contact\`) to narrow down the analysis to relevant objects. If no sObjects are specified, it will analyze all customizable sObjects.
- **Usage Details:** For each custom field, the command lists the metadata components (e.g., Apex Classes, Visualforce Pages, Flows, Reports) that reference it, along with their types and names.

!['Find custom fields usage'](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/doc-fieldusage.png)

<details markdown="1">
<summary>Technical explanations</summary>

The command operates by querying Salesforce's Tooling API and Metadata Component Dependency API:

- **sObject Retrieval:** It first queries \`EntityDefinition\` to get a list of customizable sObjects, optionally filtered by the user's input.
- **Custom Field Identification:** For each identified sObject, it queries \`CustomField\` to retrieve all custom fields associated with it.
- **Dependency Lookup:** The core of the command involves querying \`MetadataComponentDependency\` using the IDs of the custom fields. This API provides information about which other metadata components depend on the specified fields.
- **Data Aggregation & Reporting:** The retrieved data is then processed and formatted into a tabular output, showing the sObject name, field name, field type, dependency type, and dependency name. The results are also generated into various report formats (e.g., CSV, JSON) for further analysis.
- **SOQL Queries:** It uses \`soqlQuery\` and \`soqlQueryTooling\` utilities to execute SOQL queries against the Salesforce org.
</details>
`;

  public static examples = [
    '$ sf hardis:doc:fieldusage',
    '$ sf hardis:doc:fieldusage --sObjects Account,Contact,Opportunity',
    '$ sf hardis:doc:fieldusage --target-org myOrgAlias --sObjects CustomObject__c'
  ];

  public async querySObjects(connection: Connection, sObjectsFilter?: string[]) {
    let sObjectsQuery = `
      SELECT Id, DeveloperName, PublisherId, IsCustomizable, IsCustomSetting
      FROM EntityDefinition 
      WHERE IsCustomizable = true
    `;

    if (sObjectsFilter && sObjectsFilter.length > 0) {
      const sObjectsList = sObjectsFilter
        .map(sObject => sObject.trim().replace(/__c$/, ''))
        .map(sObject => `'${sObject}'`)
        .join(',');

      sObjectsQuery += ` AND DeveloperName IN (${sObjectsList})`;
    }

    const sObjectResults = await soqlQuery(sObjectsQuery, connection);
    uxLog("other", this, `Found ${sObjectResults.records.length} sObjects.`);
    return sObjectResults;
  }

  public async getFilteredSObjects(connection: Connection, sObjectsFilter?: string[]) {
    const sObjectResults = await this.querySObjects(connection, sObjectsFilter);
    const sObjectsDict: Record<string, { publisherId: string, fields: any[] }> = {};

    sObjectResults.records.forEach((record) => {
      if (!record.DeveloperName.endsWith('__Share') && !record.DeveloperName.endsWith('__ChangeEvent')) {
        sObjectsDict[record.DeveloperName] = {
          publisherId: record.PublisherId,
          fields: []
        };
      }
    });

    return sObjectsDict;
  }

  public async queryCustomFields(connection: Connection, sObjectName: string) {
    uxLog("other", this, `Extracting fields for sObject: ${sObjectName}.`);
    const queryTooling = `
      SELECT Id, DeveloperName
      FROM CustomField 
      WHERE EntityDefinition.DeveloperName = '${sObjectName}'
    `;
    const fieldResults = await soqlQueryTooling(queryTooling, connection);
    return fieldResults;
  }

  public async queryMetadataComponentDependency(connection: Connection, fieldIds: string[]) {
    const metadataQuery = `
      SELECT MetadataComponentId, MetadataComponentType, MetadataComponentName, RefMetadataComponentName, RefMetadataComponentId
      FROM MetadataComponentDependency
      WHERE RefMetadataComponentId IN (${fieldIds.join(',')})
    `;
    const dependencyResults = await soqlQueryTooling(metadataQuery, connection);

    return dependencyResults;
  }

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(HardisDocFieldusage);
    const connection = flags['target-org'].getConnection();

    const sObjectsFilter = flags['sObjects'] ? flags['sObjects'].split(',').map(s => s.trim()) : undefined;

    const sObjectsDict = await this.getFilteredSObjects(connection, sObjectsFilter);

    const fieldQueries = Object.keys(sObjectsDict).map(async (sObjectName) => {
      const fieldResults = await this.queryCustomFields(connection, sObjectName);
      if (fieldResults.records.length > 0) {
        fieldResults.records.forEach((field) => {
          sObjectsDict[sObjectName].fields.push({
            id: field.Id,
            name: field.DeveloperName,
            type: "custom",
            usedIn: []
          });
        });
      }
    });
    await Promise.all(fieldQueries);

    const dependencyQueries = Object.entries(sObjectsDict).map(async ([sObjectName, { fields }]) => {
      if (fields.length === 0) {
        uxLog("other", this, `sObject ${sObjectName} has no custom fields; skipping dependencies.`);
        return;
      }

      uxLog("other", this, `Retrieving dependencies for sObject: ${sObjectName}.`);

      const fieldIds = fields.map((field) => `'${field.id}'`);
      const dependencyResults = await this.queryMetadataComponentDependency(connection, fieldIds);

      dependencyResults.records.forEach((dep) => {
        const field = fields.find(f => f.id === dep.RefMetadataComponentId);
        if (field) {
          field.usedIn.push({ id: dep.MetadataComponentId, type: dep.MetadataComponentType, name: dep.MetadataComponentName });
        }
      });
    });
    await Promise.all(dependencyQueries);

    const columns = [
      { key: 'sObjectName', header: 'sObject Name' },
      { key: 'fieldName', header: 'Field Name' },
      { key: 'fieldType', header: 'Field Type' },
      { key: 'dependencyType', header: 'Dependency Type' },
      { key: 'dependencyName', header: 'Dependency Name' }
    ];

    const rows: any[] = [];

    for (const [sObjectName, { fields }] of Object.entries(sObjectsDict)) {
      fields.forEach((field) => {
        field.usedIn.forEach((dep) => {
          const row = {};
          row[columns[0].key] = sObjectName;
          row[columns[1].key] = field.name;
          row[columns[2].key] = field.type;
          row[columns[3].key] = dep.type;
          row[columns[4].key] = dep.name;

          rows.push(row);
        });
      });
    }

    const resultSorted = sortArray(rows, {
      by: [columns[0].key, columns[1].key, columns[3].key],
      order: ['asc', 'asc', 'asc'],
    });

    uxLog("action", this, c.cyan(`Found ${resultSorted.length} custom field usage records.`));
    uxLogTable(this, rows);

    const reportFiles = await generateReports(resultSorted, columns, this, {
      logFileName: 'fields-usage',
      logLabel: 'Find fields usage',
    });

    return {
      outputString: 'Processed fieldusage documentation.',
      result: resultSorted,
      reportFiles,
    };
  }
}
