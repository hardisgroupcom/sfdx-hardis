/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import fs from 'fs-extra';
import c from "chalk";
import * as path from "path";
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import Cloudflare from 'cloudflare';
import { execCommand, getCurrentGitBranch, uxLog } from '../../../common/utils/index.js';

import { CONSTANTS, getEnvVar } from '../../../config/index.js';
import which from 'which';
import { generateMkDocsHTML } from '../../../common/docBuilder/docUtils.js';


Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class MkDocsToCloudflare extends SfCommand<any> {
  public static title = 'MkDocs to Cloudflare';

  public static description = `## Command Behavior

**Generates MkDocs HTML pages and uploads them to Cloudflare as a static site, secured with Cloudflare Access.**

This command automates the deployment of your project's documentation (built with MkDocs) to Cloudflare Pages, making it accessible and secure. It handles the entire process from HTML generation to Cloudflare configuration.

Key operations performed:

- **MkDocs HTML Generation:** Builds the MkDocs project into static HTML pages. It can use a locally installed \`mkdocs-material\` or a \`mkdocs\` Docker image.
- **Cloudflare Pages Project Creation/Update:** Creates a new Cloudflare Pages project if one doesn't exist for your documentation, or updates an existing one.
- **Cloudflare Access Policy Assignment:** Assigns a policy to restrict access to the deployed application, ensuring only authorized users can view your documentation.
- **Cloudflare Access Application Setup:** Configures a Cloudflare Access application for the deployed site, integrating it with your Zero Trust policies.
- **HTML Page Upload:** Deploys the generated HTML pages to Cloudflare Pages.
- **Browser Opening (Non-CI):** Opens the newly deployed website in your default browser if the command is not run in a CI/CD environment.

**Prerequisite:** The documentation must have been previously generated using \`sf hardis:doc:project2markdown --with-history\`.

**Customization:** You can override default styles by customizing your \`mkdocs.yml\` file.

More information can be found in the [Documentation section](${CONSTANTS.DOC_URL_ROOT}/salesforce-project-documentation/).

**Environment Variables for Cloudflare Configuration:**

| Variable                                  | Description                                                              | Default                               |\
| :---------------------------------------- | :----------------------------------------------------------------------- | :------------------------------------: |\
| \`CLOUDFLARE_EMAIL\`                        | Cloudflare account email                                                 | _Required_                            |\
| \`CLOUDFLARE_API_TOKEN\`                    | Cloudflare API token                                                     | _Required_                            |\
| \`CLOUDFLARE_ACCOUNT_ID\`                   | Cloudflare account ID                                                    | _Required_                            |\
| \`CLOUDFLARE_PROJECT_NAME\`                 | Project name, also used for the site URL                                 | Built from Git branch name            |\
| \`CLOUDFLARE_DEFAULT_LOGIN_METHOD_TYPE\`    | Cloudflare default login method type                                     | \`onetimepin\`                          |\
| \`CLOUDFLARE_DEFAULT_ACCESS_EMAIL_DOMAIN\`  | Cloudflare default access email domain                                   | \`@cloudity.com\`                       |\
| \`CLOUDFLARE_EXTRA_ACCESS_POLICY_ID_LIST\`  | Comma-separated list of additional policy IDs to assign to the application | _Optional_                            |\

<details markdown="1">
<summary>Technical explanations</summary>

The command orchestrates interactions with MkDocs, Cloudflare APIs, and Git:

- **MkDocs Integration:** It calls \`generateMkDocsHTML()\` to execute the MkDocs build process, which converts Markdown files into static HTML. It checks for the presence of \`mkdocs.yml\` to ensure it's a valid MkDocs project.
- **Cloudflare API Interaction:** It uses the \`cloudflare\` npm package to interact with the Cloudflare API. This involves:
  - **Authentication:** Initializes the Cloudflare client using \`CLOUDFLARE_EMAIL\`, \`CLOUDFLARE_API_TOKEN\`, and \`CLOUDFLARE_ACCOUNT_ID\` environment variables.
  - **Pages Project Management:** Calls \`client.pages.projects.get()\` to check for an existing project and \`client.pages.projects.create()\` to create a new one if needed.
  - **Access Policy Management:** Lists existing access policies (\`client.zeroTrust.access.policies.list()\`) and creates a new one (\`client.zeroTrust.access.policies.create()\`) if the required policy doesn't exist. It configures the policy with email domain restrictions and a default login method.
  - **Access Application Management:** Lists existing access applications (\`client.zeroTrust.access.applications.list()\`) and creates a new one (\`client.zeroTrust.access.applications.create()\`) for the deployed site. It then updates the application to associate it with the created access policy.
- **Git Integration:** Retrieves the current Git branch name using \`getCurrentGitBranch()\` to construct the Cloudflare project name and branch for deployment.
- **Wrangler CLI:** Uses the \`wrangler\` CLI (Cloudflare's developer tool) to deploy the generated HTML pages to Cloudflare Pages via \`wrangler pages deploy\`.
- **Environment Variable Management:** Reads various environment variables to configure Cloudflare settings and project names.
- **Error Handling:** Includes checks for missing \`mkdocs.yml\` and Cloudflare environment variables, throwing \`SfError\` when necessary.
</details>
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
    })
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected debugMode = false;
  protected apiEmail: string | undefined;
  protected apiToken: string | undefined;
  protected accountId: string | undefined;
  protected client: Cloudflare;
  protected projectName: string | null;
  protected currentGitBranch: string;
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
    this.projectName = await this.getProjectName();
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

  // Search first for CLOUDFLARE_PROJECT_NAME_<lang> env var, then CLOUDFLARE_PROJECT_NAME, then git branch name
  // If none of them is found, use the default project name
  private async getProjectName(): Promise<string> {
    const defaultProjectName = (getEnvVar('CLOUDFLARE_PROJECT_NAME') || this.currentGitBranch).replace(/\//g, "-").toLowerCase();
    const promptsLanguage = getEnvVar('PROMPTS_LANGUAGE') || 'en';
    const languageScopedProjectVariableName = `CLOUDFLARE_PROJECT_NAME_${promptsLanguage?.toUpperCase()}`;
    if (getEnvVar(languageScopedProjectVariableName)) {
      return getEnvVar(languageScopedProjectVariableName) || defaultProjectName;
    }
    return defaultProjectName
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
    uxLog("log", this, c.grey("Cloudflare client info found."));
  }

  private async ensureCloudflarePagesProject() {
    uxLog("action", this, c.cyan("Checking Cloudflare Pages project."));
    try {
      this.pagesProject = await this.client.pages.projects.get(this.pagesProjectName, { account_id: this.accountId || "" });
      uxLog("action", this, c.cyan("Cloudflare Pages project found: " + this.pagesProjectName));
    } catch (e: any) {
      uxLog("log", this, c.grey(e.message));
      this.pagesProject = await this.client.pages.projects.create({
        name: this.pagesProjectName,
        account_id: this.accountId || "",
        production_branch: this.currentGitBranch || "main",
      });
      uxLog("success", this, c.green("Cloudflare Pages project created: " + this.pagesProjectName));
    }
    uxLog("log", this, c.grey(JSON.stringify(this.pagesProject, null, 2)));
  }

  private async ensureCloudflareAccessPolicy() {
    uxLog("action", this, c.cyan("Checking Cloudflare Access policy."));
    const accessPolicies = await this.client.zeroTrust.access.policies.list({ account_id: this.accountId || "" });
    this.accessPolicy = accessPolicies.result.find((p: Cloudflare.ZeroTrust.Access.Policies.PolicyGetResponse) => p.name === this.accessPolicyName) || null;
    if (this.accessPolicy) {
      uxLog("action", this, c.cyan("Cloudflare policy found: " + this.accessPolicyName));
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
      uxLog("success", this, c.green("Cloudflare policy created: " + this.accessPolicyName + "."));
    }
    uxLog("log", this, c.grey(JSON.stringify(this.accessPolicy, null, 2)));
  }

  private async ensureCloudflareAccessApplication() {
    uxLog("action", this, c.cyan("Checking Cloudflare access application."));
    const accessApplications = await this.client.zeroTrust.access.applications.list({ account_id: this.accountId || "" });
    this.accessApp = (accessApplications.result.find((a: Cloudflare.ZeroTrust.Access.Applications.ApplicationListResponse) => a.name === this.pagesProject?.domains?.[0]) || null) as any;
    if (this.accessApp) {
      uxLog("action", this, c.cyan("Cloudflare access application found: " + this.pagesProject?.domains?.[0]));
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
      uxLog("success", this, c.green("Cloudflare access application created: " + this.pagesProject?.domains?.[0] + "."));
    }
    uxLog("log", this, c.grey(JSON.stringify(this.accessApp, null, 2)));
  }

  private async ensureCloudflareAccessApplicationPolicy() {
    uxLog("action", this, c.cyan("Checking Cloudflare access application policy."));
    if (this.accessApp?.policies?.length && this.accessApp.policies.find(p => p.id === this.accessPolicy?.id)) {
      uxLog("action", this, c.cyan(`Access Application ${this.accessApp.name} already has the policy ${this.accessPolicy?.name}.`));
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
      uxLog("success", this, c.green(`Access Application ${this.accessApp?.name} updated with the policy ${this.accessPolicy?.name}.`));
    }
    uxLog("log", this, c.grey(JSON.stringify(this.accessApp, null, 2)));
  }

  private async uploadHtmlPages() {
    uxLog("action", this, c.cyan("Uploading HTML pages to Cloudflare Pages."));
    let wranglerCommand = `wrangler pages deploy ./site --project-name="${this.pagesProjectName}" --branch=${this.currentGitBranch}`;
    const isWranglerAvailable = await which("wrangler", { nothrow: true });
    if (!isWranglerAvailable) {
      wranglerCommand = "npx --yes " + wranglerCommand;
    }
    await execCommand(wranglerCommand, this, { fail: true, output: true, debug: this.debugMode });
  }

}
