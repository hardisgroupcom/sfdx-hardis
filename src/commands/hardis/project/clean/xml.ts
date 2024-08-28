/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import * as path from 'path';
import sortArray from 'sort-array';
import * as xmldom from '@xmldom/xmldom';
import * as xpath from 'xpath';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { writeXmlFileFormatted } from '../../../../common/utils/xmlUtils.js';
import { getConfig, setConfig } from '../../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-template-sf-external', 'org');

export default class CleanXml extends SfCommand<any> {
  public static title = 'Clean retrieved empty items in dx sources';

  public static description = `Remove XML elements using Glob patterns and XPath expressions
  
This can be very useful to avoid to always remove manually the same elements in the same XML file.

- **globpattern** can be any glob pattern allowing to identify the XML files to update, for example \`/**/*.flexipage-meta.xml\`

- **xpath** can be any xpath following the format \`//ns:PARENT-TAG-NAME//ns:TAG-NAME[contains(text(),'TAG-VALUE')]\`. If an element is found, the whole **PARENT-TAG-NAME** (with its subtree) will be removed.

![How to build cleaning XPath](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/doc-clean-xml.jpg)

Note: If globpattern and xpath are not sent, elements defined in property **cleanXmlPatterns** in **.sfdx-hardis.yml** config file will be used
  
  `;

  public static examples = [
    '$ sf hardis:project:clean:xml',
    `$ sf hardis:project:clean:xml --globpattern "/**/*.flexipage-meta.xml" --xpath "//ns:flexiPageRegions//ns:name[contains(text(),'dashboardName')]"`,
  ];

  public static flags = {
    folder: Flags.string({
      char: 'f',
      default: 'force-app',
      description: 'Root folder',
    }),
    globpattern: Flags.string({
      char: 'p',
      description: 'Glob pattern to find files to clean. Ex: /**/*.flexipage-meta.xml',
      dependsOn: ['xpath'],
    }),
    xpath: Flags.string({
      char: 'x',
      description:
        "XPath to use to detect the elements to remove. Ex: //ns:flexiPageRegions//ns:name[contains(text(),'dashboardName')]",
      dependsOn: ['globpattern'],
    }),
    namespace: Flags.string({
      char: 'n',
      default: 'http://soap.sforce.com/2006/04/metadata',
      description: 'XML Namespace to use',
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

  protected folder: string;
  protected globPattern: string | undefined;
  protected namespace: string;
  protected xpath: string | undefined;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanXml);
    this.folder = flags.folder || './force-app';
    this.globPattern = flags.globpattern;
    this.xpath = flags.xpath;
    this.namespace = flags.namespace || 'http://soap.sforce.com/2006/04/metadata';
    this.debugMode = flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Clean XML elements matching patterns`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const cleanXmlPatterns = await this.buildCleanXmlPatterns();
    let counter = 0;
    const xpathSelect = xpath.useNamespaces({ ns: this.namespace });
    // iterate on removePatterns
    for (const cleanXmlPattern of cleanXmlPatterns) {
      const findPattern = rootFolder + cleanXmlPattern.globPattern;
      const matchingXmlFiles = await glob(findPattern, { cwd: process.cwd() });
      // Iterate on matching files
      for (const xmlFile of matchingXmlFiles) {
        let updated = false;
        const xml = await fs.readFile(xmlFile, 'utf8');
        const doc = new xmldom.DOMParser().parseFromString(xml);
        // Iterate on xpaths
        for (const xpathItem of cleanXmlPattern.xpaths) {
          const nodes = xpathSelect(xpathItem, doc);
          for (const node of nodes as Node[]) {
            await this.removeXPath(xpathItem, doc, node);
            uxLog(this, c.grey(`Removed xpath ${xpathItem} from ${xmlFile}`));
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
      uxLog(this, c.cyan('Using configuration from input arguments...'));
      return [
        {
          globPattern: this.globPattern,
          xpaths: [this.xpath],
        },
      ];
    }
    // Stored config
    uxLog(
      this,
      c.cyan(`Using configuration from property ${c.bold('cleanXmlPatterns')} in .sfdx-hardis.yml config file...`)
    );
    const config = await getConfig('branch');
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
    const splits = xpathItem.split('//ns:').filter((str) => str !== '');
    if (splits[0]) {
      return splits[0];
    }
    throw new SfError(`[sfdx-hardis] xpath should start with //ns:PARENT-TAG-NAME//ns:`);
  }

  public findParentNode(node: any, parentNodeName: string) {
    if (node == null) {
      throw new SfError(`[sfdx-hardis] Parent node named ${parentNodeName} not found`);
    }
    if (node.localName === parentNodeName) {
      return node;
    }
    return this.findParentNode(node.parentNode, parentNodeName);
  }

  // Propose user to perform such cleaning at each future hardis:work:save command
  public async manageAddToPermanentConfig(globPattern: string, xpath: string) {
    if (!isCI) {
      const config = await getConfig('project');
      let cleanXmlPatterns = config.cleanXmlPatterns || [];
      const alreadyDefined = cleanXmlPatterns.filter(
        (item: any) => item.globPattern === globPattern && item.xpaths.includes(xpath)
      );
      if (alreadyDefined.length > 0) {
        return;
      }
      // prompt user
      const addConfigRes = await prompts({
        type: 'confirm',
        message: c.cyanBright(
          `Do you want to ALWAYS apply removal of xpath ${xpath} from files of pattern ${globPattern} ?`
        ),
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
            xpaths: [xpath],
          });
        }
        // Update config with sorted new value
        cleanXmlPatterns = sortArray(cleanXmlPatterns, {
          by: ['globPattern'],
          order: ['asc'],
        });
        await setConfig('project', { cleanXmlPatterns: cleanXmlPatterns });
      }
    }
  }
}
