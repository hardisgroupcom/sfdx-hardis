/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { generateCsvFile, generateReportPath } from '../../../common/utils/filesUtils.js';
import { soqlQuery } from '../../../common/utils/apiUtils.js';
import axios from 'axios';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';
import { glob } from 'glob';
import { GLOB_IGNORE_PATTERNS } from '../../../common/utils/projectUtils.js';
import { prompts } from '../../../common/utils/prompts.js';
import fs from 'fs-extra';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

/* jscpd:ignore-end */
export default class ServiceNowReport extends SfCommand<any> {
  public static title = 'ServiceNow Report';
  public static description = `This command retrieves user stories from Salesforce and enriches them with data from ServiceNow.

Define the following environment variables (in CICD variables or locally in a **.env** file):

- SERVICENOW_URL: The base URL of the ServiceNow API (ex: https://your-instance.service-now.com/)
- SERVICENOW_USERNAME: The username for ServiceNow API authentication.
- SERVICENOW_PASSWORD: The password for ServiceNow API authentication.

You also need to define JSON configuration file(e) in folder **config/user-stories/**

Example:

\`\`\`json
{
    "userStoriesConfig": {
        "fields": [
            "Id",
            "Name",
            "Ticket_Number__c",
            "copado__User_Story_Title__c",
            "CreatedBy.Name",
            "copado__Release__r.Name",
            "copado__Environment__r.Name"
        ],
        "table": "copado__User_Story__c",
        "where": "copado__Environment__r.Name ='UAT'",
        "whereChoices": {
          "UAT all": "copado__Environment__r.Name ='UAT'",
          "UAT postponed": "copado__Environment__r.Name ='UAT' AND copado__Release__r.Name = 'postponed'",
          "UAT in progress": "copado__Environment__r.Name ='UAT' AND copado__Release__r.Name != 'postponed' AND copado__Release__r.Name != 'cancelled'"
        },
        "orderBy": "Ticket_Number__c ASC",
        "ticketField": "Ticket_Number__c",
        "reportFields": [
            { "key": "US Name", "path": "Name" },
            { "key": "US SN Identifier", "path": "Ticket_Number__c" },
            { "key": "US Title", "path": "copado__User_Story_Title__c" },
            { "key": "US Created By", "path": "CreatedBy.Name" },
            { "key": "US Environment", "path": "copado__Environment__r.Name" },
            { "key": "US Release", "path": "copado__Release__r.Name" },
            { "key": "SN Identifier", "path": "serviceNowInfo.number", "default": "NOT FOUND" },
            { "key": "SN Title", "path": "serviceNowInfo.short_description", "default": "NOT FOUND" },
            { "key": "SN Status", "path": "serviceNowInfo.state", "default": "NOT FOUND" },
            { "key": "SN Created By", "path": "serviceNowInfo.sys_created_by", "default": "NOT FOUND" },
            { "key": "SN URL", "special": "serviceNowTicketUrl" }
        ]
    },
    "serviceNowConfig": {
        "tables": [
            { "tableName": "demand" },
            { "tableName": "incident" }
        ]
    }
}
\`\`\`
  `;

  public static examples = ['$ sf hardis:misc:servicenow-report'];
  /* jscpd:ignore-start */
  public static flags: any = {
    config: Flags.string({
      char: 'c',
      description: 'Path to JSON config file containing user stories and ServiceNow configuration',
    }),
    'where-choice': Flags.string({
      char: 'w',
      description: 'Where selection for user stories. If not provided, you will be prompted to select one from the config file.',
    }),
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
    'target-org': optionalOrgFlagWithDeprecations,
  };
  /* jscpd:ignore-end */

