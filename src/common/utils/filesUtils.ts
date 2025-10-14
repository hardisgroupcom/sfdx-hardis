// External Libraries and Node.js Modules
import fs from 'fs-extra';
import * as path from 'path';
import c from 'chalk';
import open from 'open';
import * as split from 'split';
import { PromisePool } from '@supercharge/promise-pool';
import crypto from 'crypto';

// Salesforce Specific and Other Specific Libraries
import { Connection, SfError } from '@salesforce/core';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';

// Project Specific Utilities
import { getCurrentGitBranch, isCI, isGitRepo, uxLog } from './index.js';
import { bulkQuery, soqlQuery, bulkQueryByChunks } from './apiUtils.js';
import { prompts } from './prompts.js';
import { getApiVersion, getReportDirectory } from '../../config/index.js';
import { WebSocketClient } from '../websocketClient.js';
import { FileDownloader } from './fileDownloader.js';
import { ApiLimitsManager } from './limitUtils.js';

export const filesFolderRoot = path.join('.', 'scripts', 'files');

export class FilesExporter {
  private filesPath: string;
  private conn: Connection;
  private pollTimeout: number;
  private recordsChunkSize: number;
  private startChunkNumber: number;
  private parentRecordsChunkSize: number;
  private commandThis: any;

  private dtl: any = null; // export config
  private exportedFilesFolder: string = '';
  private recordsChunk: any[] = [];
  private chunksNumber = 1;

  private recordsChunkQueue: any[] = [];
  private recordsChunkQueueRunning = false;
  private queueInterval: any;
  private bulkApiRecordsEnded = false;

  private recordChunksNumber = 0;
  private logFile: string;
  private hasExistingFiles: boolean;
  private resumeExport: boolean;

  private totalRestApiCalls = 0;
  private totalBulkApiCalls = 0;
  private totalParentRecords = 0;
  private parentRecordsWithFiles = 0;
  private recordsIgnored = 0;
  private filesDownloaded = 0;
  private filesErrors = 0;
  private filesIgnoredType = 0;
  private filesIgnoredExisting = 0;
  private filesIgnoredSize = 0;
  private filesValidationErrors = 0;
  private filesValidated = 0; // Count of files that went through validation (downloaded or existing)

  // Optimized API Limits Management System
  private apiLimitsManager: ApiLimitsManager;

  constructor(
    filesPath: string,
    conn: Connection,
    options: { pollTimeout?: number; recordsChunkSize?: number; exportConfig?: any; startChunkNumber?: number; resumeExport?: boolean },
    commandThis: any
  ) {
    this.filesPath = filesPath;
    this.conn = conn;
    this.pollTimeout = options?.pollTimeout || 600000;
    this.recordsChunkSize = options?.recordsChunkSize || 1000;
    this.parentRecordsChunkSize = 100000;
    this.startChunkNumber = options?.startChunkNumber || 0;
    this.resumeExport = options?.resumeExport || false;
    this.hasExistingFiles = fs.existsSync(path.join(this.filesPath, 'export'));
    this.commandThis = commandThis;
    if (options.exportConfig) {
      this.dtl = options.exportConfig;
    }

    // Initialize the optimized API limits manager
    this.apiLimitsManager = new ApiLimitsManager(conn, commandThis);
  }

  async processExport() {
    // Get config
    if (this.dtl === null) {
      this.dtl = await getFilesWorkspaceDetail(this.filesPath);
    }
    uxLog("action", this.commandThis, c.cyan(`Initializing files export for workspace ${c.green(this.dtl.full_label)}.`));
    uxLog("log", this.commandThis, c.italic(c.grey(this.dtl.description)));

    // Make sure export folder for files is existing
    this.exportedFilesFolder = path.join(this.filesPath, 'export');
    await fs.ensureDir(this.exportedFilesFolder);

    // Handle resume/restart mode
    if (!this.resumeExport) {
      if (this.hasExistingFiles) {
        // Restart mode: clear the output folder
        uxLog("action", this.commandThis, c.yellow(`Restart mode: clearing output folder ${this.exportedFilesFolder}.`));
        await fs.emptyDir(this.exportedFilesFolder);
      }
    } else {
      uxLog("action", this.commandThis, c.cyan(`Resume mode: existing files will be validated and skipped if valid`));
    }

    await this.calculateApiConsumption();

    const reportDir = await getReportDirectory();
    const reportExportDir = path.join(reportDir, 'files-export-log');
    const now = new Date();
    const dateStr = now.toISOString().replace(/T/, '_').replace(/:/g, '-').replace(/\..+/, '');
    this.logFile = path.join(reportExportDir, `files-export-log-${this.dtl.name}-${dateStr}.csv`);

    // Initialize CSV log file with headers
    await this.initializeCsvLog();

    // Phase 1: Calculate total files count for accurate progress tracking
    uxLog("action", this.commandThis, c.cyan("Estimating total files to download."));
    const totalFilesCount = await this.calculateTotalFilesCount();
    uxLog("log", this.commandThis, c.grey(`Estimated ${totalFilesCount} files to download.`));

    // Phase 2: Process downloads with accurate progress tracking
    await this.processDownloadsWithProgress(totalFilesCount);

    const result = await this.buildResult();
    return result;
  }

  // Phase 1: Calculate total files count using efficient COUNT() queries
  private async calculateTotalFilesCount(): Promise<number> {
    let totalFiles = 0;

    // Get parent records count to estimate batching
    const countSoqlQuery = this.dtl.soqlQuery.replace(/SELECT (.*) FROM/gi, 'SELECT COUNT() FROM');
    await this.waitIfApiLimitApproached('REST');
    this.totalRestApiCalls++;
    const countSoqlQueryRes = await soqlQuery(countSoqlQuery, this.conn);
    const totalParentRecords = countSoqlQueryRes.totalSize;

    // Count Attachments - use COUNT() query with IN clause batching for memory efficiency
    const attachmentBatchSize = 200;

    // Estimate Attachments count by sampling
    const sampleSize = Math.min(attachmentBatchSize, totalParentRecords);
    if (sampleSize > 0) {
      // Get sample of parent IDs
      const sampleQuery = this.dtl.soqlQuery.replace(/SELECT (.*) FROM/gi, 'SELECT Id FROM') + ` LIMIT ${sampleSize}`;
      await this.waitIfApiLimitApproached('REST');
      this.totalRestApiCalls++;
      const sampleParents = await soqlQuery(sampleQuery, this.conn);

      if (sampleParents.records.length > 0) {
        const sampleParentIds = sampleParents.records.map((record: any) => `'${record.Id}'`).join(',');
        const attachmentCountQuery = `SELECT COUNT() FROM Attachment WHERE ParentId IN (${sampleParentIds})`;
        await this.waitIfApiLimitApproached('REST');
        this.totalRestApiCalls++;
        const attachmentCountRes = await soqlQuery(attachmentCountQuery, this.conn);

        // Extrapolate from sample
        const avgAttachmentsPerRecord = attachmentCountRes.totalSize / sampleParents.records.length;
        totalFiles += Math.round(avgAttachmentsPerRecord * totalParentRecords);
      }
    }

    // Count ContentVersions - use COUNT() query with sampling for memory efficiency
    if (sampleSize > 0) {
      const sampleQuery = this.dtl.soqlQuery.replace(/SELECT (.*) FROM/gi, 'SELECT Id FROM') + ` LIMIT ${sampleSize}`;
      const sampleParents = await soqlQuery(sampleQuery, this.conn);

      if (sampleParents.records.length > 0) {
        const sampleParentIds = sampleParents.records.map((record: any) => `'${record.Id}'`).join(',');

        // Count ContentDocumentLinks for sample
        const linkCountQuery = `SELECT COUNT() FROM ContentDocumentLink WHERE LinkedEntityId IN (${sampleParentIds})`;
        this.totalRestApiCalls++;
        const linkCountRes = await soqlQuery(linkCountQuery, this.conn);

        // Extrapolate from sample (ContentVersions ≈ ContentDocumentLinks for latest versions)
        const avgContentVersionsPerRecord = linkCountRes.totalSize / sampleParents.records.length;
        totalFiles += Math.round(avgContentVersionsPerRecord * totalParentRecords);
      }
    }

    return Math.max(totalFiles, 1); // Ensure at least 1 for progress tracking
  }

