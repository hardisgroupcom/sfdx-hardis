/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import fs from 'fs-extra';
import c from "chalk";
import * as path from "path";
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { uxLog } from '../../../common/utils/index.js';
import { PROMPT_TEMPLATES } from '../../../common/aiProvider/promptTemplates/index.js';
import { PROMPT_VARIABLES } from '../../../common/aiProvider/promptTemplates/variablesIndex.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OverridePrompts extends SfCommand<any> {
  public static title = 'Override AI Prompt Templates';
  public static description = `Create local override files for AI prompt templates and variables

This command creates a folder config/prompt-templates/ and copies all the default AI prompt templates and variables as .txt files that can be customized.

The templates are used by sfdx-hardis for:
- Generating documentation with AI
- Solving deployment errors
- Describing Salesforce metadata

The variables contain common instruction patterns that are reused across multiple templates, such as:
- Role definitions (business analyst, developer, etc.)
- Formatting requirements for markdown output
- Security caution instructions
- Output format specifications

You can customize these prompts and variables to match your organization's specific needs and terminology.

After running this command, you can modify any of the .txt files in config/prompt-templates/ to override the default prompts and variables.

**Important**: Once created, existing template and variable files will never be overwritten with newer versions from sfdx-hardis updates, unless you explicitly use the --overwrite flag. This ensures your customizations are preserved.

Available templates:
${Object.keys(PROMPT_TEMPLATES).map(name => `- ${name}`).join('\n')}

Available variables:
${Object.keys(PROMPT_VARIABLES).map(name => `- ${name}`).join('\n')}

More info on [AI Prompts documentation](https://sfdx-hardis.cloudity.com/salesforce-ai-prompts/)
`;
  public static examples = [
    '$ sf hardis:doc:override-prompts',
    '$ sf hardis:doc:override-prompts --overwrite',
  ];

  public static flags: any = {
    overwrite: Flags.boolean({
      default: false,
      description: 'Overwrite existing template files if they already exist',
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
    })
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OverridePrompts);
    this.debugMode = flags.debug || false;

    // Create config/prompt-templates folder
    const configDir = path.join(process.cwd(), 'config');
    const promptTemplatesDir = path.join(configDir, 'prompt-templates');
    uxLog(this, c.cyan('Creating prompt templates directory...'));
    fs.ensureDirSync(promptTemplatesDir);

    let createdCount = 0;
    let overwrittenCount = 0;
    let skippedCount = 0;

    // Copy all prompt templates as .txt files
    for (const [templateName, templateDefinition] of Object.entries(PROMPT_TEMPLATES)) {
      const targetFile = path.join(promptTemplatesDir, `${templateName}.txt`);

      if (fs.existsSync(targetFile)) {
        if (flags.overwrite) {
          // Get the English text from the template
          const promptText = templateDefinition.text.en;

          // Overwrite the existing file
          fs.writeFileSync(targetFile, promptText);
          uxLog(this, c.cyan(`Overwritten: ${templateName}.txt`));
          overwrittenCount++;
        } else {
          uxLog(this, c.yellow(`Template already exists: ${templateName}.txt`));
          skippedCount++;
        }
        continue;
      }

      // Get the English text from the template
      const promptText = templateDefinition.text.en;

      // Write the prompt text to the .txt file
      fs.writeFileSync(targetFile, promptText);
      uxLog(this, c.green(`Created: ${templateName}.txt`));
      createdCount++;
    }

    // Copy all prompt variables as .txt files
    for (const [variableName, variableDefinition] of Object.entries(PROMPT_VARIABLES)) {
      const targetFile = path.join(promptTemplatesDir, `${variableName}.txt`);

      if (fs.existsSync(targetFile)) {
        if (flags.overwrite) {
          // Get the English text from the variable
          const variableText = variableDefinition.text.en;

          // Overwrite the existing file
          fs.writeFileSync(targetFile, variableText);
          uxLog(this, c.cyan(`Overwritten: ${variableName}.txt`));
          overwrittenCount++;
        } else {
          uxLog(this, c.yellow(`Variable already exists: ${variableName}.txt`));
          skippedCount++;
        }
        continue;
      }

      // Get the English text from the variable
      const variableText = variableDefinition.text.en;

      // Write the variable text to the .txt file
      fs.writeFileSync(targetFile, variableText);
      uxLog(this, c.green(`Created: ${variableName}.txt`));
      createdCount++;
    }    // Summary
    uxLog(this, '');
    uxLog(this, c.cyan('Summary:'));
    uxLog(this, c.green(`Created ${createdCount} new prompt template and variable files`));

    if (overwrittenCount > 0) {
      uxLog(this, c.cyan(`Overwritten ${overwrittenCount} existing files`));
    }

    if (skippedCount > 0) {
      uxLog(this, c.yellow(`Skipped ${skippedCount} existing files`));
    }

    uxLog(this, '');
    uxLog(this, c.cyan('Prompt templates and variables location:'));
    uxLog(this, c.white(`   ${promptTemplatesDir}`));
    uxLog(this, '');
    uxLog(this, c.cyan('Usage:'));
    uxLog(this, c.white('   - Edit template .txt files to customize AI prompts'));
    uxLog(this, c.white('   - Edit variable .txt files to customize common instruction patterns'));
    uxLog(this, c.white('   - Use {{VARIABLE_NAME}} placeholders for dynamic content'));
    uxLog(this, c.white('   - Templates can reference variables with {{VARIABLE_NAME}} syntax'));
    uxLog(this, c.white('   - Your custom prompts and variables will override the defaults automatically'));
    uxLog(this, '');
    uxLog(this, c.cyan('Documentation:')); uxLog(this, c.white('   https://sfdx-hardis.cloudity.com/salesforce-ai-prompts/'));

    const actionMessage = overwrittenCount > 0 ?
      `Created ${createdCount} and overwritten ${overwrittenCount} prompt template and variable files` :
      `Created ${createdCount} prompt template and variable files`;

    return {
      status: 'success',
      message: `${actionMessage} in ${promptTemplatesDir}`,
      createdCount,
      overwrittenCount,
      skippedCount,
      outputDir: promptTemplatesDir
    };
  }
}
