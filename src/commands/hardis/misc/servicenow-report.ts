/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { generateCsvFile, generateReportPath } from '../../../common/utils/filesUtils.js';
import { soqlQuery } from '../../../common/utils/apiUtils.js';
import axios from 'axios';
import c from 'chalk';
import { uxLog, uxLogTable } from '../../../common/utils/index.js';
import { glob } from 'glob';
import { GLOB_IGNORE_PATTERNS } from '../../../common/utils/projectUtils.js';
import { prompts } from '../../../common/utils/prompts.js';
import fs from 'fs-extra';
import { getNotificationButtons, getOrgMarkdown } from '../../../common/utils/notifUtils.js';
import { NotifProvider, NotifSeverity } from '../../../common/notifProvider/index.js';
import { setConnectionVariables } from '../../../common/utils/orgUtils.js';

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
            { "tableName": "dmn_demand" },
            { "tableName": "incident" }
        ]
    }
}
\`\`\`
  `;

  public static examples = [
    '$ sf hardis:misc:servicenow-report',
    '$ sf hardis:misc:servicenow-report --config config/user-stories/my-config.json --where-choice "UAT all"'
  ];
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
  protected invalidResults: any[] = [];
  protected conn: Connection;

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

    this.conn = flags['target-org']?.getConnection();
    // List user stories matching with criteria
    const ticketNumbers = await this.fetchUserStories(this.conn);

    // Get matching demands and incidents from ServiceNow API with axios using ticket numbers
    await this.completeUserStoriesWithServiceNowInfo(ticketNumbers);

    // Build final result
    await this.handleResults();

    return { results: this.results, outputFilesRes: this.outputFilesRes };
  }

  private async fetchUserStories(conn: any): Promise<string[]> {
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
    uxLog("action", this, c.cyan(`Fetching user stories from Salesforce...`));
    const userStoriesQuery = `SELECT ${this.userStoriesConfig.fields.join(', ')} FROM ${this.userStoriesConfig.table} WHERE ${this.userStoriesConfig.where} ORDER BY ${this.userStoriesConfig.orderBy}`;
    const userStoriesRes = await soqlQuery(userStoriesQuery, conn);
    this.userStories = userStoriesRes.records;
    const initialUserStoriesCount = this.userStories.length;
    // Duplicate user stories entries if there are multiple ticket numbers separated by ; or , in the ticket field
    this.userStories = this.userStories.flatMap((us) => {
      const ticketFieldValue = us?.[this.userStoriesConfig.ticketField];
      if (ticketFieldValue && (ticketFieldValue.includes(';') || ticketFieldValue.includes(','))) {
        const ticketNumbers = ticketFieldValue.split(/[,;]\s*/).filter((tn: string) => tn);
        return ticketNumbers.map((tn: string) => ({ ...us, [this.userStoriesConfig.ticketField]: tn }));
      }
      return us;
    });
    const finalUserStoriesCount = this.userStories.length;
    // Get list of tickets from user stories
    const ticketNumbers = userStoriesRes.records.map((record: any) => record?.[this.userStoriesConfig.ticketField] as string);
    // Remove null/undefined and duplicates
    const ticketNumbersUnique = [...new Set(ticketNumbers.filter((tn: string | undefined) => tn))] as string[];
    let message = `${initialUserStoriesCount} user stories fetched from Salesforce, with ${ticketNumbersUnique.length} unique ticket numbers.`;
    if (finalUserStoriesCount > initialUserStoriesCount) {
      message += ` After splitting multiple ticket numbers, there are ${finalUserStoriesCount} user story entries to process.`;
    }
    uxLog("action", this, c.cyan(message));
    uxLog("log", this, c.grey(`Ticket Numbers:\n${ticketNumbersUnique.map((tn) => `- ${tn}`).join('\n')}`));
    return ticketNumbersUnique;
  }

  private async completeUserStoriesWithServiceNowInfo(ticketNumbers: string[]): Promise<void> {
    const { serviceNowUrl, serviceNowApiOptions } = this.getServiceNowConfig();

    // Check each service now table to get the tickets infos
    uxLog("action", this, c.cyan(`Fetching matching tickets from ServiceNow...`));
    for (const table of this.serviceNowConfig.tables) {
      const serviceNowApiResource = `/api/now/table/${table.tableName}`;
      const serviceNowApiQuery =
        `?sysparm_query=numberIN${ticketNumbers.join(',')}&sysparm_display_value=true` +
        (table.urlSuffix ? table.urlSuffix : '');
      const serviceNowApiUrlWithQuery = `${serviceNowUrl}${serviceNowApiResource}${serviceNowApiQuery}`;
      // Make API call to ServiceNow
      uxLog("log", this, `Fetching ServiceNow ${table.tableName} table using query: ${serviceNowApiUrlWithQuery}`);
      let serviceNowApiRes;
      try {
        serviceNowApiRes = await axios.get(serviceNowApiUrlWithQuery, serviceNowApiOptions);
      }
      catch (error: any) {
        uxLog("error", this, c.red(`ServiceNow API call failed: ${error.message}\n${JSON.stringify(error?.response?.data || {})}`));
        continue;
      }
      // Complete user stories with ServiceNow data
      const serviceNowRecords = serviceNowApiRes?.data?.result;
      if (!serviceNowRecords || serviceNowRecords.length === 0) {
        uxLog("warning", this, c.yellow(`No ${table.tableName} records found in ServiceNow response.`));
        continue;
      }
      uxLog("success", this, `ServiceNow API call succeeded: ${serviceNowRecords.length} records of table ${table.tableName} have been found`);
      // If subRecordFields is defined in config, fetch each sub-record using its URL
      if (table.subRecordFields) {
        for (const subRecordField of table.subRecordFields) {
          for (const record of serviceNowRecords) {
            if (record?.[subRecordField]?.link && typeof record[subRecordField].link === 'string') {
              try {
                const serviceNowSubRecordQuery = await axios.get(record[subRecordField].link, serviceNowApiOptions);
                record[subRecordField] = Object.assign(record[subRecordField], serviceNowSubRecordQuery?.data?.result || {});
                uxLog("success", this, `ServiceNow sub-record API call succeeded for record ${record.number} field ${subRecordField}`);
              }
              catch (error: any) {
                uxLog("error", this, c.red(`ServiceNow sub-record API call failed: ${error.message}\n${JSON.stringify(error?.response?.data || {})}`));
              }
            }
            else {
              uxLog("warning", this, c.yellow(`No link found for sub-record field ${subRecordField} in record ${record.number}. Skipping sub-record fetch.`));
            }
          }
        }
      }
      // Match ServiceNow records to user stories based on ticket number
      uxLog("action", this, c.cyan(`Matching ServiceNow records with user stories...`));
      for (const userStory of this.userStories) {
        const ticketNumber = userStory?.[this.userStoriesConfig.ticketField];
        const serviceNowRecord = serviceNowRecords.find((record: any) => record.number === ticketNumber);
        if (serviceNowRecord) {
          userStory.serviceNowInfo = serviceNowRecord;
          userStory.serviceNowTableName = table.tableName;
        }
      }
    }
  }

  private async handleResults() {
    uxLog("action", this, c.cyan(`Building final results...`));
    this.results = this.userStories.map((userStory: any) => {
      const serviceNowInfo = userStory.serviceNowInfo || {};
      // Build result object dynamically based on config
      let result: any = {};
      const invalidFields: string[] = [];
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
        // Check field validity
        let isValueValid = true;
        // Use a safe hasOwnProperty check to avoid calling Object.prototype methods on the target object.
        if (Object.prototype.hasOwnProperty.call(field, 'valid')) {
          const fieldValue = result[field.key];
          if (field.valid === "NOT NULL") {
            isValueValid = fieldValue !== null && fieldValue !== 'NOT FOUND';
          } else {
            isValueValid = fieldValue === field.valid;
          }
        }
        // If any field is invalid for this result, mark the result as invalid
        if (!isValueValid) {
          invalidFields.push(field.key);
        }
      }
      const isValid = invalidFields.length === 0 ? true : false;
      const invalidFieldsStr = invalidFields.join(", ");
      result = Object.assign({ "Is Valid": isValid, "Invalid Fields": invalidFieldsStr }, result);
      return result;
    });

    uxLog("action", this, c.cyan(`Final results built with ${this.results.length} records.`));
    uxLogTable(this, this.results);

    // Check results validity
    this.invalidResults = this.results.filter((res) => {
      return res["Is Valid"] === false;
    });

    uxLog("action", this, c.cyan(`${this.invalidResults.length} invalid results found.`));
    if (this.invalidResults.length > 0) {
      uxLog("warning", this, c.yellow(`Listing invalid results below.`));
      uxLogTable(this, this.invalidResults);
      process.exitCode = 1;
    }

    // Process result
    if (this.results.length > 0) {
      // Generate output CSV file
      this.outputFile = await generateReportPath('service-now-report', this.outputFile);
      this.outputFilesRes = await generateCsvFile(this.results, this.outputFile, { fileTitle: 'ServiceNow cross-report' });

      if (this.invalidResults.length > 0) {
        const invalidOutputFile = this.outputFile.replace('.csv', '-invalid.csv');
        await generateCsvFile(this.invalidResults, invalidOutputFile, { fileTitle: 'ServiceNow cross-report - Invalid Entries' });
      }

      // Build notification
      const orgMarkdown = await getOrgMarkdown(this.conn?.instanceUrl);
      const notifButtons = await getNotificationButtons();
      const notifSeverity: NotifSeverity = 'warning';
      let notifText = `${this.results.length} ServiceNow report lines have been extracted from ${orgMarkdown}`;
      if (this.invalidResults.length > 0) {
        notifText += `, including ${this.invalidResults.length} invalid entries`;
      }
      // Post notif
      await setConnectionVariables(this.conn);// Required for some notifications providers like Email
      await NotifProvider.postNotifications({
        type: 'SERVICENOW_REPORT',
        text: notifText,
        attachments: [],
        buttons: notifButtons,
        severity: notifSeverity,
        attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
        logElements: this.results,
        data: { metric: this.results.length },
        metrics: {}
      });
    }

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

}