  // Phase 2: Process downloads with accurate file-based progress tracking
  private async processDownloadsWithProgress(estimatedFilesCount: number) {
    let filesProcessed = 0;
    let totalFilesDiscovered = 0; // Track actual files discovered
    let actualTotalFiles = estimatedFilesCount; // Start with estimation, will be adjusted as we discover actual files

    // Start progress tracking with estimated total files count
    WebSocketClient.sendProgressStartMessage('Exporting files', actualTotalFiles);

    // Progress callback function with total adjustment capability
    const progressCallback = (filesCompleted: number, filesDiscoveredInChunk?: number) => {
      filesProcessed += filesCompleted;

      // If we discovered files in this chunk, update our tracking
      if (filesDiscoveredInChunk !== undefined) {
        totalFilesDiscovered += filesDiscoveredInChunk;
        // Update total to use actual discovered count + remaining estimation
        const processedChunks = this.recordChunksNumber;
        const totalChunks = this.chunksNumber;
        const remainingChunks = totalChunks - processedChunks;

        if (remainingChunks > 0) {
          // Estimate remaining files based on actual discovery rate
          const avgFilesPerChunk = totalFilesDiscovered / processedChunks;
          const estimatedRemainingFiles = Math.round(avgFilesPerChunk * remainingChunks);
          actualTotalFiles = totalFilesDiscovered + estimatedRemainingFiles;
        } else {
          // All chunks processed, use actual total
          actualTotalFiles = totalFilesDiscovered;
        }

        // Get API usage for display (non-blocking)
        this.getApiUsageStatus().then(apiUsage => {
          uxLog("other", this, c.grey(`Discovered ${filesDiscoveredInChunk} files in chunk, updated total estimate to ${actualTotalFiles} ${apiUsage.message}`));
        }).catch(() => {
          uxLog("other", this, c.grey(`Discovered ${filesDiscoveredInChunk} files in chunk, updated total estimate to ${actualTotalFiles}`));
        });
      }

      WebSocketClient.sendProgressStepMessage(filesProcessed, actualTotalFiles);
    };

    // Use modified queue system with progress tracking
    this.startQueue(progressCallback);
    await this.processParentRecords(progressCallback);
    await this.queueCompleted();

    // End progress tracking with final total
    WebSocketClient.sendProgressEndMessage(actualTotalFiles);
  }

  // Calculate API consumption and validate limits - optimized with new ApiLimitsManager
  private async calculateApiConsumption() {
    // Initialize the API limits manager
    await this.apiLimitsManager.initialize();

    const countSoqlQuery = this.dtl.soqlQuery.replace(/SELECT (.*) FROM/gi, 'SELECT COUNT() FROM');
    await this.apiLimitsManager.trackApiCall('REST');
    this.totalRestApiCalls++;
    const countSoqlQueryRes = await soqlQuery(countSoqlQuery, this.conn);
    this.chunksNumber = Math.round(countSoqlQueryRes.totalSize / this.recordsChunkSize);

    // Get current usage for API consumption estimation
    const currentUsage = this.apiLimitsManager.getCurrentUsage();

    // More accurate API consumption estimation:
    // - 1 Bulk API v2 call for main parent records query
    // - Multiple REST API calls for Attachment queries (batches of 200)
    // - Multiple Bulk API v2 calls for ContentDocumentLink and ContentVersion queries
    const estimatedRestApiCalls = Math.round(this.chunksNumber * (countSoqlQueryRes.totalSize / 200)) + 5; // Attachment batches + counting queries
    const estimatedBulkApiCalls = Math.round(this.chunksNumber * 3) + 1; // Parent records + ContentDocumentLink + ContentVersion per chunk

    // Check REST API limit with safety buffer
    const restApiSafetyBuffer = 500;
    if (currentUsage.restRemaining < estimatedRestApiCalls + restApiSafetyBuffer) {
      throw new SfError(
        `You don't have enough REST API calls available (${c.bold(
          currentUsage.restRemaining
        )}) to perform this export that could consume ${c.bold(estimatedRestApiCalls)} REST API calls`
      );
    }

    // Check Bulk API v2 limit with safety buffer
    const bulkApiSafetyBuffer = 100;
    if (currentUsage.bulkRemaining < estimatedBulkApiCalls + bulkApiSafetyBuffer) {
      throw new SfError(
        `You don't have enough Bulk API v2 calls available (${c.bold(
          currentUsage.bulkRemaining
        )}) to perform this export that could consume ${c.bold(estimatedBulkApiCalls)} Bulk API v2 calls`
      );
    }

    // Request user confirmation
    if (!isCI) {
      const warningMessage = c.cyanBright(
        `This export of files could run on ${c.bold(c.yellow(countSoqlQueryRes.totalSize))} records, in ${c.bold(
          c.yellow(this.chunksNumber)
        )} chunks, and consume up to ${c.bold(c.yellow(estimatedRestApiCalls))} REST API calls (${c.bold(c.yellow(currentUsage.restRemaining))} remaining) and ${c.bold(c.yellow(estimatedBulkApiCalls))} Bulk API v2 calls (${c.bold(c.yellow(currentUsage.bulkRemaining))} remaining). Do you want to proceed ?`
      );
      const promptRes = await prompts({
        type: 'confirm',
        message: warningMessage,
        description: 'Proceed with the operation despite API usage warnings'
      });
      if (promptRes.value !== true) {
        throw new SfError('Command cancelled by user.');
      }
      if (this.startChunkNumber === 0) {
        uxLog(
          "warning",
          this,
          c.yellow(
            c.italic('Use --startchunknumber command line argument if you do not want to start from first chunk')
          )
        );
      }
    }
  }

  // Monitor API usage during operations using the optimized ApiLimitsManager
  private async waitIfApiLimitApproached(operationType: 'REST' | 'BULK') {
    await this.apiLimitsManager.trackApiCall(operationType);
  }

  // Get current API usage percentages for display
  private async getApiUsageStatus(): Promise<{ rest: number; bulk: number; message: string }> {
    return this.apiLimitsManager.getUsageStatus();
  }

  // Run chunks one by one, and don't wait to have all the records fetched to start it
  private startQueue(progressCallback?: (filesCompleted: number, filesDiscoveredInChunk?: number) => void) {
    this.queueInterval = setInterval(async () => {
      if (this.recordsChunkQueueRunning === false && this.recordsChunkQueue.length > 0) {
        this.recordsChunkQueueRunning = true;
        const queueItem = this.recordsChunkQueue.shift();
        // Handle both old format (array) and new format (object with records and progressCallback)
        const recordChunk = Array.isArray(queueItem) ? queueItem : queueItem.records;
        const chunkProgressCallback = Array.isArray(queueItem) ? progressCallback : queueItem.progressCallback;
        await this.processRecordsChunk(recordChunk, chunkProgressCallback);
        this.recordsChunkQueueRunning = false;
        // Manage last chunk
      } else if (
        this.bulkApiRecordsEnded === true &&
        this.recordsChunkQueue.length === 0 &&
        this.recordsChunk.length > 0
      ) {
        const recordsToProcess = [...this.recordsChunk];
        this.recordsChunk = [];
        this.recordsChunkQueue.push({ records: recordsToProcess, progressCallback });
      }
    }, 1000);
  }

  // Wait for the queue to be completed
  private async queueCompleted() {
    await new Promise((resolve) => {
      const completeCheckInterval = setInterval(async () => {
        if (
          this.bulkApiRecordsEnded === true &&
          this.recordsChunkQueueRunning === false &&
          this.recordsChunkQueue.length === 0 &&
          this.recordsChunk.length === 0
        ) {
          clearInterval(completeCheckInterval);
          resolve(true);
        }
        if (globalThis.sfdxHardisFatalError === true) {
          uxLog("error", this, c.red('Fatal error while processing chunks queue'));
          process.exit(1);
        }
      }, 1000);
    });
    clearInterval(this.queueInterval);
    this.queueInterval = null;
  }

  private async processParentRecords(progressCallback?: (filesCompleted: number, filesDiscoveredInChunk?: number) => void) {
    // Query parent records using SOQL defined in export.json file
    await this.waitIfApiLimitApproached('BULK');
    this.totalBulkApiCalls++;
    this.conn.bulk.pollTimeout = this.pollTimeout || 600000; // Increase timeout in case we are on a bad internet connection or if the bulk api batch is queued

    // Use bulkQueryByChunks to handle large queries
    const queryRes = await bulkQueryByChunks(this.dtl.soqlQuery, this.conn, this.parentRecordsChunkSize);
    for (const record of queryRes.records) {
      this.totalParentRecords++;
      const parentRecordFolderForFiles = path.resolve(
        path.join(this.exportedFilesFolder, record[this.dtl.outputFolderNameField] || record.Id)
      );
      if (this.dtl.overwriteParentRecords !== true && fs.existsSync(parentRecordFolderForFiles)) {
        uxLog(
          "log",
          this,
          c.grey(
            `Skipped record - ${record[this.dtl.outputFolderNameField] || record.Id} - Record files already downloaded`
          )
        );
        this.recordsIgnored++;
        continue;
      }
      await this.addToRecordsChunk(record, progressCallback);
    }
    this.bulkApiRecordsEnded = true;
  }

