/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import ora, { Ora } from 'ora';
import * as path from 'path';

import { execCommand, uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import { MetadataUtils } from '../../../common/metadata-utils/index.js';
import { glob } from 'glob';
import { GLOB_IGNORE_PATTERNS } from '../../../common/utils/projectUtils.js';
import { applyAllReplacementsDefinitions } from '../../../common/utils/xmlUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PurgeRef extends SfCommand<any> {
  public static title = 'Purge References';

  public static description = `
## Command Behavior

**Purges references to specified strings within your Salesforce metadata files before deployment.**

This command is a powerful, yet dangerous, tool designed to modify your local Salesforce metadata by removing or altering references to specific strings. It's primarily intended for advanced use cases, such as refactoring a custom field's API name (e.g., changing a Master-Detail relationship to a Lookup) where direct string replacement across many files is necessary.

**USE WITH EXTREME CAUTION AND CAREFULLY READ ALL MESSAGES!** Incorrect usage can lead to data loss or metadata corruption.

Key functionalities:

- **Reference String Input:** You can provide a comma-separated list of strings (e.g., \`Affaire__c,MyField__c\`) that you want to find and modify within your metadata.
- **Automatic Related Field Inclusion:** If a custom field API name (ending with \`__c\`) is provided, it automatically includes its relationship name (ending with \`__r\`) in the list of references to purge, ensuring comprehensive cleanup.
- **Source Synchronization Check:** Prompts you to confirm if your local sources are up-to-date with the target org, offering to retrieve metadata if needed.
- **Targeted File Scan:** Scans \`.cls\`, \`.trigger\`, and \`.xml\` files within your SFDX project to identify occurrences of the specified reference strings.
- **Configurable Replacements:** Applies predefined replacement rules based on file type (e.g., Apex classes, XML files) to modify the content where references are found.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Interactive Input:** Uses \`prompts\` to get the list of reference strings from the user if not provided via flags.
- **Metadata Retrieval:** If the user indicates that local sources are not up-to-date, it executes \`sf project retrieve start\` to fetch the latest metadata from the target org.
- **File System Scan:** It uses \`glob\` to efficiently find all relevant source files (\`.cls\`, \`.trigger\`, \`.xml\`) within the project's package directories.
- **Content Matching:** Reads the content of each source file and checks for the presence of any of the specified reference strings.

The core utility function for replacements is called \`applyAllReplacementsDefinitions\`. It is responsible for iterating through the identified files and applying the defined replacement rules. These rules are structured to target specific patterns (for example, \`,{{REF}},\` or \`{{REF}}[ |=].+\` in Apex code) and replace them with a desired string (often an empty string or a modified version).

- **Regular Expressions:** The replacement rules heavily rely on regular expressions (\`regex\`) to precisely match and modify the content.
- **User Feedback:** Provides real-time feedback using \`ora\` for spinners and \`uxLog\` for logging messages about the progress and results of the operation.
</details>
`;

  public static examples = ['$ sf hardis:misc:purge-references'];

  public static flags: any = {
    references: Flags.string({
      char: 'r',
      description: 'Comma-separated list of references to find in metadatas',
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
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  /* jscpd:ignore-end */
  private ignorePatterns: string[] = GLOB_IGNORE_PATTERNS;
  protected referenceStrings: string[] = [];
  protected referenceStringsLabel: string;
  protected allMatchingSourceFiles: string[] = [];
  protected spinnerCustom: Ora;

  public async run(): Promise<AnyJson> {
    uxLog("warning", this, c.yellow(c.bold(PurgeRef.description)));
    const { flags } = await this.parse(PurgeRef);
    // Collect input parameters
    this.referenceStrings = (flags?.references || '').split(',');
    if (this.referenceStrings.length == 1 && this.referenceStrings[0] === '') {
      const refPromptResult = await prompts({
        type: 'text',
        message: 'Please input a comma-separated list of strings you want to purge (example: Affaire__c)',
        description: 'Enter the reference strings to purge from your metadata files.',
        placeholder: 'Ex: Affaire__c,MyField__c,CustomObject__c',
      });
      this.referenceStrings = refPromptResult.value.split(',');
    }
    if (this.referenceStrings.length == 1 && this.referenceStrings[0] === '') {
      throw new SfError('You must input at least one string to check for references');
    }
    for (const refString of this.referenceStrings) {
      if (refString.endsWith('__c') && !this.referenceStrings.includes(refString.replace('__c', '__r'))) {
        this.referenceStrings.push(refString.replace('__c', '__r'));
      }
    }
    this.referenceStringsLabel = this.referenceStrings.join(',');

    // Retrieve metadatas if necessary
    const retrieveNeedRes = await prompts({
      type: 'select',
      message: `Are your local sources up to date with target org ${flags[
        'target-org'
      ].getUsername()}, or do you need to retrieve some of them?`,
      description: 'Confirm whether your local metadata is synchronized with the target org.',
      placeholder: 'Select an option',
      choices: [
        { value: true, title: 'My local sfdx sources are up to date with the target org' },
        { value: false, title: 'I need to retrieve metadatas ' },
      ],
    });
    if (retrieveNeedRes.value === false) {
      const metadatas = await MetadataUtils.promptMetadataTypes();
      const metadataArg = metadatas.map((metadataType: any) => metadataType.xmlName).join(' ');
      await execCommand(`sf project retrieve start --ignore-conflicts --metadata ${metadataArg}`, this, { fail: true });
    }

    // Find sources that contain references
    this.spinnerCustom = ora({
      text: `Browsing sources to find references to ${this.referenceStringsLabel}...`,
      spinner: 'moon',
    }).start();
    const packageDirectories = this.project?.getPackageDirectories() || [];
    this.allMatchingSourceFiles = [];
    for (const packageDirectory of packageDirectories) {
      const sourceFiles = await glob('*/**/*.{cls,trigger,xml}', {
        ignore: this.ignorePatterns,
        cwd: packageDirectory.fullPath,
      });
      const matchingSourceFiles = sourceFiles
        .filter((sourceFile) => {
          sourceFile = path.join(packageDirectory.path, sourceFile);
          const fileContent = fs.readFileSync(sourceFile, 'utf8');
          return this.referenceStrings.some((refString) => fileContent.includes(refString));
        })
        .map((sourceFile) => path.join(packageDirectory.path, sourceFile));
      this.allMatchingSourceFiles.push(...matchingSourceFiles);
    }
    this.spinnerCustom.succeed(`Found ${this.allMatchingSourceFiles.length} sources with references`);
    this.allMatchingSourceFiles.sort();
    uxLog("other", this, 'Matching files:\n' + c.grey(this.allMatchingSourceFiles.join('\n')));

    // Handling Apex classes
    await applyAllReplacementsDefinitions(
      this.allMatchingSourceFiles,
      this.referenceStrings,
      this.getAllReplacements()
    );

    return { message: 'Command completed' };
  }

  private getAllReplacements() {
    return [
      // Apex
      {
        extensions: ['.cls', '.trigger'],
        label: 'Apex',
        type: 'code',
        replaceMode: ['line'],
        refRegexes: [
          // , REF ,
          { regex: `,{{REF}},`, replace: ',' },
          { regex: `, {{REF}},`, replace: ',' },
          { regex: `,{{REF}} ,`, replace: ',' },
          { regex: `, {{REF}} ,`, replace: ',' },
          // , REF = xxx ,
          { regex: `,{{REF}}[ |=].+\\,`, replace: ',' },
          { regex: `, {{REF}}[ |=].+\\,`, replace: ',' },
          { regex: `,{{REF}}[ |=].+\\, `, replace: ',' },
          { regex: `, {{REF}}[ |=].+\\ ,`, replace: ',' },
          // , REF = xxx )
          { regex: `,{{REF}}[ |=].+\\)`, replace: ')' },
          { regex: `, {{REF}}[ |=].+\\)`, replace: ')' },
          // REF = xxx ,
          { regex: `{{REF}}[ |=].+\\)`, replace: ')' },
        ],
      },
    ];
  }
}
