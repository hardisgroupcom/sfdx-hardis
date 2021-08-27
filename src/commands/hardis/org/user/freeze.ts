/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages/*, SfdxError*/ } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as columnify from 'columnify';
import { uxLog } from '../../../../common/utils';
//import { executeApex } from "../../../../common/utils/deployUtils";
import { prompts } from "../../../../common/utils/prompts";
 
// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgUnfreezeUser extends SfdxCommand {
  public static title = 'freeze user in organization';

  public static description = messages.getMessage('orgfreezeUser');

  public static examples = [
    `$ sfdx hardis:org:user:freeze --targetusername dimitri.monge@gmail.com
    [sfdx-hardis]  Found 1 records:
    NAME              PROFILE  
    Dimitri Monge     Utilisateur standard  
    ? 🦙   Are you sure you want to freeze this list of records in dimitri.monge@gmail.com (y/n)? ☑ Yes
    ....
    ....

    [sfdx-hardis]  updated 1 user, records:
    NAME              PROFILE
    Dimitri Monge     Utilisateur standard
  `,
    `$ sfdx hardis:org:user:freeze --targetusername dimirtri.monge@gmail.com
    [sfdx-hardis]  Found 1 records:
    NAME                  PROFILE
    Dimitri Monge         Utilisateur standard
    √ 🦙   Are you sure you want to freeze this list of records in admin.hardis@cermix.com.dev (y/n)? » ☓ No
    [sfdx-hardis]  No user has been frozen
  `
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    name: flags.string({
      char: 'n',
      description: messages.getMessage('nameFilter')
    }),
    except: flags.string({
      char: 'e',
      default: 'system administrator,Administrateur système',
      description: messages.getMessage('exceptFilter')
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
    //const profiles = await promptProfiles(this.org.getConnection(),{multiselect: true, initialSelection: ["System Administrator","Administrateur Système"], message: 'Please select the profiles that will NOT be frozen'});
    const exceptFilter = this.flags.except
      ? this.flags.except.split(',')
      : ['System Administrator'];
    const nameFilter = this.flags.name || null;
    //const debugMode = this.flags.debug || false;

    //select id, isfrozen, UserId from UserLogin where userid in (select id from user where profile.name NOT IN (\''+exceptFilter+'\') and isactive=true) AND isfrozen=false
    // Build query with name filter if sent
    let queryUser = `select id, isFrozen, UserId from UserLogin where userid in (select id from user where profile.name NOT IN ('${exceptFilter.join(
      "','"
    )}') and isactive=true`;
    if (nameFilter) {
      queryUser += ' AND Name LIKE \'%'+nameFilter+'%\'';
    }
    queryUser +=') AND isfrozen=false';

   let userlistrawFreeze;
   let userList;
   const userIdList=[];
   const conn = this.org.getConnection();
   await conn.query(queryUser, null,function(err:any, result:any) {
    if (err) { return console.log(err); }
    console.log("total freeze: " + result.totalSize);
    console.log("fetched freeze: " + result.records.length);
    console.log("records freeze: " + JSON.stringify(result.records));
    userList = result.records;
   });

    if(userList.length>0){
      for (const record of userList) {
        userIdList.push('\''+record.UserId+'\'');
      }  
      try{ 
      const resultfreeze = await conn.query('SELECT Id,Name,Profile.Name FROM User WHERE Id IN ('+userIdList+')', null,null);
      console.log(JSON.stringify(resultfreeze));
      userlistrawFreeze = resultfreeze.records;
      } catch(e){
        console.log(e);
        return;
      }
    }

    console.log("userlistrawFreeze : " + JSON.stringify(userlistrawFreeze));
    // Check empty result
    if (!userlistrawFreeze || userlistrawFreeze.length === 0) {
      const outputString = ` No matching user records found for all profile  except ${exceptFilter}`;
      uxLog(this,c.yellow(outputString));
      return { deleted: [], outputString }; 
    }

    let userlist = userlistrawFreeze.map((record: any) => {
      return {
        Name: record.Name,
        Profile: record.Profile.Name
      };
    });
    uxLog(this,
      ` Found ${c.bold(userlist.length)} records:\n${c.yellow(columnify(userlist.splice(0,500)))}`
    );

    userlistrawFreeze = [];
    const confirmfreeze = await prompts({
      type: "confirm",
      name: "value",
      initial: true,
      message: c.cyanBright(
        ` Are you sure you want to freeze this list of records in ${c.green(
          this.org.getUsername()
        )} (y/n)?`
      ),
    });
    if (confirmfreeze.value === true) {
      for (const freezerecord of userList) {
        freezerecord.IsFrozen = true;
        delete freezerecord.UserId;
      }

      console.log('userList '+JSON.stringify(userList));
      try {
        const ret = await conn.sobject("UserLogin").update(userList, null);
        console.log('Updated Successfully : ' + JSON.stringify(ret));
      } catch (error) {
        console.error(error, JSON.stringify(error));
        return;
      }
     

    }
    if (userlistrawFreeze.length === 0) {
      const outputString  = ` No user has been frozen`;
      uxLog(this,c.green(outputString));
      return { userlist: [], outputString }; 
    }else{
        userlist = userlistrawFreeze.map((record: any) => {
          return {
            Name: record.Name,
            Profile: record.Profile.Name
          };
        });
        const summary =
          ` updated ${c.bold(userlist.length)} user, records:\n${c.yellow(columnify(userlist.splice(0,500)))}`;
    
        uxLog(this,c.green(summary));
        // Return an object to be displayed with --json
        return { orgId: this.org.getOrgId(), outputString: summary };
      }
    }
     
}