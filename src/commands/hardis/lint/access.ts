/* jscpd:ignore-start */
// External Libraries
import c from 'chalk';
import { glob } from 'glob';
import * as path from 'path';
import sortArray from 'sort-array';

// Salesforce Specific
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import fs from 'fs-extra';
import { AnyJson } from '@salesforce/ts-types';

// Common Utilities
import { isCI, uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import { parseXmlFile, writeXmlFile } from '../../../common/utils/xmlUtils.js';
import { generateCsvFile, generateReportPath } from '../../../common/utils/filesUtils.js';
import { NotifProvider, NotifSeverity } from '../../../common/notifProvider/index.js';
import { Parser } from 'xml2js';

// Config
import { getConfig } from '../../../config/index.js';
import { getBranchMarkdown, getNotificationButtons, getSeverityIcon } from '../../../common/utils/notifUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class LintAccess extends SfCommand<any> {
  public static title = 'check permission access';

  public static description = `Check if elements(apex class and field) are at least in one permission set
  
This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-missing-access/) and can output Grafana, Slack and MsTeams Notifications.
`;

  public static examples = [
    '$ sf hardis:lint:access',
    '$ sf hardis:lint:access -e "ApexClass:ClassA, CustomField:Account.CustomField"',
    '$ sf hardis:lint:access -i "PermissionSet:permissionSetA, Profile"',
  ];

  public static flags = {
    elementsignored: Flags.string({
      char: 'e',
      default: '',
      description: 'Ignore specific elements separated by commas',
    }),
    ignorerights: Flags.string({
      char: 'i',
      default: '',
      description: 'Ignore permission sets or profiles',
    }),
    folder: Flags.string({
      char: 'f',
      default: 'force-app',
      description: 'Root folder',
    }),
    outputfile: Flags.string({
      char: 'o',
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
  };

  protected static supportsUsername = true;

  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected folder: string;
  protected customSettingsNames: string[] = [];
  protected missingElements: any[] = [];
  protected missingElementsMap: any = {};
  protected outputFile;
  protected outputFilesRes: any = {};

  protected static sourceElements: any[] = [
    {
      regex: `/**/*.cls`,
      type: 'ApexClass',
      xmlField: 'apexClass',
      xmlChildren: 'classAccesses',
      xmlAccessField: 'enabled',
      ignore: {
        all: false,
        elements: [],
      },
    },
    {
      regex: `/**/objects/**/fields/*__c.field-meta.xml`,
      type: 'CustomField',
      xmlField: 'field',
      xmlChildren: 'fieldPermissions',
      xmlAccessField: 'readable',
      ignore: {
        all: false,
        elements: [],
      },
    },
  ];

  private permissionSet: any = {
    regex: `/**/permissionsets/*.permissionset-meta.xml`,
    type: 'Permission sets',
    name: 'PermissionSet',
    isIgnoredAll: false,
    elementsIgnored: [],
  };

  private profiles: any = {
    regex: `/**/profiles/*.profile-meta.xml`,
    type: 'Profiles',
    name: 'Profile',
    isIgnoredAll: false,
    elementsIgnored: [],
  };

  private static messages = {
    header: 'Check if elements(apex class and field) are at least in one permission set',
    allElementsHaveRights: 'All elements are included in at least one Permission set or Profile',
    someElementsDontHaveRights: 'Some elements are not included in at least one Permission set or Profile',
  };

  private hasElementsWithNoRights = false;

  private hasToDisplayJsonOnly = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(LintAccess);
    const config = await getConfig('user');
    this.folder = flags.folder || './force-app';
    this.hasToDisplayJsonOnly = this.argv.includes('--json');

    this.ignoreSourceElementsIfDefined(flags);
    this.ignoreRightElementsIfDefined(config, flags);

    this.customSettingsNames = (await this.listLocalCustomSettings()).map((cs) => cs.name);

    uxLog(this, c.green(LintAccess.messages.header));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);

    const elementsToCheckByType: any = { apexClass: [], field: [] };

    /* ELEMENTS TO CHECK */
    for (const sourceElement of LintAccess.sourceElements) {
      //if the type(apex class, field) is ignored we pass to the next type
      if (sourceElement.ignore.all) {
        continue;
      }

      const findManagedPattern = rootFolder + sourceElement['regex'];
      const matchedElements = await glob(findManagedPattern, { cwd: process.cwd() });

      switch (sourceElement.type) {
        case 'CustomField':
          elementsToCheckByType.field = await this.retrieveElementToCheck(
            matchedElements,
            sourceElement.xmlField,
            sourceElement.ignore.elements
          );
          break;

        case 'ApexClass':
          elementsToCheckByType.apexClass = await this.retrieveElementToCheck(
            matchedElements,
            sourceElement.xmlField,
            sourceElement.ignore.elements
          );
          break;

        default:
          break;
      }
    }

    const remainingElements = await this.listElementIfNotInProfileOrPermission(rootFolder, elementsToCheckByType);
    await this.verifyMultipleObjectsInPermissionSets(
      path.join(process.cwd(), this.folder, '**/permissionsets/*.permissionset-meta.xml')
    );

    // Write report
    await this.writeOutputFile();
    // Send notification
    await this.manageNotification(flags);
    // Prompt user if he/she wants to update a Permission set with missing elements
    await this.handleFixIssues();
    // Handle output status & exitCode
    const statusCode = this.hasElementsWithNoRights ? 1 : 0;
    if ((this.argv || []).includes('audittrail')) {
      process.exitCode = statusCode;
    }
    return { statusCode: statusCode, outputString: remainingElements };
  }

  private ignoreSourceElementsIfDefined(flags) {
    const ignoreElements = flags.elementsignored;

    for (const ignoredElement of ignoreElements.split(',')) {
      const elementTrimmed: string = ignoredElement.trim();

      //check if all elements of a type are ignored
      if (elementTrimmed === 'ApexClass') {
        LintAccess.sourceElements[0].ignore.all = true;
      } else if (elementTrimmed === 'CustomField') {
        LintAccess.sourceElements[1].ignore.all = true;
      }
      //check individual elements (ex : ApexClass:ClassB)
      else if (elementTrimmed.startsWith('ApexClass')) {
        LintAccess.sourceElements[0].ignore.elements.push(
          elementTrimmed.substring(elementTrimmed.indexOf(':') + 1).trim()
        );
      } else if (elementTrimmed.startsWith('CustomField')) {
        LintAccess.sourceElements[1].ignore.elements.push(
          elementTrimmed.substring(elementTrimmed.indexOf(':') + 1).trim()
        );
      }
    }
  }

  private ignoreRightElementsIfDefined(projectConfig, flags) {
    const ignoreElements = flags.ignorerights ? flags.ignorerights : projectConfig.linterIgnoreRightMetadataFile;
    if (!ignoreElements) {
      return;
    }

    for (const ignoredElement of ignoreElements.split(',')) {
      const elementTrimmed: string = ignoredElement.trim();

      if (elementTrimmed === this.profiles.name) {
        this.profiles.isIgnoredAll = true;
      } else if (elementTrimmed.startsWith(this.profiles.name)) {
        this.profiles.elementsIgnored.push(elementTrimmed.substring(elementTrimmed.indexOf(':') + 1).trim());
      }
      if (elementTrimmed === this.permissionSet.name) {
        this.permissionSet.isIgnoredAll = true;
      } else if (elementTrimmed.startsWith(this.permissionSet.name)) {
        this.permissionSet.elementsIgnored.push(elementTrimmed.substring(elementTrimmed.indexOf(':') + 1).trim());
      }
    }
  }

  private formatElementNameFromPath(path, type): string {
    if (type === 'field') {
      const fieldRoute = path.substring(path.indexOf('objects/'));
      const objectField = fieldRoute
        .substring(fieldRoute.indexOf('/') + 1)
        .replace('/fields/', '.')
        .replace('.field-meta.xml', '');
      return objectField;
    } else if (type === 'apexClass') {
      return path.substring(path.indexOf('classes/')).replace('classes/', '').replace('.cls', '').split('/').pop();
    }

    return '';
  }

  private async retrieveElementToCheck(elements, xmlField, excludedElements): Promise<Array<string>> {
    let fieldsToSearch: any[] = [];

    for (const element of elements) {
      // Exclude mandatory fields
      if (element.endsWith('.field-meta.xml')) {
        const fieldXml = await parseXmlFile(element);
        // Mater detail
        if (fieldXml?.CustomField?.type && fieldXml?.CustomField?.type[0] === 'MasterDetail') {
          continue;
        }
        // Required
        if (fieldXml?.CustomField?.required && fieldXml?.CustomField?.required[0] === 'true') {
          continue;
        }
        // Check Parent is not eligible to fields access
        const parentObject = element.substring(element.indexOf('objects/')).split('/')[1];
        // Custom Metadata or DataCloud
        if (parentObject.endsWith('__mdt') || parentObject.endsWith('__dll') || parentObject.endsWith('__dlm')) {
          continue;
        }
        // Custom Setting
        if (this.customSettingsNames.includes(parentObject)) {
          continue;
        }
      }

      const el = this.formatElementNameFromPath(element, xmlField);
      //only check elements not ignored
      if (!excludedElements.includes(el)) {
        fieldsToSearch.push(el);

        const otherElementsToCheck = this.ruleBasedCheckForFields(el);
        if (otherElementsToCheck.length > 0) {
          fieldsToSearch = fieldsToSearch.concat(otherElementsToCheck);
        }
      }
    }

    return fieldsToSearch;
  }

  private ruleBasedCheckForFields(el: string): Array<string> {
    const otherElementsToCheck: any[] = [];

    // Activity is the parent object of Task and Event: check also rights to avoid false positives
    if (el.startsWith('Activity.')) {
      const field = el.split('.')[1];
      otherElementsToCheck.push('Task.' + field);
      otherElementsToCheck.push('Event.' + field);
    }

    return otherElementsToCheck;
  }

  private async listElementIfNotInProfileOrPermission(rootFolder, elementsToCheckByType) {
    const profilesFiles = await glob(rootFolder + this.profiles['regex'], { cwd: process.cwd() });
    let remainingElements = elementsToCheckByType;

    //CHECK PROFILES FIRST
    if (!this.profiles.isIgnoredAll) {
      remainingElements = await this.retrieveElementsWithoutRights(
        this.profiles.name,
        profilesFiles,
        elementsToCheckByType
      );
    }
    if (this.hasRemainingElementsToCheck(remainingElements) && !this.permissionSet.isIgnoredAll) {
      const permissionSetFiles = await glob(rootFolder + this.permissionSet['regex'], { cwd: process.cwd() });
      remainingElements = await this.retrieveElementsWithoutRights(
        this.permissionSet.name,
        permissionSetFiles,
        remainingElements
      );
    }

    if (!this.hasRemainingElementsToCheck(remainingElements)) {
      uxLog(this, c.green(LintAccess.messages.allElementsHaveRights));
      return LintAccess.messages.allElementsHaveRights;
    } else {
      //list remaining elements after checking on profiles and permissions sets
      this.missingElementsMap = Object.assign({}, remainingElements);
      this.missingElements = [];
      const severityIcon = getSeverityIcon('warning');
      for (const missingType of Object.keys(this.missingElementsMap)) {
        for (const missingItem of this.missingElementsMap[missingType]) {
          this.missingElements.push({
            type: missingType,
            element: missingItem,
            severity: 'warning',
            severityIcon: severityIcon,
          });
        }
      }
      remainingElements = this.constructLogAndDisplayTable(remainingElements);
    }

    return this.hasToDisplayJsonOnly ? remainingElements : '';
  }

  private formatPathPermissionSetOrProfile(typeFile, path) {
    if (typeFile == this.profiles.name) {
      return path.substring(path.indexOf('profiles/')).replace('profiles/', '').replace('.profile-meta.xml', '');
    } else if (typeFile == this.permissionSet.name) {
      return path
        .substring(path.indexOf('permissionsets/'))
        .replace('permissionsets/', '')
        .replace('.permissionset-meta.xml', '');
    }
    return '';
  }

  private async retrieveElementsWithoutRights(typeFile, files, elementsToCheckByType) {
    const remainingElements = elementsToCheckByType;

    if (typeFile == this.profiles.name) {
      files = files.filter(
        (e) => !this.profiles.elementsIgnored.includes(this.formatPathPermissionSetOrProfile(typeFile, e))
      );
    } else if (typeFile === this.permissionSet.name) {
      files = files.filter(
        (e) => !this.permissionSet.elementsIgnored.includes(this.formatPathPermissionSetOrProfile(typeFile, e))
      );
    }

    for (const file of files) {
      const fileXml = await parseXmlFile(file);

      //checking all elements in the current type
      for (const currentType of LintAccess.sourceElements) {
        //checking if current type is at least once in the current profile or permission set
        if (!(currentType.xmlChildren in fileXml[typeFile]) || fileXml[typeFile][currentType.xmlChildren].length == 0) {
          continue;
        }

        for (const permission of fileXml[typeFile][currentType.xmlChildren]) {
          //only readable(for fields) or enabled(apex class) rights are relevant
          if (
            permission &&
            permission[currentType.xmlAccessField][0] == 'true' &&
            elementsToCheckByType[currentType.xmlField].includes(permission[currentType.xmlField][0])
          ) {
            remainingElements[currentType.xmlField] = remainingElements[currentType.xmlField].filter(
              (e) => e !== permission[currentType.xmlField][0]
            );
          }
        }
      }
      //if no remaining elements to check then we stop iterating permissionset or profile files
      if (!this.hasRemainingElementsToCheck(remainingElements)) {
        break;
      }
    }

    return remainingElements;
  }

  private hasRemainingElementsToCheck(remainingElements): boolean {
    return Object.keys(remainingElements).some((elementType) => remainingElements[elementType].length > 0);
  }

  private constructLogAndDisplayTable(remainingElements) {
    const remainingElementsTable: any[] = [];
    let counterTable = 0;

    for (const currentType of LintAccess.sourceElements) {
      for (const e of remainingElements[currentType.xmlField]) {
        if (!remainingElementsTable[counterTable]) {
          remainingElementsTable[counterTable] = {};
        }

        remainingElementsTable[counterTable]['Type'] = currentType.type;
        remainingElementsTable[counterTable]['Element'] = e;
        counterTable++;
        this.hasElementsWithNoRights = true;
      }
    }

    //we create an object to have a custom header in the table
    if (!this.hasToDisplayJsonOnly) {
      uxLog(this, c.red(LintAccess.messages.someElementsDontHaveRights));
      console.table(remainingElementsTable);
    }

    return remainingElements;
  }

  private async writeOutputFile() {
    if (this.missingElements.length === 0) {
      return;
    }
    this.outputFile = await generateReportPath('lint-access', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.missingElements, this.outputFile);
  }

  private async manageNotification(flags) {
    const branchMd = await getBranchMarkdown();
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = `No custom elements have no access defined in any Profile or Permission set in ${branchMd}`;
    let attachments: any[] = [];
    // Manage detail in case there are issues
    if (this.missingElements.length > 0) {
      notifSeverity = 'warning';
      notifText = `${this.missingElements.length} custom elements have no access defined in any Profile or Permission set in ${branchMd}`;
      let notifDetailText = ``;
      for (const missingType of Object.keys(this.missingElementsMap)) {
        if (this.missingElementsMap[missingType]?.length > 0) {
          notifDetailText += `*${missingType}*\n`;
          for (const missingItem of this.missingElementsMap[missingType]) {
            notifDetailText += `• ${missingItem}\n`;
          }
        }
      }
      attachments = [{ text: notifDetailText }];
    }

    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
      type: 'LINT_ACCESS',
      text: notifText,
      attachments: attachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.missingElements,
      data: { metric: this.missingElements.length },
      metrics: {
        ElementsWithNoProfileOrPermissionSetAccess: this.missingElements.length,
      },
    });
  }

  private async handleFixIssues() {
    if (!isCI && this.missingElements.length > 0 && this.argv.includes('--websocket')) {
      const promptUpdate = await prompts({
        type: 'confirm',
        message: c.cyanBright('Do you want to add the missing accesses in permission sets ?'),
      });
      if (promptUpdate.value === true) {
        const availablePermissionSets = await this.listLocalPermissionSets();
        const promptsElementsPs = await prompts([
          {
            type: 'multiselect',
            name: 'elements',
            message: 'Please select the elements you want to add in Permission Set(s)',
            choices: this.missingElements.map((elt) => {
              return { title: `${elt.type}: ${elt.element}`, value: elt };
            }),
          },
          {
            type: 'multiselect',
            name: 'permissionSets',
            message: 'Please select the permission sets you want to update with selected elements',
            choices: availablePermissionSets.map((elt) => {
              return { title: elt.name, value: elt.filePath };
            }),
          },
          {
            type: 'select',
            name: 'access',
            message: 'Please select the accesses to set for the custom fields',
            choices: [
              { title: 'Readable', value: 'readable' },
              { title: 'Readable & Editable', value: 'editable' },
            ],
          },
        ]);
        // Update Permission sets
        if (promptsElementsPs.elements.length > 0 && promptsElementsPs.permissionSets.length > 0) {
          await this.updatePermissionSets(
            promptsElementsPs.permissionSets,
            promptsElementsPs.elements,
            promptsElementsPs.access === 'editable'
              ? { readable: true, editable: true }
              : { readable: true, editable: false }
          );
        }
      }
    } else if (this.missingElements.length > 0) {
      uxLog(this, c.yellow('Please add missing access on permission set(s)'));
      uxLog(this, c.yellow('You can do it by running VsCode SFDX Hardis command Audit -> Detect missing permissions'));
    }
  }

  private async listLocalCustomSettings() {
    const globPatternObjects = process.cwd() + `/**/*.object-meta.xml`;
    const objectFiles = await glob(globPatternObjects);
    const csList: any[] = [];
    for (const objectFile of objectFiles) {
      const objectXml = await parseXmlFile(objectFile);
      if (objectXml?.CustomObject?.customSettingsType?.length > 0) {
        csList.push({ name: path.basename(objectFile).replace('.object-meta.xml', ''), filePath: objectFile });
      }
    }
    return csList;
  }

  private async listLocalPermissionSets() {
    const globPatternPS = process.cwd() + `/**/*.permissionset-meta.xml`;
    const psFiles = await glob(globPatternPS);
    const psList: any[] = [];
    for (const ps of psFiles) {
      psList.push({ name: path.basename(ps).replace('.permissionset-meta.xml', ''), filePath: ps });
    }
    return psList;
  }

  private async updatePermissionSets(permissionSetFiles, elements, fieldProperties) {
    for (const permissionSetFile of permissionSetFiles) {
      const psFileXml = await parseXmlFile(permissionSetFile);
      for (const element of elements) {
        // Apex class access
        if (element.type === 'apexClass') {
          const className = element.element.split('/').pop();
          let classAccesses = psFileXml.PermissionSet?.classAccesses || [];
          let updated = false;
          classAccesses = classAccesses.map((item) => {
            if (item.apexClass[0] === className) {
              item.enabled = [true];
              updated = true;
            }
            return item;
          });
          if (updated === false) {
            classAccesses.push({
              apexClass: [className],
              enabled: [true],
            });
          }
          psFileXml.PermissionSet.classAccesses = sortArray(classAccesses, {
            by: ['apexClass'],
            order: ['asc'],
          });
        }
        // Custom field permission
        else if (element.type === 'field') {
          let fieldPermissions = psFileXml.PermissionSet?.fieldPermissions || [];
          let updated = false;
          fieldPermissions = fieldPermissions.map((item) => {
            if (item.field[0] === element.element) {
              item.readable = [fieldProperties.readable];
              item.editable = [fieldProperties.editable];
              updated = true;
            }
            return item;
          });
          if (updated === false) {
            fieldPermissions.push({
              field: [element.element],
              readable: [fieldProperties.readable],
              editable: [fieldProperties.editable],
            });
          }
          psFileXml.PermissionSet.fieldPermissions = sortArray(fieldPermissions, {
            by: ['field'],
            order: ['asc'],
          });
        }
      }
      await writeXmlFile(permissionSetFile, psFileXml);
    }
    throw new SfError(c.red('Your permission sets has been updated: please CHECK THE UPDATES then commit and push !'));
  }

  private async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8');
  }

  private async parseString(xml: string): Promise<any> {
    const parser = new Parser();
    return parser.parseStringPromise(xml);
  }

  private async verifyMultipleObjectsInPermissionSets(permissionsetsDirectory: string): Promise<void> {
    const permissionFiles = await glob(permissionsetsDirectory, { cwd: process.cwd() });

    for (const permissionFile of permissionFiles) {
      const content = await this.readFile(permissionFile);
      const parsedContent = await this.parseString(content);

      if (parsedContent && parsedContent.PermissionSet && parsedContent.PermissionSet.objectPermissions) {
        const objectPermissions = parsedContent.PermissionSet.objectPermissions;
        const objectCount: { [key: string]: number } = {};

        for (const op of objectPermissions) {
          if (op.object && op.object[0]) {
            const objectName = op.object[0];
            objectCount[objectName] = (objectCount[objectName] || 0) + 1;
          }
        }

        const multipleOccurrences = Object.keys(objectCount).filter((objectName) => objectCount[objectName] > 1);
        if (multipleOccurrences.length > 0) {
          this.hasElementsWithNoRights = true;
          const permissionSetName = path.basename(permissionFile);
          for (const obj of multipleOccurrences) {
            this.missingElements.push({ type: 'MultipleObjectPermissions', element: `${obj} in ${permissionSetName}` });
            if (!this.missingElementsMap['MultipleObjectPermissions']) {
              this.missingElementsMap['MultipleObjectPermissions'] = [];
            }
            this.missingElementsMap['MultipleObjectPermissions'].push(`${obj} in ${permissionSetName}`);
          }
        }
      }
    }
  }
}