  private async addToRecordsChunk(record: any, progressCallback?: (filesCompleted: number, filesDiscoveredInChunk?: number) => void) {
    this.recordsChunk.push(record);
    // If chunk size is reached , process the chunk of records
    if (this.recordsChunk.length === this.recordsChunkSize) {
      const recordsToProcess = [...this.recordsChunk];
      this.recordsChunk = [];
      this.recordsChunkQueue.push({ records: recordsToProcess, progressCallback });
    }
  }

  private async processRecordsChunk(records: any[], progressCallback?: (filesCompleted: number, filesDiscoveredInChunk?: number) => void) {
    this.recordChunksNumber++;
    if (this.recordChunksNumber < this.startChunkNumber) {
      uxLog(
        "action",
        this,
        c.cyan(
          `Skip parent records chunk #${this.recordChunksNumber} because it is lesser than ${this.startChunkNumber}`
        )
      );
      return;
    }

    let actualFilesInChunk = 0;

    uxLog(
      "action",
      this,
      c.cyan(
        `Processing parent records chunk #${this.recordChunksNumber} on ${this.chunksNumber} (${records.length} records) ...`
      )
    );
    // Process records in batches of 200 for Attachments and 1000 for ContentVersions to avoid hitting the SOQL query limit
    const attachmentBatchSize = 200;
    const contentVersionBatchSize = 1000;
    for (let i = 0; i < records.length; i += attachmentBatchSize) {
      const batch = records.slice(i, i + attachmentBatchSize);
      // Request all Attachment related to all records of the batch using REST API
      const parentIdIn = batch.map((record: any) => `'${record.Id}'`).join(',');
      const attachmentQuery = `SELECT Id, Name, ContentType, ParentId, BodyLength FROM Attachment WHERE ParentId IN (${parentIdIn})`;
      await this.waitIfApiLimitApproached('REST');
      this.totalRestApiCalls++;
      const attachments = await this.conn.query(attachmentQuery);
      actualFilesInChunk += attachments.records.length; // Count actual files discovered

      if (attachments.records.length > 0) {
        // Download attachments using REST API
        await PromisePool.withConcurrency(5)
          .for(attachments.records)
          .process(async (attachment: any) => {
            try {
              await this.downloadAttachmentFile(attachment, batch);
              // Call progress callback if available
              if (progressCallback) {
                progressCallback(1);
              }
            } catch (e) {
              this.filesErrors++;
              uxLog("warning", this, c.red('Download file error: ' + attachment.Name + '\n' + e));
            }
          });
      } else {
        uxLog("log", this, c.grey(`No Attachments found for the ${batch.length} parent records in this batch`));
      }
    }
    for (let i = 0; i < records.length; i += contentVersionBatchSize) {
      const batch = records.slice(i, i + contentVersionBatchSize);
      // Request all ContentDocumentLink related to all records of the batch
      const linkedEntityIdIn = batch.map((record: any) => `'${record.Id}'`).join(',');
      const linkedEntityInQuery = `SELECT ContentDocumentId,LinkedEntityId FROM ContentDocumentLink WHERE LinkedEntityId IN (${linkedEntityIdIn})`;
      await this.waitIfApiLimitApproached('BULK');
      this.totalBulkApiCalls++;
      uxLog("log", this, c.grey(`Querying ContentDocumentLinks for ${linkedEntityInQuery.length} parent records in this batch...`));
      const contentDocumentLinks = await bulkQueryByChunks(linkedEntityInQuery, this.conn, this.parentRecordsChunkSize);
      if (contentDocumentLinks.records.length > 0) {
        // Retrieve all ContentVersion related to ContentDocumentLink
        const contentDocIdIn = contentDocumentLinks.records.map((link: any) => `'${link.ContentDocumentId}'`);
        // Loop on contentDocIdIn by contentVersionBatchSize
        for (let j = 0; j < contentDocIdIn.length; j += contentVersionBatchSize) {
          const contentDocIdBatch = contentDocIdIn.slice(j, j + contentVersionBatchSize).join(',');
          // Log the progression of contentDocIdBatch
          uxLog(
            "action",
            this,
            c.cyan(
              `Processing ContentDocumentId chunk #${Math.ceil((j + 1) / contentVersionBatchSize)} on ${Math.ceil(
                contentDocIdIn.length / contentVersionBatchSize
              )}`
            )
          );
          // Request all ContentVersion related to all records of the batch
          const contentVersionSoql = `SELECT Id,ContentDocumentId,Description,FileExtension,FileType,PathOnClient,Title,ContentSize,Checksum FROM ContentVersion WHERE ContentDocumentId IN (${contentDocIdBatch}) AND IsLatest = true`;
          await this.waitIfApiLimitApproached('BULK');
          this.totalBulkApiCalls++;
          const contentVersions = await bulkQueryByChunks(contentVersionSoql, this.conn, this.parentRecordsChunkSize);
          // ContentDocument object can be linked to multiple other objects even with same type (for example: same attachment can be linked to multiple EmailMessage objects).
          // Because of this when we fetch ContentVersion for ContentDocument it can return less results than there is ContentDocumentLink objects to link.
          // To fix this we create a list of ContentVersion and ContentDocumentLink pairs.
          // This way we have multiple pairs and we will download ContentVersion objects for each linked object.
          const versionsAndLinks: any[] = [];
          contentVersions.records.forEach((contentVersion) => {
            contentDocumentLinks.records.forEach((contentDocumentLink) => {
              if (contentDocumentLink.ContentDocumentId === contentVersion.ContentDocumentId) {
                versionsAndLinks.push({
                  contentVersion: contentVersion,
                  contentDocumentLink: contentDocumentLink,
                });
              }
            });
          });
          actualFilesInChunk += versionsAndLinks.length; // Count actual ContentVersion files discovered
          uxLog("log", this, c.grey(`Downloading ${versionsAndLinks.length} found files...`))
          // Download files
          await PromisePool.withConcurrency(5)
            .for(versionsAndLinks)
            .process(async (versionAndLink: any) => {
              try {
                await this.downloadContentVersionFile(
                  versionAndLink.contentVersion,
                  batch,
                  versionAndLink.contentDocumentLink
                );
                // Call progress callback if available
                if (progressCallback) {
                  progressCallback(1);
                }
              } catch (e) {
                this.filesErrors++;
                uxLog("warning", this, c.red('Download file error: ' + versionAndLink.contentVersion.Title + '\n' + e));
              }
            });
        }
      } else {
        uxLog("log", this, c.grey('No ContentDocumentLinks found for the parent records in this batch'));
      }
    }

    // At the end of chunk processing, report the actual files discovered in this chunk
    if (progressCallback && actualFilesInChunk > 0) {
      // This will help adjust the total progress based on actual discovered files
      progressCallback(0, actualFilesInChunk); // Report actual files found in this chunk
    }
  }

  // Initialize CSV log file with headers
  private async initializeCsvLog() {
    await fs.ensureDir(path.dirname(this.logFile));
    const headers = 'Status,Folder,File Name,Extension,File Size (KB),Error Detail,ContentDocument Id,ContentVersion Id,Attachment Id,Validation Status,Download URL\n';
    await fs.writeFile(this.logFile, headers, 'utf8');
    uxLog("log", this, c.grey(`CSV log file initialized: ${this.logFile}`));
    WebSocketClient.sendReportFileMessage(this.logFile, "Exported files report (CSV)", 'report');
  }

  // Helper method to extract file information from output path
  private extractFileInfo(outputFile: string) {
    const fileName = path.basename(outputFile);
    const extension = path.extname(fileName);
    const folderPath = path.dirname(outputFile)
      .replace(process.cwd(), '')
      .replace(this.exportedFilesFolder, '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');

    return { fileName, extension, folderPath };
  }

