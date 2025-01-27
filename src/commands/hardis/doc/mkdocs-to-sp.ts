/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import fs from 'fs-extra';
import c from "chalk";
import * as path from "path";
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { execCommand, uxLog } from '../../../common/utils/index.js';
import { CONSTANTS } from '../../../config/index.js';
import { readMkDocsFile, writeMkDocsFile } from '../../../common/utils/docUtils.js';
import { SPDefault, GraphDefault } from "@pnp/nodejs";
import { spfi } from "@pnp/sp";
import { graphfi } from "@pnp/graph";
import "@pnp/graph/users";
import "@pnp/sp/webs";

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class MkDocsToSP extends SfCommand<any> {
  public static title = 'MkDocs to SP';

  public static description = `Generates MkDocs HTML pages and upload them in a Saharepoint library

This command performs the following operations:

- Generates MkDocs HTML pages (using locally installed mkdocs-material, or using mkdocs docker image)
- upload them to a sharepoint library
- Opens the Custom Tab in the default browser (only if not in CI context)

Note: the documentation must have been previously generated using "sf hardis:doc:project2markdown --with-history"

You can:

- Specify the type of documentation to generate (CICD or Monitoring) using the --type flag. Default is CICD.
- Override default styles by customizing mkdocs.yml

More info on [Documentation section](${CONSTANTS.DOC_URL_ROOT}/salesforce-project-documentation/)
`;

  public static examples = [
    '$ sf hardis:doc:mkdocs-to-sp',
  ];

  public static flags: any = {
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
  public static requiresProject = true;

  protected debugMode = false;
  protected tenantId: string = process.env.SHAREPOINT_TENANT_ID || "MISSING_SHAREPOINT_TENANT_ID";
  protected clientId: string = process.env.SHAREPOINT_CLIENT_ID || "MISSING_SHAREPOINT_CLIENT_ID";
  protected siteUrl: string = process.env.SHAREPOINT_SITE_URL || "MISSING_SHAREPOINT_SITE_URL";
  protected sp: any;
  protected graph: any;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MkDocsToSP);
    this.debugMode = flags.debug || false;

    // Check if the project is a MkDocs project
    const mkdocsYmlFile = path.join(process.cwd(), "mkdocs.yml");
    if (!fs.existsSync(mkdocsYmlFile)) {
      throw new SfError('This command needs a mkdocs.yml config file. Generate one using "sf hardis:doc:project2markdown --with-history"');
    }

    // Update mkdocs.yml so it is compliant with being hosted in a static resource
    const mkdocsYml: any = readMkDocsFile(mkdocsYmlFile);
    const mkdocsYmlCopy = Object.assign({}, mkdocsYml);
    mkdocsYmlCopy.use_directory_urls = false;
    await writeMkDocsFile(mkdocsYmlFile, mkdocsYmlCopy);

    try {
      // Generate HTML pages
      await this.generateMkDocsHTML();

      // Authenticate to Sharepoint
      await this.authenticateToSharepoint();

      /*
        if (success && !isCI) {
          uxLog(this, c.cyan(`Opening the Custom Tab ${c.green(resName)} in your default browser...`));
          uxLog(this, c.yellow(`If you have an access issue, make sure the tab ${resName} is not hidden on your Profile...`));
          const sfPath = `lightning/n/${resName}`;
          await execCommand(`sf org open --path ${sfPath} --target-org ${targetUsername}`, this, { fail: false, output: true, debug: this.debugMode });
        }
        // Restore previous mkdocs.yml version
        await writeMkDocsFile(mkdocsYmlFile, mkdocsYml);
        return { success: success };*/
    } catch (e) {
      // Restore previous mkdocs.yml version
      await writeMkDocsFile(mkdocsYmlFile, mkdocsYml);
      throw e;
    }
    return {}
  }

  private async installMkDocs() {
    uxLog(this, c.cyan("Managing mkdocs-material local installation..."));
    let mkdocsLocalOk = false;
    const installMkDocsRes = await execCommand("pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists || python -m install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists || py -m install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists", this, { fail: false, output: true, debug: this.debugMode });
    if (installMkDocsRes.status === 0) {
      mkdocsLocalOk = true;
    }
    return mkdocsLocalOk;
  }

  private async generateMkDocsHTML() {
    const mkdocsLocalOk = await this.installMkDocs();
    if (mkdocsLocalOk) {
      // Generate MkDocs HTML pages with local MkDocs
      uxLog(this, c.cyan("Generating HTML pages with mkdocs..."));
      const mkdocsBuildRes = await execCommand("mkdocs build || python -m mkdocs build || py -m mkdocs build", this, { fail: false, output: true, debug: this.debugMode });
      if (mkdocsBuildRes.status !== 0) {
        throw new SfError('MkDocs build failed:\n' + mkdocsBuildRes.stderr + "\n" + mkdocsBuildRes.stdout);
      }
    }
    else {
      // Generate MkDocs HTML pages with Docker
      uxLog(this, c.cyan("Generating HTML pages with Docker..."));
      const mkdocsBuildRes = await execCommand("docker run --rm -v $(pwd):/docs squidfunk/mkdocs-material build", this, { fail: false, output: true, debug: this.debugMode });
      if (mkdocsBuildRes.status !== 0) {
        throw new SfError('MkDocs build with docker failed:\n' + mkdocsBuildRes.stderr + "\n" + mkdocsBuildRes.stdout);
      }
    }
  }

  async authenticateToSharepoint() {
    const configuration: any = {
      auth: {
        authority: `https://login.microsoftonline.com/${this.tenantId}/`,
        clientId: this.clientId
      }
    };

    this.sp = spfi(this.siteUrl).using(SPDefault({
      msal: {
        config: configuration,
        scopes: [`https://${this.tenantId}.sharepoint.com/.default`],
      },
    }));

    this.graph = graphfi().using(GraphDefault({
      msal: {
        config: configuration,
        scopes: ["https://graph.microsoft.com/.default"],
      },
    }));

  }


}