  protected static supportsDevhubUsername = false;
  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;
  protected configFile: string | undefined;
  protected whereChoice: string | undefined;
  protected outputFile: string;
  protected outputFilesRes: any = {};
  protected userStories: any[] = [];
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
    whereChoices: {
      'UAT all': "copado__Environment__r.Name ='UAT'",
      'UAT postponed': "copado__Environment__r.Name ='UAT' AND copado__Release__r.Name = 'postponed'",
      'UAT in progress': "copado__Environment__r.Name ='UAT' AND copado__Release__r.Name != 'postponed' AND copado__Release__r.Name != 'cancelled'"
    },
    orderBy: 'Ticket_Number__c ASC',
    ticketField: 'Ticket_Number__c',
    reportFields: [
      { key: 'US Name', path: 'Name' },
      { key: 'US SN Identifier', path: 'Ticket_Number__c' },
      { key: 'US Title', path: 'copado__User_Story_Title__c' },
      { key: 'US Created By', path: 'CreatedBy.Name' },
      { key: 'US Environment', path: 'copado__Environment__r.Name' },
      { key: 'US Release', path: 'copado__Release__r.Name' },
      { key: 'SN Identifier', path: 'serviceNowInfo.number', default: 'NOT FOUND' },
      { key: 'SN Title', path: 'serviceNowInfo.short_description', default: 'NOT FOUND' },
      { key: 'SN Status', path: 'serviceNowInfo.state', default: 'NOT FOUND' },
      { key: 'SN Created By', path: 'serviceNowInfo.sys_created_by', default: 'NOT FOUND' },
      { key: 'SN URL', special: 'serviceNowTicketUrl' }
    ]
  };

  protected serviceNowConfig: any = {
    tables: [
      { tableName: 'demand' },
      { tableName: 'incident' },
    ]
  };


  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ServiceNowReport);
    this.configFile = flags.config;
    this.whereChoice = flags['where-choice'];
    this.outputFile = flags.outputfile || null;

    await this.initializeConfiguration();

    const conn = flags['target-org']?.getConnection();
    // List user stories matching with criteria
    const ticketNumbers = await this.fetchUserStories(conn);

    // Get matching demands and incidents from ServiceNow API with axios using ticket numbers
    const { serviceNowUrl, serviceNowApiOptions } = this.getServiceNowConfig();

    // Check each service now table to get the tickets infos
    for (const table of this.serviceNowConfig.tables) {
      const serviceNowApiResource = `/api/now/table/${table.tableName}`;
      const serviceNowApiQuery = `?sysparm_query=numberIN${ticketNumbers.join(',')}&sysparm_display_value=true`;
      const serviceNowApiUrlWithQuery = `${serviceNowUrl}${serviceNowApiResource}${serviceNowApiQuery}`;
      // Make API call to ServiceNow
      uxLog("other", this, `Fetching Service now using query: ${serviceNowApiUrlWithQuery}`);
      let serviceNowApiRes;
      try {
        serviceNowApiRes = await axios.get(serviceNowApiUrlWithQuery, serviceNowApiOptions);
      }
      catch (error: any) {
        uxLog("error", this, c.red(`ServiceNow API call failed: ${error.message}\n${JSON.stringify(error?.response?.data || {})}`));
        continue;
      }
      // Complete user stories with ServiceNow data
      const serviceNowRecords = serviceNowApiRes.data.result;
      uxLog("other", this, `ServiceNow API call succeeded: ${serviceNowRecords.length} records found`);
      for (const userStory of this.userStories) {
        const ticketNumber = userStory?.[this.userStoriesConfig.ticketField];
        const serviceNowRecord = serviceNowRecords.find((record: any) => record.number === ticketNumber);
        if (serviceNowRecord) {
          userStory.serviceNowInfo = serviceNowRecord;
          userStory.serviceNowTableName = table.tableName;
        }
      }
    }

    // Build final result
    this.results = this.userStories.map((userStory: any) => {
      const serviceNowInfo = userStory.serviceNowInfo || {};
      // Build result object dynamically based on config
      const result: any = {};
      for (const field of this.userStoriesConfig.reportFields) {
        if (field.special === "serviceNowTicketUrl") {
          if (!serviceNowInfo.sys_id) {
            result[field.key] = 'NOT FOUND';
          }
          else {
            result[field.key] = `${process.env.SERVICENOW_URL}/nav_to.do?uri=/${userStory.serviceNowTableName}.do?sys_id=${serviceNowInfo.sys_id}`;
          }
        } else if (field.path) {
          // Support nested paths like "CreatedBy.Name" or "serviceNowInfo.number"
          const value = field.path.split('.').reduce((obj, prop) => obj && obj[prop], { ...userStory, serviceNowInfo });
          result[field.key] = value !== undefined && value !== null ? value : (field.default ?? 'NOT FOUND');
        }
      }
      return result;
    });

    uxLog("log", this, c.grey(JSON.stringify(this.results, null, 2)));

    // Generate CSV file
    await this.buildCsvFile();

    return { results: this.results, outputFilesRes: this.outputFilesRes };
  }

  private getServiceNowConfig() {
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
    return { serviceNowUrl, serviceNowApiOptions };
  }

  private async fetchUserStories(conn: any) {
    if (this.userStoriesConfig.whereChoices) {
      // If whereChoices is defined, use the provided whereChoice flag or prompt user to select one
      if (this.whereChoice) {
        // If whereChoice is provided, use it directly
        this.userStoriesConfig.where = this.userStoriesConfig.whereChoices[this.whereChoice];
      }
      else {
        // If whereChoice is not provided, prompt user to select one
        uxLog("warning", this, c.yellow('No WHERE choice provided. Please select one from the available choices.'));
        // If whereChoices is defined, prompt user to select one
        const whereChoices = Object.keys(this.userStoriesConfig.whereChoices).map((key) => ({
          title: key,
          description: this.userStoriesConfig.whereChoices[key],
          value: key,
        }));
        const whereChoiceRes = await prompts({
          type: 'select',
          message: 'Select a WHERE condition for user stories:',
          description: 'Choose a predefined WHERE condition to filter user stories',
          placeholder: 'Select a condition',
          choices: whereChoices,
        });
        this.whereChoice = whereChoiceRes.value;
        this.userStoriesConfig.where = this.userStoriesConfig.whereChoices[this.whereChoice || ''];
      }
    }
    const userStoriesQuery = `SELECT ${this.userStoriesConfig.fields.join(', ')} FROM ${this.userStoriesConfig.table} WHERE ${this.userStoriesConfig.where} ORDER BY ${this.userStoriesConfig.orderBy}`;
    const userStoriesRes = await soqlQuery(userStoriesQuery, conn);
    this.userStories = userStoriesRes.records;
    // Get list of tickets from user stories
    const ticketNumbers = userStoriesRes.records.map((record: any) => record?.[this.userStoriesConfig.ticketField]);
    return ticketNumbers;
  }

  private async initializeConfiguration() {
    if (!this.configFile) {
      // If no config file is provided, prompt users to select a JSON file in all files found in folder config/user-stories/
      const configFiles = await glob('config/user-stories/*.json', { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS });
      if (configFiles.length === 0) {
        uxLog("warning", this, c.yellow('No configuration files found in config/user-stories/ directory. Using default config...'));
      }
      else if (configFiles.length === 1) {
        this.configFile = configFiles[0];
        uxLog("other", this, `Single config file found: ${this.configFile}`);
      }
      else {
        // If multiple files are found, prompt user to select one
        const configFileRes = await prompts({
          type: 'select',
          message: 'Multiple configuration files found. Please select one:',
          description: 'Choose which configuration file to use for the ServiceNow report',
          placeholder: 'Select a config file',
          choices: configFiles.map((file) => ({ title: file, value: file })),
        });
        this.configFile = configFileRes.value;
      }
    }
    if (this.configFile) {
      // Load configuration from JSON file
      try {
        const configData = await fs.readJSON(this.configFile);
        this.userStoriesConfig = configData.userStoriesConfig || this.userStoriesConfig;
        this.serviceNowConfig = configData.serviceNowConfig || this.serviceNowConfig;
        uxLog("other", this, `Configuration loaded from ${this.configFile}`);
      }
      catch (error: any) {
        throw new SfError(`Failed to load configuration file: ${error.message}`);
      }
    }
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
    this.outputFile = await generateReportPath('user-story-report' + (this.whereChoice ? `-${this.whereChoice}` : ''), this.outputFile, { withDate: true });
    this.outputFilesRes = await generateCsvFile(this.results, this.outputFile);
  }
}