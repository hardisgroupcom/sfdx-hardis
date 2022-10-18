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
//import { getConfig } from "../../../config";
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
    ignore: flags.string({
      char: "i",
      default: '',
      description: "Ignore specific elements seperated by commas (-i \"ApexClass:ClassA, CustomField:Account.CustomField\")",
    }),
    folder: flags.string({
      char: "f",
      default: "force-app",
      description: "Root folder",
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
      xmlChilds : 'classAccesses',
      xmlAccessField : 'enabled',
      ignore : {
        all : false,
        elements : []
      }
    },
    {
      regex: `/**/objects/**/fields/*__c.field-meta.xml`,
      type : 'Object fields',
      xmlField : 'field',
      xmlChilds : 'fieldPermissions',
      xmlAccessField : 'readable',
      ignore : {
        all : false,
        elements : []
      }
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

  private static messages = {
    header : 'Check if elements(apex class and field) are at least in one permission set',
    allElementsHaveRights : 'All elements are included in at least one Permission set or Profile',

  }

  public async run(): Promise<AnyJson> {
    //getConfig("")
    this.folder = this.flags.folder || "./force-app";

    const ignoreElements = this.flags.ignore;
    ignoreElements.split(',').forEach(ignoredElement => {
      const elementTrimed = ignoredElement.trim();

      //check if all elements of a type are ignored
      if(elementTrimed === 'ApexClass') {
        Access.sourceElements[0].ignore.all = true;
      } else if(elementTrimed === 'CustomField') {
        Access.sourceElements[1].ignore.all = true;
      }
      //check indivual elements (ex : ApexClass:ClassB)
      else if(elementTrimed.startsWith('ApexClass') ) {
        Access.sourceElements[0].ignore.elements.push(elementTrimed.substring(elementTrimed.indexOf(':') + 1).trim() );
      } else if(elementTrimed.startsWith('CustomField') ) {
        Access.sourceElements[1].ignore.elements.push(elementTrimed.substring(elementTrimed.indexOf(':') + 1).trim() );
      }
    });

    uxLog(this, c.cyan(Access.messages.header));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    
    
    const elementsToCheckByType = {apexClass : [], field: [] };

    /* ELEMENTS TO CHECK */
    for(const sourceElement of Access.sourceElements) {
      //if the type(apex class, field) is ignored we pass to the next type
      if(sourceElement.ignore.all ) {
        continue;
      }

      const findManagedPattern = rootFolder + sourceElement['regex'];
      const matchedElements = await glob(findManagedPattern, { cwd: process.cwd() });
    
      switch (sourceElement.type) {
        case 'Object fields':
          elementsToCheckByType.field = await this.retrieveElementToCheck(matchedElements, sourceElement.xmlField, sourceElement.ignore.elements);
          break;
        
        case 'Apex classes':
          elementsToCheckByType.apexClass = await this.retrieveElementToCheck(matchedElements, sourceElement.xmlField, sourceElement.ignore.elements);
          break;
      
        default:
          break;
      }
    
    }

    const remaningElements = await this.listElementIfNotInProfilOrPermission(rootFolder, elementsToCheckByType);
    return { outputString: remaningElements };
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

  private async retrieveElementToCheck(elements, xmlField, excludedElements) {
    const fieldsToSearch = [];

    for(const element of elements) {
      const el = this.formatElementNameFromPath(element, xmlField);
      
      //only check elements not ignored
      if(!excludedElements.includes(el) ) {
        fieldsToSearch.push(el);
      }
    }

    return fieldsToSearch;
  }

  private async listElementIfNotInProfilOrPermission(rootFolder, elementsToCheckByType) {
    const hasToDisplayJsonOnly = process.argv.includes("--json");
    const profilesFiles = await glob(rootFolder + this.profiles['regex'], { cwd: process.cwd() });
    
    //CHECK PROFILES FIRST
    let remaningElements = await this.retrieveElementsWithoutRights('Profile', profilesFiles, elementsToCheckByType);
    if( !this.hasRemaningElementsToCheck(remaningElements) && !hasToDisplayJsonOnly) {
      uxLog(this, Access.messages.allElementsHaveRights);
    } else {
      //THEN CHECK PERMISSION SETS
      const permissionSetFiles = await glob(rootFolder + this.permissionSet['regex'], { cwd: process.cwd() });
      remaningElements = await this.retrieveElementsWithoutRights('PermissionSet', permissionSetFiles, remaningElements);

      if( !this.hasRemaningElementsToCheck(remaningElements) && !hasToDisplayJsonOnly) {
        uxLog(this, Access.messages.allElementsHaveRights);
      } else {
        //list remaning elements after checking on profiles and permissions sets
        remaningElements.apexClass = this.constructLogAndDisplayTable(remaningElements.apexClass, "Apex class", hasToDisplayJsonOnly);
        remaningElements.field = this.constructLogAndDisplayTable(remaningElements.field, "Custom field", hasToDisplayJsonOnly);
      }
    }
    
    const json = hasToDisplayJsonOnly ? remaningElements : '';

    return json;
  }

  private async retrieveElementsWithoutRights(typeFile, files, elementsToCheckByType) {
    const remaningElements = elementsToCheckByType;

    for(const file of files) {
      const fileXml = await parseXmlFile(file);

      //checking all elements in the current type
      for(const currentType of Access.sourceElements) {
        if( !fileXml[typeFile][currentType.xmlChilds] ||  fileXml[typeFile][currentType.xmlChilds].length == 0) {
          continue;
        } 

        fileXml[typeFile][currentType.xmlChilds].forEach(permission => {
          //only readable(for fields) or enabled(apex class) rights are relevant
          if(permission[currentType.xmlAccessField][0] == 'true' && elementsToCheckByType[currentType.xmlField].includes(permission[currentType.xmlField][0]) ) {
            remaningElements[currentType.xmlField] = remaningElements[currentType.xmlField].filter(e => e !== permission[currentType.xmlField][0] );
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
    return Object.keys(remaningElements).some(elementType => remaningElements[elementType].length > 0 );
  }

  private constructLogAndDisplayTable(elements, header, hasToDisplayJsonOnly) {
    if(elements.length > 0) {
      //we create an object to have a custom header in the table
      elements = elements.map(e => { return {[header]: e} });
      if(!hasToDisplayJsonOnly) {
        console.table(elements);
      }
    }
    return elements;
  }
}
