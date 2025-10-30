/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import sortArray from 'sort-array';
import { prompts } from '../../../../common/utils/prompts.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class StorageStats extends SfCommand<any> {
  public static title = 'Extract Data Storage stats';

  public static description = `
## Command Behavior


Key functionalities:
e width="560" height="315" src="https://www.youtube.com/embed/jHv8yrSK8Dg" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

</details>
`;

  public static examples = [
    '$ sf hardis:org:diagnose:storage-stats',
  ];

  public static flags: any = {
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = false;

  protected debugMode = false;
  protected tableStorageInfos: any[] = [];
  protected outputFile;
  protected outputFilesRes: any = {};


  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(StorageStats);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;
    const conn: Connection = flags['target-org'].getConnection();

    // List SObjects in org and filter them to exclude Salesforce platform technical ones , to keep only "Production" objects like Account, Contact, Custom Objects, etc.
    uxLog("action", this, `Listing SObjects from the org...`);
    const customObjects = await conn.metadata.list([{ type: 'CustomObject' }]);
    const sObjects = await conn.describeGlobal();
    uxLog("log", this, `${sObjects.sobjects.length} SObjects retrieved.`);
    const sObjectsFiltered = sObjects.sobjects.filter((obj: any) => {
      return customObjects.find((customObj: any) => customObj.fullName === obj.name) &&
        !obj.name.endsWith('__mdt') &&
        obj.layoutable === true &&
        obj.queryable === true &&
        obj.retrieveable === true &&
        obj.deletable === true &&
        obj.updateable === true &&
        obj.createable === true;
    });
    sortArray(sObjectsFiltered, { by: "name" });
    uxLog("log", this, `${sObjectsFiltered.length} SObjects after filtering technical ones.`);

    // Prompt user to select objects to analyze
    const promptObjectsRes = await prompts({
      type: 'multiselect',
      message: 'Select the SObjects to analyze for storage usage:',
      description: "Exclude objects you don't want to analyze.",
      choices: sObjectsFiltered.map((obj: any) => ({ title: obj.name, value: obj })),
    });
    const selectedObjects = promptObjectsRes.value;
    uxLog("log", this, `${selectedObjects.length} SObjects selected for analysis.`);

    // Prompt user for stats on CreatedDate or LastModifiedDate
    const promptDateFieldRes = await prompts({
      type: 'select',
      message: 'Select the date field to use for storage stats breakdown',
      description: "Choose between CreatedDate or LastModifiedDate.",
      choices: [
        { title: 'CreatedDate', value: 'CreatedDate' },
        { title: 'LastModifiedDate', value: 'LastModifiedDate' },
      ],
    });
    const dateField = promptDateFieldRes.value;
    uxLog("log", this, `Using ${c.cyan(dateField)} for storage stats breakdown.`);

    // Query objects to know the count of records, storage used and their year of created date
    uxLog("action", this, `Requesting storage stats for selected SObjects...`);
    const objectStorageStats: any[] = [];
    for (const obj of selectedObjects) {
      const res = await this.calculateObjectStorageStats(obj, dateField, conn);
      objectStorageStats.push(res);
    }

    uxLog("action", this, `Compiling storage stats...`);
    this.tableStorageInfos = objectStorageStats.flatMap(objStats => {
      const allLines: any[] = [];
      // calculate object storage usage based on record count and average record size
      const averageSalesforceRecordSizeBytes = 2 * 1024; // 2 KB average size per record
      const tableStorageInfo: any = {
        ApiName: objStats.name,
        Label: objStats.label,
      };
      const globalLine = {
        Type: 'Total',
        ...tableStorageInfo,
        RecordCount: objStats.totalRecords,
        EstimatedStorageMB: ((objStats.totalRecords * averageSalesforceRecordSizeBytes) / (1024 * 1024)).toFixed(2),
      };
      allLines.push(globalLine);
      for (const yearStat of objStats.yearlyStats) {
        const year = yearStat.year;
        const recordCount = yearStat.total;
        const storageUsedYearBytes = (recordCount * averageSalesforceRecordSizeBytes) / (1024 * 1024);
        const line = {
          Type: 'Year Breakdown',
          ...tableStorageInfo,
          Year: year,
          RecordCount: recordCount,
          EstimatedStorageMB: storageUsedYearBytes.toFixed(2),
        };
        allLines.push(line);
      }
      return tableStorageInfo;
    });

    // Generate output CSV file
    this.outputFile = await generateReportPath('storage-stats', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.tableStorageInfos, this.outputFile, { fileTitle: "Unsecured OAuth Tokens" });

    // Display results
    uxLog("action", this, `Storage stats usage`);
    uxLogTable(this, this.tableStorageInfos);

    return {
      tableStorageInfos: this.tableStorageInfos,
      outputFiles: this.outputFilesRes,
    }
  }

  private async calculateObjectStorageStats(obj: any, dateField: string, conn) {
    uxLog("log", this, `Querying storage stats for object: ${c.cyan(obj.name)}...`);
    const query = `SELECT CALENDAR_YEAR(${dateField}) year, COUNT(Id) total
FROM ${obj.name} 
GROUP BY CALENDAR_YEAR(${dateField})
ORDER BY CALENDAR_YEAR(${dateField}) DESC`;
    const queryRes = await soqlQuery(query, conn);
    const yearlyStats = queryRes.records.map((record: any) => ({
      year: record.year,
      total: record.total,
    }));
    const totalRecords = yearlyStats.reduce((acc: number, curr: any) => acc + curr.total, 0);
    return {
      name: obj.name,
      label: obj.label,
      totalRecords,
      yearlyStats,
    };
  }
}