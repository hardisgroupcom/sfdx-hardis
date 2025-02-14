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
import which from 'which';
import { generateMkDocsHTML } from '../../../common/docBuilder/docUtils.js';


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


| Variable                                        | Description | Default |
| :-----------------------------------------      | :---------- | :-----: |
| \`CLOUDFLARE_EMAIL\`                            | Cloudflare account email | <!--- Required --> |
| \`CLOUDFLARE_API_TOKEN\`                        | Cloudflare API token | <!--- Required --> |
| \`CLOUDFLARE_ACCOUNT_ID\`                       | Cloudflare account | <!--- Required --> |
| \`CLOUDFLARE_PROJECT_NAME\`                     | Project name, that will also be used for site URL | Built from git branch name |
| \`CLOUDFLARE_DEFAULT_LOGIN_METHOD_TYPE\`        | Cloudflare default login method type | \`onetimepin\` |
| \`CLOUDFLARE_DEFAULT_ACCESS_EMAIL_DOMAIN\`      | Cloudflare default access email domain | \`@cloudity.com\` |
| \`CLOUDFLARE_EXTRA_ACCESS_POLICY_ID_LIST\`    | Policies to assign to every application access | <!--- Optional --> |

`;

  public static examples = [
    '$ sf hardis:doc:mkdocs-to-cf',
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
  protected projectName: string | null;
  protected currentGitBranch: string | null;
  protected defaultLoginMethodType: string = process.env.CLOUDFLARE_DEFAULT_LOGIN_METHOD_TYPE || "onetimepin";
  protected defaultAccessEmailDomain: string = process.env.CLOUDFLARE_DEFAULT_ACCESS_EMAIL_DOMAIN || "@cloudity.com";
  protected pagesProjectName: string;
  protected pagesProject: Cloudflare.Pages.Projects.Project;
  protected accessPolicyName: string;
  protected accessPolicy: Cloudflare.ZeroTrust.Access.Policies.PolicyGetResponse | null;
  protected extraPolicyIds: string[] = (process.env.CLOUDFLARE_EXTRA_ACCESS_POLICY_ID_LIST || "").split(",").filter(p => p);
  protected accessApp: Cloudflare.ZeroTrust.Access.Applications.ApplicationGetResponse.SelfHostedApplication | null;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MkDocsToCloudflare);
    this.debugMode = flags.debug || false;

    // Check if the project is a MkDocs project
    const mkdocsYmlFile = path.join(process.cwd(), "mkdocs.yml");
    if (!fs.existsSync(mkdocsYmlFile)) {
      throw new SfError('This command needs a mkdocs.yml config file. Generate one using "sf hardis:doc:project2markdown --with-history"');
    }

    this.currentGitBranch = await getCurrentGitBranch() || "main";
    this.projectName = (process.env.CLOUDFLARE_PROJECT_NAME || this.currentGitBranch).replace(/\//g, "-").toLowerCase();
    this.pagesProjectName = `sfdoc-${this.projectName}`;
    this.accessPolicyName = `access-policy-${this.projectName}`;

    // Create connection to Cloudflare
    this.setupCloudflareClient();

    // Generate HTML pages
    if ((process.env?.SKIP_BUILD_HTML || "false") !== "true") {
      await generateMkDocsHTML();
    }

    // Get or Create Cloudflare Pages project
    await this.ensureCloudflarePagesProject();

    // Ensure there is a policy restricting access to the application
    await this.ensureCloudflareAccessPolicy();

    // Ensure there is an access application
    await this.ensureCloudflareAccessApplication();

    // Ensure the access application has the right policy
    await this.ensureCloudflareAccessApplicationPolicy();

    // Upload pages
    await this.uploadHtmlPages();

    return { success: true };
  }

  private setupCloudflareClient() {
    this.apiEmail = process.env.CLOUDFLARE_EMAIL;
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN;
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!this.apiEmail || !this.accountId || !this.apiToken) {
      throw new Error('Missing CLOUDFLARE_EMAIL or CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID');
    }
    this.client = new Cloudflare({
      apiEmail: this.apiEmail,
      apiToken: this.apiToken,
    });
    uxLog(this, c.grey("Cloudflare client info found"));
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
      uxLog(this, c.green("Cloudflare Pages project created: " + this.pagesProjectName));
    }
    uxLog(this, c.grey(JSON.stringify(this.pagesProject, null, 2)));
  }

  private async ensureCloudflareAccessPolicy() {
    uxLog(this, c.cyan("Checking Cloudflare Access policy..."));
    const accessPolicies = await this.client.zeroTrust.access.policies.list({ account_id: this.accountId || "" });
    this.accessPolicy = accessPolicies.result.find((p: Cloudflare.ZeroTrust.Access.Policies.PolicyGetResponse) => p.name === this.accessPolicyName) || null;
    if (this.accessPolicy) {
      uxLog(this, c.cyan("Cloudflare policy found: " + this.accessPolicyName));
    }
    else {
      const loginMethods = await this.client.zeroTrust.identityProviders.list({ account_id: this.accountId || "" });
      const defaultLoginMethod = loginMethods.result.find((m: Cloudflare.ZeroTrust.IdentityProviders.IdentityProviderListResponse) => m.type === this.defaultLoginMethodType);
      if (!defaultLoginMethod) {
        throw new SfError(`No login method of type ${this.defaultLoginMethodType} found in Cloudflare account. Please create one in Zero Trust/Settings before running this command`);
      }
      this.accessPolicy = await this.client.zeroTrust.access.policies.create({
        name: this.accessPolicyName,
        account_id: this.accountId || "",
        decision: "allow",
        include: [
          { email_domain: { domain: this.defaultAccessEmailDomain } },
        ],
        require: [
          { login_method: { id: defaultLoginMethod.id } }
        ],
      } as any);
      uxLog(this, c.green("Cloudflare policy created: " + this.accessPolicyName));
    }
    uxLog(this, c.grey(JSON.stringify(this.accessPolicy, null, 2)));
  }

  private async ensureCloudflareAccessApplication() {
    uxLog(this, c.cyan("Checking Cloudflare access application..."));
    const accessApplications = await this.client.zeroTrust.access.applications.list({ account_id: this.accountId || "" });
    this.accessApp = (accessApplications.result.find((a: Cloudflare.ZeroTrust.Access.Applications.ApplicationListResponse) => a.name === this.pagesProject?.domains?.[0]) || null) as any;
    if (this.accessApp) {
      uxLog(this, c.cyan("Cloudflare access application found: " + this.pagesProject?.domains?.[0]));
    }
    else {
      this.accessApp = (await this.client.zeroTrust.access.applications.create({
        name: this.pagesProject?.domains?.[0],
        account_id: this.accountId || "",
        type: "self_hosted",
        domain: this.pagesProject?.domains?.[0],
        destinations: [
          {
            "type": "public",
            "uri": `${this.pagesProject?.domains?.[0]}`
          },
          {
            "type": "public",
            "uri": `*.${this.pagesProject?.domains?.[0]}`
          }
        ]
      }) as Cloudflare.ZeroTrust.Access.Applications.ApplicationGetResponse.SelfHostedApplication);
      uxLog(this, c.green("Cloudflare access application created: " + this.pagesProject?.domains?.[0]));
    }
    uxLog(this, c.grey(JSON.stringify(this.accessApp, null, 2)));
  }

  private async ensureCloudflareAccessApplicationPolicy() {
    uxLog(this, c.cyan("Checking Cloudflare access application policy..."));
    if (this.accessApp?.policies?.length && this.accessApp.policies.find(p => p.id === this.accessPolicy?.id)) {
      uxLog(this, c.cyan(`Access Application ${this.accessApp.name} already has the policy ${this.accessPolicy?.name}`));
    }
    else {
      const policiesWithExtra = this.extraPolicyIds.concat([this.accessPolicy?.id || ""]).filter(p => p);
      this.accessApp = (await this.client.zeroTrust.access.applications.update(this.accessApp?.id || "", {
        account_id: this.accountId,
        domain: this.accessApp?.domain,
        destinations: this.accessApp?.destinations,
        type: this.accessApp?.type,
        policies: policiesWithExtra,
      } as Cloudflare.ZeroTrust.Access.ApplicationUpdateParams)) as Cloudflare.ZeroTrust.Access.Applications.ApplicationGetResponse.SelfHostedApplication;
      uxLog(this, c.green(`Access Application ${this.accessApp?.name} updated with the policy ${this.accessPolicy?.name}`));
    }
    uxLog(this, c.grey(JSON.stringify(this.accessApp, null, 2)));
  }

  private async uploadHtmlPages() {
    uxLog(this, c.cyan("Uploading HTML pages to Cloudflare Pages..."));
    let wranglerCommand = `wrangler pages publish ./site --project-name="${this.pagesProjectName}" --branch=${this.currentGitBranch}`;
    const isWranglerAvailable = await which("wrangler", { nothrow: true });
    if (!isWranglerAvailable) {
      wranglerCommand = "npx --yes " + wranglerCommand;
    }
    await execCommand(wranglerCommand, this, { fail: true, output: true, debug: this.debugMode });
  }

}