  // Helper method to log skipped files
  private async logSkippedFile(
    outputFile: string,
    errorDetail: string,
    contentDocumentId: string = '',
    contentVersionId: string = '',
    attachmentId: string = '',
    downloadUrl: string = ''
  ) {
    const { fileName, extension, folderPath } = this.extractFileInfo(outputFile);
    await this.writeCsvLogEntry('skipped', folderPath, fileName, extension, 0, errorDetail, contentDocumentId, contentVersionId, attachmentId, 'Skipped', downloadUrl);
  }

  // Helper method to calculate MD5 checksum of a file
  private async calculateMD5(filePath: string): Promise<string> {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);

    return new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  // Helper method to validate downloaded file
  private async validateDownloadedFile(
    outputFile: string,
    expectedSize: number,
    expectedChecksum?: string,
  ): Promise<{ valid: boolean; actualSize: number; actualChecksum?: string; error?: string }> {
    try {
      // Check if file exists
      if (!fs.existsSync(outputFile)) {
        return { valid: false, actualSize: 0, error: 'File does not exist' };
      }

      // Get actual file size
      const stats = await fs.stat(outputFile);
      const actualSize = stats.size;

      // Validate file size if expected size is provided
      if (actualSize !== expectedSize) {
        return {
          valid: false,
          actualSize,
          error: `Size mismatch: expected ${expectedSize} bytes, got ${actualSize} bytes`
        };
      }

      // Validate checksum if expected checksum is provided
      if (expectedChecksum) {
        const actualChecksum = await this.calculateMD5(outputFile);
        if (actualChecksum.toLowerCase() !== expectedChecksum.toLowerCase()) {
          return {
            valid: false,
            actualSize,
            actualChecksum,
            error: `Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`
          };
        }
        return { valid: true, actualSize, actualChecksum };
      }

      return { valid: true, actualSize };
    } catch (error) {
      return {
        valid: false,
        actualSize: 0,
        error: `Validation error: ${(error as Error).message}`
      };
    }
  }

