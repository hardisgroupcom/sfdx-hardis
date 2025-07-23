/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { getReportDirectory } from '../../../../config/index.js';
import { FileDownloader } from '../../../../common/utils/fileDownloader.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

// Type definitions
interface EventLogFileRecord {
  Id: string;
  EventType: string;
  LogDate: string;
  LogFileLength: number;
  LogFile: string;
}

interface DownloadedFile {
  id: string;
  eventType: string;
  logDate: string;
  filePath: string;
  fileName: string;
  size: number;
}

interface UploadResult {
  eventType: string;
  datasetName: string;
  fileCount: number;
  success: boolean;
  datasetId?: string;
  message?: string;
  error?: string;
}

// Wave API interfaces
interface WaveDatasetVersion {
  id?: string;
  datasetId?: string;
  name?: string;
  label?: string;
  state?: string;
  createdDate?: string;
}

interface WaveDatasetUploadResponse {
  id: string;
  name: string;
  label: string;
  datasetVersion: WaveDatasetVersion;
}

interface WaveDatasetUploadJobResponse {
  id: string;
  object: string;
  state: string;
  createdDate: string;
  systemModstamp: string;
}

export default class DataEventlogExtract extends SfCommand<any> {
  public static title = 'Extract EventLogFile data to CRM Analytics';

  public static description = `Extract all EventLogFile records from the current org, download their CSV files, and upload them to CRM Analytics.

This command performs the following operations:
1. Queries all EventLogFile records from the org
2. Downloads the CSV data files for each EventLogFile
3. Merges CSV files of the same event type into a single file (automatic behavior)
4. Creates datasets in CRM Analytics with naming pattern "DSInput_<EventType>"
5. Uploads the merged CSV data to the corresponding CRM Analytics datasets

The command handles different event types automatically and creates separate datasets for each type.
Use this for comprehensive event log analysis and monitoring in CRM Analytics.
`;

  public static examples = [
    '$ sf hardis:data:eventlog:extract',
    '$ sf hardis:data:eventlog:extract --outputdir ./eventlogs --debug',
    '$ sf hardis:data:eventlog:extract --eventtype Login,API --days 7',
    '$ sf hardis:data:eventlog:extract --eventtype Login',
    '$ sf hardis:data:eventlog:extract --days 14',
    '$ sf hardis:data:eventlog:extract --target-org myorg@company.com'
  ];

