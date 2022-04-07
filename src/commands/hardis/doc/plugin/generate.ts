/* jscpd:ignore-start */
import * as Config from "@oclif/config";
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import * as sortArray from "sort-array";
import * as set from "set-value";
import * as yaml from "js-yaml";
import { uxLog } from "../../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DocPluginGenerate extends SfdxCommand {
  public static title = "Generate SFDX Plugin Documentation";

  public static description = `Generate Markdown documentation ready for HTML conversion with mkdocs

After the first run, you need to update manually:

- mkdocs.yml
- .github/workflows/build-deploy-docs.yml
- docs/javascripts/gtag.js , if you want Google Analytics tracking

Then, activate Github pages, with "gh_pages" as target branch

At each merge into master/main branch, the GitHub Action build-deploy-docs will rebuild documentation and publish it in GitHub pages
`;

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
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
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

    // Load plugin configuration
    const cwd = process.cwd();
    const config = await Config.load({ root: cwd, devPlugins: false, userPlugins: false });

    // Generate commands markdowns
    const commandsNav = { "All commands": "commands.md" };
    const commandsLinks = {};
    for (const command of config.commands) {
      await this.generateCommandDoc(command);
      const commandsSplit = command.id.split(":");
      const commandName = commandsSplit.pop();
      const commandMdPath = commandsSplit.join("/") + `/${commandName}.md`;
      const navItem = {};
      navItem[commandName] = commandMdPath;
      set(commandsNav, commandsSplit.join("."), navItem, { preservePaths: true, merge: true });
      commandsLinks[command.id] = commandMdPath;
    }
    uxLog(this, yaml.dump(commandsNav));

    // Generate index.md
    await this.generateIndexDoc(config, commandsLinks);

    // Copy default files (mkdocs.yml and other files can be updated by the sfdx plugin developer later)
    const mkdocsYmlFile = path.join(process.cwd(), "mkdocs.yml");
    const mkdocsYmlFileExists = fs.existsSync(mkdocsYmlFile);
    await fs.copy(path.join(__dirname, "../../../../../defaults/mkdocs", "."), process.cwd(), { overwrite: false });
    if (!mkdocsYmlFileExists) {
      uxLog(this, c.blue("Base mkdocs files copied in your sfdx plugin folder"));
      uxLog(this, c.yellow("You should probably manually update mkdocs.yml and build-deploy-docs.yml with your repo & plugin information"));
    }
    // Remove changelog if not existing
    if (!fs.existsSync(path.join(process.cwd(), "CHANGELOG.md")) && fs.existsSync(path.join(process.cwd(), "docs", "CHANGELOG.md"))) {
      await fs.remove(path.join(process.cwd(), "docs", "CHANGELOG.md"));
    }
    // Remove license if not existing
    if (!fs.existsSync(path.join(process.cwd(), "LICENSE")) && fs.existsSync(path.join(process.cwd(), "docs", "license.md"))) {
      await fs.remove(path.join(process.cwd(), "docs", "license.md"));
    }

    // Update mkdocs nav items
    const mkdocsYml = yaml.load(
      fs
        .readFileSync(mkdocsYmlFile, "utf-8")
        .replace("!!python/name:materialx.emoji.twemoji", "'!!python/name:materialx.emoji.twemoji'")
        .replace("!!python/name:materialx.emoji.to_svg", "'!!python/name:materialx.emoji.to_svg'")
    );
    mkdocsYml.nav = mkdocsYml.nav.map((navItem: any) => {
      if (navItem["Commands"]) {
        navItem["Commands"] = commandsNav;
      }
      return navItem;
    });
    const mkdocsYmlStr = yaml
      .dump(mkdocsYml)
      .replace("'!!python/name:materialx.emoji.twemoji'", "!!python/name:materialx.emoji.twemoji")
      .replace("'!!python/name:materialx.emoji.to_svg'", "!!python/name:materialx.emoji.to_svg");
    await fs.writeFile(mkdocsYmlFile, mkdocsYmlStr);
    uxLog(this, c.cyan(`Updated ${c.green(mkdocsYmlFile)}`));

    // Return an object to be displayed with --json
    return { outputString: `Generated documentation` };
  }

  // Generate index file
  private async generateIndexDoc(config: any, commandsLinks: any) {
    const lines = [
      "<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->",
    ];
    const readme = await fs.readFile(path.join(process.cwd(), "README.md"), "utf8");
    let reusableReadmePartFound = false;
    // Try to find README content until auto-generated commands
    const limitStrings = ["## Commands", "## COMMANDS", "# Commands", "<!-- commands -->"];
    for (const limitString of limitStrings) {
      if (readme.indexOf(limitString) > 0) {
        lines.push(...readme.substring(0, readme.indexOf(limitString)).split(/\r?\n/));
        reusableReadmePartFound = true;
        break;
      }
    }
    // Default index.md
    if (reusableReadmePartFound === false) {
      lines.push(...["", `# ${config.pjson.name}`, "", "## Description", "", config.pjson.description.split("\n").join("<br/>"), ""]);
    }

    // Build commands (for index.md and commands.md)
    const cmdLines = [];
    lines.push(...["", "## Commands"]);
    cmdLines.push("# Commands");
    let currentSection = "";
    for (const command of sortArray(config.commands, { by: ["id"], order: ["asc"] })) {
      const section = command.id.split(":")[0] + ":" + command.id.split(":")[1];
      if (section !== currentSection) {
        lines.push(...["", `### ${section}`, "", "|Command|Title|", "|:------|:----------|"]);
        cmdLines.push(...["", `## ${section}`, "", "|Command|Title|", "|:------|:----------|"]);
        currentSection = section;
      }
      const commandInstance = command.load();
      const title = commandInstance.title ? commandInstance.title : commandInstance.description ? commandInstance.description.split("\n")[0] : "";
      lines.push(...[`|[**${command.id}**](${commandsLinks[command.id]})|${title}|`]);
      cmdLines.push(...[`|[**${command.id}**](${commandsLinks[command.id]})|${title}|`]);
    }

    // Create docs dir if not existing yet
    await fs.ensureDir(path.join(process.cwd(), "docs"));

    // write in index.md
    const indexMdFile = path.join(process.cwd(), "docs", "index.md");
    const indexMdString = lines.join("\n") + "\n";
    await fs.writeFile(indexMdFile, indexMdString);
    // write in commands.md
    const commandsMdFile = path.join(process.cwd(), "docs", "commands.md");
    const commandsMdString = cmdLines.join("\n") + "\n";
    await fs.writeFile(commandsMdFile, commandsMdString);
  }

  // Generate markdown doc for a single command
  private async generateCommandDoc(command: any) {
    const lines = [
      "<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->",
    ];
    // Title
    const titleLines = [`# ${command.id}`, ""];
    lines.push(...titleLines);
    // Description
    const descriptionLines = [`## Description`, "", ...(command.description || "").split("\n"), ""];
    lines.push(...descriptionLines);
    // Flags
    const flagLines = [
      `## Parameters`,
      "",
      "|Name|Type|Description|Default|Required|Options|",
      "|:---|:--:|:----------|:-----:|:------:|:-----:|",
      ...Object.keys(command.flags || {})
        .sort()
        .map((flagKey: string) => {
          const flag = command.flags[flagKey];
          const optionsUnique = [];
          for (const option of flag.options || []) {
            if (optionsUnique.filter((o) => o.toLowerCase() === option.toLowerCase()).length === 0) {
              optionsUnique.push(option);
            }
          }
          return `|${flag.name + (flag.char ? `<br/>-${flag.char}` : "")}|${flag.type}|${flag.description}|${flag.default || ""}|${
            flag.required ? "" : ""
          }|${optionsUnique.join("<br/>")}|`;
        }),
      "",
    ];
    lines.push(...flagLines);
    // Examples
    const exampleLines = [
      `## Examples`,
      "",
      ...(command.examples || []).map((example: string) => ["```shell", ...(example || "").split("\n"), "```", ""]).flat(),
      "",
    ];
    lines.push(...exampleLines);
    // Write to file
    const mdFileName = path.join(process.cwd(), "docs", path.sep, command.id.replace(/:/g, "/") + ".md");
    await fs.ensureDir(path.dirname(mdFileName));
    const yamlString = lines.join("\n") + "\n";
    await fs.writeFile(mdFileName, yamlString);
    uxLog(this, c.grey("Generated file " + c.bold(mdFileName)));
  }
}
