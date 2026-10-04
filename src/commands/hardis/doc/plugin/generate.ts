/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from '../../../../common/utils/fsUtils.js';
import * as path from 'path';
import { setDeepValue } from '../../../../common/utils/objectUtils.js';
import * as yaml from 'js-yaml';
import { uxLog } from '../../../../common/utils/index.js';
import { PACKAGE_ROOT_DIR } from '../../../../settings.js';
import { Config } from '@oclif/core';
import { migrateGtagJsToMkDocsAnalytics, readMkDocsFile, writeMkDocsFile } from '../../../../common/docBuilder/docUtils.js';
import {
  buildCommandDocMarkdown,
  buildIndexAndCommandsMarkdown,
  buildRemovedCommandPage,
  getCommandDocRelativePath,
  listGeneratedCommandPages,
  selectCommands,
} from '../../../../common/docBuilder/pluginDocUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DocPluginGenerate extends SfCommand<any> {
  public static title = 'Generate SF Cli Plugin Documentation';

  // Listed in DISABLE_WEBSOCKET_COMMANDS of src/hooks/init/start-ws-client.ts: keep both in sync
  public static disableWebsocket = true;

  public static description = `
## Command Behavior

**Generates Markdown documentation for an SF CLI plugin, ready for conversion into HTML with MkDocs.**

This command automates the creation of comprehensive documentation for your Salesforce CLI plugin. It processes your plugin's commands and their flags to generate structured Markdown files, which can then be used with Zensical to produce a professional-looking website.

Key functionalities:

- **Command Documentation:** Generates a dedicated Markdown file for each command, including its description, parameters (flags), and examples.
- **Index and Commands Pages:** Creates an \`index.md\` and \`commands.md\` file that list all available commands, providing an overview and easy navigation.
- **Zensical Integration:** Sets up the basic documentation project structure and updates the \`mkdocs.yml\` navigation to include the generated command documentation.
- **Default File Copying:** Copies the documentation configuration files and GitHub Actions workflows to your project, so continuous documentation deployment works out of the box.
- **Selected commands only:** With \`--commands\`, only the pages of the commands you name are written. It takes command ids and \`*\` patterns, separated by commas or by repeating the flag, and stops when one of them matches no command. \`index.md\`, \`commands.md\` and the navigation are then rewritten only when a command was added or removed. A new command always gets its page, even when it is not named.
- **Removed commands:** When a command no longer exists, its page is not deleted: it is replaced by a short page saying so, which keeps old links working. That page is left out of the navigation, the lists of commands and the search, and you can edit it, for example to name the command to use instead.

The pages are built from the compiled commands of the plugin: compile it before running this command.

**Post-Generation Steps:**

After the initial run, you will need to manually update:

- \`mkdocs.yml\`: Customize the project title, theme, and other site settings. Zensical reads this file directly.
- \`.github/workflows/build-deploy-docs.yml\`: Configure the GitHub Actions workflow for automatic documentation deployment.
- \`mkdocs.yml\`, key \`extra.analytics\`: If desired, set up Google Analytics tracking with your own measurement id.

Finally, activate GitHub Pages with \`gh_pages\` as the target branch. This will enable automatic documentation rebuilding and publishing to GitHub Pages upon each merge into your \`master\`/\`main\` branch.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Plugin Configuration Loading:** It loads the SF CLI plugin's configuration using \`@oclif/core\`'s \`Config.load()\`, which provides access to all registered commands and their metadata. Every command is loaded, with or without \`--commands\`.
- **Command Selection:** \`--commands\` values are matched against the command ids. \`*\` stands for any sequence of characters, \`:\` included, and an id typed with spaces is read as its colon form.
- **Markdown File Generation:** For each selected command, it constructs a Markdown file (\`.md\`) containing:
  - The command ID as the main heading.
  - The command's \`description\` property.
  - A table of parameters (flags), including their name, type, description, default value, required status, and available options. It dynamically extracts this information from the command's \`flags\` property. A default that depends on the machine building the documentation, such as the default org, is left out.
  - Code blocks for each example provided in the command's \`examples\` property.
- **Table Alignment:** The tables of the generated pages are padded the way \`markdown-table-formatter\` pads them, so a formatter run on the documentation changes nothing.
- **Navigation Structure:** It builds a nested JavaScript object (\`commandsNav\`) that mirrors the command hierarchy, which is then converted to YAML and inserted into the \`Commands\` entry of \`mkdocs.yml\` to create the navigation menu.
- **Index and Commands Page Generation:** It reads the project's \`README.md\` and extracts relevant sections to create the \`index.md\` file. It also generates a separate \`commands.md\` file listing all commands.
- **Command List Changes:** A generated page is recognized by its header comment and its title. A command without such a page is new, and such a page without a command is replaced by the removed command page.
- **File System Operations:** It uses Node.js \`fs\` to create directories, copy the default site files (\`defaults/mkdocs\`), and write the generated Markdown and YAML files.
- **YAML Serialization:** It uses \`js-yaml\` to serialize the navigation object into YAML format for \`mkdocs.yml\`.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:doc:plugin:generate --agent
sf hardis:doc:plugin:generate --agent --commands hardis:org:monitor:backup
\`\`\`

In agent mode:

- The command never prompts, with or without \`--agent\`.
- \`--commands\` limits the pages written to the commands it names. Without it, every page is written.
- The \`--json\` result lists the files written, the pages of removed commands, and whether the index pages and the navigation were rebuilt.

`;

  public static examples = [
    '$ sf hardis:doc:plugin:generate',
    '$ sf hardis:doc:plugin:generate --commands hardis:org:monitor:backup',
    '$ sf hardis:doc:plugin:generate --commands "hardis:project:action:*,hardis:work:save"',
    '$ sf hardis:doc:plugin:generate --agent',
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    commands: Flags.string({
      char: 'c',
      multiple: true,
      description:
        'Commands to generate the documentation of: ids or patterns with *, separated by commas or by repeating the flag. If not set, all commands are processed',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
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
  public static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DocPluginGenerate);
    this.debugMode = flags.debug || false;
    const docsRoot = path.join(process.cwd(), 'docs');

    // Load plugin configuration
    const cwd = process.cwd();
    const config = await Config.load({ root: cwd, devPlugins: false, userPlugins: false });
    const allCommandIds: string[] = config.commands.map((command) => command.id);

    // Select the commands to document
    const commandPatterns: string[] = flags.commands || [];
    const isFiltered = commandPatterns.length > 0;
    let selectedCommandIds = allCommandIds;
    if (isFiltered) {
      const selection = selectCommands(allCommandIds, commandPatterns);
      if (selection.unmatched.length > 0) {
        throw new SfError(t('docPluginNoCommandMatches', { patterns: selection.unmatched.join(', ') }));
      }
      selectedCommandIds = selection.selected;
    }

    // Compare the commands with the pages generated by previous runs
    const existingPages = listGeneratedCommandPages(docsRoot);
    const existingPageIds = new Set(existingPages.map((page) => page.commandId));
    const newCommandIds = allCommandIds.filter((commandId) => !existingPageIds.has(commandId));
    const removedCommandPages = existingPages.filter((page) => !allCommandIds.includes(page.commandId));
    const commandListChanged = newCommandIds.length > 0 || removedCommandPages.length > 0;
    const rebuildIndex = !isFiltered || commandListChanged;

    // Generate commands markdowns
    const commandIdsToGenerate = allCommandIds.filter(
      (commandId) => selectedCommandIds.includes(commandId) || newCommandIds.includes(commandId)
    );
    if (isFiltered) {
      uxLog(
        "action",
        this,
        c.cyan(t('docPluginGeneratingSelectedCommands', { selected: commandIdsToGenerate.length, total: allCommandIds.length }))
      );
    }
    const generatedFiles: string[] = [];
    for (const command of config.commands) {
      if (commandIdsToGenerate.includes(command.id)) {
        generatedFiles.push(await this.writeDocFile(docsRoot, getCommandDocRelativePath(command.id), buildCommandDocMarkdown(command)));
      }
    }

    // Replace the pages of the commands that do not exist anymore
    const removedCommandFiles: string[] = [];
    for (const removedCommandPage of removedCommandPages) {
      await fs.writeFile(removedCommandPage.file, buildRemovedCommandPage(removedCommandPage.commandId));
      removedCommandFiles.push(path.relative(process.cwd(), removedCommandPage.file).split(path.sep).join('/'));
      uxLog("warning", this, c.yellow(t('docPluginRemovedCommandPage', { command: removedCommandPage.commandId })));
    }

    // Generate index.md and commands.md
    if (rebuildIndex) {
      const readme = await fs.readFile(path.join(process.cwd(), 'README.md'), 'utf8');
      const { indexMarkdown, commandsMarkdown } = buildIndexAndCommandsMarkdown(config.commands, config.pjson, readme);
      generatedFiles.push(await this.writeDocFile(docsRoot, 'index.md', indexMarkdown));
      generatedFiles.push(await this.writeDocFile(docsRoot, 'commands.md', commandsMarkdown));
    }

    // Copy default files (mkdocs.yml and other files can be updated by the SF Cli plugin developer later)
    const mkdocsYmlFile = path.join(process.cwd(), 'mkdocs.yml');
    const mkdocsYmlFileExists = fs.existsSync(mkdocsYmlFile);
    await fs.copy(path.join(PACKAGE_ROOT_DIR, 'defaults/mkdocs', '.'), process.cwd(), { overwrite: false });
    if (!mkdocsYmlFileExists) {
      uxLog("log", this, c.grey(t('baseMkdocsFilesCopiedIntoYourSf')));
      uxLog(
        "warning",
        this,
        c.yellow(
          t('updateMkdocsAndBuildDeployDocs')
        )
      );
    }
    // Remove changelog if not existing
    if (
      !fs.existsSync(path.join(process.cwd(), 'CHANGELOG.md')) &&
      fs.existsSync(path.join(process.cwd(), 'docs', 'CHANGELOG.md'))
    ) {
      await fs.remove(path.join(process.cwd(), 'docs', 'CHANGELOG.md'));
    }
    // Remove license if not existing
    if (
      !fs.existsSync(path.join(process.cwd(), 'LICENSE')) &&
      fs.existsSync(path.join(process.cwd(), 'docs', 'license.md'))
    ) {
      await fs.remove(path.join(process.cwd(), 'docs', 'license.md'));
    }

    // Update mkdocs nav items
    const mkdocsYml: any = readMkDocsFile(mkdocsYmlFile);
    let navRebuilt = false;
    if (rebuildIndex) {
      const commandsNav = this.buildCommandsNav(allCommandIds);
      uxLog("other", this, yaml.dump(commandsNav));
      mkdocsYml.nav = mkdocsYml.nav.map((navItem: any) => {
        if (navItem['Commands']) {
          navItem['Commands'] = commandsNav;
          navRebuilt = true;
        }
        return navItem;
      });
    }
    // Analytics used to be a gtag.js copied into the project, which never counted the page a
    // reader landed on. The id moves to extra.analytics, where the theme reads it.
    const gtagMigration = await migrateGtagJsToMkDocsAnalytics(process.cwd(), mkdocsYml);
    const mkdocsYmlChanged =
      rebuildIndex || gtagMigration.movedProperty !== null || gtagMigration.fileRemoved || gtagMigration.entryRemoved;
    if (mkdocsYmlChanged || !mkdocsYmlFileExists) {
      await writeMkDocsFile(mkdocsYmlFile, mkdocsYml);
    }
    if (isFiltered) {
      uxLog("log", this, c.grey(t(rebuildIndex ? 'docPluginIndexRebuilt' : 'docPluginIndexKept')));
    }

    // Return an object to be displayed with --json
    return {
      outputString: `Generated documentation`,
      commandsSelected: commandIdsToGenerate.length,
      commandsTotal: allCommandIds.length,
      generatedFiles,
      removedCommandFiles,
      indexRebuilt: rebuildIndex,
      navRebuilt,
    };
  }

  // Write a page under the docs folder, and return its path from the project root
  private async writeDocFile(docsRoot: string, relativePath: string, content: string): Promise<string> {
    const mdFileName = path.join(docsRoot, ...relativePath.split('/'));
    await fs.ensureDir(path.dirname(mdFileName));
    await fs.writeFile(mdFileName, content);
    uxLog("log", this, c.grey(t('generatedFile') + c.bold(mdFileName) + '.'));
    return 'docs/' + relativePath;
  }

  // Navigation menu mirroring the hierarchy of the commands
  private buildCommandsNav(commandIds: string[]): any {
    const commandsNav = { 'Commands Reference': 'commands.md' };
    for (const commandId of commandIds) {
      const commandsSplit = commandId.split(':');
      const commandName = commandsSplit.pop();
      const navItem = {};
      navItem[commandName || ''] = commandsSplit.join('/') + `/${commandName}.md`;
      setDeepValue(commandsNav, commandsSplit.join('.'), navItem);
    }
    return commandsNav;
  }
}
