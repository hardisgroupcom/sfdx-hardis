/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as glob from "glob-promise";
import * as path from "path";
import { uxLog } from "../../../common/utils";
import * as fs from "fs-extra";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
//const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class Access extends SfdxCommand {
  public static title = "check permission access";

  public static description = "Check if elements(apex class and field) are at least in one permission set";

  public static examples = ["$ sfdx hardis:lint:access"];

  protected static flagsConfig = {
    ignore: flags.boolean({
      char: "i",
      default: false,
      description: "Ignore specific elements seperated by commas",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected folder: string;
  protected del = false;

  protected static sourceElements = [
    {
      regex: `/**/*.cls`,
      type : 'Apex classes'
    },
    {
      regex: `/**/objects/**/fields/*__c.field-meta.xml`,
      type : 'Object fields'
    }
  ];

  private permissionSet = {
    regex: `/**/permissionsets/*.permissionset-meta.xml`,
    type : 'Permission sets'
  };

  private profiles = {
    regex: `/**/profiles/*.profile-meta.xml`,
    type : 'Profiles'
  };


  public async run(): Promise<AnyJson> {
    this.folder = this.flags.folder || "./force-app";
    this.del = this.flags.delete || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Check if elements(apex class and field) are at least in one permission set`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    
    
    for(const sourceElement of Access.sourceElements) {
      const findManagedPattern = rootFolder + sourceElement['regex'];
      const matchedElements = await glob(findManagedPattern, { cwd: process.cwd() });
    
      uxLog(this, c.cyan(`-----${sourceElement['type'] }-----`));
      switch (sourceElement.type) {
        case 'Object fields':
          this.handleObjectFieldsCheck(matchedElements, rootFolder);
          break;
        
        case 'Apex classes':
          this.handleApexClassesCheck(matchedElements, rootFolder);
          break;
      
        default:
          break;
      }
    
    }

    // Return an object to be displayed with --json
    return { outputString: '' };
  }

  private formatFieldDescriptionForPermissionSet(element) {
    const fieldRoute = element.substring(element.indexOf('objects/') );
    const objectField = fieldRoute.substring(fieldRoute.indexOf('/') + 1).replace('/fields/', '.').replace('.field-meta.xml', '');

    return objectField;
  }

  

  private async handleObjectFieldsCheck(elements, rootFolder) {
    const fieldsToSearch = [];

    for(const element of elements) {
      const objectField = this.formatFieldDescriptionForPermissionSet(element);
      
      fieldsToSearch.push(objectField);
    }

    this.listElementIfNotInProfilOrPermission(rootFolder, fieldsToSearch, 'Field');
    
  }

  private async handleApexClassesCheck(elements, rootFolder) {
    const apexClassesToSearch = [];

    for(const element of elements) {

      const apexClass = element.substring(element.indexOf('classes/')).replace('classes/', '').replace('.cls', '');  
      apexClassesToSearch.push(apexClass);
    }

    this.listElementIfNotInProfilOrPermission(rootFolder, apexClassesToSearch, 'Class');
  }


  private async listElementIfNotInProfilOrPermission(rootFolder, searchTerms, prefixMessage) {

    for(const searchTerm of searchTerms) {
      //------CHECK PERMISSION SET----------------
      const permissionSetsFiles = await glob(rootFolder + this.permissionSet['regex'], { cwd: process.cwd() });
      let isIncludedInPermissionSet = false;


      for(const permissionSetFile of permissionSetsFiles) {
        const fileText = await fs.readFile(permissionSetFile, "utf8");
        const fileLines = fileText.split("\n");

        for(const line of fileLines) {
          if(line.includes(searchTerm) ) {
            isIncludedInPermissionSet = true;
          }
        }
      }

      //--------CHECK PROFILES-----------------
      const profilesFiles = await glob(rootFolder + this.profiles['regex'], { cwd: process.cwd() });
      let isIncludedInProfile = false;

      for(const profileFile of profilesFiles) {
        const fileText = await fs.readFile(profileFile, "utf8");
        const fileLines = fileText.split("\n");

        for(const line of fileLines) {
          if(line.includes(searchTerm) ) {
            isIncludedInProfile = true;
          }
        }
      }

      if( !isIncludedInPermissionSet && !isIncludedInProfile ) {
        uxLog(this, c.cyan(`${prefixMessage} ${searchTerm} is in sources but has no rights defined in Profiles of Permission sets`));
      }
    }
  }
}
