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
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CleanReferences extends SfCommand<any> {
  public static title = 'Clean references in dx sources';

  public static description = `
## Command Behavior

**Removes unwanted references and cleans up metadata within your Salesforce DX project sources.**

This command provides a powerful way to maintain a clean and efficient Salesforce codebase by eliminating unnecessary or problematic metadata. It supports various cleaning types, from removing hardcoded user references in dashboards to minimizing profile attributes.

Key functionalities include:

- **Configurable Cleaning Types:** You can specify a particular cleaning type (e.g., 
- **JSON/XML Configuration:** Cleaning operations can be driven by a JSON configuration file or a 
- **Interactive Selection:** If no cleaning type is specified, the command interactively prompts you to select which references to clean.
- **Persistent Configuration:** You can choose to save your cleaning selections in your project's configuration (\`.sfdx-hardis.yml\`) so they are automatically applied during future Work Save operations.
- **File Deletion:** Beyond just cleaning XML content, it can also delete related files (e.g., custom field files and their translations when a custom field is marked for deletion).

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:clean:references --agent --type all
\`\`\`

In agent mode:

- The interactive prompt to select cleaning types is skipped. You must provide \`--type\` or \`--config\`, otherwise the configured \`autoCleanTypes\` are used.
- The prompt to save cleaning selections to permanent configuration is skipped.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves several steps:

- **Configuration Loading:** It reads the project's configuration to determine default cleaning types and user preferences.
- **Cleaning Type Processing:** For each selected cleaning type, it either executes a dedicated sub-command (e.g., 
- **XML Filtering:** For template-based cleanings, it constructs a temporary JSON configuration file based on predefined templates or user-provided 
- **Package.xml Cleanup:** It iterates through 
- **Object Property Removal:** The 
</details>
`;

  public static examples = [
    '$ sf hardis:project:clean:references',
    '$ sf hardis:project:clean:references --type all',
    '$ sf hardis:project:clean:references --config ./cleaning/myconfig.json',
    '$ sf hardis:project:clean:references --config ./somefolder/myDestructivePackage.xml',
    '$ sf hardis:project:clean:references --agent --type all',
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
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
        'flowPositions',
        'sensitiveMetadatas',
        'minimizeProfiles'
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
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
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
      title: t('cleaningTypeCheckPermissions'),
      command: 'sf hardis:lint:access',
    },
    {
      value: 'dashboards',
      title: t('cleaningTypeDashboards'),
    },
    {
      value: 'destructivechanges',
      title: t('cleaningTypeDestructiveChanges'),
    },
    {
      value: 'flowPositions',
      title: t('cleaningTypeFlowPositions'),
      command: 'sf hardis:project:clean:flowpositions',
    },
    {
      value: 'sensitiveMetadatas',
      title: t('cleaningTypeSensitiveMetadatas'),
      command: 'sf hardis:project:clean:sensitive-metadatas',
    },
    {
      value: 'listViewsMine',
      title: t('cleaningTypeListViewsMine'),
      command: 'sf hardis:project:clean:listviews',
    },
    {
      value: 'minimizeProfiles',
      title: t('cleaningTypeMinimizeProfiles'),
      command: 'sf hardis:project:clean:minimizeprofiles',
    },
    {
      value: 'caseentitlement',
      title: t('cleaningTypeCaseEntitlement'),
    },
    {
      value: 'datadotcom',
      title: t('cleaningTypeDataDotCom'),
    },
    {
      value: 'entitlement',
      title: t('cleaningTypeEntitlement'),
    },
    {
      value: 'localfields',
      title: t('cleaningTypeLocalFields'),
    },
    {
      value: 'productrequest',
      title: t('cleaningTypeProductRequest'),
    },
    {
      value: 'systemDebug',
      title: t('cleaningTypeSystemDebug'),
      command: 'sf hardis:project:clean:systemdebug',
    },
    {
      value: 'v60',
      title: t('cleaningTypeV60'),
    },
  ];

  protected configFile: string | null;
  protected deleteItems: any = {};

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanReferences);
    const agentMode = flags.agent === true;
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
      if (!isCI && !agentMode && this.cleaningTypes.length === 0) {
        const typesResponse = await prompts({
          type: 'multiselect',
          name: 'value',
          message: c.cyanBright(t('whatReferencesDoYouWantToClean')),
          description: t('selectWhichTypesOfReferenceCleaning'),
          choices: this.allCleaningTypes,
        });
        this.cleaningTypes = typesResponse.value;
      }
    }

    // Prompt user to save choice in configuration
    const autoCleanTypes = config.autoCleanTypes || [];
    const toAdd = this.cleaningTypes.filter((type) => !autoCleanTypes.includes(type));
    if (toAdd.length > 0 && !isCI && !agentMode && flags.type !== 'all') {
      const saveResponse = await prompts({
        type: 'confirm',
        name: 'value',
        default: true,
        message: c.cyanBright(t('doYouWantToSaveCleaningAction')),
        description: t('chooseSaveCleaningTypesFutureWorkSaves'),
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
        uxLog("action", this, c.cyan(t('runCleaningCommand', { cleaningType: c.bold(cleaningType), cleaningTypeObj: cleaningTypeObj.title })));
        // Command based cleaning
        await execCommand(command, this, {
          fail: true,
          output: true,
          debug: this.debugMode,
        });
      } else {
        // Template based cleaning
        uxLog("action", this, c.cyan(t('applyCleaningOfReferencesTo', { cleaningType: c.bold(cleaningType), cleaningTypeObj: cleaningTypeObj.title })));
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
    uxLog("log", this, c.grey(`Cleaning package.xml & files from deleted items...`));
    const patternPackageXml = '**/manifest/**/package*.xml';
    const packageXmlFiles = await glob(patternPackageXml, {
      cwd: process.cwd(),
      ignore: GLOB_IGNORE_PATTERNS
    });
    for (const packageXmlFile of packageXmlFiles) {
      const packageXmlContent = await parsePackageXmlFile(packageXmlFile);
      const packageXmlContentStr = JSON.stringify(packageXmlContent);
      const newPackageXmlContent = removeObjectPropertyLists(packageXmlContent, this.deleteItems);
      if (packageXmlContentStr !== JSON.stringify(newPackageXmlContent)) {
        await writePackageXmlFile(packageXmlFile, newPackageXmlContent);
        uxLog("log", this, c.grey('-- cleaned elements from ' + packageXmlFile));
      }
    }

    // Delete files when necessary (in parallel)
    uxLog("log", this, c.grey(`Removing obsolete files...`));
    await Promise.all(
      Object.keys(this.deleteItems).map(async (type) => {
        await this.manageDeleteRelatedFiles(type);
      })
    );

    uxLog("success", this, c.green(t('cleaningComplete')));
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
    const patternField = `**/objects/${obj}/fields/${fld}.field-meta.xml`;
    const patternTranslation = `**/objectTranslations/${obj}-*/${fld}.fieldTranslation-meta.xml`;
    for (const pattern of [patternField, patternTranslation]) {
      const matchFiles = await glob(pattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS });
      for (const removeFile of matchFiles) {
        await fs.remove(removeFile);
        uxLog("log", this, c.grey(t('removedFile', { removeFile })));
      }
    }
    // Remove field in recordTypes
    const patternRecordType = `**/objects/${obj}/recordTypes/*.recordType-meta.xml`;
    const matchFilesPattern = await glob(patternRecordType, {
      cwd: process.cwd(),
      ignore: GLOB_IGNORE_PATTERNS
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
          uxLog("log", this, c.grey(t('cleanedFileFrom', { recordTypeFile, obj, fld })));
        }
      }
    }
  }
}