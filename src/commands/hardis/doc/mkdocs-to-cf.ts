/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import fs from 'fs-extra';
import c from "chalk";
import * as path from "path";
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import Cloudflare from 'cloudflare';
import { execCommand, getCurrentGitBranch, uxLog } from '../../../common/utils/index.js';

import { CONSTANTS } from '../../../config/index.js';


Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class MkDocsToCloudflare extends SfCommand<any> {
  public static title = 'MkDocs to Cloudflare';

  public static description = `Generates MkDocs HTML pages and upload them to Cloudflare as a static pages

This command performs the following operations:

- Generates MkDocs HTML pages (using locally installed mkdocs-material, or using mkdocs docker image)
- Creates a Cloudflare pages app
- Assigns a policy restricting access to the application
- Opens the new WebSite in the default browser (only if not in CI context)

Note: the documentation must have been previously generated using "sf hardis:doc:project2markdown --with-history"

You can:

- Override default styles by customizing mkdocs.yml

More info on [Documentation section](${CONSTANTS.DOC_URL_ROOT}/salesforce-project-documentation/)
`;

  public static examples = [
    '$ sf hardis:doc:mkdocs-to-cf',
    '$ CLOUDFLARE_EMAIL=xxx@xxx.com CLOUDFLARE_API_KEY=zzzzzz CLOUDFLARE_ACCOUNT_ID=zzzzz sf hardis:doc:mkdocs-to-cf',
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
  protected apiEmail: string | undefined;
  protected apiToken: string | undefined;
  protected accountId: string | undefined;
  protected client: Cloudflare;
  protected currentGitBranch: string | null;
  protected pagesProjectName: string;
  protected pagesProject: Cloudflare.Pages.Projects.Project;
  protected accessPolicyName: string;
  protected accessPolicy: Cloudflare.ZeroTrust.Access.Policies.PolicyGetResponse;
  protected accessAppName: string;
  protected accessApp: Cloudflare.ZeroTrust.Access.Applications.ApplicationGetResponse;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MkDocsToCloudflare);
    this.debugMode = flags.debug || false;

    // Check if the project is a MkDocs project
    const mkdocsYmlFile = path.join(process.cwd(), "mkdocs.yml");
    if (!fs.existsSync(mkdocsYmlFile)) {
      throw new SfError('This command needs a mkdocs.yml config file. Generate one using "sf hardis:doc:project2markdown --with-history"');
    }

    this.currentGitBranch = (await getCurrentGitBranch() || "main").replace(/\//g, "-");
    this.pagesProjectName = `sfdx-hardis-project-${this.currentGitBranch}`;
    this.accessAppName = `sfdx-hardis-access-app-${this.currentGitBranch}`;
    this.accessPolicyName = `sfdx-hardis-access-policy-${this.currentGitBranch}`;

    // Create connection to Cloudflare
    this.setupCloudflareClient();

    // Generate HTML pages
    await this.generateMkDocsHTML();

    // Get or Create Cloudflare Pages project
    await this.ensureCloudflarePagesProject();

    // Ensure there is a policy restricting access to the application
    await this.ensureCloudflareAccessPolicy();

    // Ensure there is an access application
    await this.ensureCloudflareAccessApplication();

    return { success: true };
  }

  private async ensureCloudflareAccessApplication() {
    uxLog(this, c.cyan("Checking Cloudflare access application..."));
    try {
      this.accessApp = await this.client.zeroTrust.access.applications.get(this.accessAppName, { account_id: this.accountId || "" });
      uxLog(this, c.cyan("Cloudflare access application found: " + this.accessAppName));
    } catch (e: any) {
      uxLog(this, c.grey(e.message));
      this.accessApp = await this.client.zeroTrust.access.applications.create({
        name: this.accessAppName,
        account_id: this.accountId || "",
        type: "self_hosted",
        domain: this.pagesProject?.domains?.[0],
        policies: [{
          id: this.accessPolicy.id,
        }],
      });
      uxLog(this, c.cyan("Cloudflare access application created: " + this.accessAppName));
    }
    uxLog(this, c.grey(JSON.stringify(this.accessApp)));
  }

  private async ensureCloudflareAccessPolicy() {
    try {
      this.accessPolicy = await this.client.zeroTrust.access.policies.get(this.accessPolicyName, { account_id: this.accountId || "" });
      uxLog(this, c.cyan("Cloudflare policy found: " + this.accessPolicyName));
    } catch (e: any) {
      uxLog(this, c.grey(e.message));
      this.accessPolicy = await this.client.zeroTrust.access.policies.create({
        name: this.accessPolicyName,
        account_id: this.accountId || "",
        decision: "allow",
        include: [
          {
            auth_method: { auth_method: "otp" }
          }
        ],
        require: [
          {
            email_domain: { domain: "@cloudity.com" },
          }
        ],
      });
      uxLog(this, c.cyan("Cloudflare policy created: " + this.accessPolicyName));
    }
    uxLog(this, c.grey(JSON.stringify(this.accessPolicy)));
  }

  private async ensureCloudflarePagesProject() {
    uxLog(this, c.cyan("Checking Cloudflare Pages project..."));
    try {
      this.pagesProject = await this.client.pages.projects.get(this.pagesProjectName, { account_id: this.accountId || "" });
      uxLog(this, c.cyan("Cloudflare Pages project found: " + this.pagesProjectName));
    } catch (e: any) {
      uxLog(this, c.grey(e.message));
      this.pagesProject = await this.client.pages.projects.create({
        name: this.pagesProjectName,
        account_id: this.accountId || "",
        production_branch: this.currentGitBranch || "main",
      });
      uxLog(this, c.cyan("Cloudflare Pages project created: " + this.pagesProjectName));
    }
    uxLog(this, c.grey(JSON.stringify(this.pagesProject)));
  }

  private setupCloudflareClient() {
    this.apiEmail = process.env.CLOUDFLARE_EMAIL;
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN;
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!this.apiEmail || !this.accountId || !this.apiToken) {
      throw new Error('Missing CLOUDFLARE_EMAIL or CLOUDFLARE_API_KEY or CLOUDFLARE_ACCOUNT_ID');
    }
    this.client = new Cloudflare({
      apiEmail: this.apiEmail,
      apiToken: this.apiToken,
    });
    uxLog(this, c.grey("Cloudflare client info found"));
  }

  private async generateMkDocsHTML() {
    const mkdocsLocalOk = await this.installMkDocs();
    if (mkdocsLocalOk) {
      // Generate MkDocs HTML pages with local MkDocs
      uxLog(this, c.cyan("Generating HTML pages with mkdocs..."));
      const mkdocsBuildRes = await execCommand("mkdocs build -v || python -m mkdocs build -v || py -m mkdocs build -v", this, { fail: false, output: true, debug: this.debugMode });
      if (mkdocsBuildRes.status !== 0) {
        throw new SfError('MkDocs build failed:\n' + mkdocsBuildRes.stderr + "\n" + mkdocsBuildRes.stdout);
      }
    }
    else {
      // Generate MkDocs HTML pages with Docker
      uxLog(this, c.cyan("Generating HTML pages with Docker..."));
      const mkdocsBuildRes = await execCommand("docker run --rm -v $(pwd):/docs squidfunk/mkdocs-material build -v", this, { fail: false, output: true, debug: this.debugMode });
      if (mkdocsBuildRes.status !== 0) {
        throw new SfError('MkDocs build with docker failed:\n' + mkdocsBuildRes.stderr + "\n" + mkdocsBuildRes.stdout);
      }
    }
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

}
