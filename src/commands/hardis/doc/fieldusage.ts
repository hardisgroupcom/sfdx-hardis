import { requiredOrgFlagWithDeprecations, SfCommand } from '@salesforce/sf-plugins-core';
import { Flags } from '@salesforce/sf-plugins-core';
import { Connection  } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import sortArray from 'sort-array';
import { generateReports, uxLog } from '../../../common/utils/index.js';
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

  public static description = 'Retrieves custom field usage from metadata dependencies for specified sObjects.';

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
    uxLog(this, `Found ${sObjectResults.records.length} sObjects.`);
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
    uxLog(this, `Extracting fields for sObject: ${sObjectName}`);
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
        uxLog(this, `sObject ${sObjectName} does not have any custom fields, skipping dependencies.`);
        return;
      }

      uxLog(this, `Retrieving dependencies for sObject: ${sObjectName}`);

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
      { key: 'publisherId', header: 'Publisher Id' },
      { key: 'fieldId', header: 'Field Id' },
      { key: 'fieldName', header: 'Field Name' },
      { key: 'fieldType', header: 'Field Type' },
      { key: 'dependencyId', header: 'Dependency Id' },
      { key: 'dependencyType', header: 'Dependency Type' },
      { key: 'dependencyName', header: 'Dependency Name' }
    ];

    const rows: any[] = [];

    for (const [sObjectName, { publisherId, fields }] of Object.entries(sObjectsDict)) {
      fields.forEach((field) => {
        field.usedIn.forEach((dep) => {
          const row = {};
          row[columns[0].key] = sObjectName;
          row[columns[1].key] = publisherId;
          row[columns[2].key] = field.id;
          row[columns[3].key] = field.name;
          row[columns[4].key] = field.type;
          row[columns[5].key] = dep.id;
          row[columns[6].key] = dep.type;
          row[columns[7].key] = dep.name;

          rows.push(row);
        });
      });
    }

    const resultSorted = sortArray(rows, {
      by: [columns[0].key, columns[3].key, columns[6].key],
      order: ['asc', 'asc', 'asc'],
    });

    console.table(rows);

    const reportFiles = await generateReports(resultSorted, columns, this, {
      logFileName: 'fields-usage',
      logLabel: 'Find fields usage',
    });

    return {
      outputString: 'Processed fieldusage doc',
      result: resultSorted,
      reportFiles,
    };
  }
}
