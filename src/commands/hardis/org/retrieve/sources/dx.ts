/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as child from 'child_process';
import fs from 'fs-extra';
import * as path from 'path';
import * as util from 'util';
const exec = util.promisify(child.exec);

import { MetadataUtils } from '../../../../../common/metadata-utils/index.js';
import { uxLog } from '../../../../../common/utils/index.js';
import { WebSocketClient } from '../../../../../common/websocketClient.js';
import { setConfig } from '../../../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DxSources extends SfCommand<any> {
  public static title = 'Retrieve sfdx sources from org';

  public static description = `
## Command Behavior

**Retrieves Salesforce metadata from an org and converts it into Salesforce DX (SFDX) source format.**

This command provides a flexible way to pull metadata from any Salesforce org into your local SFDX project. It's particularly useful for:

- **Initial Project Setup:** Populating a new SFDX project with existing org metadata.
- **Environment Synchronization:** Bringing changes from a Salesforce org (e.g., a sandbox) into your local development environment.
- **Selective Retrieval:** Allows you to specify which metadata types to retrieve, or to filter out certain types.
- **Org Shape Creation:** Can optionally create an org shape, which is useful for defining the characteristics of scratch orgs.

Key functionalities:

- **Metadata Retrieval:** Connects to a target Salesforce org and retrieves metadata based on specified filters.
- **MDAPI to SFDX Conversion:** Converts the retrieved metadata from Metadata API format to SFDX source format.
- **Org Shape Generation (Optional):** If the \`--shape\` flag is used, it also captures the org's shape and stores installed package information.
- **Temporary File Management:** Uses temporary folders for intermediate steps, ensuring a clean working directory.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Temporary Directory Management:** It creates and manages temporary directories (\`./tmp\`, \`mdapipkg\`, \`sfdx-project\`) to stage the retrieved metadata and the converted SFDX sources.
- **\`MetadataUtils.retrieveMetadatas\`:** This utility is used to connect to the Salesforce org and retrieve metadata in Metadata API format. It supports filtering by metadata types and excluding certain items.
- **SFDX Project Creation:** It executes \`sf project generate\` to create a new SFDX project structure within a temporary directory.
- **MDAPI to SFDX Conversion:** It then uses \`sf project convert mdapi\` to convert the retrieved metadata from the MDAPI format to the SFDX source format.
- **File System Operations:** It uses \`fs-extra\` to copy the converted SFDX sources to the main project folder, while preserving important project files like \`.gitignore\` and \`sfdx-project.json\`.
- **Org Shape Handling:** If \`--shape\` is enabled, it copies the generated \`package.xml\` and stores information about installed packages using \`setConfig\`.
- **Error Handling:** Includes robust error handling for Salesforce CLI commands and file system operations.
- **WebSocket Communication:** Uses \`WebSocketClient.sendRefreshCommandsMessage\` to notify connected VS Code clients about changes to the project.
</details>
`;

  public static examples = ['$ sf hardis:org:retrieve:sources:dx'];

  public static flags: any = {
    folder: Flags.string({
      char: 'f',
      default: '.',
      description: messages.getMessage('folder'),
    }),
    tempfolder: Flags.string({
      char: 't',
      default: './tmp',
      description: messages.getMessage('tempFolder'),
    }),
    keepmetadatatypes: Flags.string({
      char: 'k',
      description: 'Comma separated list of metadatas types that will be the only ones to be retrieved',
    }),
    filteredmetadatas: Flags.string({
      char: 'm',
      description: messages.getMessage('filteredMetadatas'),
    }),
    shape: Flags.boolean({
      char: 's',
      default: false,
      description: messages.getMessage('createOrgShape'),
    }),
    instanceurl: Flags.string({
      char: 'r',
      description: messages.getMessage('instanceUrl'),
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
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DxSources);
    const folder = path.resolve(flags.folder || '.');
    const tempFolder = path.resolve(flags.tempfolder || './tmp');
    const keepMetadataTypes = flags.keepmetadatatypes ? flags.keepmetadatatypes.split(',') : [];
    const filteredMetadatas = flags.filteredmetadatas
      ? flags.filteredmetadatas.split(',')
      : MetadataUtils.listMetadatasNotManagedBySfdx();
    const shapeFlag = flags.shape || false;
    const debug = flags.debug || false;

    // Create working temp folders and define it as cwd
    const prevCwd = process.cwd();
    await fs.ensureDir(tempFolder);
    await fs.emptyDir(tempFolder);
    process.chdir(tempFolder);
    const metadataFolder = path.join(tempFolder, 'mdapipkg');
    await fs.ensureDir(metadataFolder);
    await fs.emptyDir(metadataFolder);
    const sfdxFolder = path.join(tempFolder, 'sfdx-project');
    await fs.ensureDir(sfdxFolder);
    await fs.emptyDir(sfdxFolder);

    // Retrieve metadatas
    const retrieveOptions: any = { filterManagedItems: true, removeStandard: false };
    if (keepMetadataTypes) {
      retrieveOptions.keepMetadataTypes = keepMetadataTypes;
    }
    const packageXml = path.resolve(path.join(tempFolder, 'package.xml'));
    await MetadataUtils.retrieveMetadatas(
      packageXml,
      metadataFolder,
      true,
      filteredMetadatas,
      retrieveOptions,
      this,
      flags['target-org'].getUsername(),
      debug
    );

    // Create sfdx project
    if (fs.readdirSync(sfdxFolder).length === 0) {
      uxLog("action", this, c.cyan('Creating SFDX project...'));
      const projectCreateCommand = 'sf project generate --name "sfdx-project"';
      uxLog("other", this, `[command] ${c.bold(c.grey(projectCreateCommand))}`);
      const createProjectRes = await exec(projectCreateCommand, { maxBuffer: 1024 * 2000 });
      if (debug) {
        uxLog("other", this, createProjectRes.stdout + createProjectRes.stderr);
      }
    }

    // Converting metadatas to sfdx
    uxLog("action", this, c.cyan(`Converting metadatas into SFDX sources in ${c.green(sfdxFolder)}...`));
    process.chdir(sfdxFolder);
    const mdapiConvertCommand = `sf project convert mdapi --root-dir ${path.join(metadataFolder, 'unpackaged')} ${debug ? '--verbose' : ''
      }`;
    uxLog("other", this, `[command] ${c.bold(c.grey(mdapiConvertCommand))}`);
    try {
      const convertRes = await exec(mdapiConvertCommand, {
        maxBuffer: 10000 * 10000,
      });
      if (debug) {
        uxLog("other", this, convertRes.stdout + convertRes.stderr);
      }
    } catch (e) {
      throw new SfError(JSON.stringify(e, null, 2));
    }

    // Move sfdx sources in main folder
    uxLog("other", this, `[sfdx-hardis] Moving temp files to main folder ${c.green(path.resolve(folder))}...`);
    process.chdir(prevCwd);
    // Do not replace files if already defined
    const filesToNotReplace = ['.gitignore', '.forceignore', 'sfdx-project.json', 'README.md'];
    for (const fileToNotReplace of filesToNotReplace) {
      if (
        fs.existsSync(path.join(path.resolve(folder), fileToNotReplace)) &&
        fs.existsSync(path.join(sfdxFolder, fileToNotReplace))
      ) {
        await fs.remove(path.join(sfdxFolder, fileToNotReplace));
      }
    }
    // Copy files
    await fs.copy(sfdxFolder, path.resolve(folder));

    // Manage org shape if requested
    if (shapeFlag === true) {
      // Copy package.xml
      const packageXmlInConfig = path.resolve(folder) + '/manifest/package.xml'; // '/config/package.xml';
      if (!fs.existsSync(packageXmlInConfig)) {
        await fs.ensureDir(path.dirname(packageXmlInConfig));
        uxLog("other", this, `[sfdx-hardis] Copying package.xml manifest ${c.green(packageXmlInConfig)}...`);
        await fs.copy(packageXml, packageXmlInConfig);
      }
      // Store list of installed packages
      const installedPackages = await MetadataUtils.listInstalledPackages(null, this);
      await setConfig('project', {
        installedPackages,
      });
    }

    // Remove temporary files
    uxLog("other", this, `Remove temporary folder ${tempFolder} ...`);
    try {
      await fs.rm(tempFolder, { recursive: true });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      uxLog("warning", this, c.yellow(`Unable to remove folder ${tempFolder}, please delete it manually`));
    }

    // Trigger commands refresh on VS Code WebSocket Client
    WebSocketClient.sendRefreshCommandsMessage();

    // Set bac initial cwd
    const message = `[sfdx-hardis] Successfully retrieved sfdx project in ${folder}`;
    uxLog("success", this, c.green(message));
    return { orgId: flags['target-org'].getOrgId(), outputString: message };
  }
}
