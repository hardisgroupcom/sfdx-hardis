import { SfCommand } from '@salesforce/sf-plugins-core';
import { AnyJson } from '@salesforce/ts-types';

export default class HardisCommands extends SfCommand<AnyJson> {
  public static readonly summary = 'Expose example custom menus to the sfdx-hardis VS Code extension';

  public static readonly description = `
## Command Behavior

**Returns example custom menus that illustrate the plugin discovery contract used by the sfdx-hardis VS Code extension.**

This hidden command is a working example for plugin authors who want to expose Welcome page cards and Commands panel entries through the \`hardis-commands\` JSON contract.

## Technical explanations

- **Hidden helper command:** It is not intended for regular end users and is primarily consumed with \`--json\`.
- **Discovery payload:** It returns \`customCommands\` and \`customCommandsPosition\` with the menu and command metadata supported by the extension.
- **Illustrative links:** Each sample command includes a documentation URL to demonstrate how help links can be attached to custom commands.
`;

  public static readonly examples = ['$ sf sfdx-hardis:hardis-commands --json'];

  public static readonly aliases = ['sfdx-hardis:hardis-commands'];

  public static readonly hidden = true;

  public static readonly requiresProject = false;

  public async run(): Promise<AnyJson> {
    return {
      customCommandsPosition: 'last',
      customCommands: [
        {
          id: 'plugin-api-examples',
          label: 'Plugin API examples',
          description: 'Example custom commands exposed through the sfdx-hardis plugin API',
          vscodeIcon: 'symbol-misc',
          sldsIcon: 'utility:apps',
          commands: [
            {
              id: 'generate-project-documentation',
              label: 'Generate project documentation',
              command: 'sf hardis:doc:project2markdown',
              tooltip: 'Generate Markdown project documentation from the current repository',
              helpUrl: 'https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/',
              icon: 'file.svg',
              vscodeIcon: 'file',
              sldsIcon: 'utility:file',
            },
            {
              id: 'detect-legacy-api-usage',
              label: 'Detect legacy API usage',
              command: 'sf hardis:org:diagnose:legacyapi',
              tooltip: 'Analyze the org and exported logs to find deprecated Salesforce API versions',
              helpUrl: 'https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi/',
              icon: 'salesforce.svg',
              vscodeIcon: 'warning',
              sldsIcon: 'utility:warning',
            },
          ],
        },
      ],
    };
  }
}