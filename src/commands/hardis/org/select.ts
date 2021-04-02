/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import {  uxLog } from '../../../common/utils';
import { prompts } from '../../../common/utils/prompts';
//import { WebSocketClient } from '../../../common/websocketClient';
//import { setConfig } from '../../../config';
import * as moment from 'moment'

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgSelect extends SfdxCommand {

  public static title = 'Select org';

  public static description = messages.getMessage('selectOrg');

  public static examples = [
    '$ sfdx hardis:org:select'
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    devhub: flags.boolean({ char: 'h', default: false, description: messages.getMessage('withDevHub') }),
    debug: flags.boolean({ char: 'd', default: false, description: messages.getMessage('debugMode') })
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  /*public async run(): Promise<AnyJson> {
    const devHub = this.flags.devhub || false;
    this.debugMode = this.flags.debug || false;

    // List all local orgs and request to user
    //const orgListResult = await MetadataUtils.listLocalOrgs('any');
    const  orgListResultTest ={
      "nonScratchOrgs":[ {
      username: "nicolas.vuillamy@hardis-scratch-nvuillamy-champs-sur-oppo_2021-03-02_11-27.com",
      instanceUrl: "https://flow-efficiency-2233-dev-ed.cs102.my.salesforce.com/",
      lastUsed: "2021-02-20T16:18:52.616Z",
        attributes: {
        type: "ScratchOrgInfo",
        url: "/services/data/v51.0/sobjects/ScratchOrgInfo/2SR09000000wq3bGAA",
      },
      orgName: "NVUILLAMY-champs-sur-oppo_2021-03-02_11-27",
      edition: "Developer",
      connectedStatus: "Unknown",
    },
    {
      username: "nicolas.vuillamy@hardis-scratch-nvuillamy-ci-nico_2021-03-22_11-26.com",     
      instanceUrl: "https://customer-speed-1350-dev-ed.cs102.my.salesforce.com/",
      lastUsed: "2021-03-15T16:18:52.616Z",      
      attributes: {
        type: "ScratchOrgInfo",
        url: "/services/data/v51.0/sobjects/ScratchOrgInfo/2SR09000000Gt9WGAS",
      },
      orgName: "NVUILLAMY-CI-Nico_2021-03-22_11-26",
      edition: "Developer",
      connectedStatus: "Unknown",
    },
    {
      username: "nicolas.vuillamy@hardis-scratch-nvuillamy-new-fflib_2021-03-09_03-27.com",     
      instanceUrl: "https://connect-site-22082-dev-ed.cs100.my.salesforce.com",
      lastUsed: "2021-03-15T16:18:53.616Z",      
      attributes: {
        type: "ScratchOrgInfo",
        url: "/services/data/v51.0/sobjects/ScratchOrgInfo/2SR09000000Gt9WGAS",
      },
      orgName: "NVUILLAMY-new-fflib_2021-03-09_03-27",
      edition: "Developer",
      connectedStatus: "Unknown",
    }],
	  "scratchOrgs" :[]
       
 
    };
    console.debug("coucou je suis dans la classe select");
    orgListResultTest.nonScratchOrgs.sort((a, b) => (a.lastUsed > b.lastUsed) ? 1 : -1);
    const orgList = [...orgListResultTest.scratchOrgs,
    ...orgListResultTest.nonScratchOrgs,
    { username: 'Connect to another org', otherOrg: true },
    { username: 'Cancel', cancel: true }
    ];
    const orgResponse = await prompts({
      type: 'select',
      name: 'org',
      message: c.cyanBright('Please select an org'),
      choices: orgList.map((org: any) => {
        const title = org.username || org.alias || org.instanceUrl;        
        const description = title !== org.instanceUrl ? org.instanceUrl : '';

        const lastTimeConnect = moment(org.lastUsed).format('DD-MM-YYYY');
        const descriptionWithLastTimeConnect = org.lastUsed !== undefined ? description + ' last access: ' + lastTimeConnect : description;

        return { 
          title: c.cyan(title),
          description: descriptionWithLastTimeConnect ,
          value: org
        };
      })
    }
    );

    // Cancel
    if (orgResponse.org.cancel === true) {
      uxLog(this, c.cyan('Cancelled'));
      process.exit(0);
    }

    // Connect to new org
    if (orgResponse.org.otherOrg === true) {
      await this.config.runHook('auth', { checkAuth: true, Command: this, devHub });
      return { outputString: 'Launched org connection' };
    } else {
      // Set default username
      const setDefaultUsernameCommand = `sfdx config:set ${devHub ? 'defaultdevhubusername' : 'defaultusername'}=${orgResponse.org.username}`;
      await execSfdxJson(setDefaultUsernameCommand, this, { fail: true, output: false });
      WebSocketClient.sendMessage({event: "refreshStatus"});
      // Update local user .sfdx-hardis.yml file with response if scratch has been selected
      if (orgResponse.org.username.includes('scratch')) {
        await setConfig('user', {
          scratchOrgAlias: orgResponse.org.username,
          scratchOrgUsername: orgResponse.org.alias || orgResponse.org.username
        });
      }

      uxLog(this, c.gray(JSON.stringify(orgResponse.org, null, 2)));
      uxLog(this, c.cyan(`Selected org ${c.green(orgResponse.org.username)} - ${c.green(orgResponse.org.instanceUrl)}`));

      // Return an object to be displayed with --json
      return { outputString: `Selected org ${orgResponse.org.username}` };
    }
  }*/


  //////////////////////////////////  For delete    //////////////////////////////////////////
public async run(): Promise<AnyJson> {
    const devHub = this.flags.devhub || false;
    this.debugMode = this.flags.debug || false;

    // List all local orgs and request to user
    //const orgListResult = await MetadataUtils.listLocalOrgs('any');
    const  orgListResultTest ={
      "nonScratchOrgs":[ {
      username: "nicolas.vuillamy@hardis-scratch-nvuillamy-champs-sur-oppo_2021-03-02_11-27.com",
      instanceUrl: "https://flow-efficiency-2233-dev-ed.cs102.my.salesforce.com/",
      lastUsed: "2021-02-20T16:18:52.616Z",
      orgId: "00D1x0000001IRLEA2",
        attributes: {
        type: "ScratchOrgInfo",
        url: "/services/data/v51.0/sobjects/ScratchOrgInfo/2SR09000000wq3bGAA",
      },
      orgName: "NVUILLAMY-champs-sur-oppo_2021-03-02_11-27",
      edition: "Developer",
      connectedStatus: "Unknown",
    },
    {
      username: "nicolas.vuillamy@hardis-scratch-nvuillamy-ci-nico_2021-03-22_11-26.com",     
      instanceUrl: "https://customer-speed-1350-dev-ed.cs102.my.salesforce.com/",
      lastUsed: "2021-03-15T16:18:52.616Z",      
      attributes: {
        type: "ScratchOrgInfo",
        url: "/services/data/v51.0/sobjects/ScratchOrgInfo/2SR09000000Gt9WGAS",
      },
      orgName: "NVUILLAMY-CI-Nico_2021-03-22_11-26",
      edition: "Developer",
      connectedStatus: "Unknown",
    },
    {
      username: "nicolas.vuillamy@hardis-scratch-nvuillamy-new-fflib_2021-03-09_03-27.com",     
      instanceUrl: "https://connect-site-22082-dev-ed.cs100.my.salesforce.com",
      lastUsed: "2021-03-15T16:18:53.616Z",      
      attributes: {
        type: "ScratchOrgInfo",
        url: "/services/data/v51.0/sobjects/ScratchOrgInfo/2SR09000000Gt9WGAS",
      },
      orgName: "NVUILLAMY-new-fflib_2021-03-09_03-27",
      edition: "Developer",
      connectedStatus: "Unknown",
    }],
	  "scratchOrgs" :[]
       
 
    };
    console.debug("coucou je suis dans la classe select");
    orgListResultTest.nonScratchOrgs.sort((a, b) => (a.lastUsed > b.lastUsed) ? 1 : -1);
    const orgList = [...orgListResultTest.scratchOrgs,
    ...orgListResultTest.nonScratchOrgs,
      { username: 'Cancel', cancel: true }
    ];
    const orgResponse = await prompts({
      type: 'select',
      name: 'org',
      message: c.cyanBright('Please select an org'),
      choices: orgList.map((org: any) => {
        const title = org.username || org.alias || org.instanceUrl;        
        const description = title !== org.instanceUrl ? org.instanceUrl : '';

        const lastTimeConnect = moment(org.lastUsed).format('DD-MM-YYYY');
        const descriptionWithLastTimeConnect = org.lastUsed !== undefined ? description + ' last access: ' + lastTimeConnect : description;

        return { 
          title: c.cyan(title),
          description: descriptionWithLastTimeConnect ,
          value: org
        };
      })
    }
    );

    // Cancel
    if (orgResponse.org.cancel === true) {
      uxLog(this, c.cyan('Cancelled'));
      process.exit(0);
    }

    // Connect to new org
    
      // Set default username
      
      const setDefaultUsernameCommand = `sfdx config:set ${devHub ? 'defaultdevhubusername' : 'defaultusername'}=${orgResponse.org.username}`;
      const setDefaultorgIdCommand = `${orgResponse.org.orgId}`;
      console.log("org name select " + setDefaultUsernameCommand);
      console.log("org id select " + setDefaultorgIdCommand);
      orgListResultTest.nonScratchOrgs = orgListResultTest.nonScratchOrgs.filter((el) => {return el.orgId !=setDefaultorgIdCommand});    
      console.log("org id select " + orgListResultTest.nonScratchOrgs);

      const orgList2 = [...orgListResultTest.scratchOrgs,
        ...orgListResultTest.nonScratchOrgs,
          { username: 'Cancel', cancel: true }
        ];
        const orgResponse2 = await prompts({
          type: 'select',
          name: 'org',
          message: c.cyanBright('Please select an org'),
          choices: orgList2.map((org: any) => {
            const title = org.username || org.alias || org.instanceUrl;        
            const description = title !== org.instanceUrl ? org.instanceUrl : '';
    
            const lastTimeConnect = moment(org.lastUsed).format('DD-MM-YYYY');
            const descriptionWithLastTimeConnect = org.lastUsed !== undefined ? description + ' last access: ' + lastTimeConnect : description;
    
            return { 
              title: c.cyan(title),
              description: descriptionWithLastTimeConnect ,
              value: org
            };
          })
        }
        );
        if (orgResponse2.org.cancel === true) {
          uxLog(this, c.cyan('Cancelled'));
          process.exit(0);
        }

      return null;
      /*await execSfdxJson(setDefaultUsernameCommand, this, { fail: true, output: false });
      WebSocketClient.sendMessage({event: "refreshStatus"});
      // Update local user .sfdx-hardis.yml file with response if scratch has been selected
      if (orgResponse.org.username.includes('scratch')) {
        await setConfig('user', {
          scratchOrgAlias: orgResponse.org.username,
          scratchOrgUsername: orgResponse.org.alias || orgResponse.org.username
        });
      }

      uxLog(this, c.gray(JSON.stringify(orgResponse.org, null, 2)));
      uxLog(this, c.cyan(`Selected org ${c.green(orgResponse.org.username)} - ${c.green(orgResponse.org.instanceUrl)}`));

      // Return an object to be displayed with --json
      return { outputString: `Selected org ${orgResponse.org.username}` };*/
    
  }
}
