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
  public static description = `
## Command Behavior

**Creates local override files for AI prompt templates and variables, allowing for customization of sfdx-hardis AI interactions.**

This command sets up a \`config/prompt-templates/\` folder within your project. It populates this folder with \`.txt\` files containing the default AI prompt templates and variables used by sfdx-hardis. This enables you to tailor the AI's behavior and responses to your organization's specific needs, terminology, and coding standards.

Key functionalities:

- **Template Customization:** Modify templates used for generating documentation, solving deployment errors, and describing Salesforce metadata.
- **Variable Customization:** Adjust common instruction patterns (e.g., role definitions, formatting requirements, security cautions) that are reused across multiple templates.
- **Persistent Overrides:** Once created, these local files will override the default sfdx-hardis templates and variables, and they will not be overwritten by future sfdx-hardis updates unless explicitly requested with the \`--overwrite\` flag.

**Important:** After running this command, you can modify any of the \`.txt\` files in \`config/prompt-templates/\` to customize the AI's behavior.

Available templates:
${Object.keys(PROMPT_TEMPLATES).map(name => `- ${name}`).join('\\n')}

Available variables:
${Object.keys(PROMPT_VARIABLES).map(name => `- ${name}`).join('\\n')}

More info on [AI Prompts documentation](https://sfdx-hardis.cloudity.com/salesforce-ai-prompts/)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Directory Creation:** Ensures the \`config/prompt-templates/\` directory exists using \`fs.ensureDirSync()\`.
- **File Copying:** Iterates through predefined \`PROMPT_TEMPLATES\` and \`PROMPT_VARIABLES\` objects. For each template/variable, it extracts the English text content and writes it to a corresponding \`.txt\` file in the \`config/prompt-templates/\` directory.
- **Overwrite Logic:** Checks if a file already exists. If the \`--overwrite\` flag is provided, it overwrites the existing file; otherwise, it skips the file and logs a message.
- **User Feedback:** Provides detailed logs about created, overwritten, and skipped files, along with instructions on how to use the customized prompts and variables.
- **Dynamic Content:** The description itself dynamically lists available templates and variables by iterating over \`PROMPT_TEMPLATES\` and \`PROMPT_VARIABLES\` objects.
</details>
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
    uxLog("action", this, c.cyan('Creating prompt templates directory.'));
    fs.ensureDirSync(promptTemplatesDir);

    let createdCount = 0;
    let overwrittenCount = 0;
    let skippedCount = 0;

    uxLog("action", this, c.cyan('Creating prompt templates and variables.'));
    // Copy all prompt templates as .txt files
    for (const [templateName, templateDefinition] of Object.entries(PROMPT_TEMPLATES)) {
      const targetFile = path.join(promptTemplatesDir, `${templateName}.txt`);

      if (fs.existsSync(targetFile)) {
        if (flags.overwrite) {
          // Get the English text from the template
          const promptText = templateDefinition.text.en;

          // Overwrite the existing file
          fs.writeFileSync(targetFile, promptText);
          uxLog("log", this, c.grey(`Overwritten: ${templateName}.txt`));
          overwrittenCount++;
        } else {
          uxLog("warning", this, c.yellow(`Template already exists: ${templateName}.txt`));
          skippedCount++;
        }
        continue;
      }

      // Get the English text from the template
      const promptText = templateDefinition.text.en;

      // Write the prompt text to the .txt file
      fs.writeFileSync(targetFile, promptText);
      uxLog("success", this, c.green(`Created: ${templateName}.txt`));
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
          uxLog("log", this, c.grey(`Overwritten: ${variableName}.txt`));
          overwrittenCount++;
        } else {
          uxLog("warning", this, c.yellow(`Variable already exists: ${variableName}.txt`));
          skippedCount++;
        }
        continue;
      }

      // Get the English text from the variable
      const variableText = variableDefinition.text.en;

      // Write the variable text to the .txt file
      fs.writeFileSync(targetFile, variableText);
      uxLog("success", this, c.green(`Created: ${variableName}.txt`));
      createdCount++;
    }    // Summary
    uxLog("other", this, '');
    const actionMessage = overwrittenCount > 0 ?
      `Created ${createdCount} and overwritten ${overwrittenCount} prompt template and variable files.` :
      `Created ${createdCount} prompt template and variable files.`;
    uxLog("action", this, c.cyan(actionMessage));

    if (overwrittenCount > 0) {
      uxLog("warning", this, c.yellow(`Overwritten ${overwrittenCount} existing files.`));
    }

    if (skippedCount > 0) {
      uxLog("warning", this, c.yellow(`Skipped ${skippedCount} existing files.`));
    }

    const usageMessage = [
      '',
      'Prompt templates and variables location:',
      `   ${promptTemplatesDir}`,
      '',
      'Usage:',
      '   - Edit template .txt files to customize AI prompts',
      '   - Edit variable .txt files to customize common instruction patterns',
      '   - Use {{VARIABLE_NAME}} placeholders for dynamic content',
      '   - Templates can reference variables with {{VARIABLE_NAME}} syntax',
      '   - Your custom prompts and variables will override the defaults automatically',
    ].join('\n');
    uxLog("log", this, c.grey(usageMessage));
    uxLog("log", this, c.grey('Documentation: https://sfdx-hardis.cloudity.com/salesforce-ai-prompts/.'));

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