  public static flags: any = {
    outputdir: Flags.string({
      char: 'o',
      description: 'Output directory for downloaded EventLogFile CSV files',
    }),
    eventtype: Flags.string({
      char: 'e',
      description: 'Comma-separated list of event types to extract (e.g., Login,API,Report). If not specified, you will be prompted to select specific types from available types in your org.'
    }),
    days: Flags.integer({
      char: 'd',
      description: 'Number of days to look back for EventLogFile records (1-30). If not specified, you will be prompted to enter a value.',
    }),
    debug: Flags.boolean({
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

  protected conn: Connection;
  protected outputDir: string;
  protected debugMode: boolean;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DataEventlogExtract);

    this.conn = flags['target-org'].getConnection();
    this.outputDir = flags.outputdir || path.join(await getReportDirectory(), 'eventlog-extract', `${new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-')}`);
    this.debugMode = flags.debug || false;

    // Get event types - either from flag or prompt user for selection
    let eventTypes: string[] | null = null;
    if (flags.eventtype) {
      eventTypes = flags.eventtype.split(',').map(type => type.trim());
    } else {
      // Prompt will always return a string array, never null
      eventTypes = await this.promptForEventTypes();
    }

    // Get number of days - either from flag or prompt user for selection
    let daysBack: number;
    if (flags.days !== undefined) {
      daysBack = flags.days;
    } else {
      daysBack = await this.promptForDays();
    }

    uxLog(this, c.cyan(`Starting EventLogFile extraction to CRM Analytics...`));

    // Ensure output directory exists
    await fs.ensureDir(this.outputDir);

    // Step 1: Extract EventLogFile records
    const eventLogFiles = await this.extractEventLogFiles(eventTypes, daysBack);

    if (eventLogFiles.length === 0) {
      uxLog(this, c.yellow(`No EventLogFile records found for the specified criteria.`));
      return {
        success: true,
        message: 'No EventLogFile records found',
        extractedFiles: 0,
        uploadedDatasets: 0
      };
    }

    uxLog(this, c.green(`Found ${eventLogFiles.length} EventLogFile records to process.`));

    // Step 2: Download CSV files
    const downloadedFiles = await this.downloadEventLogFiles(eventLogFiles);

    // Step 3: Upload to CRM Analytics
    const uploadResults = await this.uploadToCRMAnalytics(downloadedFiles);

    uxLog(this, c.green(`SUCCESS: Processed ${eventLogFiles.length} EventLogFile records`));
    uxLog(this, c.cyan(`- Downloaded CSV files: ${downloadedFiles.length}`));
    uxLog(this, c.cyan(`- Created/Updated CRM Analytics datasets: ${uploadResults.length}`));

    return {
      success: true,
      message: 'EventLogFile extraction completed',
      extractedFiles: eventLogFiles.length,
      downloadedFiles: downloadedFiles.length,
      uploadedDatasets: uploadResults.length,
      outputDir: this.outputDir,
      results: uploadResults.map(result => ({
        eventType: result.eventType,
        datasetName: result.datasetName,
        fileCount: result.fileCount,
        success: result.success,
        ...(result.datasetId && { datasetId: result.datasetId }),
        ...(result.message && { message: result.message }),
        ...(result.error && { error: result.error })
      }))
    };
  }

  /**
   * Get available event types from the EventLogFile object and prompt user for specific selection
   * Users must select at least one event type - no "all types" option is provided
   */
  private async promptForEventTypes(): Promise<string[]> {
    try {
      uxLog(this, c.cyan('Fetching available EventLogFile event types...'));

      // Query the EventLogFile object to get available event types
      // We'll get distinct event types from existing records in the last 90 days
      const dateFilter = new Date();
      dateFilter.setDate(dateFilter.getDate() - 90);
      const dateString = dateFilter.toISOString().split('T')[0];

      const eventTypesQuery = `
        SELECT EventType, COUNT(Id) RecordCount
        FROM EventLogFile 
        WHERE LogDate >= ${dateString}T00:00:00Z 
        GROUP BY EventType 
        ORDER BY EventType
      `;

      const queryResult = await soqlQuery(eventTypesQuery, this.conn);

      if (queryResult.records.length === 0) {
        uxLog(this, c.yellow('No EventLogFile records found in the last 90 days.'));
        uxLog(this, c.yellow('Please specify event types using the --eventtype flag instead.'));
        throw new Error('No EventLogFile records available for selection');
      }

      // Format choices for the prompt
      const eventTypeChoices = queryResult.records.map((record: any) => ({
        title: `${record.EventType} (${record.RecordCount} records available)`,
        value: record.EventType
      })).sort((a, b) => a.title.localeCompare(b.title));

      uxLog(this, c.cyan(`Found ${queryResult.records.length} different event types in your org.`));

      const response = await prompts({
        type: 'multiselect',
        message: 'Select event types to extract (use space to select/deselect, enter to confirm):',
        choices: eventTypeChoices,
        name: 'selectedEventTypes'
      });

      if (response.selectedEventTypes === 'exitNow') {
        throw new Error('User cancelled the operation');
      }

      if (!response.selectedEventTypes || response.selectedEventTypes.length === 0) {
        uxLog(this, c.yellow('No event types selected. Please run the command again and select at least one event type.'));
        throw new Error('No event types selected');
      }

      uxLog(this, c.green(`Selected event types: ${response.selectedEventTypes.join(', ')}`));
      return response.selectedEventTypes;

    } catch (error) {
      if (error instanceof Error && error.message?.includes('User cancelled')) {
        throw error;
      }
      if (error instanceof Error && (error.message?.includes('No EventLogFile records available') || error.message?.includes('No event types selected'))) {
        throw error;
      }
      uxLog(this, c.red(`Error: Could not fetch event types: ${error instanceof Error ? error.message : String(error)}`));
      uxLog(this, c.yellow('Please specify event types using the --eventtype flag instead.'));
      throw new Error('Unable to fetch available event types for selection');
    }
  }

  /**
   * Prompt user for number of days to look back for EventLogFile records
   * User must select from predefined choices between 1 and 30 days
   */
  private async promptForDays(): Promise<number> {
    try {
      uxLog(this, c.cyan('Select number of days to look back for EventLogFile records...'));

      // Build list of day choices (1-30)
      const dayChoices: Array<{ title: string; value: number }> = [];

      // Add remaining days (2, 4-6, 8-13, 15-29)
      for (let i = 1; i <= 30; i++) {
        dayChoices.push({
          title: `${i} days`,
          value: i
        });
      }

      const response = await prompts({
        type: 'select',
        message: 'Select number of days to look back:',
        choices: dayChoices,
        name: 'days'
      });

      if (response.days === undefined || response.days === 'exitNow') {
        throw new Error('User cancelled the operation');
      }

      uxLog(this, c.green(`Selected: ${response.days} days`));
      return response.days;

    } catch (error) {
      if (error instanceof Error && error.message?.includes('User cancelled')) {
        throw error;
      }
      uxLog(this, c.red(`Error: Could not get number of days: ${error instanceof Error ? error.message : String(error)}`));
      uxLog(this, c.yellow('Using default value: 30 days'));
      return 30;
    }
  }

  /**
   * Extract EventLogFile records from the org
   */
  private async extractEventLogFiles(eventTypes: string[] | null, daysBack: number): Promise<EventLogFileRecord[]> {
    uxLog(this, c.cyan(`Querying EventLogFile records from the last ${daysBack} days...`));

    const dateFilter = new Date();
    dateFilter.setDate(dateFilter.getDate() - daysBack);
    const dateString = dateFilter.toISOString().split('T')[0];

    let soqlQueryLogFiles = `
      SELECT Id, EventType, LogDate, LogFileLength, LogFile 
      FROM EventLogFile 
      WHERE LogDate >= ${dateString}T00:00:00Z 
      AND LogFileLength > 0
    `;

    if (eventTypes && eventTypes.length > 0) {
      const eventTypeFilter = eventTypes.map(type => `'${type}'`).join(',');
      soqlQueryLogFiles += ` AND EventType IN (${eventTypeFilter})`;
    }

    soqlQueryLogFiles += ` ORDER BY LogDate DESC, EventType`;

    if (this.debugMode) {
      uxLog(this, c.gray(`SOQL Query: ${soqlQueryLogFiles}`));
    }

    try {
      const queryResult = await soqlQuery(soqlQueryLogFiles, this.conn);
      uxLog(this, c.green(`Retrieved ${queryResult.records.length} EventLogFile records`));

      // Group by EventType for reporting
      const eventTypeCounts: { [key: string]: number } = {};
      queryResult.records.forEach((record: any) => {
        eventTypeCounts[record.EventType] = (eventTypeCounts[record.EventType] || 0) + 1;
      });

      uxLog(this, c.cyan(`Event types found:`));
      Object.entries(eventTypeCounts).forEach(([eventType, count]) => {
        uxLog(this, c.gray(`  - ${eventType}: ${count} files`));
      });

      return queryResult.records;
    } catch (error) {
      uxLog(this, c.red(`Error querying EventLogFile records: ${error instanceof Error ? error.message : String(error)}`));
      throw error;
    }
  }

  /**
   * Download CSV files for each EventLogFile record
   */
  private async downloadEventLogFiles(eventLogFiles: EventLogFileRecord[]): Promise<DownloadedFile[]> {
    uxLog(this, c.cyan(`Downloading CSV files for ${eventLogFiles.length} EventLogFile records...`));

    const downloadedFiles: DownloadedFile[] = [];

    for (let i = 0; i < eventLogFiles.length; i++) {
      const eventLogFile = eventLogFiles[i];
      const progressText = `[${i + 1}/${eventLogFiles.length}]`;

      uxLog(this, c.gray(`${progressText} Downloading ${eventLogFile.EventType} log from ${eventLogFile.LogDate}...`));

      // Create event type directory
      const eventTypeDir = path.join(this.outputDir, eventLogFile.EventType);
      await fs.ensureDir(eventTypeDir);

      // Generate filename
      const logDate = new Date(eventLogFile.LogDate).toISOString().split('T')[0];
      const fileName = `${eventLogFile.EventType}_${logDate}_${eventLogFile.Id}.csv`;
      const filePath = path.join(eventTypeDir, fileName);

      // Download the log file content
      const logFileUrl = `${this.conn.instanceUrl}${eventLogFile.LogFile}`;
      uxLog(this, c.gray(`${progressText} Fetching log file from: ${logFileUrl}`));
      const downloadResult = await new FileDownloader(logFileUrl, { conn: this.conn, outputFile: filePath }).download();

      if (downloadResult.success) {
        downloadedFiles.push({
          id: eventLogFile.Id,
          eventType: eventLogFile.EventType,
          logDate: eventLogFile.LogDate,
          filePath: filePath,
          fileName: fileName,
          size: eventLogFile.LogFileLength
        });
        uxLog(this, c.gray(`${progressText} Downloaded: ${fileName} (${eventLogFile.LogFileLength} bytes)`));
      } else {
        uxLog(this, c.yellow(`${progressText} Warning: Failed to download ${eventLogFile.EventType} log ${eventLogFile.Id}: ${downloadResult.error instanceof Error ? downloadResult.error.message : String(downloadResult.error)}`));
      }
    }

    uxLog(this, c.green(`Successfully downloaded ${downloadedFiles.length} CSV files`));
    return downloadedFiles;
  }

  /**
   * Upload CSV files to CRM Analytics datasets
   */
  private async uploadToCRMAnalytics(downloadedFiles: DownloadedFile[]): Promise<UploadResult[]> {
    uxLog(this, c.cyan(`Uploading CSV files to CRM Analytics datasets...`));

    // Group files by event type
    const filesByEventType: { [key: string]: DownloadedFile[] } = {};
    downloadedFiles.forEach(file => {
      if (!filesByEventType[file.eventType]) {
        filesByEventType[file.eventType] = [];
      }
      filesByEventType[file.eventType].push(file);
    });

    const uploadResults: UploadResult[] = [];

    for (const [eventType, files] of Object.entries(filesByEventType)) {
      const datasetName = `DSInput_${eventType}`;

      try {
        uxLog(this, c.cyan(`Processing ${files.length} files for dataset: ${datasetName}`));

        // Merge CSV files (always enabled by default)
        let filesToUpload = files;
        if (files.length > 1) {
          uxLog(this, c.gray(`Merging ${files.length} CSV files for ${eventType}...`));
          const mergedFile = await this.mergeCsvFiles(eventType, files);
          filesToUpload = [mergedFile];
          uxLog(this, c.green(`Merged ${files.length} files into: ${mergedFile.fileName}`));
        }

        // Create or update dataset for this event type
        const datasetResult = await this.createOrUpdateDataset(datasetName, eventType, filesToUpload);

        uploadResults.push({
          eventType,
          datasetName,
          fileCount: filesToUpload.length,
          success: datasetResult.success,
          datasetId: datasetResult.datasetId,
          message: datasetResult.message
        });

      } catch (error) {
        uxLog(this, c.red(`Error processing dataset ${datasetName}: ${error instanceof Error ? error.message : String(error)}`));
        uploadResults.push({
          eventType,
          datasetName,
          fileCount: files.length,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return uploadResults;
  }

  /**
   * Create or update a CRM Analytics dataset
   */
  private async createOrUpdateDataset(datasetName: string, eventType: string, files: DownloadedFile[]): Promise<any> {
    uxLog(this, c.cyan(`Creating/updating CRM Analytics dataset: ${datasetName}`));

    try {
      // Check if dataset already exists using Wave API
      const existingDataset = await this.checkDatasetExists(datasetName);

      if (existingDataset) {
        uxLog(this, c.gray(`Dataset ${datasetName} already exists (ID: ${existingDataset.id}), will append data...`));
        return await this.appendDataToDataset(existingDataset.id, files);
      } else {
        uxLog(this, c.gray(`Creating new dataset: ${datasetName}`));
        return await this.createNewDataset(datasetName, eventType, files);
      }

    } catch (error) {
      throw new Error(`Failed to create/update dataset ${datasetName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if a dataset exists using Wave API
   */
  private async checkDatasetExists(datasetName: string): Promise<any | null> {
    const apiVersion = this.conn.getApiVersion();
    const datasetsUrl = `${this.conn.instanceUrl}/services/data/v${apiVersion}/wave/datasets`;

    if (this.debugMode) {
      uxLog(this, c.gray(`Checking dataset existence at: ${datasetsUrl}`));
    }

    // Get all datasets and filter by name
    const response = await this.conn.request({
      method: 'GET',
      url: datasetsUrl,
      headers: {
        'Content-Type': 'application/json'
      }
    }) as any;

    // Look for dataset with matching name or developerName
    const existingDataset = response.datasets?.find((dataset: any) =>
      dataset.name === datasetName ||
      dataset.developerName === datasetName
    );

    if (existingDataset) {
      if (this.debugMode) {
        uxLog(this, c.gray(`Found existing dataset: ${JSON.stringify(existingDataset, null, 2)}`));
      }
      return existingDataset;
    }

    return null;
  }

  /**
   * Get or create a CRM Analytics folder using Wave API
   */
  private async getOrCreateFolder(folderName: string): Promise<string> {
    const apiVersion = this.conn.getApiVersion();
    const foldersUrl = `${this.conn.instanceUrl}/services/data/v${apiVersion}/wave/folders`;

    if (this.debugMode) {
      uxLog(this, c.gray(`Checking folders at: ${foldersUrl}`));
    }

    // Get all folders and look for existing folder
    const response = await this.conn.request({
      method: 'GET',
      url: foldersUrl,
      headers: {
        'Content-Type': 'application/json'
      }
    }) as any;

    // Look for existing folder
    const existingFolder = response.folders?.find((folder: any) =>
      folder.name === folderName || folder.label === folderName
    );

    if (existingFolder) {
      if (this.debugMode) {
        uxLog(this, c.gray(`Found existing folder: ${folderName} (ID: ${existingFolder.id})`));
      }
      return existingFolder.id;
    }

    // Create new folder if it doesn't exist
    uxLog(this, c.gray(`Creating new folder: ${folderName}`));

    const folderMetadata = {
      name: folderName,
      label: folderName,
      description: `Folder for ${folderName} datasets`
    };

    const createResponse = await this.conn.request({
      method: 'POST',
      url: foldersUrl,
      body: JSON.stringify(folderMetadata),
      headers: {
        'Content-Type': 'application/json'
      }
    }) as any;

    uxLog(this, c.green(`Created folder: ${folderName} (ID: ${createResponse.id})`));
    return createResponse.id;
  }

  /**
   * Create a new CRM Analytics dataset using Wave API
   */
  private async createNewDataset(datasetName: string, eventType: string, files: DownloadedFile[]): Promise<any> {
    try {
      uxLog(this, c.gray(`Creating dataset "${datasetName}" using Wave API...`));

      // Step 1: Get or create the EventLogFiles folder (optional)
      let folderId: string | null = null;
      try {
        folderId = await this.getOrCreateFolder('EventLogFiles');
      } catch (error) {
        uxLog(this, c.yellow(`Warning: Could not create/access folder, creating dataset in default location`));
      }

      // Step 2: Create dataset metadata
      const datasetMetadata: any = {
        name: datasetName,
        label: `EventLogFile ${eventType}`,
        description: `EventLogFile data for ${eventType} events`
      };

      // Only add folder if we successfully got one
      if (folderId) {
        datasetMetadata.folder = { id: folderId };
      }

      const apiVersion = this.conn.getApiVersion();
      const datasetUrl = `${this.conn.instanceUrl}/services/data/v${apiVersion}/wave/datasets`;

      if (this.debugMode) {
        uxLog(this, c.gray(`Creating dataset at: ${datasetUrl}`));
        uxLog(this, c.gray(`Dataset metadata: ${JSON.stringify(datasetMetadata, null, 2)}`));
      }

      // Create the dataset
      const datasetResponse = await this.conn.request({
        method: 'POST',
        url: datasetUrl,
        body: JSON.stringify(datasetMetadata),
        headers: {
          'Content-Type': 'application/json'
        }
      }) as WaveDatasetUploadResponse;

      uxLog(this, c.green(`Created dataset "${datasetName}" with ID: ${datasetResponse.id}`));

      // Step 3: Upload CSV files to the dataset
      let successCount = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const progressText = `[${i + 1}/${files.length}]`;

        try {
          await this.uploadFileToDataset(datasetResponse.id, file, progressText);
          successCount++;
        } catch (error) {
          uxLog(this, c.yellow(`${progressText} Warning: Failed to upload ${file.fileName}: ${error instanceof Error ? error.message : String(error)}`));
        }
      }

      return {
        success: successCount > 0,
        datasetId: datasetResponse.id,
        message: `Created dataset with ${successCount}/${files.length} files uploaded successfully`
      };

    } catch (error) {
      throw new Error(`Failed to create dataset: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Append data to an existing dataset using Wave API
   */
  private async appendDataToDataset(datasetId: string, files: DownloadedFile[]): Promise<any> {
    try {
      let successCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const progressText = `[${i + 1}/${files.length}]`;

        try {
          await this.uploadFileToDataset(datasetId, file, progressText);
          successCount++;
        } catch (error) {
          uxLog(this, c.yellow(`${progressText} Warning: Failed to upload ${file.fileName}: ${error instanceof Error ? error.message : String(error)}`));
        }
      }

      return {
        success: successCount > 0,
        datasetId,
        message: `Appended ${successCount}/${files.length} files to existing dataset`
      };

    } catch (error) {
      throw new Error(`Failed to append data to dataset: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Upload a single CSV file to a CRM Analytics dataset using Wave API
   */
  private async uploadFileToDataset(datasetId: string, file: DownloadedFile, progressText?: string): Promise<void> {
    try {
      const prefix = progressText || '';
      uxLog(this, c.gray(`${prefix} Uploading ${file.fileName} to dataset...`));

      const apiVersion = this.conn.getApiVersion();
      const uploadUrl = `${this.conn.instanceUrl}/services/data/v${apiVersion}/wave/datasets/${datasetId}/versions`;

      // Read the CSV file content
      const fileContent = await fs.readFile(file.filePath, 'utf8');

      // Create upload job
      const uploadJobMetadata = {
        Format: 'CSV',
        EdgemartAlias: null,
        MetadataJson: JSON.stringify({
          fileFormat: {
            charsetName: 'UTF-8',
            fieldsDelimitedBy: ',',
            fieldsEnclosedBy: '"',
            numberOfLinesToIgnore: 1
          }
        }),
        Action: 'Overwrite',
        NotificationSent: false,
        NotificationEmail: null
      };

      if (this.debugMode) {
        uxLog(this, c.gray(`${prefix} Creating upload job at: ${uploadUrl}`));
        uxLog(this, c.gray(`${prefix} Upload metadata: ${JSON.stringify(uploadJobMetadata, null, 2)}`));
      }

      // Step 1: Create upload job
      const jobResponse = await this.conn.request({
        method: 'POST',
        url: uploadUrl,
        body: JSON.stringify(uploadJobMetadata),
        headers: {
          'Content-Type': 'application/json'
        }
      }) as WaveDatasetUploadJobResponse;

      uxLog(this, c.gray(`${prefix} Created upload job: ${jobResponse.id}`));

      // Step 2: Upload CSV data
      const dataUploadUrl = `${uploadUrl}/${jobResponse.id}/parts/1`;

      await this.conn.request({
        method: 'PUT',
        url: dataUploadUrl,
        body: fileContent,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Length': Buffer.byteLength(fileContent, 'utf8').toString()
        }
      });

      uxLog(this, c.gray(`${prefix} Uploaded CSV data for ${file.fileName}`));

      // Step 3: Start processing
      const processUrl = `${uploadUrl}/${jobResponse.id}`;
      await this.conn.request({
        method: 'PATCH',
        url: processUrl,
        body: JSON.stringify({ action: 'Process' }),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      uxLog(this, c.green(`${prefix} Successfully uploaded: ${file.fileName}`));

    } catch (error) {
      throw new Error(`Failed to upload file ${file.fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Merge multiple CSV files of the same event type into a single CSV file
   */
  private async mergeCsvFiles(eventType: string, files: DownloadedFile[]): Promise<DownloadedFile> {
    const mergedFileName = `${eventType}_merged_${new Date().toISOString().split('T')[0]}.csv`;
    const mergedFilePath = path.join(this.outputDir, eventType, mergedFileName);

    let isFirstFile = true;
    let mergedContent = '';
    let totalSize = 0;

    for (const file of files) {
      uxLog(this, c.gray(`Reading ${file.fileName}...`));
      const fileContent = await fs.readFile(file.filePath, 'utf8');
      const lines = fileContent.split('\n');

      if (isFirstFile) {
        // Include header for the first file
        mergedContent = fileContent;
        isFirstFile = false;
      } else {
        // Skip header for subsequent files (first line)
        if (lines.length > 1) {
          const dataLines = lines.slice(1).join('\n');
          if (dataLines.trim()) {
            mergedContent += '\n' + dataLines;
          }
        }
      }

      totalSize += file.size;
    }

    // Write merged content to file
    await fs.writeFile(mergedFilePath, mergedContent, 'utf8');

    uxLog(this, c.green(`Created merged file: ${mergedFileName} (${totalSize} bytes total)`));

    return {
      id: `merged_${eventType}`,
      eventType: eventType,
      logDate: new Date().toISOString(),
      filePath: mergedFilePath,
      fileName: mergedFileName,
      size: totalSize
    };
  }
  /* jscpd:ignore-end */
}
