/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages/*, SfdxError*/ } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as fs from 'fs-extra';
import * as c from 'chalk';
import * as columnify from 'columnify';
import * as path from 'path';
import { execSfdxJson, uxLog } from '../../../../common/utils';
 
// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgUnfreezeUser extends SfdxCommand {
  public static title = 'Unfreeze user in organization';

  public static description = messages.getMessage('orgUnfreezeUser');

  public static examples = [
    `$ sfdx hardis:org:user:unfreeze --targetusername dimitri.mongey@gmail.com
  Found 1 records
  Are you sure you want to unfreeze these users (y/n)?: y
  Successfully unfreeze users.
  updated the following list of records:
  ID                 MASTERLABEL PROFIL ISFROZEN
  30109000000kX7uAAE TestFlow    2         true
  `,
    `$ sfdx hardis:org:user:unfreeze --targetusername dimirtri.monge@gmail.com --except ""
  Found 4 records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  30109000000kX8EAAU TestFlow    6             test flowwww InvalidDraft
  30109000000kX8AAAU TestFlow    5             test flowwww InvalidDraft
  30109000000kX89AAE TestFlow    4             test flowwww Draft
  Are you sure you want to delete this list of records (y/n)?: n
  No record deleted
  `
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    prompt: flags.boolean({
      char: 'z',
      default: true,
      allowNo: true,
      description: messages.getMessage('prompt')
    }),
    name: flags.string({
      char: 'n',
      description: messages.getMessage('nameFilter')
    }),
    except: flags.string({
      char: 's',
      default: 'system administrator',
      description: messages.getMessage('exceptFilter')
    }),
    instanceurl: flags.string({
      char: 'r',
      default: 'https://login.saleforce.com',
      description: messages.getMessage('instanceUrl')
    }),
    debug: flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode')
    })
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const prompt = this.flags.prompt === false ? false : true;
    const exceptFilter = this.flags.except
      ? this.flags.except.split(',')
      : ['System Administrator'];
    const nameFilter = this.flags.name || null;

    const debugMode = this.flags.debug || false;

    //select id, isfrozen, UserId from UserLogin where userid in (select id from user where profile.name NOT IN (\''+exceptFilter+'\') and isactive=true) AND isfrozen=false
    // Build query with name filter if sent
    let queryUser = `select id, isFrozen, UserId from UserLogin where userid in (select id from user where profile.name NOT IN ('${exceptFilter.join(
      "','"
    )}') and isactive=true`;
    if (nameFilter) {
      queryUser += ' AND Name LIKE \'%'+nameFilter+'%\'';
    }
    queryUser +=') AND isfrozen=true';

    let apexcode = 'list<userLogin> userLoginList = ['+queryUser+']; \n'+
    'Set<Id> userIdList = new Set<Id>();\n'+
    'if(userLoginList != null && userLoginList.size()> 0){\n'+
        'for(UserLogin userfromList : userLoginList){\n'+
            'userIdList.add(userfromList.UserId);\n'+
        '}\n'+
    '}\n'+
    'list<User> userList = [SELECT Id,Name,Profile.Name FROM User WHERE Id IN :userIdList];\n'+
    'system.debug(\'OUTPUTVALUE=\'+JSON.serialize(userList)+\'END_OUTPUTVALUE\'); \n';
    
    const username = this.org.getUsername(); 

    fs.readFileSync(path.join(__dirname,'./apex-freeze.apex'),'utf8');
    const targetFile = path.join(__dirname,'apex-freeze.apex');
    await fs.writeFile(targetFile,apexcode);
  
    const apexScriptCommand = `sfdx force:apex:execute -f "${targetFile}" --targetusername ${username}`;
    const freezeQueryRes = await execSfdxJson(apexScriptCommand, this, { fail: true, output: true, debug: debugMode });
  
    let logs = freezeQueryRes?.result?.logs || '' ;
  
    let userlistraw= JSON.parse(logs.split('OUTPUTVALUE=')[2].split('END_OUTPUTVALUE')[0]);
    // Check empty result
    if (userlistraw.length === 0) {
      const outputString = `[sfdx-hardis] No matching user records found for all profile  except ${exceptFilter}`;
      uxLog(this,c.yellow(outputString));
      return { deleted: [], outputString };
    }

    let userlist = userlistraw.map((record: any) => {
      return {
        Name: record.Name,
        Profile: record.Profile.Name
      };
    });
    uxLog(this,
      `[sfdx-hardis] Found ${c.bold(userlist.length)} records:\n${c.yellow(columnify(userlist.splice(0,500)))}`
    );


    userlistraw = [];
    const confirmunfreeze = await prompts({
      type: "confirm",
      name: "value",
      initial: true,
      message: c.cyanBright(
        `[sfdx-hardis] Are you sure you want to freeze this list of records in ${c.green(
          this.org.getUsername()
        )} (y/n)?`
      ),
    });
    if (confirmunfreeze.value === true) { {
        apexcode = 'list<userLogin> userLoginList = ['+queryUser+']; \n'+
        'Set<Id> userIdList = new Set<Id>();\n'+
        'if(userLoginList != null && userLoginList.size()> 0){\n'+
            'for(UserLogin userfromList : userLoginList){\n'+
                'userfromList.isFrozen = false;\n'+
                'userIdList.add(userfromList.UserId);\n'+
            '}\n'+
        '}\n'+
        'upsert userLoginList;\n'+
        'list<User> userList = [SELECT Id,Name,Profile.Name FROM User WHERE Id IN :userIdList];\n'+
        'system.debug(\'OUTPUTVALUE=\'+JSON.serialize(userList)+\'END_OUTPUTVALUE\'); \n';
        fs.readFileSync(path.join(__dirname,'./apex-freeze.apex'),'utf8');
        const targetFile = path.join(__dirname,'apex-freeze.apex');
        await fs.writeFile(targetFile,apexcode);
      
        const apexScriptCommand = `sfdx force:apex:execute -f "${targetFile}" --targetusername ${username}`;
        const freezeQueryRes = await execSfdxJson(apexScriptCommand, this, { fail: true, output: true, debug: debugMode });
      
        logs = freezeQueryRes?.result?.logs || '' ;
      
        userlistraw= JSON.parse(logs.split('OUTPUTVALUE=')[2].split('END_OUTPUTVALUE')[0]);

    }
    
    if (userlistraw.length === 0) {
      const outputString = `[sfdx-hardis] No user has been frozen`;
      uxLog(this,c.green(outputString));
      return { deleted: [], outputString };
    }else{
      userlist = userlistraw.map((record: any) => {
        return {
          Name: record.Name,
          Profile: record.Profile.Name
        };
      });
      const summary =
        `[sfdx-hardis] updated ${c.bold(userlist.length)} user, records:\n${c.yellow(columnify(userlist.splice(0,500)))}`;
  
      uxLog(this,c.green(summary));
      // Return an object to be displayed with --json
      return { orgId: this.org.getOrgId(), outputString: summary };
    }

  }
}