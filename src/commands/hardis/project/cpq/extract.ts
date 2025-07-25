/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import Excel from 'exceljs';
import Papa from 'papaparse';
import { uxLog } from '../../../../common/utils/index.js';
import { getReportDirectory } from '../../../../config/index.js';
import { bulkQueryWithCLI, soqlQuery } from '../../../../common/utils/apiUtils.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';
import { glob } from 'glob';
import { listMetadataTypes } from '../../../../common/metadata-utils/metadataList.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CpqExtract extends SfCommand<any> {
  public static title = 'Extract CPQ Configuration';

  public static description = `Extract Salesforce CPQ configuration and metadata for analysis or backup purposes.

This command analyzes CPQ-related metadata and configuration within your Salesforce project,
providing detailed reports on CPQ objects, custom fields, workflows, and configuration settings.

Use this command to:
- Extract CPQ product rules and price rules
- Analyze CPQ custom objects and fields
- Generate reports on CPQ configuration
- Backup CPQ settings for documentation or migration
`;

  public static examples = [
    '$ sf hardis:project:cpq:extract',
  ];

  public static flags: any = {
    outputdir: Flags.string({
      char: 'o',
      description: 'Output directory for extracted CPQ configuration files',
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
    "target-org": requiredOrgFlagWithDeprecations
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected extractResults: any[] = [];
  protected outputDir: string;
  protected debugMode: boolean;
  protected conn: Connection;
  protected cpqObjects: Array<{ object: string, csvFile: string }> = [];
  protected outputTabs: Array<{ tabName: string, recordCount: number, object: string, hasData: boolean, csvFile?: string }> = [];
  protected skippedObjects: string[] = [];
  protected cpqMetadataCsv: string | undefined;
  protected cpqMetadataMatches: Array<{ file: string; cause: string }> = [];

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CpqExtract);
    this.outputDir = flags.outputdir || path.join(await getReportDirectory(), 'cpq-extract', `${new Date().toISOString().replace(/:/g, '-').split('.')[0]}`);
    this.debugMode = flags.debug || false;
    this.conn = flags["target-org"].getConnection();
    uxLog(this, c.cyan(`Starting CPQ configuration extraction...`));

    // Ensure output directory exists
    await fs.ensureDir(this.outputDir);
    // Extract all CPQ related records
    await this.extractObjects();
    // Extract CPQ-related metadata files and references
    const metadataResult = await this.extractMetadatas();
    this.cpqMetadataCsv = metadataResult.csvFile;
    this.cpqMetadataMatches = metadataResult.matches;
    // Merge CSV files into a single excel file, with one tab by Object
    await this.mergeCsvInExcelFile();

    uxLog(this, c.green(`CPQ extraction completed successfully!`));
    uxLog(this, c.cyan(`Output directory: ${this.outputDir}`));
    uxLog(this, c.cyan(`SOQL queries logged to: ${path.join(this.outputDir, 'soqlQueries')}`));

    return { success: true };
  }

  public async extractObjects(): Promise<void> {
    const objectsToExtract = [
      'Product2',
      'PricebookEntry',
      // Commented for now: crashing because of too many records
      // 'SBQQ__Quote__c',
      // 'SBQQ__QuoteLine__c',
      // 'SBQQ__QuoteLineGroup__c',
      'SBQQ__ProductRule__c',
      'SBQQ__PriceRule__c',
      'SBQQ__SummaryVariable__c',
      'SBQQ__ConfigurationAttribute__c',
      'SBQQ__ProductOption__c',
      'SBQQ__QuoteTemplate__c',
      'SBQQ__TemplateContent__c',
      'SBQQ__SubscriptionTerm__c',
      'SBQQ__Feature__c',
      'SBQQ__FeatureRule__c',
      'SBQQ__Approval__c',
      'SBQQ__DocumentTemplate__c',
      'SBQQ__ConstraintRule__c'
    ];

    // Create soqlQueries directory for logging queries
    const soqlQueriesDir = path.join(this.outputDir, 'soqlQueries');
    await fs.ensureDir(soqlQueriesDir);
    uxLog(this, c.grey(`Created SOQL queries log directory: ${soqlQueriesDir}`));
    // Use tooling API to list fields of each object
    const objectsWithFields: any = [
    ]
    for (const objectName of objectsToExtract) {
      const fieldsQuery = `SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${objectName}'`;
      const fieldsQueryResult = await soqlQuery(fieldsQuery, this.conn);
      const fields = fieldsQueryResult.records.map((field: any) => field.QualifiedApiName);
      if (fields.length === 0) {
        uxLog(this, c.yellow(`No fields found for ${objectName}, skipping extraction`));
        this.skippedObjects.push(objectName);
        continue;
      }
      objectsWithFields.push({
        objectName: objectName,
        fields: fields,
        order: 'Name',
      });
      uxLog(this, c.grey(`Extracted fields for ${objectName}: ${fields.join(', ')}`));
    }
    // Extract records using Bulk API
    for (const object of objectsWithFields) {
      uxLog(this, c.cyan(`Extracting records for ${object.objectName}...`));
      const bulkQueryRecords = `SELECT ${object.fields.join(', ')} FROM ${object.objectName} ORDER BY ${object.order}`;

      // Log the SOQL query to a file in soqlQueries directory
      const queryLogFileName = `${object.objectName}_query.soql`;
      const queryLogFilePath = path.join(soqlQueriesDir, queryLogFileName);
      await fs.writeFile(queryLogFilePath, bulkQueryRecords, 'utf8');
      uxLog(this, c.grey(`Logged SOQL query to: ${queryLogFileName}`));

      // Define CSV file path
      const csvFileName = `${object.objectName}.csv`;
      const csvFilePath = path.join(this.outputDir, csvFileName);

      // Use SF CLI bulk export to directly create CSV file
      const queryRes = await bulkQueryWithCLI(bulkQueryRecords, this.conn, csvFilePath, 60);

      if (queryRes.success) {
        const recordCount = queryRes.result.totalSize || 0;

        uxLog(this, c.grey(`Extracted ${recordCount} records for ${object.objectName}`));

        // Add to cpqObjects property
        this.cpqObjects.push({
          object: object.objectName,
          csvFile: csvFilePath
        });

        // Add to outputTabs property for summary
        const tabName = object.objectName.substring(0, 31);

        this.outputTabs.push({
          tabName: tabName,
          recordCount: recordCount,
          object: object.objectName,
          hasData: recordCount > 0,
          csvFile: csvFilePath
        });

        uxLog(this, c.green(`Saved ${recordCount} records to ${csvFileName}`));
      }

    }
  }

  public async mergeCsvInExcelFile(): Promise<void> {
    uxLog(this, c.cyan('Creating Excel file with CPQ data using streaming...'));

    // Create a new workbook with streaming support
    const workbook = new Excel.stream.xlsx.WorkbookWriter({
      filename: path.join(this.outputDir, 'CPQ_Extract.xlsx'),
      useStyles: true,
      useSharedStrings: false
    });

    workbook.creator = 'sfdx-hardis CPQ Extract';
    workbook.lastModifiedBy = 'sfdx-hardis';
    workbook.created = new Date();

    // Create summary worksheet first
    await this.createSummaryWorksheetStreaming(workbook);

    // Process each CSV file using outputTabs with streaming
    for (const tabInfo of this.outputTabs) {
      // Skip if no CSV file was created (e.g., extraction failed)
      if (!tabInfo.csvFile) {
        continue;
      }
      // Check if CSV file has more than just the header
      const csvContent = await fs.readFile(tabInfo.csvFile, 'utf8');
      const lines = csvContent.split('\n').filter(line => line.trim() !== '');
      if (lines.length <= 1) {
        uxLog(this, c.grey(`Skipping worksheet for ${tabInfo.tabName} (no data rows)`));
        continue;
      }
      await this.processCSVFileStreaming(workbook, tabInfo);
    }

    // Add CPQ Metadata Matches CSV as a worksheet if present
    if (this.cpqMetadataCsv) {
      const tabName = 'CPQ_Metadata_Matches';
      await this.processCSVFileStreaming(workbook, { tabName, csvFile: this.cpqMetadataCsv });
      uxLog(this, c.green(`Added CPQ metadata matches to Excel as tab: ${tabName}`));
    }

    // Commit the workbook to finish writing
    await workbook.commit();
    uxLog(this, c.green(`Excel file created successfully: CPQ_Extract.xlsx`));
    uxLog(this, c.cyan(`File location: ${path.join(this.outputDir, 'CPQ_Extract.xlsx')}`));

  }

  private async processCSVFileStreaming(workbook: any, tabInfo: any): Promise<void> {
    return new Promise((resolve, reject) => {
      uxLog(this, c.grey(`Processing ${tabInfo.tabName} with streaming...`));
      const worksheet = workbook.addWorksheet(tabInfo.tabName);
      let isFirstRow = true;
      let rowCount = 0;
      let headers: string[] = [];
      // Use PapaParse's streaming capabilities
      const fileStream = fs.createReadStream(tabInfo.csvFile, { encoding: 'utf8' });
      Papa.parse(fileStream, {
        header: false,
        skipEmptyLines: true,
        step: (results: any) => {
          const row = results.data as string[];
          // Defensive: skip if row is null or not an array
          if (!Array.isArray(row)) {
            return;
          }
          // Manage header
          if (isFirstRow) {
            headers = row;
            const headerRow = worksheet.addRow(headers);
            headerRow.font = { bold: true };
            headerRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE0E0E0' }
            };
            headers.forEach((header, index) => {
              const column = worksheet.getColumn(index + 1);
              column.width = Math.max(header.length + 2, 15);
            });
            isFirstRow = false;
          }
          // Handle data rows
          else if (row.length > 0 && row.some((cell: any) => cell !== null && cell !== '')) {
            const dataRow = headers.map((_, index) => (row[index] === null || row[index] === undefined) ? '' : row[index]);
            worksheet.addRow(dataRow);
            rowCount++;
          }
        },
        complete: () => {
          worksheet.commit();
          if (rowCount === 0) {
            worksheet.addRow(['No data available']);
            worksheet.commit();
          }
          uxLog(this, c.grey(`Added worksheet "${tabInfo.tabName}" with ${rowCount} rows (streaming)`));
          resolve(undefined);
        },
        error: (error: any) => {
          reject(error);
        }
      });
    });
  }

  private async createSummaryWorksheetStreaming(workbook: any): Promise<void> {
    const summaryWorksheet = workbook.addWorksheet('Summary');
    // Add title
    const titleRow = summaryWorksheet.addRow(['CPQ Extract Summary']);
    titleRow.font = { bold: true, size: 16 };
    titleRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    summaryWorksheet.addRow(['Generated on:', new Date().toISOString()]);
    summaryWorksheet.addRow([]);
    // Add headers for summary table (remove Has Data)
    const headerRow = summaryWorksheet.addRow(['Tab Name (click to view)', 'Lines number']);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    // Add summary data with hyperlinks to tabs
    let totalRecords = 0;
    let objectsWithData = 0;
    for (const tab of this.outputTabs) {
      summaryWorksheet.addRow([
        { text: tab.tabName, hyperlink: `#'${tab.tabName}'!A1`, font: { color: { argb: 'FF0000FF' }, underline: true } },
        tab.recordCount
      ]);
      totalRecords += tab.recordCount;
      if (tab.hasData) {
        objectsWithData++;
      }
    }

    // Add CPQ Metadata Matches tab hyperlink if present
    if (this.cpqMetadataCsv && this.cpqMetadataMatches && this.cpqMetadataMatches.length > 0) {
      summaryWorksheet.addRow([
        { text: 'CPQ_Metadata_Matches', hyperlink: `#'CPQ_Metadata_Matches'!A1`, font: { color: { argb: 'FF0000FF' }, underline: true } },
        this.cpqMetadataMatches.length
      ]);
    }

    // Add totals
    summaryWorksheet.addRow([]);
    const totalObjectsRow = summaryWorksheet.addRow(['Total Objects Extracted:', this.outputTabs.length]);
    totalObjectsRow.font = { bold: true };
    const objectsWithDataRow = summaryWorksheet.addRow(['Objects with Data:', objectsWithData]);
    objectsWithDataRow.font = { bold: true };
    const totalRecordsRow = summaryWorksheet.addRow(['Total Records:', totalRecords]);
    totalRecordsRow.font = { bold: true };

    // Add skipped objects section if any
    if (this.skippedObjects.length > 0) {
      summaryWorksheet.addRow([]);

      const skippedHeaderRow = summaryWorksheet.addRow(['Objects Skipped (No Fields Found):']);
      skippedHeaderRow.font = { bold: true, color: { argb: 'FFFF6600' } };

      for (const skippedObject of this.skippedObjects) {
        summaryWorksheet.addRow([skippedObject, 'No fields accessible', 0]);
      }

      const skippedCountRow = summaryWorksheet.addRow(['Total Skipped Objects:', this.skippedObjects.length]);
      skippedCountRow.font = { bold: true, color: { argb: 'FFFF6600' } };
    }

    // Add summary for CPQ metadata matches
    if (this.cpqMetadataMatches && this.cpqMetadataMatches.length > 0) {
      summaryWorksheet.addRow([]);
      const metaHeader = summaryWorksheet.addRow(['CPQ Metadata Matches']);
      metaHeader.font = { bold: true, color: { argb: 'FF44772C4' } };
      summaryWorksheet.addRow(['Total Files Found:', this.cpqMetadataMatches.length]);
      summaryWorksheet.addRow(['See tab "CPQ_Metadata_Matches" for details.']);
    }

    // Set column widths (remove Has Data column)
    summaryWorksheet.getColumn(1).width = 25;
    summaryWorksheet.getColumn(2).width = 20;
    summaryWorksheet.getColumn(3).width = 15;

    // Commit the summary worksheet
    summaryWorksheet.commit();

    uxLog(this, c.grey('Created summary worksheet with extraction overview (streaming)'));
  }

  /**
   * Extracts metadata files related to CPQ by name or content reference using glob.
   * - Name match: filename contains 'CPQ' (case-insensitive)
   * - Reference match: file content contains 'SBQQ' or 'CPQ' (case-insensitive)
   * Results are written to a CSV file and returned as an array for summary.
   */
  public async extractMetadatas(): Promise<{ csvFile: string; matches: Array<{ file: string; cause: string }> }> {
    const projectRoot = process.cwd();
    const forceAppDir = path.join(projectRoot, 'force-app');
    const outputCsv = path.join(this.outputDir, 'CPQ_MetadataMatches.csv');
    const matches: Array<{ file: string; cause: string; ref?: string; metadataType?: string; metadataName?: string }> = [];
    const exts = ['.cls', '.trigger', '.js', '.ts', '.xml', '.page', '.cmp', '.app', '.component', '.aura', '.lwcmp', '.html', '.js-meta.xml'];
    const namePattern = /CPQ/i;
    const refPattern = /SBQQ|CPQ/i;

    const metadataTypes = listMetadataTypes();

    // Helper to get metadata type and name from file path
    function getMetadataTypeAndName(filePath: string): { metadataType: string; metadataName: string } {
      // Try to match file path to known metadata types
      // Example: force-app/main/default/classes/MyClass.cls => metadataType: ApexClass, metadataName: MyClass
      for (const type of metadataTypes) {
        if (type.directoryName && filePath.includes(type.directoryName)) {
          // Get the part after the directoryName
          const parts = filePath.split(path.sep);
          const dirIdx = parts.findIndex(p => p === type.directoryName);
          if (dirIdx >= 0 && parts.length > dirIdx + 1) {
            let fileName = parts[parts.length - 1];
            // Remove extension(s)
            fileName = fileName.replace(/\.[^.]+$/, '');
            // For Aura/LWC, use folder name
            if (type.inFolder && parts.length > dirIdx + 1) {
              fileName = parts[dirIdx + 1];
            }
            return { metadataType: type.xmlName || type.directoryName, metadataName: fileName };
          }
        }
      }
      // Fallback: use file extension as type, file name as name
      const fallbackName = path.basename(filePath).replace(/\.[^.]+$/, '');
      const fallbackType = path.extname(filePath).replace(/^\./, '');
      return { metadataType: fallbackType, metadataName: fallbackName };
    }

    // Build glob pattern for extensions
    const extPattern = exts.map(e => e.replace(/^\./, '')).join(',');
    const globPattern = `**/*.{${extPattern}}`;

    // Use glob to find all files in force-app, respecting ignore patterns
    const allFiles: string[] = await glob(globPattern, { cwd: forceAppDir, absolute: true, ignore: GLOB_IGNORE_PATTERNS });

    for (const file of allFiles) {
      const base = path.basename(file);
      let matched = false;
      let cause = '';
      let ref = '';
      if (namePattern.test(base)) {
        cause = 'Name';
        matched = true;
      }
      // Only search for references if the file name does NOT start with SBQQ__
      if (!matched && !base.startsWith('SBQQ__')) {
        const content = await fs.readFile(file, 'utf8');
        if (refPattern.test(content)) {
          cause = 'Reference';
          // Find the first matching line/snippet
          const lines = content.split(/\r?\n/);
          for (const line of lines) {
            if (refPattern.test(line)) {
              ref = line.trim();
              break;
            }
          }
          if (!ref) {
            // fallback: first match in the whole content
            const match = content.match(refPattern);
            if (match) ref = match[0];
          }
          matched = true;
        }

      }
      if (matched) {
        const { metadataType, metadataName } = getMetadataTypeAndName(file);
        matches.push({ file, cause, ref, metadataType, metadataName });
      }
    }

    // Sort matches by metadataType, then metadataName, then cause, then file name
    matches.sort((a, b) => {
      if ((a.metadataType || '') < (b.metadataType || '')) return -1;
      if ((a.metadataType || '') > (b.metadataType || '')) return 1;
      if ((a.metadataName || '') < (b.metadataName || '')) return -1;
      if ((a.metadataName || '') > (b.metadataName || '')) return 1;
      if (a.cause < b.cause) return -1;
      if (a.cause > b.cause) return 1;
      return a.file.localeCompare(b.file);
    });

    // Write CSV with new columns
    const csvRows = ['Metadata Type,Metadata Name,Match cause,First reference'];
    for (const m of matches) {
      csvRows.push(`"${(m.metadataType || '').replace(/"/g, '""')}","${(m.metadataName || '').replace(/"/g, '""')}",${m.cause},"${(m.ref || '').replace(/"/g, '""')}"`);
    }
    await fs.writeFile(outputCsv, csvRows.join('\n'), 'utf8');
    uxLog(this, c.green(`CPQ metadata matches written to: ${outputCsv}`));
    return { csvFile: outputCsv, matches };
  }

}