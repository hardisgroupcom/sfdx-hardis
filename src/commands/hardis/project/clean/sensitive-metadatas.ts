/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { glob } from 'glob';
import * as path from 'path';
import fs from 'fs-extra';
import { uxLog } from '../../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CleanSensitiveMetadatas extends SfCommand<any> {
  public static title = 'Clean Sensitive Metadatas';

  public static description = `Sensitive data like credentials and certificates are not supposed to be stored in Git, to avoid security breaches.

This command detects the related metadata and replaces their sensitive content by "HIDDEN_BY_SFDX_HARDIS"

Can be automated at each **hardis:work:save** if **sensitiveMetadatas** is added in .sfdx-hardis.yml **autoCleanTypes** property  

Example in config/.sfdx-hardis.yml:

\`\`\`yaml
autoCleanTypes:
  - destructivechanges
  - sensitiveMetadatas
\`\`\`
`;

  public static examples = ['$ sf hardis:project:clean:sensitive-metadatas'];

  public static flags: any = {
    folder: Flags.string({
      char: 'f',
      default: 'force-app',
      description: 'Root folder',
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
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanSensitiveMetadatas);
    this.folder = flags.folder || './force-app';
    this.debugMode = flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Looking for certificates...`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const findManagedPattern = rootFolder + `/**/*.crt`;
    const matchingCerts = await glob(findManagedPattern, { cwd: process.cwd() });
    let counter = 0;
    for (const cert of matchingCerts) {
      let certText = await fs.readFile(cert, 'utf8');
      if (certText.includes('BEGIN CERTIFICATE')) {
        certText = `CERTIFICATE HIDDEN BY SFDX-HARDIS.

Certificates are not supposed to be stored in Git Repositories, please:

- Make sure they are never overwritten thanks to package-no-overwrite.Xml
- Manually upload them in target orgs when necessary
`
        await fs.writeFile(cert, certText);
        counter++;
        uxLog(this, c.grey(`Replaced certificate content of ${cert}`));
      }
    }

    // Summary
    const msg = `Updated ${c.green(c.bold(counter))} certificates to hide their content`;
    uxLog(this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