  // Write a CSV entry for each file processed (fileSize in KB)
  private async writeCsvLogEntry(
    status: 'success' | 'failed' | 'skipped' | 'invalid',
    folder: string,
    fileName: string,
    extension: string,
    fileSizeKB: number,
    errorDetail: string = '',
    contentDocumentId: string = '',
    contentVersionId: string = '',
    attachmentId: string = '',
    validationStatus: string = '',
    downloadUrl: string = ''
  ) {
    try {
      // Escape CSV values to handle commas, quotes, and newlines
      const escapeCsvValue = (value: string | number): string => {
        const strValue = String(value);
        if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
          return `"${strValue.replace(/"/g, '""')}"`;
        }
        return strValue;
      };

      const csvLine = [
        escapeCsvValue(status),
        escapeCsvValue(folder),
        escapeCsvValue(fileName),
        escapeCsvValue(extension),
        escapeCsvValue(fileSizeKB),
        escapeCsvValue(errorDetail),
        escapeCsvValue(contentDocumentId),
        escapeCsvValue(contentVersionId),
        escapeCsvValue(attachmentId),
        escapeCsvValue(validationStatus),
        escapeCsvValue(downloadUrl)
      ].join(',') + '\n';

      await fs.appendFile(this.logFile, csvLine, 'utf8');
    } catch (e) {
      uxLog("warning", this, c.yellow(`Error writing to CSV log: ${(e as Error).message}`));
    }
  }

  private async downloadFile(
    fetchUrl: string,
    outputFile: string,
    contentDocumentId: string = '',
    contentVersionId: string = '',
    attachmentId: string = '',
    expectedSize: number,
    expectedChecksum?: string,
  ) {
    // In resume mode, check if file already exists and is valid
    if (this.resumeExport && fs.existsSync(outputFile)) {
      const { fileName, extension, folderPath } = this.extractFileInfo(outputFile);
      let fileSizeKB = 0;

      try {
        const stats = await fs.stat(outputFile);
        fileSizeKB = Math.round(stats.size / 1024); // Convert bytes to KB

        // Validate existing file (always have validation data: checksum for ContentVersion, size for Attachment)
        const validation = await this.validateDownloadedFile(outputFile, expectedSize, expectedChecksum);

        if (validation.valid) {
          this.filesValidated++; // Count only valid files
          // File exists and is valid - skip download
          const fileDisplay = path.join(folderPath, fileName).replace(/\\/g, '/');
          uxLog("success", this, c.grey(`Skipped (valid existing file) ${fileDisplay}`));
          this.filesIgnoredExisting++;

          // Write success entry to CSV log
          await this.writeCsvLogEntry('success', folderPath, fileName, extension, fileSizeKB, 'Existing valid file', contentDocumentId, contentVersionId, attachmentId, 'Valid (existing)', fetchUrl);
          return;
        } else {
          // File exists but is invalid - will re-download
          uxLog("log", this, c.yellow(`Existing file ${fileName} is invalid (${validation.error}) - re-downloading`));
        }
      } catch (e) {
        uxLog("warning", this, c.yellow(`Could not validate existing file ${fileName}: ${(e as Error).message}`));
        // Continue with download if we can't validate existing file
      }
    }

    // Proceed with normal download process
    const downloadResult = await new FileDownloader(fetchUrl, { conn: this.conn, outputFile: outputFile, label: 'file' }).download();

    // Extract file information for CSV logging
    const { fileName, extension, folderPath } = this.extractFileInfo(outputFile);
    let fileSizeKB = 0;
    let errorDetail = '';
    let validationError = ''; // Store validation error separately
    let validationStatus = '';
    let isValidFile = false; // Track if file is both downloaded and valid

    // Get file size if download was successful
    if (downloadResult.success && fs.existsSync(outputFile)) {
      try {
        const stats = await fs.stat(outputFile);
        fileSizeKB = Math.round(stats.size / 1024); // Convert bytes to KB

        // Perform file validation (always have validation data: checksum for ContentVersion, size for Attachment)
        const validation = await this.validateDownloadedFile(outputFile, expectedSize, expectedChecksum);

        if (validation.valid) {
          this.filesValidated++; // Count only valid files
          validationStatus = 'Valid';
          isValidFile = true;
          uxLog("success", this, c.green(`✓ Validation passed for ${fileName}`));
        } else {
          validationStatus = 'Invalid';
          validationError = validation.error || 'Unknown validation error';
          isValidFile = false;
          this.filesValidationErrors++;
          uxLog("warning", this, c.yellow(`⚠ Validation failed for ${fileName}: ${validation.error}`));
        }
      } catch (e) {
        uxLog("warning", this, c.yellow(`Could not get file size for ${fileName}: ${(e as Error).message}`));
        validationStatus = 'Invalid';
        validationError = (e as Error).message;
        isValidFile = false;
      }
    } else if (!downloadResult.success) {
      errorDetail = downloadResult.error || 'Unknown download error';
      validationStatus = 'Download failed';
      isValidFile = false;
    }

    // Use file folder and file name for log display
    const fileDisplay = path.join(folderPath, fileName).replace(/\\/g, '/');

    // Log based on download success AND validation success
    if (downloadResult.success && isValidFile) {
      uxLog("success", this, c.grey(`Downloaded ${fileDisplay}`));
      this.filesDownloaded++;

      // Write success entry to CSV log with Salesforce IDs and validation status
      await this.writeCsvLogEntry('success', folderPath, fileName, extension, fileSizeKB, '', contentDocumentId, contentVersionId, attachmentId, validationStatus, fetchUrl);
    } else if (downloadResult.success && !isValidFile) {
      // File was downloaded but validation failed
      uxLog("warning", this, c.red(`Invalid ${fileDisplay} - validation failed`));
      this.filesErrors++;

      // Write invalid entry to CSV log with validation error details
      await this.writeCsvLogEntry('invalid', folderPath, fileName, extension, fileSizeKB, validationError, contentDocumentId, contentVersionId, attachmentId, validationStatus, fetchUrl);
    } else {
      // Download failed
      uxLog("warning", this, c.red(`Error ${fileDisplay}`));
      this.filesErrors++;

      // Write failed entry to CSV log with Salesforce IDs and validation status
      await this.writeCsvLogEntry('failed', folderPath, fileName, extension, fileSizeKB, errorDetail, contentDocumentId, contentVersionId, attachmentId, validationStatus, fetchUrl);
    }
  }

  private async downloadAttachmentFile(attachment: any, records: any[]) {
    // Check file size filter (BodyLength is in bytes)
    const fileSizeKB = attachment.BodyLength ? Math.round(attachment.BodyLength / 1024) : 0;
    if (this.dtl.fileSizeMin && this.dtl.fileSizeMin > 0 && fileSizeKB < this.dtl.fileSizeMin) {
      uxLog("log", this, c.grey(`Skipped - ${attachment.Name} - File size (${fileSizeKB} KB) below minimum (${this.dtl.fileSizeMin} KB)`));
      this.filesIgnoredSize++;

      // Log skipped file to CSV
      const parentAttachment = records.filter((record) => record.Id === attachment.ParentId)[0];
      const attachmentParentFolderName = (parentAttachment[this.dtl.outputFolderNameField] || parentAttachment.Id).replace(
        /[/\\?%*:|"<>]/g,
        '-'
      );
      const parentRecordFolderForFiles = path.resolve(path.join(this.exportedFilesFolder, attachmentParentFolderName));
      const outputFile = path.join(parentRecordFolderForFiles, attachment.Name.replace(/[/\\?%*:|"<>]/g, '-'));
      const fetchUrl = `${this.conn.instanceUrl}/services/data/v${getApiVersion()}/sobjects/Attachment/${attachment.Id}/Body`;
      await this.logSkippedFile(outputFile, `File size (${fileSizeKB} KB) below minimum (${this.dtl.fileSizeMin} KB)`, '', '', attachment.Id, fetchUrl);
      return;
    }

    // Retrieve initial record to build output files folder name
    const parentAttachment = records.filter((record) => record.Id === attachment.ParentId)[0];
    // Build record output files folder (if folder name contains slashes or antislashes, replace them by spaces)
    const attachmentParentFolderName = (parentAttachment[this.dtl.outputFolderNameField] || parentAttachment.Id).replace(
      /[/\\?%*:|"<>]/g,
      '-'
    );
    const parentRecordFolderForFiles = path.resolve(path.join(this.exportedFilesFolder, attachmentParentFolderName));
    // Define name of the file
    const outputFile = path.join(parentRecordFolderForFiles, attachment.Name.replace(/[/\\?%*:|"<>]/g, '-'));
    // Create directory if not existing
    await fs.ensureDir(parentRecordFolderForFiles);
    // Download file locally with validation (Attachments have BodyLength but no checksum)
    const fetchUrl = `${this.conn.instanceUrl}/services/data/v${getApiVersion()}/sobjects/Attachment/${attachment.Id}/Body`;
    await this.downloadFile(fetchUrl, outputFile, '', '', attachment.Id, Number(attachment.BodyLength), undefined);
  }

  private async downloadContentVersionFile(contentVersion: any, records: any[], contentDocumentLink: any) {
    // Check file size filter (ContentSize is in bytes)
    const fileSizeKB = contentVersion.ContentSize ? Math.round(contentVersion.ContentSize / 1024) : 0;
    if (this.dtl.fileSizeMin && this.dtl.fileSizeMin > 0 && fileSizeKB < this.dtl.fileSizeMin) {
      uxLog("log", this, c.grey(`Skipped - ${contentVersion.Title} - File size (${fileSizeKB} KB) below minimum (${this.dtl.fileSizeMin} KB)`));
      this.filesIgnoredSize++;

      // Log skipped file to CSV
      const parentRecord = records.filter((record) => record.Id === contentDocumentLink.LinkedEntityId)[0];
      const parentFolderName = (parentRecord[this.dtl.outputFolderNameField] || parentRecord.Id).replace(
        /[/\\?%*:|"<>]/g,
        '-'
      );
      const parentRecordFolderForFiles = path.resolve(path.join(this.exportedFilesFolder, parentFolderName));
      const outputFile = path.join(parentRecordFolderForFiles, contentVersion.Title.replace(/[/\\?%*:|"<>]/g, '-'));
      const fetchUrl = `${this.conn.instanceUrl}/services/data/v${getApiVersion()}/sobjects/ContentVersion/${contentVersion.Id}/VersionData`;
      await this.logSkippedFile(outputFile, `File size (${fileSizeKB} KB) below minimum (${this.dtl.fileSizeMin} KB)`, contentVersion.ContentDocumentId, contentVersion.Id, '', fetchUrl);
      return;
    }

    // Retrieve initial record to build output files folder name
    const parentRecord = records.filter((record) => record.Id === contentDocumentLink.LinkedEntityId)[0];
    // Build record output files folder (if folder name contains slashes or antislashes, replace them by spaces)
    const parentFolderName = (parentRecord[this.dtl.outputFolderNameField] || parentRecord.Id).replace(
      /[/\\?%*:|"<>]/g,
      '-'
    );
    const parentRecordFolderForFiles = path.resolve(path.join(this.exportedFilesFolder, parentFolderName));
    // Define name of the file
    let outputFile =
      // Id
      this.dtl?.outputFileNameFormat === 'id'
        ? path.join(parentRecordFolderForFiles, contentVersion.Id)
        : // Title + Id
        this.dtl?.outputFileNameFormat === 'title_id'
          ? path.join(
            parentRecordFolderForFiles,
            `${contentVersion.Title.replace(/[/\\?%*:|"<>]/g, '-')}_${contentVersion.Id}`
          )
          : // Id + Title
          this.dtl?.outputFileNameFormat === 'id_title'
            ? path.join(
              parentRecordFolderForFiles,
              `${contentVersion.Id}_${contentVersion.Title.replace(/[/\\?%*:|"<>]/g, '-')}`
            )
            : // Title
            path.join(parentRecordFolderForFiles, contentVersion.Title.replace(/[/\\?%*:|"<>]/g, '-'));
    // Add file extension if missing in file title, and replace .snote by .html
    if (contentVersion.FileExtension && path.extname(outputFile) !== contentVersion.FileExtension) {
      outputFile =
        outputFile + '.' + (contentVersion.FileExtension !== 'snote' ? contentVersion.FileExtension : 'html');
    }
    // Check file extension
    if (this.dtl.fileTypes !== 'all' && !this.dtl.fileTypes.includes(contentVersion.FileType)) {
      uxLog("log", this, c.grey(`Skipped - ${outputFile.replace(this.exportedFilesFolder, '')} - File type ignored`));
      this.filesIgnoredType++;

      // Log skipped file to CSV
      const fetchUrl = `${this.conn.instanceUrl}/services/data/v${getApiVersion()}/sobjects/ContentVersion/${contentVersion.Id}/VersionData`;
      await this.logSkippedFile(outputFile, 'File type ignored', contentVersion.ContentDocumentId, contentVersion.Id, '', fetchUrl);
      return;
    }
    // Check file overwrite (unless in resume mode where downloadFile handles existing files)
    if (this.dtl.overwriteFiles !== true && !this.resumeExport && fs.existsSync(outputFile)) {
      uxLog("warning", this, c.yellow(`Skipped - ${outputFile.replace(this.exportedFilesFolder, '')} - File already existing`));
      this.filesIgnoredExisting++;

      // Log skipped file to CSV
      const fetchUrl = `${this.conn.instanceUrl}/services/data/v${getApiVersion()}/sobjects/ContentVersion/${contentVersion.Id}/VersionData`;
      await this.logSkippedFile(outputFile, 'File already exists', contentVersion.ContentDocumentId, contentVersion.Id, '', fetchUrl);
      return;
    }
    // Create directory if not existing
    await fs.ensureDir(parentRecordFolderForFiles);
    // Download file locally with validation (ContentVersion has both Checksum and ContentSize)
    const fetchUrl = `${this.conn.instanceUrl}/services/data/v${getApiVersion()}/sobjects/ContentVersion/${contentVersion.Id}/VersionData`;
    await this.downloadFile(fetchUrl, outputFile, contentVersion.ContentDocumentId, contentVersion.Id, '', Number(contentVersion.ContentSize), contentVersion.Checksum);
  }
  // Build stats & result
  private async buildResult() {
    // Get final API usage from the limits manager
    const finalUsage = await this.apiLimitsManager.getFinalUsage();

    // Display final API usage summary
    try {
      const finalApiUsage = await this.getApiUsageStatus();
      uxLog("success", this, c.green(`Export completed! Final API usage: ${finalApiUsage.message}`));
    } catch (error) {
      uxLog("warning", this, c.yellow(`Could not retrieve final API usage: ${(error as Error).message}`));
    }

    const result = {
      stats: {
        filesValidated: this.filesValidated,
        filesDownloaded: this.filesDownloaded,
        filesErrors: this.filesErrors,
        filesIgnoredType: this.filesIgnoredType,
        filesIgnoredExisting: this.filesIgnoredExisting,
        filesIgnoredSize: this.filesIgnoredSize,
        filesValidationErrors: this.filesValidationErrors,
        totalRestApiCalls: this.totalRestApiCalls,
        totalBulkApiCalls: this.totalBulkApiCalls,
        totalParentRecords: this.totalParentRecords,
        parentRecordsWithFiles: this.parentRecordsWithFiles,
        recordsIgnored: this.recordsIgnored,
        restApiUsedBefore: finalUsage.restUsed,
        restApiUsedAfter: finalUsage.restUsed,
        restApiLimit: finalUsage.restLimit,
        restApiCallsRemaining: finalUsage.restRemaining,
        bulkApiUsedBefore: finalUsage.bulkUsed,
        bulkApiUsedAfter: finalUsage.bulkUsed,
        bulkApiLimit: finalUsage.bulkLimit,
        bulkApiCallsRemaining: finalUsage.bulkRemaining,
      },
      logFile: this.logFile
    };
    await createXlsxFromCsv(this.logFile, { fileTitle: "Exported files report" }, result);
    return result;
  }
}

export class FilesImporter {
  private filesPath: string;
  private conn: Connection;
  private commandThis: any;

  private dtl: any = null; // export config
  private exportedFilesFolder: string = '';
  private handleOverwrite = false;
  private logFile: string;

  // Statistics tracking
  private totalFolders = 0;
  private totalFiles = 0;
  private filesUploaded = 0;
  private filesOverwritten = 0;
  private filesErrors = 0;
  private filesSkipped = 0;

  // Optimized API Limits Management System
  private apiLimitsManager: ApiLimitsManager;

  constructor(
    filesPath: string,
    conn: Connection,
    options: { exportConfig?: any; handleOverwrite?: boolean },
    commandThis: any
  ) {
    this.filesPath = filesPath;
    this.exportedFilesFolder = path.join(this.filesPath, 'export');
    this.handleOverwrite = options?.handleOverwrite === true;
    this.conn = conn;
    this.commandThis = commandThis;
    if (options.exportConfig) {
      this.dtl = options.exportConfig;
    }

    // Initialize the optimized API limits manager
    this.apiLimitsManager = new ApiLimitsManager(conn, commandThis);

    // Initialize log file path
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    this.logFile = path.join(this.filesPath, `import-log-${timestamp}.csv`);
  }

  // Initialize CSV log file with headers
  private async initializeCsvLog() {
    await fs.ensureDir(path.dirname(this.logFile));
    const headers = 'Status,Folder,File Name,Extension,File Size (KB),Error Detail,ContentVersion Id\n';
    await fs.writeFile(this.logFile, headers, 'utf8');
    uxLog("log", this.commandThis, c.grey(`CSV log file initialized: ${this.logFile}`));
    WebSocketClient.sendReportFileMessage(this.logFile, "Imported files report (CSV)", 'report');
  }

  // Helper method to extract file information from file path
  private extractFileInfo(filePath: string, folderName: string) {
    const fileName = path.basename(filePath);
    const extension = path.extname(fileName);

    return { fileName, extension, folderPath: folderName };
  }

  // Write a CSV entry for each file processed (fileSize in KB)
  private async writeCsvLogEntry(status: 'success' | 'failed' | 'skipped' | 'overwritten', folder: string, fileName: string, extension: string, fileSizeKB: number, errorDetail: string = '', contentVersionId: string = '') {
    try {
      // Escape CSV values to handle commas, quotes, and newlines
      const escapeCsvValue = (value: string | number): string => {
        const strValue = String(value);
        if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
          return `"${strValue.replace(/"/g, '""')}"`;
        }
        return strValue;
      };

      const csvLine = [
        escapeCsvValue(status),
        escapeCsvValue(folder),
        escapeCsvValue(fileName),
        escapeCsvValue(extension),
        escapeCsvValue(fileSizeKB),
        escapeCsvValue(errorDetail),
        escapeCsvValue(contentVersionId)
      ].join(',') + '\n';

      await fs.appendFile(this.logFile, csvLine, 'utf8');
    } catch (e) {
      uxLog("warning", this.commandThis, c.yellow(`Error writing to CSV log: ${(e as Error).message}`));
    }
  }

  async processImport() {
    // Get config
    if (this.dtl === null) {
      this.dtl = await getFilesWorkspaceDetail(this.filesPath);
    }
    uxLog("action", this.commandThis, c.cyan(`Importing files from ${c.green(this.dtl.full_label)} ...`));
    uxLog("log", this.commandThis, c.italic(c.grey(this.dtl.description)));

    // Get folders and files
    const allRecordFolders = fs.readdirSync(this.exportedFilesFolder).filter((file) => {
      return fs.statSync(path.join(this.exportedFilesFolder, file)).isDirectory();
    });

    this.totalFolders = allRecordFolders.length;

    // Count total files
    for (const folder of allRecordFolders) {
      this.totalFiles += fs.readdirSync(path.join(this.exportedFilesFolder, folder)).length;
    }

    // Initialize API usage tracking with total file count
    await this.calculateApiConsumption(this.totalFiles);

    // Initialize CSV logging
    await this.initializeCsvLog();

    // Start progress tracking
    WebSocketClient.sendProgressStartMessage("Importing files", this.totalFiles);

    // Query parent objects to find Ids corresponding to field value used as folder name
    const parentObjectsRes = await bulkQuery(this.dtl.soqlQuery, this.conn);
    const parentObjects = parentObjectsRes.records;

    let processedFiles = 0;

    for (const recordFolder of allRecordFolders) {
      uxLog("log", this.commandThis, c.grey(`Processing record ${recordFolder} ...`));
      const recordFolderPath = path.join(this.exportedFilesFolder, recordFolder);

      // List files in folder
      const files = fs.readdirSync(recordFolderPath).filter((file) => {
        return fs.statSync(path.join(this.exportedFilesFolder, recordFolder, file)).isFile();
      });

      // Find Id of parent object using folder name
      const parentRecordIds = parentObjects.filter(
        (parentObj) => parentObj[this.dtl.outputFolderNameField] === recordFolder
      );

      if (parentRecordIds.length === 0) {
        uxLog("error", this.commandThis, c.red(`Unable to find Id for ${this.dtl.outputFolderNameField}=${recordFolder}`));

        // Log all files in this folder as skipped
        for (const file of files) {
          const { fileName, extension } = this.extractFileInfo(file, recordFolder);
          const filePath = path.join(recordFolderPath, file);
          const fileSizeKB = fs.existsSync(filePath) ? Math.round(fs.statSync(filePath).size / 1024) : 0;

          await this.writeCsvLogEntry('skipped', recordFolder, fileName, extension, fileSizeKB, 'Parent record not found', '');
          this.filesSkipped++;
          processedFiles++;

          // Update progress
          WebSocketClient.sendProgressStepMessage(processedFiles, this.totalFiles);
        }
        continue;
      }

      const parentRecordId = parentRecordIds[0].Id;

      let existingDocuments: any[] = [];
      // Collect existing documents if we handle file overwrite
      if (this.handleOverwrite) {
        const existingDocsQuery = `SELECT Id, ContentDocumentId, Title FROM ContentVersion WHERE FirstPublishLocationId = '${parentRecordId}'`;
        const existingDocsQueryRes = await this.conn.query(existingDocsQuery);
        existingDocuments = existingDocsQueryRes.records;
      }

      for (const file of files) {
        const filePath = path.join(recordFolderPath, file);
        const { fileName, extension } = this.extractFileInfo(file, recordFolder);
        const fileSizeKB = fs.existsSync(filePath) ? Math.round(fs.statSync(filePath).size / 1024) : 0;

        try {
          const fileData = fs.readFileSync(filePath);
          const contentVersionParams: any = {
            Title: file,
            PathOnClient: file,
            VersionData: fileData.toString('base64'),
          };

          const matchingExistingDocs = existingDocuments.filter((doc) => doc.Title === file);
          let isOverwrite = false;

          if (matchingExistingDocs.length > 0) {
            contentVersionParams.ContentDocumentId = matchingExistingDocs[0].ContentDocumentId;
            uxLog("log", this.commandThis, c.grey(`Overwriting file ${file} ...`));
            isOverwrite = true;
          } else {
            contentVersionParams.FirstPublishLocationId = parentRecordId;
            uxLog("log", this.commandThis, c.grey(`Uploading file ${file} ...`));
          }

          const insertResult = await this.conn.sobject('ContentVersion').create(contentVersionParams);

          if (Array.isArray(insertResult) && insertResult.length === 0) {
            uxLog("error", this.commandThis, c.red(`Unable to upload file ${file}`));
            await this.writeCsvLogEntry('failed', recordFolder, fileName, extension, fileSizeKB, 'Upload failed', '');
            this.filesErrors++;
          } else if (Array.isArray(insertResult) && !insertResult[0].success) {
            uxLog("error", this.commandThis, c.red(`Unable to upload file ${file}`));
            await this.writeCsvLogEntry('failed', recordFolder, fileName, extension, fileSizeKB, insertResult[0].errors?.join(', ') || 'Upload failed', '');
            this.filesErrors++;
          } else {
            // Extract ContentVersion ID from successful insert result
            const contentVersionId = Array.isArray(insertResult) && insertResult.length > 0
              ? insertResult[0].id
              : (insertResult as any).id || '';

            if (isOverwrite) {
              uxLog("success", this.commandThis, c.grey(`Overwritten ${file}`));
              await this.writeCsvLogEntry('overwritten', recordFolder, fileName, extension, fileSizeKB, '', contentVersionId);
              this.filesOverwritten++;
            } else {
              uxLog("success", this.commandThis, c.grey(`Uploaded ${file}`));
              await this.writeCsvLogEntry('success', recordFolder, fileName, extension, fileSizeKB, '', contentVersionId);
              this.filesUploaded++;
            }
          }
        } catch (e) {
          const errorDetail = (e as Error).message;
          uxLog("error", this.commandThis, c.red(`Unable to upload file ${file}: ${errorDetail}`));
          await this.writeCsvLogEntry('failed', recordFolder, fileName, extension, fileSizeKB, errorDetail, '');
          this.filesErrors++;
        }

        processedFiles++;
        // Update progress
        WebSocketClient.sendProgressStepMessage(processedFiles, this.totalFiles);
      }
    }

    // End progress tracking
    WebSocketClient.sendProgressEndMessage(this.totalFiles);

    // Build and return result
    return await this.buildResult();
  }

  // Build stats & result
  private async buildResult() {
    // Get final API usage from the limits manager
    const finalUsage = await this.apiLimitsManager.getFinalUsage();

    const result = {
      stats: {
        filesUploaded: this.filesUploaded,
        filesOverwritten: this.filesOverwritten,
        filesErrors: this.filesErrors,
        filesSkipped: this.filesSkipped,
        totalFolders: this.totalFolders,
        totalFiles: this.totalFiles,
        restApiUsedBefore: finalUsage.restUsed,
        restApiUsedAfter: finalUsage.restUsed,
        restApiLimit: finalUsage.restLimit,
        restApiCallsRemaining: finalUsage.restRemaining,
        bulkApiUsedBefore: finalUsage.bulkUsed,
        bulkApiUsedAfter: finalUsage.bulkUsed,
        bulkApiLimit: finalUsage.bulkLimit,
        bulkApiCallsRemaining: finalUsage.bulkRemaining,
      },
      logFile: this.logFile
    };
    await createXlsxFromCsv(this.logFile, { fileTitle: "Imported files report" }, result);
    return result;
  }

  // Calculate API consumption using the optimized ApiLimitsManager
  private async calculateApiConsumption(totalFilesNumber) {
    // Initialize the API limits manager
    await this.apiLimitsManager.initialize();

    const bulkCallsNb = 1;
    if (this.handleOverwrite) {
      totalFilesNumber = totalFilesNumber * 2;
    }

    // Check if there are enough API calls available
    // Request user confirmation
    if (!isCI) {
      const warningMessage = c.cyanBright(
        `Files import consumes one REST API call per uploaded file.
        (Estimation: ${bulkCallsNb} Bulks calls and ${totalFilesNumber} REST calls) Do you confirm you want to proceed ?`
      );
      const promptRes = await prompts({
        type: 'confirm',
        message: warningMessage,
        description: 'Confirm file import operation which will consume API calls'
      });
      if (promptRes.value !== true) {
        throw new SfError('Command cancelled by user');
      }
    }
  }
}

export async function selectFilesWorkspace(opts = { selectFilesLabel: 'Please select a files folder to export' }) {
  if (!fs.existsSync(filesFolderRoot)) {
    throw new SfError(
      "There is no files root folder 'scripts/files' in your workspace. Create it and define a files export configuration"
    );
  }

  const filesFolders = fs
    .readdirSync(filesFolderRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.join('.', 'scripts', 'files', dirent.name));
  if (filesFolders.length === 0) {
    throw new SfError('There is no file exports folder in your workspace');
  }
  const choices: any = [];
  for (const filesFolder of filesFolders) {
    const dtl = await getFilesWorkspaceDetail(filesFolder);
    if (dtl !== null) {
      choices.push({
        title: `📁 ${dtl.full_label}`,
        description: dtl.description,
        value: filesFolder,
      });
    }
  }
  const filesDirResult = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(opts.selectFilesLabel),
    description: 'Select the files workspace configuration to use for this operation',
    choices: choices,
  });
  return filesDirResult.value;
}

export async function getFilesWorkspaceDetail(filesWorkspace: string) {
  const exportFile = path.join(filesWorkspace, 'export.json');
  if (!fs.existsSync(exportFile)) {
    uxLog(
      "warning",
      this,
      c.yellow(
        `Your File export folder ${c.bold(filesWorkspace)} must contain an ${c.bold('export.json')} configuration file`
      )
    );
    return null;
  }
  const exportFileJson = JSON.parse(await fs.readFile(exportFile, 'utf8'));
  const folderName = (filesWorkspace.replace(/\\/g, '/').match(/([^/]*)\/*$/) || '')[1];
  const hardisLabel = exportFileJson.sfdxHardisLabel || folderName;
  const hardisDescription = exportFileJson.sfdxHardisDescription || filesWorkspace;
  const soqlQuery = exportFileJson.soqlQuery || '';
  const fileTypes = exportFileJson.fileTypes || 'all';
  const outputFolderNameField = exportFileJson.outputFolderNameField || 'Name';
  const outputFileNameFormat = exportFileJson.outputFileNameFormat || 'title';
  const overwriteParentRecords =
    exportFileJson.overwriteParentRecords === false ? false : exportFileJson.overwriteParentRecords || true;
  const overwriteFiles = exportFileJson.overwriteFiles || false;
  const fileSizeMin = exportFileJson.fileSizeMin || 0;
  return {
    full_label: `[${folderName}]${folderName != hardisLabel ? `: ${hardisLabel}` : ''}`,
    name: folderName,
    label: hardisLabel,
    description: hardisDescription,
    soqlQuery: soqlQuery,
    fileTypes: fileTypes,
    outputFolderNameField: outputFolderNameField,
    outputFileNameFormat: outputFileNameFormat,
    overwriteParentRecords: overwriteParentRecords,
    overwriteFiles: overwriteFiles,
    fileSizeMin: fileSizeMin,
  };
}

export async function promptFilesExportConfiguration(filesExportConfig: any, override = false) {
  const questions: any[] = [];
  if (override === false) {
    questions.push(
      ...[
        {
          type: 'text',
          name: 'filesExportPath',
          message: c.cyanBright(
            'Please input the files export config folder name (PascalCase format)'
          ),
          description: 'The folder name that will be created to store the export configuration and downloaded files',
          placeholder: 'Ex: OpportunitiesPDF',
        },
        {
          type: 'text',
          name: 'sfdxHardisLabel',
          message: c.cyanBright('Please input a label for the files export configuration'),
          description: 'A human-readable label that will identify this export configuration',
          initial: filesExportConfig.sfdxHardisLabel,
        },
        {
          type: 'text',
          name: 'sfdxHardisDescription',
          message: c.cyanBright('Please input a description of the files export configuration'),
          description: 'A detailed description explaining what this export configuration does',
          initial: filesExportConfig.sfdxHardisDescription,
        },
      ]
    );
  }
  questions.push(
    ...[
      {
        type: 'text',
        name: 'soqlQuery',
        message:
          'Please input the main SOQL Query to fetch the parent records of files (ContentVersions)',
        description: 'SOQL query that retrieves the parent records to which files are attached',
        placeholder: 'Ex: SELECT Id,Name from Opportunity',
        initial: filesExportConfig.soqlQuery,
      },
      {
        type: 'text',
        name: 'outputFolderNameField',
        message: 'Please input the field to use to build the name of the folder containing downloaded files',
        description: 'Field name from the SOQL query result that will be used as folder name for organizing files',
        placeholder: 'Ex: Name',
        initial: filesExportConfig.outputFolderNameField,
      },
      {
        type: 'select',
        name: 'outputFileNameFormat',
        choices: [
          { value: 'title', title: 'title (ex: "Cloudity New Project")' },
          { value: 'title_id', title: 'title_id (ex: "Cloudity New Project_006bR00000Bet7WQAR")' },
          { value: 'id_title', title: 'id_title (ex: "006bR00000Bet7WQAR_Cloudity New Project")' },
          { value: 'id', title: 'id (ex: "006bR00000Bet7WQAR")' },
        ],
        message: 'Please select the format of output files names',
        description: 'Choose how downloaded file names should be formatted',
        initial: filesExportConfig.outputFileNameFormat,
      },
      {
        type: 'confirm',
        name: 'overwriteParentRecords',
        message:
          'Do you want to try to download files attached to a parent records whose folder is already existing in local folders ?',
        description: 'Allow downloading files for records that already have a local folder',
        initial: filesExportConfig.overwriteParentRecords,
      },
      {
        type: 'confirm',
        name: 'overwriteFiles',
        message: 'Do you want to overwrite file that has already been previously downloaded ?',
        description: 'Replace existing local files with newly downloaded versions',
        initial: filesExportConfig.overwriteFiles,
      },
      {
        type: 'number',
        name: 'fileSizeMin',
        message: 'Please input the minimum file size in KB (0 = no minimum)',
        description: 'Only files with size greater than or equal to this value will be downloaded (in kilobytes)',
        placeholder: 'Ex: 10',
        initial: filesExportConfig.fileSizeMin || 0,
        min: 0,
      },
    ]
  );

  const resp = await prompts(questions);
  const filesConfig = Object.assign(filesExportConfig, {
    filesExportPath: resp.filesExportPath,
    sfdxHardisLabel: resp.sfdxHardisLabel || filesExportConfig.sfdxHardisLabel,
    sfdxHardisDescription: resp.sfdxHardisDescription || filesExportConfig.sfdxHardisDescription,
    soqlQuery: resp.soqlQuery,
    outputFolderNameField: resp.outputFolderNameField,
    outputFileNameFormat: resp.outputFileNameFormat,
    overwriteParentRecords: resp.overwriteParentRecords,
    overwriteFiles: resp.overwriteFiles,
    fileSizeMin: resp.fileSizeMin,
  });
  return filesConfig;
}

export async function countLinesInFile(file: string) {
  let readError;
  let lineCount = 0;
  return await new Promise((resolve) => {
    fs.createReadStream(file)
      .pipe(split())
      .on('data', () => {
        lineCount++;
      })
      .on('end', () => {
        if (readError) {
          return;
        }
        resolve(lineCount - 1);
      })
      .on('error', (error) => {
        readError = true;
        resolve(error);
      });
  });
}

/**
 * @description This function generates a report path for a given file name prefix.
 * It retrieves the report directory and the current branch name.
 * If the branch name is not available in the environment variable CI_COMMIT_REF_NAME, it tries to get the current git branch.
 * If both are not available, it uses the string "Missing CI_COMMIT_REF_NAME variable".
 * It then joins the report directory, file name prefix, and branch name to form the full path of the report.
 *
 * @param {string} fileNamePrefix - The prefix for the file name.
 * @param {string} outputFile - The output file path. If null, a new path is generated.
 * @param {Object} [options] - Additional options for generating the report path.
 * @param {boolean} [options.withDate=false] - Whether to append a timestamp to the file name.
 * @returns {Promise<string>} - A Promise that resolves to the full path of the report.
 */
export async function generateReportPath(fileNamePrefix: string, outputFile: string, options: { withDate: boolean } = { withDate: false }): Promise<string> {
  if (outputFile == null) {
    const reportDir = await getReportDirectory();
    const branchName =
      (!isGitRepo()) ? 'no-git' :
        process.env.CI_COMMIT_REF_NAME ||
        (await getCurrentGitBranch({ formatted: true })) ||
        'branch-not-found';
    let newOutputFile = path.join(reportDir, `${fileNamePrefix}-${branchName.split('/').pop()}.csv`);
    if (options.withDate) {
      // Add date time info
      const date = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
      newOutputFile = path.join(reportDir, `${fileNamePrefix}-${branchName.split('/').pop()}-${date}.csv`);
    }
    return newOutputFile;
  } else {
    await fs.ensureDir(path.dirname(outputFile));
    return outputFile;
  }
}

/**
 * @description This function generates a CSV file from the provided data and writes it to the specified output path.
 * If the operation is successful, it logs a message and requests to open the file.
 * If an error occurs during the operation, it logs the error message and stack trace.
 *
 * @param {any[]} data - The data to be written to the CSV file.
 * @param {string} outputPath - The path where the CSV file will be written.
 * @returns {Promise<void>} - A Promise that resolves when the operation is complete.
 */
export async function generateCsvFile(
  data: any[],
  outputPath: string,
  options: { fileTitle?: string, csvFileTitle?: string, xlsFileTitle?: string, noExcel?: boolean }
): Promise<any> {
  const result: any = {};
  try {
    const csvContent = Papa.unparse(data);
    await fs.writeFile(outputPath, csvContent, 'utf8');
    uxLog("action", this, c.cyan(c.italic(`Please see detailed CSV log in ${c.bold(outputPath)}`)));
    result.csvFile = outputPath;
    if (!WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.requestOpenFile(outputPath);
    }
    const csvFileTitle = options?.fileTitle ? `${options.fileTitle} (CSV)` : options?.csvFileTitle ?? "Report (CSV)";
    WebSocketClient.sendReportFileMessage(outputPath, csvFileTitle, "report");
    if (data.length > 0 && !options?.noExcel) {
      await createXlsxFromCsv(outputPath, options, result);
    } else {
      uxLog("other", this, c.grey(`No XLS file generated as ${outputPath} is empty`));
    }
  } catch (e) {
    uxLog("warning", this, c.yellow('Error while generating CSV log file:\n' + (e as Error).message + '\n' + (e as Error).stack));
  }
  return result;
}

async function createXlsxFromCsv(outputPath: string, options: { fileTitle?: string; csvFileTitle?: string; xlsFileTitle?: string; noExcel?: boolean; }, result: any) {
  try {
    const xlsDirName = path.join(path.dirname(outputPath), 'xls');
    const xslFileName = path.basename(outputPath).replace('.csv', '.xlsx');
    const xslxFile = path.join(xlsDirName, xslFileName);
    await fs.ensureDir(xlsDirName);
    await csvToXls(outputPath, xslxFile);
    uxLog("action", this, c.cyan(c.italic(`Please see detailed XLSX log in ${c.bold(xslxFile)}`)));
    const xlsFileTitle = options?.fileTitle ? `${options.fileTitle} (XLSX)` : options?.xlsFileTitle ?? "Report (XLSX)";
    WebSocketClient.sendReportFileMessage(xslxFile, xlsFileTitle, "report");
    result.xlsxFile = xslxFile;
    if (!isCI && !(process.env.NO_OPEN === 'true') && !WebSocketClient.isAliveWithLwcUI()) {
      try {
        uxLog("other", this, c.italic(c.grey(`Opening XLSX file ${c.bold(xslxFile)}... (define NO_OPEN=true to disable this)`)));
        await open(xslxFile, { wait: false });
      } catch (e) {
        uxLog("warning", this, c.yellow('Error while opening XLSX file:\n' + (e as Error).message + '\n' + (e as Error).stack));
      }
    }
  } catch (e2) {
    uxLog(
      "warning",
      this,
      c.yellow('Error while generating XLSX log file:\n' + (e2 as Error).message + '\n' + (e2 as Error).stack)
    );
  }
}

async function csvToXls(csvFile: string, xslxFile: string) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = await workbook.csv.readFile(csvFile);
  // Set filters
  worksheet.autoFilter = 'A1:Z1';
  // Adjust column size (only if the file is not too big, to avoid performances issues)
  if (worksheet.rowCount < 5000) {
    worksheet.columns.forEach((column) => {
      const lengths = (column.values || []).map((v) => (v || '').toString().length);
      const maxLength = Math.max(...lengths.filter((v) => typeof v === 'number'));
      column.width = maxLength;
    });
  }
  await workbook.xlsx.writeFile(xslxFile);
}
