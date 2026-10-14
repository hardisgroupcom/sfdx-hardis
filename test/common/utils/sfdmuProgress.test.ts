import { expect } from 'chai';
import { SfdmuProgressTracker } from '../../../src/common/utils/sfdmuProgress.js';

// Real sfdmu output of an "Update" job on 177373 Account records (shortened)
const IMPORT_LOG_LINES = [
  '[16:29:24.177] ===== MIGRATION JOB STARTED =====',
  '[16:29:24.658] ===== OBJECT SET #1 STARTED =====',
  '[16:29:24.926] {Account} Fetching metadata (TARGET) ...',
  '[16:29:25.600] {FieldDefinition} Using REST API (v67.0) to retrieve the data ...',
  '[16:29:28.692] ANALYSING DATA...',
  '[16:29:28.692] {Account} Processing the object ...',
  '[16:29:31.496] {Account} The original query string of this object is returning 177373 records from the TARGET org.',
  '[16:29:31.543] Deleting data was skipped.',
  '[16:29:31.544] ===== Fetching the data (STAGE 1) =====',
  '[16:29:31.544] {Account} Fetching the SOURCE data from CSV file (STAGE 1: all records) ...',
  '[16:29:34.233] {Account} Data retrieval (SOURCE) has been completed. Got 177373 new records.',
  '[16:29:34.234] ===== Fetching the data (STAGE 2) =====',
  '[16:29:34.246] {Account} Fetching the TARGET data from Org (STAGE 2: all records) ...',
  '[16:29:34.248] {Account} Using Bulk API Query (v67.0) to retrieve the data ...',
  '[16:29:46.810] In progress... Completed 2000 records.',
  '[16:29:48.870] In progress... Completed 177373 records.',
  '[16:29:49.583] {Account} Data retrieval (TARGET) has been completed. Got 177373 new records.',
  '[16:29:49.587] ===== DATA RETRIEVAL SUMMARY =====',
  '[16:29:49.589] ===== Updating the Target (STAGE 1) =====',
  '[16:29:55.113] {Account} Amount of records to Update: 177373.',
  '[16:29:55.129] {Account} Using BULK API V2 (API v67.0) to execute Update ...',
  '[16:29:55.597] [Job# 750h70000004EQzAAM:Update] {Account} The job has been created. Uploading data ...',
  '[16:30:04.960] [Batch# 750h70000004EQzAAM:Update] {Account} The data has been uploaded. Processing ...',
  '[16:30:27.585] [Batch# 750h70000004EQzAAM:Update] {Account} Processing ... 3600 records processed, 0 records failed.',
  '[16:33:17.850] [Batch# 750h70000004EQzAAM:Update] {Account} Processing ... 60000 records processed, 3 records failed.',
  '[16:36:18.197] [Batch# 750h70000004EQzAAM:Update] {Account} Processing ... 120000 records processed, 4 records failed.',
  '[16:39:41.349] [Batch# 750h70000004EQzAAM:Update] {Account} Processing ... 177373 records processed, 4 records failed.',
  '[16:39:57.435] [WARNING] [Batch# 750h70000004EQzAAM:Update] {Account} Completed. 177373 records processed, 4 records failed.',
  '[16:39:59.183] {Account} The Target has been updated. Totally processed 177373 records.',
  '[16:39:59.185] ===== Updating the Target (STAGE 2) =====',
  '[16:40:00.948] Nothing was updated.',
  '[16:40:00.949] ===== DATA PROCESSING SUMMARY =====',
  '[16:40:00.958] ===== MIGRATION JOB ENDED =====',
  '[16:40:00.959] Command succeeded.',
];

