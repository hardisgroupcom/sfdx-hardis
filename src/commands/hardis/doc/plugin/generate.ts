/* jscpd:ignore-start */
import * as Config from '@oclif/config'
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from 'chalk';
import * as fs from 'fs-extra';
import * as path from "path";
import * as set from "set-value";
import * as yaml from 'js-yaml';
import { uxLog } from '../../../../common/utils';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DocPluginGenerate extends SfdxCommand {
  public static title = "Generate SFDX Plugin Documentation";

  public static description = "Generate Markdown documentation ready for HTML conversion with mkdocs";

  public static examples = ["$ sfdx hardis:doc:plugin:generate"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;

    const cwd = process.cwd()
    const config = await Config.load({ root: cwd, devPlugins: false, userPlugins: false });

    const commandsNav = {}
    for (const command of config.commands) {
      await this.generateCommandDoc(command);
      const commandsSplit = command.id.split(":");
      const commandName = commandsSplit.pop();
      const commandMdPath = commandsSplit.join("/") + `/${commandName}.md`;
      const navItem = {};
      navItem[commandName] = commandMdPath;
      set(commandsNav, commandsSplit.join("."), navItem, { preservePaths: true, merge: true });
    }

    uxLog(this, yaml.dump(commandsNav));

    // Copy default files (mkdocs.yml and other files can be updated by the sfdx plugin developer later)
    const mkdocsYmlFile = path.join(process.cwd(), 'mkdocs.yml');
    const mkdocsYmlFileExists = fs.existsSync(mkdocsYmlFile);
    await fs.copy(path.join(__dirname, "../../../../../defaults/mkdocs", "."), process.cwd(), { overwrite: false });
    if (!mkdocsYmlFileExists) {
      uxLog(this, c.blue('Base mkdocs files copied in your sfdx plugin folder'));
      uxLog(this, c.yellow('You should probably manually update mkdocs.yml with your plugin information'));
    }

    // Update mkdocs nav items
    const mkdocsYml = yaml.load(fs.readFileSync(mkdocsYmlFile, "utf-8")
      .replace("!!python/name:materialx.emoji.twemoji", "'!!python/name:materialx.emoji.twemoji'")
      .replace("!!python/name:materialx.emoji.to_svg", "'!!python/name:materialx.emoji.to_svg'"));
    mkdocsYml.nav = mkdocsYml.nav.map((navItem: any) => {
      if (navItem["Commands"]) {
        navItem["Commands"] = commandsNav;
      }
      return navItem;
    });
    const mkdocsYmlStr = yaml.dump(mkdocsYml)
      .replace("'!!python/name:materialx.emoji.twemoji'", "!!python/name:materialx.emoji.twemoji")
      .replace("'!!python/name:materialx.emoji.to_svg'", "!!python/name:materialx.emoji.to_svg");
    await fs.writeFile(mkdocsYmlFile, mkdocsYmlStr);
    uxLog(this, c.cyan(`Updated ${c.green(mkdocsYmlFile)}`));


    // Return an object to be displayed with --json
    return { outputString: `Generated documentation` };
  }

  // Generate markdown doc for a single command
  public async generateCommandDoc(command: any) {
    const lines = [];
    // Title
    const titleLines = [
      `# ${command.id}`,
      ""
    ];
    lines.push(...titleLines);
    // Description 
    const descriptionLines = [
      `## Description`,
      "",
      ...command.description.split("\n"),
      ""
    ];
    lines.push(...descriptionLines);
    // Flags
    const flagLines = [
      `## Parameters`,
      "",
      "|Name|Type|Description|Default|Required|Options|",
      "|:---|:--:|:----------|:-----:|:------:|:-----:|",
      ...Object.keys(command.flags || {}).sort().map((flagKey: string) => {
        const flag = command.flags[flagKey];
        const optionsUnique = [];
        for (const option of flag.options || []) {
          if (optionsUnique.filter(o => o.toLowerCase() === option.toLowerCase()).length === 0) {
            optionsUnique.push(option);
          }
        }
        return `|${flag.name + (flag.char ? `<br/>-${flag.char}` : '')}|${flag.type}|${flag.description}|${flag.default || ''}|${flag.required ? '' : ''}|${optionsUnique.join('<br/>')}|`
      }),
      ""
    ]
    lines.push(...flagLines);
    // Examples
    const exampleLines = [
      `## Examples`,
      "",
      ...((command.examples || []).map((example: string) => [
        "```shell",
        ...example.split("\n"),
        "```",
        ""
      ])).flat(),
      ""
    ];
    lines.push(...exampleLines)
    // Write to file
    const mdFileName = path.join(process.cwd(), 'docs', path.sep, command.id.replace(/:/g, "/") + '.md');
    await fs.ensureDir(path.dirname(mdFileName));
    const yamlString = lines.join("\n") + "\n";
    await fs.writeFile(mdFileName, yamlString);
    uxLog(this, c.grey("Generated file " + c.bold(mdFileName)));
  }
}
