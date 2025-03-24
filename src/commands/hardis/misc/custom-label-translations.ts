import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import c from "chalk";
import * as path from "path";
import fs from "fs-extra";
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { isCI, uxLog } from '../../../common/utils/index.js';
import { MetadataUtils } from '../../../common/metadata-utils/index.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { parseStringPromise, Builder } from 'xml2js';
import { glob } from 'glob';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CustomLabelTranslations extends SfCommand<any> {
  public static title = 'Custom Label Translations';

  public static description = `Extract selected custom labels, or of a given LWC, from all language translation files`;

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
    uxLog(this, c.grey(`Looking for LWC '${lwcName}' JS files...`));

    const lwcFiles = await glob(`**/lwc/${lwcName}/**/*.js`);

    if (lwcFiles.length === 0) {
      throw new Error(`No JS files found for LWC '${lwcName}'`);
    }

    uxLog(this, c.grey(`Found ${lwcFiles.length} JS files for component '${lwcName}'`));

    const labelNames = new Set<string>();
    const labelImportRegex = /@salesforce\/label\/c\.([a-zA-Z0-9_]+)/g;

    for (const jsFile of lwcFiles) {
      const content = await fs.readFile(jsFile, 'utf8');

      let match;
      while ((match = labelImportRegex.exec(content)) !== null) {
        labelNames.add(match[1]);
      }

      if (debugMode) {
        uxLog(this, c.grey(`Processed file: ${jsFile}`));
      }
    }

    const extractedLabels = Array.from(labelNames);

    if (extractedLabels.length === 0) {
      throw new Error(`No custom labels found in LWC '${lwcName}'`);
    }

    uxLog(this, c.grey(`Found ${extractedLabels.length} custom labels in LWC '${lwcName}': ${extractedLabels.join(', ')}`));
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
        uxLog(this, c.red(error.message));
        return { success: false, message: error.message };
      }
    } else if (flags.label) {
      labelNames = flags.label.split(',').map(label => label.trim());
    } else if (!isCI) {
      const selection = await MetadataUtils.promptExtractionMethod();
      if (selection.type == 'labels') {
        labelNames = selection.values;
      } else if (selection.type == 'lwc') {
        labelNames = await this.extractLabelsFromLwc(selection.values, debugMode);
      }
    }

    if (!labelNames || labelNames.length === 0) {
      const errorMsg = 'No custom labels specified. Use --label or --lwc flag.';
      uxLog(this, c.red(errorMsg));
      return { success: false, message: errorMsg };
    }

    uxLog(this, c.grey(`Processing custom labels: ${labelNames.join(', ')}`));

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputDir = path.join('extracted-translations', `${this.outputDirPrefix}-${timestamp}`);
      await fs.ensureDir(outputDir);

      const translationFiles = await glob('**/translations/*.translation-meta.xml');

      if (translationFiles.length === 0) {
        uxLog(this, c.yellow(`No translation files found in **/translations/`));
        return { success: false, message: 'No translation files found' };
      }

      const results = {};

      for (const translationFile of translationFiles) {
        const languageCode = path.basename(translationFile).replace('.translation-meta.xml', '');
        uxLog(this, c.grey(`Processing translation file for ${languageCode}...`));

        const xmlContent = await fs.readFile(translationFile, 'utf8');

        const parsedXml = await parseStringPromise(xmlContent, { explicitArray: false });

        if (!parsedXml.Translations) {
          uxLog(this, c.yellow(`Invalid translation file format: ${translationFile}`));
          continue;
        }

        if (!parsedXml.Translations.customLabels) {
          uxLog(this, c.yellow(`No custom labels found in ${translationFile}`));
          continue;
        }

        const customLabels = Array.isArray(parsedXml.Translations.customLabels)
          ? parsedXml.Translations.customLabels
          : [parsedXml.Translations.customLabels];

        const matchedLabels = customLabels.filter(label =>
          labelNames.includes(label.name)
        );

        if (matchedLabels.length === 0) {
          uxLog(this, c.yellow(`No matching custom labels found in ${languageCode}`));
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
          uxLog(this, c.grey(`Found ${matchedLabels.length} labels in ${languageCode}:`));
          matchedLabels.forEach(label => {
            uxLog(this, c.grey(`  ${label.name} = "${label.label}"`));
          });
        }
      }

      const totalFiles = Object.keys(results).length;

      if (totalFiles === 0) {
        uxLog(this, c.yellow('No matching labels found in any translation file.'));
        return { success: false, message: 'No matching labels found' };
      }

      uxLog(this, c.green(`Successfully extracted custom labels to ${outputDir}`));
      uxLog(this, c.grey(`Processed ${totalFiles} translation files`));

      WebSocketClient.requestOpenFile(outputDir);

      // Return an object to be displayed with --json
      return {
        success: true,
        outputDirectory: outputDir,
        results: results
      };

    } catch (err: any) {
      uxLog(this, c.red(`Error processing custom labels: ${err.message}`));
      throw err;
    }
  }
}