/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from 'fs-extra';
import * as glob from "glob-promise";
import * as path from "path";
import * as sortArray from "sort-array";
import * as xmldom from 'xmldom';
import * as xpath from 'xpath';
import { isCI, uxLog } from "../../../../common/utils";
import { prompts } from "../../../../common/utils/prompts";
import { writeXmlFileFormatted } from "../../../../common/utils/xmlUtils";
import { getConfig, setConfig } from "../../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class CleanXml extends SfdxCommand {
  public static title = "Clean retrieved empty items in dx sources";

  public static description = `Remove XML elements using Glob patterns and XPath expressions
  
This can be very useful to avoid to always remove manually the same elements in the same XML file.

- **globpattern** can be any glob pattern allowing to identify the XML files to update, for example \`/**/*.flexipage-meta.xml\`

- **xpath** can be any xpath following the format \`//ns:PARENT-TAG-NAME//ns:TAG-NAME[contains(text(),'TAG-VALUE')]\`. If an element is found, the whole **PARENT-TAG-NAME** (with its subtree) will be removed.

![How to build cleaning XPath](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/doc-clean-xml.jpg)

Note: If globpattern and xpath are not sent, elements defined in property **cleanXmlPatterns** in **.sfdx-hardis.yml** config file will be used
  
  `;

  public static examples = [
    "$ sfdx hardis:project:clean:xml",
    `$ sfdx hardis:project:clean:xml --globpattern "/**/*.flexipage-meta.xml" --xpath "//ns:flexiPageRegions//ns:name[contains(text(),'dashboardName')]"`
  ];

  protected static flagsConfig = {
    folder: flags.string({
      char: "f",
      default: "force-app",
      description: "Root folder",
    }),
    globpattern: flags.string({
      char: 'p',
      description: "Glob pattern to find files to clean. Ex: /**/*.flexipage-meta.xml",
      dependsOn: ["xpath"]
    }),
    xpath: flags.string({
      char: 'x',
      description: "XPath to use to detect the elements to remove. Ex: //ns:flexiPageRegions//ns:name[contains(text(),'dashboardName')]",
      dependsOn: ["globpattern"]
    }),
    namespace: flags.string({
      char: 'n',
      default: 'http://soap.sforce.com/2006/04/metadata',
      description: "XML Namespace to use",
    }),
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
  protected static requiresProject = true;

  protected folder: string;
  protected globPattern: string;
  protected namespace: string;
  protected xpath: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    this.folder = this.flags.folder || "./force-app";
    this.globPattern = this.flags.globpattern;
    this.xpath = this.flags.xpath;
    this.namespace = this.flags.namespace || 'http://soap.sforce.com/2006/04/metadata';
    this.debugMode = this.flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Clean XML elements matching patterns`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const cleanXmlPatterns = await this.buildCleanXmlPatterns();
    let counter = 0;
    const xpathSelect = xpath.useNamespaces({ "ns": this.namespace });
    // iterate on removePatterns
    for (const cleanXmlPattern of cleanXmlPatterns) {
      const findPattern = rootFolder + cleanXmlPattern.globPattern;
      const matchingXmlFiles = await glob(findPattern, { cwd: process.cwd() });
      // Iterate on matching files
      for (const xmlFile of matchingXmlFiles) {
        let updated = false;
        const xml = await fs.readFile(xmlFile, "utf8");
        const doc = new xmldom.DOMParser().parseFromString(xml);
        // Iterate on xpaths
        for (const xpathItem of cleanXmlPattern.xpaths) {
          const nodes = xpathSelect(xpathItem, doc);
          for (const node of nodes) {
            await this.removeXPath(xpathItem, doc, node);
            updated = true;
            counter++;
          }
        }
        if (updated) {
          const updatedXml = new xmldom.XMLSerializer().serializeToString(doc);
          await writeXmlFileFormatted(xmlFile, updatedXml);
        }
      }
    }

    // Summary
    const msg = `Updated ${c.green(c.bold(counter))} XML files`;
    uxLog(this, c.cyan(msg));
    // Propose to add in permanent configuration
    if (this.globPattern && this.xpath) {
      await this.manageAddToPermanentConfig(this.globPattern, this.xpath);
    }
    // Return an object to be displayed with --json
    return { outputString: msg };
  }

  public async buildCleanXmlPatterns() {
    // Input parameters
    if (this.globPattern && this.xpath) {
      uxLog(this, c.cyan("Using configuration from input arguments..."));
      return [
        {
          globPattern: this.globPattern,
          xpaths: [this.xpath]
        }];
    }
    // Stored config
    uxLog(this, c.cyan(`Using configuration from property ${c.bold("cleanXmlPatterns")} in .sfdx-hardis.yml config file...`));
    const config = await getConfig("branch");
    return config.cleanXmlPatterns || [];
  }

  public async removeXPath(xPathItem, doc, node) {
    const parentNodeName = this.findRemoveParentNodeName(xPathItem);
    const parentNode = this.findParentNode(node, parentNodeName);
    if (parentNode) {
      doc.removeChild(parentNode);
    }
  }

  public findRemoveParentNodeName(xpathItem: string) {
    const splits = xpathItem.split("//ns:").filter(str => str !== '');
    if (splits[0]) {
      return splits[0];
    }
    throw new SfdxError(`[sfdx-hardis] xpath should start with //ns:PARENT-TAG-NAME//ns:`);
  }

  public findParentNode(node: any, parentNodeName: string) {
    if (node == null) {
      throw new SfdxError(`[sfdx-hardis] Parent node named ${parentNodeName} not found`);
    }
    if (node.localName === parentNodeName) {
      return node;
    }
    return this.findParentNode(node.parentNode, parentNodeName);
  }

  // Propose user to perform such cleaning at each future hardis:work:save command
  public async manageAddToPermanentConfig(globPattern: string, xpath: string) {
    if (!isCI) {
      const config = await getConfig("project");
      let cleanXmlPatterns = config.cleanXmlPatterns || [];
      const alreadyDefined = cleanXmlPatterns.filter((item: any) => item.globPattern === globPattern && item.xpaths.includes(xpath));
      if (alreadyDefined.length > 0) {
        return;
      }
      // prompt user
      const addConfigRes = await prompts({
        type: "confirm",
        message: c.cyanBright(`Do you want to ALWAYS apply removal of xpath ${xpath} from files of pattern ${globPattern} ?`)
      });
      if (addConfigRes.value === true) {
        let updated = false;
        cleanXmlPatterns = cleanXmlPatterns.map((item: any) => {
          // Check if glob pattern is already existing in the config and update it if found
          if (item.globPattern === globPattern) {
            item.xpaths.push(xpath);
            item.xpaths.sort();
            updated = true;
          }
          return item;
        });
        if (!updated) {
          // globPattern not existing yet: add it with single xpath
          cleanXmlPatterns.push({
            globPattern: globPattern,
            xpaths: [xpath]
          });
        }
        // Update config with sorted new value
        cleanXmlPatterns = sortArray(cleanXmlPatterns, {
          by: ["globPattern"],
          order: ["asc"],
        });
        await setConfig("project", { cleanXmlPatterns: cleanXmlPatterns });
      }
    }
  }
}
