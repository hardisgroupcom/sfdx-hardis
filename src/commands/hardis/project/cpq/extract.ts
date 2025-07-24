/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import path from 'path';
import sortArray from 'sort-array';
import Excel from 'exceljs';
import Papa from 'papaparse';
import { stringify } from 'csv-stringify';
import { generateReports, uxLog } from '../../../../common/utils/index.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';
import { getReportDirectory } from '../../../../config/index.js';
import { bulkQuery, soqlQuery } from '../../../../common/utils/apiUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CpqExtract extends SfCommand<any> {
  public static title = 'Extract CPQ Configuration';

  public static description = `Extract Salesforce CPQ configuration and metadata for analysis or backup purposes.

This command analyzes CPQ-related metadata and configuration within your Salesforce project,
providing detailed reports on CPQ objects, custom fields, workflows, and configuration settings.

The command is optimized for scalability with large datasets:
- Uses streaming for CSV file generation to handle large record sets efficiently
- Implements batch processing to prevent memory issues (1000 records for CSV, 500 for Excel)
- Automatically detects large files (>50MB) and uses line-by-line streaming for Excel generation
- Progress logging for long-running operations

Use this command to:
- Extract CPQ product rules and price rules
- Analyze CPQ custom objects and fields
- Generate reports on CPQ configuration
- Backup CPQ settings for documentation or migration
`;

  public static examples = [
    '$ sf hardis:project:cpq:extract',
    '$ sf hardis:project:cpq:extract --outputdir ./cpq-data',
    '$ sf hardis:project:cpq:extract --debug',
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
    // Merge CSV files into a single excel file, with one tab by Object
    await this.mergeCsvInExcelFile();

    return { success: true };
  }

  public async extractObjects(): Promise<void> {
    const objectsToExtract = [
      'Product2',
      'PricebookEntry',
      //      'SBQQ__Quote__c',
      //      'SBQQ__QuoteLine__c',
      //      'SBQQ__QuoteLineGroup__c',
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
    // Use tooling API to list fields of each object
    const objectsWithFields: any = [
    ]
    const objectsWithoutFields: string[] = [];
    uxLog(this, c.cyan(`Extracting fields for CPQ objects: ${objectsToExtract.join(', ')}`)); for (const objectName of objectsToExtract) {
      const fieldsQuery = `SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${objectName}'`;
      const fieldsQueryResult = await soqlQuery(fieldsQuery, this.conn);
      const fields = fieldsQueryResult.records.map((field: any) => field.QualifiedApiName);
      if (fields.length === 0) {
        uxLog(this, c.yellow(`No fields found for ${objectName}. It might not be a valid CPQ object or it has no fields.`));
        objectsWithoutFields.push(objectName);
        continue;
      }
      objectsWithFields.push({
        objectName: objectName,
        fields: fields,
        order: 'Name',
      });
      uxLog(this, c.grey(`Extracted fields for ${objectName}: ${fields.join(', ')}`));
    }
    // Display summary of objects without fields
    if (objectsWithoutFields.length > 0) {
      uxLog(this, c.yellow(`The following CPQ objects were found but have no fields: ${objectsWithoutFields.join(', ')}.`));
      uxLog(this, c.yellow(`This might indicate that these objects are not used in your CPQ configuration or are not standard CPQ objects.`));
    }
    // Extract records using Bulk API
    uxLog(this, c.cyan(`Extracting records for ${objectsWithFields.length} CPQ objects: ${objectsWithFields.map(o => o.objectName).join(', ')}`));
    for (const object of objectsWithFields) {
      uxLog(this, c.cyan(`Extracting records for ${object.objectName}...`));
      const bulkQueryRecords = `SELECT ${object.fields.join(', ')} FROM ${object.objectName} ORDER BY ${object.order}`;
      const queryRes = await bulkQuery(bulkQueryRecords, this.conn);
      uxLog(this, c.grey(`Extracted ${queryRes.records.length} records for ${object.objectName}`));

      // Write records to CSV file using streaming for memory efficiency
      if (queryRes.records && queryRes.records.length > 0) {
        const csvFileName = `${object.objectName}.csv`;
        const csvFilePath = path.join(this.outputDir, csvFileName);

        await this.writeRecordsToCSVStream(queryRes.records, object.fields, csvFilePath);

        // Add to cpqObjects property
        this.cpqObjects.push({
          object: object.objectName,
          csvFile: csvFilePath
        });

        uxLog(this, c.green(`Saved ${queryRes.records.length} records to ${csvFileName}`));
      }
    }
  }

  /**
   * Write records to CSV file using streaming for memory efficiency
   */
  private async writeRecordsToCSVStream(records: any[], fields: string[], filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath, { encoding: 'utf8' });
      const csvStream = stringify({
        header: true,
        columns: fields,
        quoted: true,
        quoted_empty: false,
        quoted_string: true
      });

      // Handle stream events
      csvStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);

      // Pipe CSV stream to file
      csvStream.pipe(writeStream);

      // Write records in batches to prevent memory issues
      const batchSize = 1000; // Optimal batch size for CSV processing
      let batchIndex = 0;

      const writeBatch = () => {
        const start = batchIndex * batchSize;
        const end = Math.min(start + batchSize, records.length);
        const batch = records.slice(start, end);

        for (const record of batch) {
          const row: any = {};
          fields.forEach(field => {
            row[field] = record[field] ?? '';
          });
          csvStream.write(row);
        }

        batchIndex++;

        // Log progress for large datasets
        if (end % 10000 === 0 && end > 0) {
          uxLog(this, c.gray(`    Processed ${end} records...`));
        }

        if (end < records.length) {
          // Use setImmediate to prevent call stack overflow
          setImmediate(writeBatch);
        } else {
          csvStream.end();
        }
      }; writeBatch();
    });
  }

  public async mergeCsvInExcelFile(): Promise<void> {
    uxLog(this, c.cyan('Creating Excel file with CPQ data using streaming...'));

    // Create Excel file path
    const excelFilePath = path.join(this.outputDir, 'CPQ_Extract.xlsx');

    // Create a new streaming workbook
    const workbook = new Excel.stream.xlsx.WorkbookWriter({
      filename: excelFilePath,
      useStyles: true,
      useSharedStrings: true
    });

    workbook.creator = 'sfdx-hardis CPQ Extract';
    workbook.lastModifiedBy = 'sfdx-hardis';
    workbook.created = new Date();

    // Process each CSV file using streaming
    for (const cpqObject of this.cpqObjects) {
      try {
        // Check file size to determine which streaming method to use
        const fileStats = await fs.stat(cpqObject.csvFile);
        const fileSizeMB = fileStats.size / (1024 * 1024);

        if (fileSizeMB > 50) { // Use line-by-line streaming for files larger than 50MB
          uxLog(this, c.cyan(`Large file detected (${fileSizeMB.toFixed(1)}MB): ${cpqObject.object}, using line-by-line streaming`));
          await this.addLargeCsvToWorkbookStream(workbook, cpqObject);
        } else {
          await this.addCsvToWorkbookStream(workbook, cpqObject);
        }
      } catch (error) {
        uxLog(this, c.red(`Error processing CSV file ${cpqObject.csvFile}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    // Finalize the workbook
    try {
      await workbook.commit();
      uxLog(this, c.green(`Excel file created successfully: CPQ_Extract.xlsx`));
      uxLog(this, c.cyan(`File location: ${excelFilePath}`));
    } catch (error) {
      uxLog(this, c.red(`Error finalizing Excel file: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  /**
   * Add CSV data to workbook using streaming for memory efficiency
   */
  private async addCsvToWorkbookStream(workbook: any, cpqObject: { object: string, csvFile: string }): Promise<void> {
    const worksheetName = cpqObject.object.substring(0, 31); // Excel worksheet names are limited to 31 characters
    uxLog(this, c.gray(`Processing ${cpqObject.object} for worksheet "${worksheetName}"...`));

    // Create worksheet
    const worksheet = workbook.addWorksheet(worksheetName);

    return new Promise((resolve, reject) => {
      // Create readable stream for CSV file
      const readStream = fs.createReadStream(cpqObject.csvFile, { encoding: 'utf8' });

      let headers: string[] = [];
      let rowCount = 0;
      let csvData = '';

      readStream.on('data', (chunk: string | Buffer) => {
        csvData += chunk.toString();
      });

      readStream.on('end', () => {
        try {
          // Parse the entire CSV content in streaming mode with proper error handling
          const parseResult = Papa.parse(csvData, {
            header: true,
            skipEmptyLines: true,
            transform: (value: string) => value === '' ? null : value
          });

          if (parseResult.errors.length > 0) {
            uxLog(this, c.yellow(`Warning: CSV parsing errors for ${cpqObject.object}:`));
            parseResult.errors.forEach(error => {
              uxLog(this, c.yellow(`  - Row ${error.row}: ${error.message}`));
            });
          }

          if (parseResult.data.length > 0) {
            // Get headers from the first row
            headers = Object.keys(parseResult.data[0] as any);

            // Set up column structure with headers before adding any data
            this.autoFitWorksheetColumns(worksheet, headers);

            // Process data in smaller batches to prevent memory issues
            const excelBatchSize = 500; // Optimal batch size for Excel processing
            for (let i = 0; i < parseResult.data.length; i += excelBatchSize) {
              const batch = parseResult.data.slice(i, i + excelBatchSize);

              for (const row of batch) {
                const values = headers.map(header => (row as any)[header]);
                const dataRow = worksheet.addRow(values);
                dataRow.commit();
              }

              rowCount += batch.length;

              // Log progress for large datasets
              if (rowCount % 5000 === 0) {
                uxLog(this, c.gray(`  Processed ${rowCount} rows for ${cpqObject.object}...`));
              }
            }

            uxLog(this, c.grey(`Added worksheet "${worksheetName}" with ${parseResult.data.length} rows`));
          } else {
            // Add empty worksheet with just headers if no data
            worksheet.addRow(['No data available']).commit();
            uxLog(this, c.grey(`Added empty worksheet "${worksheetName}" (no data)`));
          }

          worksheet.commit();
          resolve();

        } catch (error) {
          uxLog(this, c.red(`Error processing CSV data for ${cpqObject.object}: ${error instanceof Error ? error.message : String(error)}`));
          reject(error);
        }
      });

      readStream.on('error', (error) => {
        uxLog(this, c.red(`Error reading CSV file ${cpqObject.csvFile}: ${error.message}`));
        reject(error);
      });
    });
  }

  /**
   * Set up worksheet columns and add styled header row
   */
  private autoFitWorksheetColumns(worksheet: any, headers: string[]): void {
    // Set up column definitions
    worksheet.columns = headers.map(header => ({
      header: header,
      key: header,
      width: Math.min(Math.max(header.length + 2, 10), 50) // Set reasonable width based on header length
    }));

    // The column definitions above automatically create the header row
    // Now style the header row (row 1)
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    headerRow.commit();
  }

  /**
   * Alternative implementation for very large CSV files using true streaming
   * This method processes CSV line by line without loading the entire file into memory
   */
  private async addLargeCsvToWorkbookStream(workbook: any, cpqObject: { object: string, csvFile: string }): Promise<void> {
    const worksheetName = cpqObject.object.substring(0, 31);
    uxLog(this, c.gray(`Processing large CSV ${cpqObject.object} for worksheet "${worksheetName}" using line-by-line streaming...`));

    const worksheet = workbook.addWorksheet(worksheetName);

    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(cpqObject.csvFile, { encoding: 'utf8' });
      let lineBuffer = '';
      let isFirstLine = true;
      let headers: string[] = [];
      let rowCount = 0;

      readStream.on('data', (chunk: string | Buffer) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split('\n');

        // Keep the last incomplete line in the buffer
        lineBuffer = lines.pop() || '';

        // Process complete lines
        for (const line of lines) {
          if (line.trim() === '') continue;

          try {
            const parsedLine = Papa.parse(line, { header: false }).data[0] as string[];

            if (isFirstLine) {
              headers = parsedLine;

              // Set up column structure with headers before adding any data
              this.autoFitWorksheetColumns(worksheet, headers);

              isFirstLine = false;
            } else {
              // Process data row
              const dataRow = worksheet.addRow(parsedLine);
              dataRow.commit();
              rowCount++;

              // Log progress for very large datasets
              if (rowCount % 10000 === 0) {
                uxLog(this, c.gray(`    Streamed ${rowCount} rows for ${cpqObject.object}...`));
              }
            }
          } catch (error) {
            if (this.debugMode) {
              uxLog(this, c.yellow(`Warning: Error parsing line in ${cpqObject.object}: ${error instanceof Error ? error.message : String(error)}`));
            }
          }
        }
      });

      readStream.on('end', () => {
        // Process any remaining data in the buffer
        if (lineBuffer.trim() !== '') {
          try {
            const parsedLine = Papa.parse(lineBuffer, { header: false }).data[0] as string[];
            if (!isFirstLine && parsedLine.length > 0) {
              worksheet.addRow(parsedLine).commit();
              rowCount++;
            }
          } catch (error) {
            // Ignore final line parsing errors
          }
        }

        worksheet.commit();
        uxLog(this, c.grey(`Added worksheet "${worksheetName}" with ${rowCount} rows (streamed)`));
        resolve();
      });

      readStream.on('error', reject);
    });
  }


  public async murf(): Promise<AnyJson> {
    // Define CPQ-related patterns to search for
    const cpqPatterns = [
      '**/*CPQ*/**/*.xml',
      '**/objects/SBQQ__*.xml',
      '**/customMetadata/SBQQ__*.xml',
      '**/workflows/SBQQ__*.xml',
      '**/flows/*CPQ*.xml',
      '**/flows/*Quote*.xml'
    ];

    let allCpqFiles: string[] = [];

    // Search for CPQ-related files
    for (const pattern of cpqPatterns) {
      try {
        const files = await glob(pattern, { ignore: GLOB_IGNORE_PATTERNS });
        allCpqFiles = [...allCpqFiles, ...files];
        if (this.debugMode) {
          uxLog(this, c.gray(`Found ${files.length} files matching pattern: ${pattern}`));
        }
      } catch (error) {
        if (this.debugMode) {
          uxLog(this, c.yellow(`Warning: Could not search pattern ${pattern}: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
    }

    // Remove duplicates
    allCpqFiles = [...new Set(allCpqFiles)];

    uxLog(this, `Found ${c.bold(allCpqFiles.length)} CPQ-related files to analyze`);

    this.extractResults = [];

    // Process each CPQ file
    for (const file of allCpqFiles) {
      try {
        const fileText = await fs.readFile(file, 'utf8');
        const fileStats = await fs.stat(file);

        // Determine file type and namespace
        const fileName = file.split(/[/\\]/).pop() || '';
        const fileType = this.determineCpqFileType(file, fileText);
        const namespace = fileName.includes('SBQQ__') ? 'SBQQ' : 'Custom';

        const extractResult = {
          fileName,
          filePath: file,
          fileType,
          namespace,
          size: fileStats.size,
          lastModified: fileStats.mtime,
          hasCustomizations: this.hasCustomizations(fileText),
          isActive: this.isActive(fileText),
        };

        this.extractResults.push(extractResult);

        if (this.debugMode) {
          uxLog(this, c.gray(`Processed: ${fileName} (${fileType})`));
        }

      } catch (error) {
        uxLog(this, c.yellow(`Warning: Could not process file ${file}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    // Sort results
    const resultSorted = sortArray(this.extractResults, {
      by: ['fileType', 'namespace', 'fileName'],
      order: ['asc', 'asc', 'asc'],
    });

    // Display summary table
    const resultsLight = JSON.parse(JSON.stringify(resultSorted));
    console.table(
      resultsLight.map((item: any) => {
        return {
          fileName: item.fileName,
          fileType: item.fileType,
          namespace: item.namespace,
          size: `${Math.round(item.size / 1024)}KB`,
          hasCustomizations: item.hasCustomizations ? 'Yes' : 'No',
          isActive: item.isActive ? 'Yes' : 'No'
        };
      })
    );

    // Generate summary statistics
    const totalFiles = resultSorted.length;
    const customFiles = resultSorted.filter(item => item.hasCustomizations).length;
    const activeFiles = resultSorted.filter(item => item.isActive).length;
    const fileTypes = [...new Set(resultSorted.map(item => item.fileType))];

    uxLog(this, c.green(`[sfdx-hardis] SUCCESS: Extracted ${c.bold(totalFiles)} CPQ configuration files`));
    uxLog(this, c.cyan(`- File types found: ${fileTypes.join(', ')}`));
    uxLog(this, c.cyan(`- Files with customizations: ${customFiles}`));
    uxLog(this, c.cyan(`- Active configurations: ${activeFiles}`));

    // Generate output files
    const columns = [
      { key: 'fileName', header: 'File Name' },
      { key: 'fileType', header: 'Type' },
      { key: 'namespace', header: 'Namespace' },
      { key: 'size', header: 'Size (bytes)' },
      { key: 'hasCustomizations', header: 'Has Customizations' },
      { key: 'isActive', header: 'Is Active' },
      { key: 'filePath', header: 'File Path' },
    ];

    const reportFiles = await generateReports(resultSorted, columns, this, {
      logFileName: 'cpq-extract',
      logLabel: 'CPQ Configuration Extract',
    });

    // Save detailed results to output directory
    const format = "json";
    const detailedResultsFile = `${this.outputDir}/cpq-extract-detailed.${format}`;
    if (format === 'json') {
      await fs.writeJson(detailedResultsFile, resultSorted, { spaces: 2 });
    } else if (format === 'csv') {
      // For CSV, we would need to implement CSV conversion
      uxLog(this, c.yellow(`CSV format not yet implemented, saved as JSON instead`));
      await fs.writeJson(detailedResultsFile.replace('.csv', '.json'), resultSorted, { spaces: 2 });
    }

    uxLog(this, c.green(`Detailed results saved to: ${detailedResultsFile}`));

    // Return an object to be displayed with --json
    return {
      outputString: 'CPQ configuration extraction completed',
      totalFiles,
      customFiles,
      activeFiles,
      fileTypes,
      result: resultSorted,
      reportFiles,
      outputDir: this.outputDir,
    };
  }

  /**
   * Determine the type of CPQ file based on its path and content
   */
  private determineCpqFileType(filePath: string, content: string): string {
    if (filePath.includes('/objects/')) {
      return 'Custom Object';
    }
    if (filePath.includes('/customMetadata/')) {
      return 'Custom Metadata';
    }
    if (filePath.includes('/workflows/')) {
      return 'Workflow';
    }
    if (filePath.includes('/flows/')) {
      return 'Flow';
    }
    if (filePath.includes('/permissionsets/')) {
      return 'Permission Set';
    }
    if (filePath.includes('/profiles/')) {
      return 'Profile';
    }
    if (content.includes('<CustomField>')) {
      return 'Custom Field';
    }
    if (content.includes('<ValidationRule>')) {
      return 'Validation Rule';
    }
    return 'Other';
  }

  /**
   * Check if the file contains customizations (non-standard configurations)
   */
  private hasCustomizations(content: string): boolean {
    // Look for indicators of customizations
    const customizationIndicators = [
      '<formula>',
      '<validationRule>',
      '<workflow>',
      'Custom',
      '__c',
    ];

    return customizationIndicators.some(indicator =>
      content.toLowerCase().includes(indicator.toLowerCase())
    );
  }

  /**
   * Check if the configuration is active
   */
  private isActive(content: string): boolean {
    // Look for active status indicators
    if (content.includes('<active>true</active>')) {
      return true;
    }
    if (content.includes('<active>false</active>')) {
      return false;
    }
    // Default to true if no explicit active flag found
    return true;
  }
  /* jscpd:ignore-end */
}
