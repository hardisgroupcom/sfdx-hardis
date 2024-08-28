/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import { createTempDir, execCommand, isCI, removeObjectPropertyLists, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import {
  parsePackageXmlFile,
  parseXmlFile,
  writePackageXmlFile,
  writeXmlFile,
} from '../../../../common/utils/xmlUtils.js';
import { getConfig, setConfig } from '../../../../config/index.js';
import { PACKAGE_ROOT_DIR } from '../../../../settings.js';
import { FilterXmlContent } from './filter-xml-content.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-template-sf-external', 'org');

export default class CleanReferences extends SfCommand<any> {
  public static title = 'Clean references in dx sources';

  public static description = 'Remove unwanted references within sfdx project sources';

  public static examples = [
    '$ sf hardis:project:clean:references',
    '$ sf hardis:project:clean:references --type all',
    '$ sf hardis:project:clean:references --config ./cleaning/myconfig.json',
    '$ sf hardis:project:clean:references --config ./somefolder/myDestructivePackage.xml',
  ];

  // public static args = [{name: 'file'}];

  public static flags = {
    type: Flags.string({
      char: 't',
      description: 'Cleaning type',
      options: [
        'all',
        'caseentitlement',
        'dashboards',
        'datadotcom',
        'destructivechanges',
        'localfields',
        'productrequest',
        'entitlement',
      ],
    }),
    config: Flags.string({
      char: 'c',
      description: 'Path to a JSON config file or a destructiveChanges.xml file',
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

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;
  /* jscpd:ignore-end */

  protected debugMode = false;
  protected cleaningTypes: any[] = [];
  protected allCleaningTypes = [
    {
      value: 'checkPermissions',
      title: 'Check custom items are existing it at least one Permission Set',
      command: 'sf hardis:lint:access',
    },
    {
      value: 'dashboards',
      title: 'Dashboards: Remove reference to hardcoded users',
    },
    {
      value: 'destructivechanges',
      title: 'DestructiveChanges.xml: Remove source files mentioned in destructiveChanges.xml',
    },
    {
      value: 'flowPositions',
      title: `Flows: Replace all positions in AutoLayout Flows by 0 to simplify conflicts management`,
      command: 'sf hardis:project:clean:flowpositions',
    },
    {
      value: 'listViewsMine',
      title: `ListViews: Convert scope "Everything" into scope "Mine" on ListViews`,
      command: 'sf hardis:project:clean:listviews',
    },
    {
      value: 'minimizeProfiles',
      title: 'Profiles: Remove profile attributes that exists on permission sets',
      command: 'sf hardis:project:clean:minimizeprofiles',
    },
    {
      value: 'caseentitlement',
      title: 'References to Entitlement Management items',
    },
    {
      value: 'datadotcom',
      title: 'References to Data.com items. https://help.salesforce.com/articleView?id=000320795&type=1&mode=1',
    },
    {
      value: 'entitlement',
      title: 'References to Entitlement object',
    },
    {
      value: 'localfields',
      title:
        'References to Local Fields items. https://help.salesforce.com/articleView?id=sf.admin_local_name_fields.htm&type=5',
    },
    {
      value: 'productrequest',
      title: 'References to ProductRequest object',
    },
    {
      value: 'systemDebug',
      title: 'Remove System.debug from sources',
      command: 'sf hardis:project:clean:systemdebug',
    },
    {
      value: 'v60',
      title: 'Make metadata compliant with v60',
    },
  ];

  protected configFile: string | null;
  protected deleteItems: any = {};

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanReferences);
    this.debugMode = flags.debug || false;
    this.cleaningTypes = flags.type ? [flags.type] : [];
    this.configFile = flags.config || null;
    const config = await getConfig('project');

    // Config file sent by user
    if (this.configFile != null) {
      this.cleaningTypes = [this.configFile.trim()];
    } else {
      // Read list of cleanings to perform in references
      if (this.cleaningTypes.length > 0 && this.cleaningTypes[0] === 'all') {
        this.cleaningTypes = config.autoCleanTypes || [];
      }

      // Prompt user cleanings to perform
      if (!isCI && this.cleaningTypes.length === 0) {
        const typesResponse = await prompts({
          type: 'multiselect',
          name: 'value',
          message: c.cyanBright('What references do you want to clean from your SFDX project sources ?'),
          choices: this.allCleaningTypes,
        });
        this.cleaningTypes = typesResponse.value;
      }
    }

    // Prompt user to save choice in configuration
    const autoCleanTypes = config.autoCleanTypes || [];
    const toAdd = this.cleaningTypes.filter((type) => !autoCleanTypes.includes(type));
    if (toAdd.length > 0 && !isCI && flags.type !== 'all') {
      const saveResponse = await prompts({
        type: 'confirm',
        name: 'value',
        default: true,
        message: c.cyanBright(
          'Do you want to save this action in your project configuration, so it is executed at each Work Save ?'
        ),
      });
      if (saveResponse.value === true) {
        autoCleanTypes.push(...this.cleaningTypes);
        await setConfig('project', {
          autoCleanTypes: [...new Set(autoCleanTypes)],
        });
      }
    }

    // Process cleaning
    for (const cleaningType of this.cleaningTypes) {
      const cleaningTypeObj = this.allCleaningTypes.filter(
        (cleaningTypeObj) => cleaningTypeObj.value === cleaningType
      )[0];
      if (cleaningTypeObj?.command) {
        let command = cleaningTypeObj?.command;
        if (this.argv.indexOf('--websocket') > -1) {
          command += ` --websocket ${this.argv[this.argv.indexOf('--websocket') + 1]}`;
        }
        uxLog(this, c.cyan(`Run cleaning command ${c.bold(cleaningType)} (${cleaningTypeObj.title}) ...`));
        // Command based cleaning
        await execCommand(command, this, {
          fail: true,
          output: true,
          debug: this.debugMode,
        });
      } else {
        // Template based cleaning
        uxLog(this, c.cyan(`Apply cleaning of references to ${c.bold(cleaningType)} (${cleaningTypeObj.title})...`));
        const filterConfigFile = await this.getFilterConfigFile(cleaningType);
        const packageDirectories = this.project?.getPackageDirectories() || [];
        for (const packageDirectory of packageDirectories) {
          await FilterXmlContent.run(
            ['-c', filterConfigFile, '--inputfolder', packageDirectory.path, '--outputfolder', packageDirectory.path],
            this.config
          );
        }
      }
    }

    // Clean package.xml file from deleted items
    uxLog(this, c.grey(`Cleaning package.xml files...`));
    const patternPackageXml = '**/manifest/**/package*.xml';
    const packageXmlFiles = await glob(patternPackageXml, {
      cwd: process.cwd(),
    });
    for (const packageXmlFile of packageXmlFiles) {
      const packageXmlContent = await parsePackageXmlFile(packageXmlFile);
      const packageXmlContentStr = JSON.stringify(packageXmlContent);
      const newPackageXmlContent = removeObjectPropertyLists(packageXmlContent, this.deleteItems);
      if (packageXmlContentStr !== JSON.stringify(newPackageXmlContent)) {
        await writePackageXmlFile(packageXmlFile, newPackageXmlContent);
        uxLog(this, c.grey('-- cleaned elements from ' + packageXmlFile));
      }
    }

    // Delete files when necessary (in parallel)
    uxLog(this, c.grey(`Removing obsolete files...`));
    await Promise.all(
      Object.keys(this.deleteItems).map(async (type) => {
        await this.manageDeleteRelatedFiles(type);
      })
    );

    uxLog(this, c.green(`Cleaning complete`));
    // Return an object to be displayed with --json
    return { outputString: 'Cleaned references from sfdx project' };
  }

  private async getFilterConfigFile(cleaningType) {
    const templateFile = path.join(path.join(PACKAGE_ROOT_DIR, 'defaults/clean', 'template.txt'));
    // Read and complete cleaning template
    let templateContent = await fs.readFile(templateFile, 'utf8');
    if (cleaningType === 'destructivechanges' || cleaningType.endsWith('.xml')) {
      // destructive changes file
      const destructiveChangesFile = cleaningType.endsWith('.xml') ? cleaningType : './manifest/destructiveChanges.xml';
      const destructiveChanges = await parseXmlFile(destructiveChangesFile);
      for (const type of destructiveChanges.Package.types || []) {
        const members = type.members;
        templateContent = templateContent.replace(
          new RegExp(`{{ ${type.name[0]} }}`, 'g'),
          JSON.stringify(members, null, 2)
        );
        this.deleteItems[type.name[0]] = (this.deleteItems[type.name[0]] || []).concat(members);
      }
    } else {
      // Predefined destructive items file
      const filterConfigFileConfigPath = cleaningType.endsWith('.json')
        ? cleaningType
        : path.join(path.join(PACKAGE_ROOT_DIR, 'defaults/clean', cleaningType + '.json'));
      const filterConfigFileConfig = JSON.parse(await fs.readFile(filterConfigFileConfigPath, 'utf8'));
      for (const type of Object.keys(filterConfigFileConfig.items)) {
        templateContent = templateContent.replace(
          new RegExp(`{{ ${type} }}`, 'g'),
          JSON.stringify(filterConfigFileConfig.items[type], null, 2)
        );
        this.deleteItems[type] = (this.deleteItems[type] || []).concat(filterConfigFileConfig.items[type]);
      }
    }
    // Create temporary file
    templateContent = templateContent.replace(/{{ .* }}/gm, '[]');
    const tmpCleanFileName =
      cleaningType.endsWith('.xml') || cleaningType.endsWith('.json') ? path.basename(cleaningType) : cleaningType;
    const filterConfigFile = path.join(await createTempDir(), `clean_${tmpCleanFileName}.json`);
    await fs.writeFile(filterConfigFile, templateContent);
    return filterConfigFile;
  }

  private async manageDeleteRelatedFiles(type) {
    // Custom fields
    if (type === 'CustomField') {
      for (const field of this.deleteItems[type] || []) {
        await this.manageDeleteCustomFieldRelatedFiles(field);
      }
    }
  }

  private async manageDeleteCustomFieldRelatedFiles(field: string) {
    // Remove custom field and customTranslation
    const [obj, fld] = field.split('.');
    const patternField = `force-app/**/objects/${obj}/fields/${fld}.field-meta.xml`;
    const patternTranslation = `force-app/**/objectTranslations/${obj}-*/${fld}.fieldTranslation-meta.xml`;
    for (const pattern of [patternField, patternTranslation]) {
      const matchFiles = await glob(pattern, { cwd: process.cwd() });
      for (const removeFile of matchFiles) {
        await fs.remove(removeFile);
        uxLog(this, c.grey(`Removed file ${removeFile}`));
      }
    }
    // Remove field in recordTypes
    const patternRecordType = `/force-app/**/objects/${obj}/recordTypes/*.recordType-meta.xml`;
    const matchFilesPattern = await glob(patternRecordType, {
      cwd: process.cwd(),
    });
    for (const recordTypeFile of matchFilesPattern) {
      const recordType = await parseXmlFile(recordTypeFile);
      if (recordType?.RecordType.picklistValues) {
        const updatedPicklistValues = recordType.RecordType.picklistValues.filter((picklistValue) => {
          return picklistValue?.picklist[0] !== fld;
        });
        if (updatedPicklistValues.length !== recordType.RecordType.picklistValues.length) {
          recordType.RecordType.picklistValues = updatedPicklistValues;
          await writeXmlFile(recordTypeFile, recordType);
          uxLog(this, c.grey(`Cleaned file ${recordTypeFile} from ${obj}.${fld}`));
        }
      }
    }
  }
}
