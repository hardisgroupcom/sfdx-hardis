/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as prompts from 'prompts';
import * as c from 'chalk';
import { execSfdxJson, uxLog } from '../../../../common/utils';
import { getConfig } from '../../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class TreeExport extends SfdxCommand {

  public static title = 'Tree export';

  public static description = messages.getMessage('dataTreeExport');

  public static examples = [
    '$ sfdx hardis:data:tree:export'
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    debug: flags.boolean({ char: 'd', default: false, description: messages.getMessage('debugMode') })
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const debugMode = this.flags.debug || false;

    const config = await getConfig('project');

    // User selection of a request
    let requestToRun = null;
    const choices = (config.initDataRequests || []).map(dataRequest => {
      return { title: `${dataRequest.name}: ${dataRequest.description}`, value: dataRequest }
    });
    choices.push({ title: "New export request", value: "new" });
    const promptResponse = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright('Please select an export request'),
      choices: choices
    });
    if (promptResponse.value == 'new') {
      uxLog(this, c.red(`Not implemented yet. Add requests in config/sfdx-hardis.yml initDataRequests property !\nexemple:
${c.yellow(`initDataRequests:
  - name: SampleAccounts
    description: List of sample accounts with contacts and custom objects
    soql: SELECT Id, name, (SELECT Id, Name FROM Contacts),(SELECT Id, Name FROM My_Custom_Objects__r) FROM Account LIMIT 100
    plan: SampleAccounts-Account-Contact-MyCustomObject__c-plan.json`)}`));
      process.exit(1);
    }
    else {
      requestToRun = promptResponse.value;
    }

    // Execute request and build import files 
    const exportCommand = "sfdx force:data:tree:export" +
      ` -q "${requestToRun.soql}"` +
      ' --plan' +
      ` --prefix ${requestToRun.name}` +
      ' --outputdir data';
    const exportRes = await execSfdxJson(exportCommand, this, { fail: true, output: true, debug: debugMode });
    console.log(exportRes);
    // Return an object to be displayed with --json
    return { outputString: 'Exported data' };
  }
}
