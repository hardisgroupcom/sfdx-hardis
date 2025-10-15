import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import c from "chalk";
import * as path from "path";
import fs from "fs-extra";
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { isCI, uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { parseStringPromise, Builder } from 'xml2js';
import { GLOB_IGNORE_PATTERNS } from '../../../common/utils/projectUtils.js';
import { glob } from 'glob';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CustomLabelTranslations extends SfCommand<any> {
  public static title = 'Custom Label Translations';

  public static description = `
## Command Behavior

**Extracts selected custom labels, or all custom labels used within a given Lightning Web Component (LWC), from all available language translation files in the project.**

This command streamlines the process of managing and isolating specific custom label translations. It's particularly useful for:

- **Localization Management:** Focusing on translations for a subset of labels or for labels relevant to a specific UI component.
- **Collaboration:** Sharing only the necessary translation files with translators, reducing complexity.
- **Debugging:** Isolating translation issues for specific labels or components.

Key functionalities:

- **Label Selection:** You can specify custom label names directly using the \`--label\` flag (comma-separated).
- **LWC-based Extraction:** Alternatively, you can provide an LWC developer name using the \`--lwc\` flag, and the command will automatically identify and extract all custom labels referenced within that LWC's JavaScript files.
- **Interactive Prompts:** If neither \`--label\` nor \`--lwc\` is provided, the command will interactively prompt you to choose between selecting specific labels or extracting from an LWC.
- **Output Generation:** For each language found in your project's \`translations\` folder, it generates a new \`.translation-meta.xml\` file containing only the extracted custom labels and their translations. These files are placed in a timestamped output directory.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** It uses \`glob\` to find all \`*.translation-meta.xml\` files in the \`**/translations/\` directory and, if an LWC is specified, it searches for the LWC's JavaScript files (\`**/lwc/**/*.js\`).
- **LWC Label Extraction:** The \`extractLabelsFromLwc\` function uses regular expressions (\`@salesforce/label/c.([a-zA-Z0-9_]+)\`) to parse LWC JavaScript files and identify referenced custom labels.
- **XML Parsing and Building:** It uses \`xml2js\` (\`parseStringPromise\` and \`Builder\`) to:
  - Read and parse existing \`.translation-meta.xml\` files.
  - Filter the \`customLabels\` array to include only the requested labels.
  - Construct a new XML structure containing only the filtered labels.
  - Build a new XML string with proper formatting and write it to a new file.
- **Interactive Prompts:** The \`prompts\` library is used extensively to guide the user through the selection of extraction methods (labels or LWC) and specific labels/components.
- **File System Operations:** It uses \`fs-extra\` for creating output directories (\`extracted-translations/\`) and writing the generated translation files.
- **WebSocket Communication:** It uses \`WebSocketClient.requestOpenFile\` to open the output directory in VS Code for easy access to the generated files.
</details>
`;

  public static examples = [
    '$ sf hardis:misc:custom-label-translations --label CustomLabelName',
    '$ sf hardis:misc:custom-label-translations --label Label1,Label2',
    '$ sf hardis:misc:custom-label-translations --lwc MyComponent'
  ];

  private outputDirPrefix = 'extract-';

  public static flags: any = {
    label: Flags.string({
      char: 'l',
      description: 'Developer name(s) of the custom label(s), comma-separated',
    }),
    lwc: Flags.string({
      char: 'c',
      description: 'Developer name of the Lightning Web Component',
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

  /**
   * Extract custom label names from LWC JS files
   */
  private async extractLabelsFromLwc(lwcName: string, debugMode: boolean): Promise<string[]> {
    uxLog("log", this, c.grey(`Looking for LWC '${lwcName}' JS files...`));

    const lwcFiles = await glob(`**/lwc/${lwcName}/**/*.js`);

    if (lwcFiles.length === 0) {
      throw new Error(`No JS files found for LWC '${lwcName}'`);
    }

    uxLog("log", this, c.grey(`Found ${lwcFiles.length} JS files for component '${lwcName}'.`));

    const labelNames = new Set<string>();
    const labelImportRegex = /@salesforce\/label\/c\.([a-zA-Z0-9_]+)/g;

    for (const jsFile of lwcFiles) {
      const content = await fs.readFile(jsFile, 'utf8');

      let match;
      while ((match = labelImportRegex.exec(content)) !== null) {
        labelNames.add(match[1]);
      }

      if (debugMode) {
        uxLog("log", this, c.grey(`Processed file: ${jsFile}`));
      }
    }

    const extractedLabels = Array.from(labelNames);

    if (extractedLabels.length === 0) {
      throw new Error(`No custom labels found in LWC '${lwcName}'`);
    }

    uxLog("log", this, c.grey(`Found ${extractedLabels.length} custom labels in LWC '${lwcName}': ${extractedLabels.join(', ')}`));
    this.outputDirPrefix = lwcName;

    return extractedLabels;
  }

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CustomLabelTranslations);
    const debugMode = flags.debug || false;

    let labelNames: string[] = [];

    if (flags.lwc) {
      try {
        labelNames = await this.extractLabelsFromLwc(flags.lwc, debugMode);
      } catch (error: any) {
        uxLog("error", this, c.red(error.message));
        return { success: false, message: error.message };
      }
    } else if (flags.label) {
      labelNames = flags.label.split(',').map(label => label.trim());
    } else if (!isCI) {
      const selection = await CustomLabelTranslations.promptExtractionMethod();
      if (selection.type == 'labels') {
        labelNames = selection.values;
      } else if (selection.type == 'lwc') {
        labelNames = await this.extractLabelsFromLwc(selection.values, debugMode);
      }
    }

    if (!labelNames || labelNames.length === 0) {
      const errorMsg = 'No custom labels specified. Use --label or --lwc flag.';
      uxLog("error", this, c.red(errorMsg));
      return { success: false, message: errorMsg };
    }

    uxLog("log", this, c.grey(`Processing custom labels: ${labelNames.join(', ')}`));

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputDir = path.join('extracted-translations', `${this.outputDirPrefix}-${timestamp}`);
      await fs.ensureDir(outputDir);

      const translationFiles = await glob('**/translations/*.translation-meta.xml');

      if (translationFiles.length === 0) {
        uxLog("warning", this, c.yellow(`No translation files found in **/translations/.`));
        return { success: false, message: 'No translation files found' };
      }

      const results = {};

      for (const translationFile of translationFiles) {
        const languageCode = path.basename(translationFile).replace('.translation-meta.xml', '');
        uxLog("log", this, c.grey(`Processing translation file for ${languageCode}...`));

        const xmlContent = await fs.readFile(translationFile, 'utf8');

        const parsedXml = await parseStringPromise(xmlContent, { explicitArray: false });

        if (!parsedXml.Translations) {
          uxLog("warning", this, c.yellow(`Invalid translation file format: ${translationFile}.`));
          continue;
        }

        if (!parsedXml.Translations.customLabels) {
          uxLog("warning", this, c.yellow(`No custom labels found in ${translationFile}.`));
          continue;
        }

        const customLabels = Array.isArray(parsedXml.Translations.customLabels)
          ? parsedXml.Translations.customLabels
          : [parsedXml.Translations.customLabels];

        const matchedLabels = customLabels.filter(label =>
          labelNames.includes(label.name)
        );

        if (matchedLabels.length === 0) {
          uxLog("warning", this, c.yellow(`No matching custom labels found in ${languageCode}.`));
          continue;
        }

        const newXml = {
          Translations: {
            $: { xmlns: "http://soap.sforce.com/2006/04/metadata" },
            customLabels: matchedLabels
          }
        };

        const builder = new Builder({
          xmldec: { version: '1.0', encoding: 'UTF-8' },
          renderOpts: { pretty: true, indent: '    ', newline: '\n' }
        });
        const outputXml = builder.buildObject(newXml);

        const outputFile = path.join(outputDir, `${languageCode}.translation-meta.xml`);

        await fs.writeFile(outputFile, outputXml);

        results[languageCode] = {
          file: outputFile,
          matchedLabels: matchedLabels.length
        };

        if (debugMode) {
          uxLog("log", this, c.grey(`Found ${matchedLabels.length} labels in ${languageCode}:`));
          matchedLabels.forEach(label => {
            uxLog("log", this, c.grey(`  ${label.name} = "${label.label}"`));
          });
        }
      }

      const totalFiles = Object.keys(results).length;

      if (totalFiles === 0) {
        uxLog("warning", this, c.yellow('No matching labels found in any translation file.'));
        return { success: false, message: 'No matching labels found' };
      }

      uxLog("success", this, c.green(`Successfully extracted custom labels to ${outputDir}.`));
      uxLog("log", this, c.grey(`Processed ${totalFiles} translation files.`));

      WebSocketClient.requestOpenFile(outputDir);

      // Return an object to be displayed with --json
      return {
        success: true,
        outputDirectory: outputDir,
        results: results
      };

    } catch (err: any) {
      uxLog("error", this, c.red(`Error processing custom labels: ${err.message}`));
      throw err;
    }
  }

  public static async promptCustomLabels() {
    try {
      const customLabelsFiles = await glob('**/labels/CustomLabels.labels-meta.xml', { ignore: GLOB_IGNORE_PATTERNS });
      if (customLabelsFiles.length == 0) {
        throw new Error('No CustomLabels.labels-meta.xml was found');
      }

      const choices: any = [];

      for (const customLabelsFile of customLabelsFiles) {
        const xmlContent = await fs.readFile(customLabelsFile, 'utf8');
        const parsedXml = await parseStringPromise(xmlContent);

        if (!parsedXml.CustomLabels || !parsedXml.CustomLabels.labels) {
          throw new Error('No custom labels found in the file');
        }

        const labels = Array.isArray(parsedXml.CustomLabels.labels)
          ? parsedXml.CustomLabels.labels
          : [parsedXml.CustomLabels.labels];

        labels.sort((a, b) => {
          const nameA = a.fullName ? a.fullName[0] : a.name ? a.name[0] : '';
          const nameB = b.fullName ? b.fullName[0] : b.name ? b.name[0] : '';
          return nameA.localeCompare(nameB, 'en', { sensitivity: 'base' });
        });

        labels.map(label => {
          const name = label.fullName ? label.fullName[0] : label.name ? label.name[0] : '';
          const value = label.value ? label.value[0] : '';
          const shortDesc = value.length > 40 ? value.substring(0, 40) + '...' : value;

          choices.push({
            value: name,
            title: name,
            description: shortDesc
          });
        });
      }

      const labelSelectRes = await prompts({
        type: 'multiselect',
        message: 'Please select the Custom Labels you want to extract from translations',
        description: 'Choose which custom labels to include in the translation extraction',
        choices: choices
      });

      return labelSelectRes.value;

    } catch (err: any) {
      console.error('Error while processing custom labels:', err.message);
      throw err;
    }
  }

  public static async promptLwcComponent() {
    try {
      const lwcMetaFiles = await glob('**/lwc/*/*.js-meta.xml');

      if (lwcMetaFiles.length === 0) {
        throw new Error('No Lightning Web Components found in the project');
      }

      const componentsInfo: Array<any> = [];
      for (const metaFile of lwcMetaFiles) {
        try {
          const xmlContent = await fs.readFile(metaFile, 'utf8');
          const parsedXml = await parseStringPromise(xmlContent);

          const pathParts = metaFile.split('/');
          const componentName = pathParts[pathParts.length - 1].replace('.js-meta.xml', '');

          let masterLabel = componentName;

          if (parsedXml.LightningComponentBundle &&
            parsedXml.LightningComponentBundle.masterLabel &&
            parsedXml.LightningComponentBundle.masterLabel.length > 0) {
            masterLabel = parsedXml.LightningComponentBundle.masterLabel[0];
          }

          componentsInfo.push({
            name: componentName,
            label: masterLabel,
            path: metaFile
          });
        } catch (err: any) {
          console.warn(`Could not parse meta file: ${metaFile}`, err.message);
        }
      }

      componentsInfo.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

      const choices = componentsInfo.map(component => ({
        value: component.name,
        title: component.label,
        description: `Name: ${component.name}`
      }));

      const componentSelectRes = await prompts({
        type: 'select',
        name: 'value',
        message: 'Select a Lightning Web Component to extract custom labels from',
        description: 'Choose which LWC component to analyze for custom label usage',
        placeholder: 'Select a component',
        choices: choices
      });

      return componentSelectRes.value;
    } catch (err: any) {
      console.error('Error while finding LWC components:', err.message);
      throw err;
    }
  }

  public static async promptExtractionMethod() {
    try {
      const methodSelectRes = await prompts({
        type: 'select',
        name: 'method',
        message: 'How would you like to extract custom label translations?',
        description: 'Choose your preferred method for extracting custom label translations',
        placeholder: 'Select extraction method',
        choices: [
          {
            value: 'labels',
            title: 'Select specific custom labels',
            description: 'Choose one or more custom labels from the full list'
          },
          {
            value: 'lwc',
            title: 'Extract from a Lightning Web Component',
            description: 'Find all custom labels used in a specific LWC'
          }
        ]
      });

      let values;
      if (methodSelectRes.method === 'labels') {
        values = await CustomLabelTranslations.promptCustomLabels();
      } else if (methodSelectRes.method === 'lwc') {
        values = await CustomLabelTranslations.promptLwcComponent();
      }

      return {
        type: methodSelectRes.method,
        values: values
      }
    } catch (err: any) {
      console.error('Error during extraction method selection:', err.message);
      throw err;
    }
  }
}