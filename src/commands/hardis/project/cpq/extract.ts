/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import path from 'path';
import sortArray from 'sort-array';
import { generateReports, uxLog } from '../../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';
import { getReportDirectory } from '../../../../config/index.js';
import { soqlQueryTooling, bulkQuery } from '../../../../common/utils/apiUtils.js';

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
      default: './cpq-extract'
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
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected extractResults: any[] = [];
  protected outputDir: string;
  protected debugMode: boolean;
  protected conn: Connection;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CpqExtract);
    this.outputDir = flags.outputdir || path.join(await getReportDirectory(), 'cpq-extract', `${new Date().toISOString().split('T')[0]}`);
    this.debugMode = flags.debug || false;
    this.conn = flags["target-org"].getConnection();
    uxLog(this, c.cyan(`Starting CPQ configuration extraction...`));

    // Ensure output directory exists
    await fs.ensureDir(this.outputDir);

    await this.extractObjects();

    return { success: true };
  }

  public async extractObjects(): Promise<void> {
    const objectsToExtract = [
      'SBQQ__ProductRule__c',
      'SBQQ__PriceRule__c',
      'SBQQ__Quote__c',
    ];
    // Use tooling API to list fields of each object
    const objectsWithFields: any = [
    ]
    for (const objectName of objectsToExtract) {
      const fieldsQuery = `SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${objectName}'`;
      const fieldsQueryResult = await soqlQueryTooling(fieldsQuery, this.conn);
      const fields = fieldsQueryResult.records.map((field: any) => field.QualifiedApiName);
      objectsWithFields.push({
        objectName: objectName,
        fields: fields,
        order: 'Name',
      });
      uxLog(this, c.grey(`Extracted fields for ${objectName}: ${fields.join(', ')}`));
    }
    // Extract records using Bulk API
    for (const object of objectsWithFields) {
      const bulkQueryRecords = `SELECT ${object.fields.join(', ')} FROM ${object.objectName} ORDER BY ${object.order}`;
      const queryRes = await bulkQuery(bulkQueryRecords, this.conn);
      uxLog(this, c.grey(`Extracted ${queryRes.records.length} records for ${object.objectName}`));
    }

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
        if (debug) {
          uxLog(this, c.gray(`Found ${files.length} files matching pattern: ${pattern}`));
        }
      } catch (error) {
        if (debug) {
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

        if (debug) {
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
    const detailedResultsFile = `${outputDir}/cpq-extract-detailed.${format}`;
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
      outputDir,
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