describe('sfdmuProgress', () => {
  describe('SfdmuProgressTracker', () => {
    it('tracks the progress of the update phase, which is where the time is spent', () => {
      const tracker = new SfdmuProgressTracker();
      const percentByLine: number[] = [];
      for (const line of IMPORT_LOG_LINES) {
        tracker.processLine(line);
        percentByLine.push(tracker.percent);
      }

      // Progress must never go backwards
      for (let i = 1; i < percentByLine.length; i++) {
        expect(percentByLine[i]).to.be.at.least(percentByLine[i - 1], `line ${i}: ${IMPORT_LOG_LINES[i]}`);
      }

      // The bulk update lines must move the progress bar: this is the 10 minutes the user is waiting for
      const startOfUpdate = percentByLine[19];
      const at60000 = percentByLine[25];
      const at120000 = percentByLine[26];
      expect(at60000).to.be.greaterThan(startOfUpdate);
      expect(at120000).to.be.greaterThan(at60000);
      expect(at60000).to.be.within(30, 70);
      expect(at120000).to.be.within(60, 90);

      const stats = tracker.getStats();
      expect(stats.percent).to.equal(100);
      expect(stats.isCompleted).to.equal(true);
      expect(stats.recordsFailed).to.equal(4);
      expect(stats.objects).to.include('Account');
      expect(stats.objectsProcessed).to.equal(1);
    });

    it('never reports the job as almost done while records are still being fetched', () => {
      const tracker = new SfdmuProgressTracker();
      for (const line of IMPORT_LOG_LINES.slice(0, 18)) {
        tracker.processLine(line);
      }
      // End of data retrieval: a quarter of the job at most, not 100%
      expect(tracker.percent).to.be.at.most(30);
    });

    it('captures the Bulk API job id and the current operation', () => {
      const tracker = new SfdmuProgressTracker();
      for (const line of IMPORT_LOG_LINES.slice(0, 24)) {
        tracker.processLine(line);
      }
      const stats = tracker.getStats();
      expect(stats.currentJobId).to.equal('750h70000004EQzAAM');
      expect(stats.currentOperation).to.equal('Update');
      expect(stats.currentObjectExpected).to.equal(177373);
    });

    it('splits progress between objects using the amounts announced by sfdmu', () => {
      const tracker = new SfdmuProgressTracker();
      const lines = [
        '===== MIGRATION JOB STARTED =====',
        '===== OBJECT SET #1 STARTED =====',
        'ANALYSING DATA...',
        '{Account} The original query string of this object is returning 1000 records from the TARGET org.',
        '{Contact} The original query string of this object is returning 1000 records from the TARGET org.',
        '===== Updating the Target (STAGE 1) =====',
        '{Account} Amount of records to Update: 1000.',
        '[Batch# 750xx:Update] {Account} Completed. 1000 records processed, 0 records failed.',
      ];
      for (const line of lines) {
        tracker.processLine(line);
      }
      const [from, to] = [27, 90]; // range of the update phase for an import
      // Half of the records of the object set are done
      expect(tracker.percent).to.be.within(from + (to - from) * 0.4, from + (to - from) * 0.6);
    });

    it('restarts progress when a new object set begins', () => {
      const tracker = new SfdmuProgressTracker();
      for (const line of IMPORT_LOG_LINES) {
        tracker.processLine(line);
      }
      expect(tracker.consumeNewObjectSet()).to.equal(false);
      tracker.processLine('===== OBJECT SET #2 STARTED =====');
      expect(tracker.consumeNewObjectSet()).to.equal(true);
      expect(tracker.consumeNewObjectSet()).to.equal(false);
      // Progress restarts at the beginning of the new object set instead of staying at 100%
      expect(tracker.percent).to.be.at.most(5);
      expect(tracker.objectSet).to.equal(2);
    });

    it('gives the org query the largest share of the bar for an export', () => {
      // Export: the org is the SOURCE (STAGE 1), the CSV files are the TARGET and are never queried
      const lines = [
        '===== MIGRATION JOB STARTED =====',
        '===== OBJECT SET #1 STARTED =====',
        'ANALYSING DATA...',
        '{Account} Processing the object ...',
        '{Account} The original query string of this object is returning 100000 records from the SOURCE org.',
        '===== Fetching the data (STAGE 1) =====',
        '{Account} Fetching the SOURCE data from Org (STAGE 1: all records) ...',
        '{Account} Using Bulk API Query (v67.0) to retrieve the data ...',
        'In progress... Completed 50000 records.',
      ];
      const tracker = new SfdmuProgressTracker('export');
      for (const line of lines) {
        tracker.processLine(line);
      }
      // Half of the records queried means about half of the job, not 12%
      expect(tracker.percent).to.be.within(35, 55);

      tracker.processLine('{Account} Data retrieval (SOURCE) has been completed. Got 100000 new records.');
      expect(tracker.percent).to.be.at.least(75);

      // The CSV target is not queried, and writing the files takes no time
      tracker.processLine('===== Fetching the data (STAGE 2) =====');
      tracker.processLine('{Account} TARGET was not queried since csvfile is set as a TARGET.');
      tracker.processLine('===== DATA RETRIEVAL SUMMARY =====');
      tracker.processLine('===== Updating the Target (STAGE 1) =====');
      tracker.processLine('{Account} The Target has been updated. Totally processed 100000 records.');
      tracker.processLine('===== DATA PROCESSING SUMMARY =====');
      tracker.processLine('===== MIGRATION JOB ENDED =====');
      expect(tracker.percent).to.equal(100);
      expect(tracker.getStats().objectsProcessed).to.equal(1);
    });

    it('tracks the deletion progress of a delete job', () => {
      const lines = [
        '===== MIGRATION JOB STARTED =====',
        '===== OBJECT SET #1 STARTED =====',
        'ANALYSING DATA...',
        '{Case} The original query string of this object is returning 5000 records from the SOURCE org.',
        '===== Fetching the data (STAGE 1) =====',
        '{Case} Data retrieval (SOURCE) has been completed. Got 5000 new records.',
        '===== Updating the Target (STAGE 1) =====',
        '{Case} Deleting records from the Source ...',
        '{Case} Amount of records to delete: 5000.',
        '[Job# 750h70000004AAAAAA:Delete] {Case} The job has been created. Uploading data ...',
      ];
      const tracker = new SfdmuProgressTracker('delete');
      for (const line of lines) {
        tracker.processLine(line);
      }
      const beforeDeletion = tracker.percent;

      tracker.processLine(
        '[Batch# 750h70000004AAAAAA:Delete] {Case} Processing ... 2500 records processed, 0 records failed.'
      );
      const halfDeleted = tracker.percent;
      tracker.processLine('{Case} Deleting has been completed.');

      expect(halfDeleted).to.be.greaterThan(beforeDeletion + 10);
      expect(tracker.percent).to.be.greaterThan(halfDeleted);
      expect(tracker.getStats().currentOperation).to.equal('Delete');
      expect(tracker.getStats().totalRecordsProcessed).to.equal(5000);
    });

    it('ignores lines that do not carry progress information', () => {
      const tracker = new SfdmuProgressTracker();
      expect(tracker.processLine('')).to.equal(false);
      expect(tracker.processLine('Warning: @salesforce/cli update available from 2.146.3 to 2.147.7.')).to.equal(false);
      expect(tracker.percent).to.equal(0);
    });
  });
});
