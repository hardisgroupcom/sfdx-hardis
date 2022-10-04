/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as glob from "glob-promise";
import * as path from "path";
import { uxLog } from "../../../common/utils";
//import * as fs from "fs-extra";
import { parseXmlFile } from "../../../common/utils/xmlUtils";

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

  protected static sourceElements = [
    {
      regex: `/**/*.cls`,
      type : 'Apex classes',
      xmlField : 'apexClass',
      xmlChilds : 'classAccesses'
    },
    {
      regex: `/**/objects/**/fields/*__c.field-meta.xml`,
      type : 'Object fields',
      xmlField : 'field',
      xmlChilds : 'fieldPermissions'
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

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Check if elements(apex class and field) are at least in one permission set`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    
    
    const elementsToCheckByType = {apexClass : [], field: [] };

    /* ELEMENTS TO CHECK */
    for(const sourceElement of Access.sourceElements) {
      const findManagedPattern = rootFolder + sourceElement['regex'];
      const matchedElements = await glob(findManagedPattern, { cwd: process.cwd() });
    
      switch (sourceElement.type) {
        case 'Object fields':
          elementsToCheckByType.field = await this.retrieveElementToCheck(matchedElements, sourceElement.xmlField);
          break;
        
        case 'Apex classes':
          elementsToCheckByType.apexClass = await this.retrieveElementToCheck(matchedElements, sourceElement.xmlField);
          break;
      
        default:
          break;
      }
    
    }

    uxLog(this, '-------------' );
    uxLog(this, '----BEFORE CHECK----' );
    uxLog(this, '-------------' );
    uxLog(this, '----FIELDS----' );
    uxLog(this, JSON.stringify(elementsToCheckByType.field) );
    uxLog(this, '----APEX CLASSES----' );
    uxLog(this, JSON.stringify(elementsToCheckByType.apexClass) );
    uxLog(this, '-------------' );
    uxLog(this, '----AFTER CHECK----' );
    uxLog(this, '-------------' );
    await this.listElementIfNotInProfilOrPermission(rootFolder, elementsToCheckByType);

    // Return an object to be displayed with --json
    return { outputString: '' };
  }

  private formatElementNameFromPath(path, type) {

    if(type === 'field') {
      const fieldRoute = path.substring(path.indexOf('objects/') );
      const objectField = fieldRoute.substring(fieldRoute.indexOf('/') + 1).replace('/fields/', '.').replace('.field-meta.xml', '');
      return objectField;
    } else if(type === 'apexClass') {
      return path.substring(path.indexOf('classes/')).replace('classes/', '').replace('.cls', '');
    }


    return '';
  }

  private async retrieveElementToCheck(elements, xmlField) {
    const fieldsToSearch = [];

    for(const element of elements) {
      const el = this.formatElementNameFromPath(element, xmlField);
      fieldsToSearch.push(el);
    }

    return fieldsToSearch;
  }

  private async listElementIfNotInProfilOrPermission(rootFolder, elementsToCheckByType) {

    const profilesFiles = await glob(rootFolder + this.profiles['regex'], { cwd: process.cwd() });
    
    let remaningElements = await this.retrieveNonAssignedRights('Profile', profilesFiles, elementsToCheckByType);
    if( !this.hasRemaningElementsToCheck(remaningElements) ) {
      uxLog(this, 'All elements are included in at least one Permission set or Profile' );
    } else {
      const permissionSetFiles = await glob(rootFolder + this.permissionSet['regex'], { cwd: process.cwd() });
      remaningElements = await this.retrieveNonAssignedRights('PermissionSet', permissionSetFiles, remaningElements);

      if( !this.hasRemaningElementsToCheck(remaningElements) ) {
        uxLog(this, 'All elements are included in at least one Permission set or Profile' );
      } else {
        //list remaning elements after checking on profiles and permissions sets
        uxLog(this, '----CLASSES---' );
        uxLog(this, JSON.stringify(remaningElements.apexClass) );
        uxLog(this, '----FIELDS---' );
        uxLog(this, JSON.stringify(remaningElements.field) );
      }
    }    
  }

  private async retrieveNonAssignedRights(typeFile, files, elementsToCheckByType) {
    const remaningElements = elementsToCheckByType;

    for(const file of files) {
      const fileXml = await parseXmlFile(file);

      for(const element of Access.sourceElements) {
        const xmlChilds = element.xmlChilds;
        const xmlField = element.xmlField;

        //if file doesn't include xml child pass to next element
        if( !fileXml[typeFile][xmlChilds] ||  fileXml[typeFile][xmlChilds].length == 0) {
          continue;
        } 

        fileXml[typeFile][xmlChilds].forEach(permission => {
          if(elementsToCheckByType[xmlField].includes(permission[xmlField][0]) ) {
            remaningElements[xmlField] = remaningElements[xmlField].filter(e => e !== permission[xmlField][0]);
          }
        });

      }

      //if no remaning elements to check then we stop iterating permissionset or profile files
      if(!this.hasRemaningElementsToCheck(remaningElements) ) {
        break;
      }
    }

    return remaningElements;
  }

  private hasRemaningElementsToCheck(remaningElements) {
    let mustContinue = false;
    Object.keys(remaningElements).forEach(elementType => {
      if(remaningElements[elementType].length > 0) {
        mustContinue = true;
      }
    });

    return mustContinue;
  }

}
