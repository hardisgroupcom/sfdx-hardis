/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { generateCsvFile, generateReportPath } from '../../../common/utils/filesUtils.js';
import { soqlQuery } from '../../../common/utils/apiUtils.js';
import axios from 'axios';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

/* jscpd:ignore-end */
export default class ServiceNowReport extends SfCommand<any> {
  public static title = 'ServiceNow Report';
  public static description = `This command retrieves user stories from Salesforce and enriches them with data from ServiceNow.

  Define the following environment variables:

  - SERVICENOW_URL: The base URL of the ServiceNow API (ex: https://your-instance.service-now.com/)
  - SERVICENOW_USERNAME: The username for ServiceNow API authentication.
  - SERVICENOW_PASSWORD: The password for ServiceNow API authentication.
  `;

  public static examples = ['$ sf hardis:misc:servicenow-report'];
  /* jscpd:ignore-start */
  public static flags: any = {
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': optionalOrgFlagWithDeprecations,
  };
  /* jscpd:ignore-end */

  protected static supportsDevhubUsername = false;
  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;
  protected outputFile: string;
  protected outputFilesRes: any = {};
  protected results: any[] = [];

  protected userStoriesConfig: any = {
    fields: [
      'Id',
      'Name',
      'Ticket_Number__c',
      'copado__User_Story_Title__c',
      'CreatedBy.Name',
      'copado__Release__r.Name',
      'copado__Environment__r.Name',
    ],
    table: 'copado__User_Story__c',
    where: "copado__Environment__r.Name ='UAT'",
    orderBy: 'Ticket_Number__c ASC',
  };

  protected serviceNowConfig: any = {
    tables: [
      { tableName: 'demand' },
      { tableName: 'incident' },
    ]
  };

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ServiceNowReport);
    this.outputFile = flags.outputfile || null;

    const conn = flags['target-org']?.getConnection();
    // List user stories matching with criteria
    const userStoriesQuery = `SELECT ${this.userStoriesConfig.fields.join(', ')} FROM ${this.userStoriesConfig.table} WHERE ${this.userStoriesConfig.where} ORDER BY ${this.userStoriesConfig.orderBy}`;
    const userStoriesRes = await soqlQuery(userStoriesQuery, conn);
    const userStories = userStoriesRes.records;
    // Get list of tickets from user stories
    const ticketNumbers = userStoriesRes.records.map((record: any) => record.Ticket_Number__c);

    // Get matching demands and incidents from ServiceNow API with axios using ticket numbers
    const serviceNowUrl = process.env.SERVICENOW_URL;
    if (!serviceNowUrl) {
      throw new SfError('ServiceNow API URL is not set. Please set SERVICENOW_URL environment variable.');
    }
    const serviceNowApiUser = process.env.SERVICENOW_USERNAME || '';
    const serviceNowApiPassword = process.env.SERVICENOW_PASSWORD || '';
    const serviceNowApiHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const serviceNowApiOptions = this.buildServiceNowAuthHeaders(serviceNowApiHeaders, serviceNowApiUser, serviceNowApiPassword);

    // Check each service now table to get the tickets infos
    for (const table of this.serviceNowConfig.tables) {
      const serviceNowApiResource = `/api/now/table/${table.tableName}`;
      const serviceNowApiQuery = `?sysparm_query=numberIN${ticketNumbers.join(',')}&sysparm_display_value=true`;
      const serviceNowApiUrlWithQuery = `${serviceNowUrl}${serviceNowApiResource}${serviceNowApiQuery}`;
      // Make API call to ServiceNow
      uxLog(this, `Fetching Service now using query: ${serviceNowApiUrlWithQuery}`);
      let serviceNowApiRes;
      try {
        serviceNowApiRes = await axios.get(serviceNowApiUrlWithQuery, serviceNowApiOptions);
      }
      catch (error: any) {
        uxLog(this, c.red(`ServiceNow API call failed: ${error.message}\n${JSON.stringify(error?.response?.data || {})}`));
        continue;
      }
      // Complete user stories with ServiceNow data
      const serviceNowRecords = serviceNowApiRes.data.result;
      uxLog(this, `ServiceNow API call succeeded: ${serviceNowRecords.length} records found`);
      for (const userStory of userStories) {
        const ticketNumber = userStory.Ticket_Number__c;
        const serviceNowRecord = serviceNowRecords.find((record: any) => record.number === ticketNumber);
        if (serviceNowRecord) {
          userStory.serviceNowInfo = serviceNowRecord;
          userStory.serviceNowTableName = table.tableName;
        }
      }
    }

    // Build final result
    this.results = userStories.map((userStory: any) => {
      const serviceNowInfo = userStory.serviceNowInfo || {};
      return {
        userStoryName: userStory.Name,
        userStoryTicketNumber: userStory.Ticket_Number__c,
        userStoryTitle: userStory.copado__User_Story_Title__c,
        userStoryCreatedBy: userStory.CreatedBy.Name,
        userStoryEnvironmentName: userStory.copado__Environment__r.Name,
        userStoryReleaseName: userStory.copado__Release__r.Name,
        serviceNowNumber: serviceNowInfo.number || 'NOT FOUND',
        serviceNowShortDescription: serviceNowInfo.short_description || 'NOT FOUND',
        serviceNowState: serviceNowInfo.state || 'NOT FOUND',
        serviceNowCreatedBy: serviceNowInfo.sys_created_by || 'NOT FOUND',
        serviceNowurl: userStory.serviceNowTableName ? `${process.env.SERVICENOW_URL}/nav_to.do?uri=/${userStory.serviceNowTableName}.do?sys_id=${serviceNowInfo.sys_id}` : 'NOT FOUND',
      };
    });
    // Generate CSV file
    await this.buildCsvFile();

    return { results: this.results, outputFilesRes: this.outputFilesRes };
  }

  private buildServiceNowAuthHeaders(serviceNowApiHeaders: { 'Content-Type': string; Accept: string; }, serviceNowApiUser: string, serviceNowApiPassword: string) {
    if (!serviceNowApiUser || !serviceNowApiPassword) {
      throw new SfError('ServiceNow API credentials are not set. Please set SERVICENOW_USERNAME and SERVICENOW_PASSWORD environment variables.');
    }
    return {
      headers: serviceNowApiHeaders,
      auth: {
        username: serviceNowApiUser,
        password: serviceNowApiPassword,
      },
    };
  }

  private async buildCsvFile(): Promise<void> {
    this.outputFile = await generateReportPath('user-story-report', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.results, this.outputFile);
  }
}