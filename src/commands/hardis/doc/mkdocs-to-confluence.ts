/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import fs from 'fs-extra';
import c from "chalk";
import * as os from "os";
import * as path from "path";
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import axios, { AxiosInstance } from 'axios';
import { uxLog, uxLogTable } from '../../../common/utils/index.js';
import { generateCsvFile, generateReportPath } from '../../../common/utils/filesUtils.js';
import { CONSTANTS, getEnvVar, getLocalizedEnvVar } from '../../../config/index.js';
import { readMkDocsFile } from '../../../common/docBuilder/docUtils.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { t } from '../../../common/utils/i18n.js';
import { convertMermaidBlocksToImages } from '../../../common/utils/mermaidUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class MkDocsToConfluence extends SfCommand<any> {
  public static title = 'MkDocs to Confluence';

  public static description = `## Command Behavior

**Reads MkDocs markdown pages and navigation structure, converts them into Confluence-compatible format, and publishes them to a Confluence space.**

This command automates the deployment of your project's MkDocs documentation to Atlassian Confluence, preserving the navigation hierarchy as nested Confluence pages. Links between pages and embedded images are automatically converted to work in Confluence.

Key operations performed:

- **MkDocs Navigation Parsing:** Reads the \`mkdocs.yml\` file to extract the navigation structure (\`nav\` key), which defines the page hierarchy.
- **Markdown to Confluence Conversion:** Converts each Markdown file into Confluence Storage Format (XHTML), handling:
  - **Internal links:** Rewrites \`[text](page.md)\` links into Confluence page links using \`<ac:link>\` macros.
  - **Images:** Uploads images as attachments to the corresponding Confluence page and replaces Markdown image references with \`<ac:image>\` macros.
  - **Code blocks:** Converts fenced code blocks into Confluence \`<ac:structured-macro>\` code blocks.
  - **Standard Markdown:** Converts headings, lists, tables, bold, italic, and other formatting to Confluence-compatible XHTML.
- **Page Hierarchy:** Creates Confluence pages mirroring the MkDocs navigation tree, with parent-child relationships matching the nav structure.
- **Incremental Updates:** If a page already exists in Confluence, it is updated (with an incremented version number) rather than duplicated.

**Environment Variables for Confluence Configuration:**

Two authentication methods are supported: **Basic Auth** (username + API token) or **OAuth2 service account** (client credentials).

| Variable                          | Description                                                               | Default              |
| :-------------------------------- | :------------------------------------------------------------------------ | :------------------: |
| \`CONFLUENCE_SPACE_KEY\`           | Confluence space key where pages will be published                        | _Required_           |
| \`CONFLUENCE_PARENT_PAGE_ID\`      | ID of the parent page under which all doc pages will be created           | Space root           |
| \`CONFLUENCE_PAGE_PREFIX\`         | Prefix added to all page titles to avoid name collisions                  | \`[Doc] \`            |
| \`CONFLUENCE_PAGE_SUFFIX\`         | Suffix added to all page titles to avoid name collisions                  | _Empty_              |
| **Basic Auth**                    |                                                                           |                      |
| \`CONFLUENCE_BASE_URL\`            | Confluence instance base URL (e.g. \`https://mycompany.atlassian.net\`)    | _Required for Basic_ |
| \`CONFLUENCE_USERNAME\`            | Confluence username (email for Confluence Cloud)                          | _Required for Basic_ |
| \`CONFLUENCE_TOKEN\`               | Confluence API token (personal access token)                              | _Required for Basic_ |
| **OAuth2 (service account)**      |                                                                           |                      |
| \`CONFLUENCE_CLIENT_ID\`           | Atlassian OAuth2 client ID                                                | _Required for OAuth_ |
| \`CONFLUENCE_CLIENT_SECRET\`       | Atlassian OAuth2 client secret                                            | _Required for OAuth_ |
| \`CONFLUENCE_BASE_URL\`            | Confluence instance base URL, used to match the right Atlassian resource  | First available      |

For \`CONFLUENCE_SPACE_KEY\`, \`CONFLUENCE_PARENT_PAGE_ID\`, \`CONFLUENCE_PAGE_PREFIX\`, and \`CONFLUENCE_PAGE_SUFFIX\`,
the command first checks a language-scoped variable for the current i18n locale, then falls back to the default one.
Examples: \`CONFLUENCE_SPACE_KEY_FR\`, \`CONFLUENCE_PARENT_PAGE_ID_NL\`, \`CONFLUENCE_PAGE_SUFFIX_PT_BR\`.

**Prerequisite:** The documentation must have been previously generated using \`sf hardis:doc:project2markdown\`.

More information can be found in the [Documentation section](${CONSTANTS.DOC_URL_ROOT}/salesforce-project-documentation/).

<details markdown="1">
<summary>Technical explanations</summary>

The command orchestrates interactions with MkDocs configuration, Markdown conversion, and the Confluence REST API:

- **MkDocs Navigation Parsing:** Uses \`readMkDocsFile()\` to load and parse \`mkdocs.yml\`, then recursively traverses the \`nav\` structure to build a flat list of pages with their hierarchy (parent-child relationships).
- **Markdown to Confluence Storage Format:** Each Markdown file is read from the \`docs/\` folder and converted to Confluence Storage Format (a subset of XHTML). The conversion handles:
  - Fenced code blocks (\`\`\`) → \`<ac:structured-macro ac:name="code">\` with language parameter.
  - Internal page links \`[text](file.md)\` → \`<ac:link><ri:page ri:content-title="..." /><ac:plain-text-link-body><![CDATA[text]]></ac:plain-text-link-body></ac:link>\`.
  - Images \`![alt](path)\` → uploaded as attachments, then referenced with \`<ac:image><ri:attachment ri:filename="..." /></ac:image>\`.
  - Tables, headings, lists, bold, italic → standard HTML equivalents compatible with Confluence storage format.
- **Confluence REST API v2:** Uses the Confluence Cloud REST API (\`/wiki/api/v2/\`) for page operations (create/update) and v1 API (\`/wiki/rest/api/\`) for attachment uploads:
  - Searches for existing pages by title within the target space.
  - Creates new pages or updates existing ones with the converted content and correct parent-child relationships.
  - Uploads image files as attachments to their respective pages.
- **Authentication:** Supports two modes:
  - **Basic Auth:** Uses HTTP Basic Auth with \`CONFLUENCE_USERNAME\` and \`CONFLUENCE_TOKEN\`.
  - **OAuth2 (service account):** Exchanges \`CONFLUENCE_CLIENT_ID\` / \`CONFLUENCE_CLIENT_SECRET\` for a Bearer token via the Atlassian OAuth2 client-credentials endpoint (\`https://api.atlassian.com/oauth/token\`). The Atlassian Cloud ID is resolved from the accessible-resources endpoint and the base URL is automatically set to \`https://api.atlassian.com/ex/confluence/{cloudId}\`.
- **Error Handling:** Reports per-page errors without stopping the entire process, allowing partial deployments. A summary of failed pages is shown at the end.
</details>
`;

  public static examples = [
    '$ sf hardis:doc:mkdocs-to-confluence',
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
    confluenceSpaceKey: Flags.string({
      description: 'Confluence space key. Overrides CONFLUENCE_SPACE_KEY[_<LANG>] env vars',
    }),
    confluenceParentPageId: Flags.string({
      description: 'Confluence parent page ID. Overrides CONFLUENCE_PARENT_PAGE_ID[_<LANG>] env vars',
    }),
    confluencePagePrefix: Flags.string({
      description: 'Confluence page title prefix. Overrides CONFLUENCE_PAGE_PREFIX[_<LANG>] env vars',
    }),
    confluencePageSuffix: Flags.string({
      description: 'Confluence page title suffix. Overrides CONFLUENCE_PAGE_SUFFIX[_<LANG>] env vars',
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    })
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected debugMode = false;
  protected confluenceBaseUrl: string;
  protected confluenceSpaceKey: string;
  protected confluenceUsername: string;
  protected confluenceToken: string;
  protected confluenceParentPageId: string | null;
  protected confluencePagePrefix: string;
  protected confluencePageSuffix: string;
  protected confluenceClientId: string | null;
  protected confluenceClientSecret: string | null;
  protected axiosClient: AxiosInstance;
  protected docsRoot: string;
  // Map from markdown file relative path to Confluence page ID
  protected pageIdMap: Map<string, string> = new Map();
  // Map from markdown file relative path to Confluence page title
  protected pageTitleMap: Map<string, string> = new Map();
  protected failedPages: string[] = [];
  protected spaceId: string;
  protected publishedPageCount = 0;
  // Per-page report rows (populated during publishing)
  protected pageReportRows: Array<{ type: string; pageName: string; file: string; status: string; failureReason: string; url: string }> = [];
  protected outputFilesRes: any = {};
  protected outputFile: string;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MkDocsToConfluence);
    this.debugMode = flags.debug || false;

    // Check if the project has a mkdocs.yml
    const mkdocsYmlFile = path.join(process.cwd(), "mkdocs.yml");
    if (!fs.existsSync(mkdocsYmlFile)) {
      throw new SfError('This command needs a mkdocs.yml config file. Generate one using "sf hardis:doc:project2markdown"');
    }

    this.docsRoot = path.join(process.cwd(), "docs");
    if (!fs.existsSync(this.docsRoot)) {
      throw new SfError('No docs/ folder found. Generate documentation first using "sf hardis:doc:project2markdown"');
    }

    // Setup Confluence connection
    await this.setupConfluenceClient(flags);

    // Read mkdocs.yml nav structure
    const mkdocsYml = readMkDocsFile(mkdocsYmlFile);
    const navItems = mkdocsYml.nav || [];

    // Resolve the space ID
    await this.resolveSpaceId();

    // Validate the parent page exists (fails fast if CONFLUENCE_PARENT_PAGE_ID is stale or wrong)
    await this.validateParentPage();

    // Build page title map first (needed for link resolution)
    this.buildPageTitleMap(navItems, "");

    // Publish pages recursively following the nav tree
    const totalPages = this.pageTitleMap.size;
    uxLog("action", this, c.cyan(t('publishingPagesToConfluence', { count: totalPages })));
    WebSocketClient.sendProgressStartMessage(t('publishingPagesToConfluence', { count: totalPages }), totalPages);
    await this.publishNavItems(navItems, this.confluenceParentPageId);
    WebSocketClient.sendProgressEndMessage(totalPages);

    // Build and write the CSV/XLSX report
    this.outputFile = await generateReportPath('mkdocs-to-confluence', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.pageReportRows, this.outputFile, {
      fileTitle: t('confluenceDeploymentSummary'),
      columnsCustomStyles: {
        type: { width: 10 },
        pageName: { width: 40 },
        file: { width: 40 },
        status: { width: 12 },
        failureReason: { width: 60, wrap: true },
        url: { width: 60, hyperlinkFromValue: true },
      },
    });

    // Summary table
    const summaryRows = [
      ...Array.from(this.pageTitleMap.entries()).map(([file, title]) => ({
        page: title,
        file,
        result: this.failedPages.includes(file)
          ? c.red('✗ ' + t('confluencePublishFailed'))
          : c.green('✓ ' + t('confluencePublishSuccess')),
      })),
    ];
    uxLog("action", this, c.bold(t('confluenceDeploymentSummary')));
    uxLogTable(this, summaryRows, ['page', 'file', 'result']);

    const publishedCount = this.pageTitleMap.size - this.failedPages.length;
    if (this.failedPages.length > 0) {
      uxLog("warning", this, c.yellow(t('confluenceSomePagesFailedToPublish', { count: this.failedPages.length })));
    }
    uxLog("action", this, c.cyan(t('confluencePublishedCount', { published: publishedCount, total: this.pageTitleMap.size })));

    if (this.failedPages.length === 0) {
      uxLog("success", this, c.green(t('confluenceAllPagesPublishedSuccessfully', { count: this.pageTitleMap.size })));
    }

    return { success: this.failedPages.length === 0, publishedPages: this.pageTitleMap.size, failedPages: this.failedPages.length, outputFile: this.outputFilesRes?.csvFile || null };
  }

  private async setupConfluenceClient(flags: Record<string, unknown>) {
    this.confluenceBaseUrl = (getEnvVar('CONFLUENCE_BASE_URL') || '').replace(/\/+$/, '');
    this.confluenceSpaceKey = (flags.confluenceSpaceKey as string) || getLocalizedEnvVar('CONFLUENCE_SPACE_KEY') || '';
    this.confluenceUsername = getEnvVar('CONFLUENCE_USERNAME') || '';
    this.confluenceToken = getEnvVar('CONFLUENCE_TOKEN') || '';
    this.confluenceClientId = getEnvVar('CONFLUENCE_CLIENT_ID') || null;
    this.confluenceClientSecret = getEnvVar('CONFLUENCE_CLIENT_SECRET') || null;
    this.confluenceParentPageId = (flags.confluenceParentPageId as string) || getLocalizedEnvVar('CONFLUENCE_PARENT_PAGE_ID') || null;
    this.confluencePagePrefix = (flags.confluencePagePrefix as string) || getLocalizedEnvVar('CONFLUENCE_PAGE_PREFIX') || '[Doc] ';
    this.confluencePageSuffix = (flags.confluencePageSuffix as string) || getLocalizedEnvVar('CONFLUENCE_PAGE_SUFFIX') || '';

    if (!this.confluenceSpaceKey) {
      WebSocketClient.sendReportFileMessage(
        `${CONSTANTS.DOC_URL_ROOT}/salesforce-project-documentation/`,
        t('confluenceDocumentation'),
        'docUrl'
      );
      uxLog("error", this, c.red(t('confluenceSetupInstructions')));
      throw new SfError('Missing CONFLUENCE_SPACE_KEY');
    }

    // OAuth2 service account (client credentials)
    if (this.confluenceClientId && this.confluenceClientSecret) {
      uxLog("log", this, c.grey(t('confluenceUsingClientCredentials')));
      const accessToken = await this.getOAuthToken();
      const cloudId = await this.getCloudId(accessToken);
      this.confluenceBaseUrl = `https://api.atlassian.com/ex/confluence/${cloudId}`;
      this.axiosClient = axios.create({
        baseURL: this.confluenceBaseUrl,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      uxLog("log", this, c.grey(t('confluenceClientCredentialsConfigured', { baseUrl: this.confluenceBaseUrl, spaceKey: this.confluenceSpaceKey })));
      return;
    }

    // Basic Auth
    if (!this.confluenceBaseUrl || !this.confluenceUsername || !this.confluenceToken) {
      WebSocketClient.sendReportFileMessage(
        `${CONSTANTS.DOC_URL_ROOT}/salesforce-project-documentation/`,
        t('confluenceDocumentation'),
        'docUrl'
      );
      uxLog("error", this, c.red(t('confluenceSetupInstructions')));
      throw new SfError('Missing CONFLUENCE_BASE_URL, CONFLUENCE_USERNAME, or CONFLUENCE_TOKEN (or use CONFLUENCE_CLIENT_ID + CONFLUENCE_CLIENT_SECRET for OAuth2)');
    }

    this.axiosClient = axios.create({
      baseURL: this.confluenceBaseUrl,
      auth: {
        username: this.confluenceUsername,
        password: this.confluenceToken,
      },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    uxLog("log", this, c.grey(t('confluenceClientConfigured', { baseUrl: this.confluenceBaseUrl, spaceKey: this.confluenceSpaceKey })));
  }

  private async getOAuthToken(): Promise<string> {
    const tokenResponse = await axios.post('https://api.atlassian.com/oauth/token', {
      audience: 'api.atlassian.com',
      grant_type: 'client_credentials',
      client_id: this.confluenceClientId,
      client_secret: this.confluenceClientSecret,
    });
    return tokenResponse.data.access_token;
  }

  private async getCloudId(accessToken: string): Promise<string> {
    const resourcesResponse = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const resources: any[] = resourcesResponse.data || [];
    let cloudId = '';
    for (const resource of resources) {
      if (this.confluenceBaseUrl && (this.confluenceBaseUrl.includes(resource.url) || resource.url.includes(this.confluenceBaseUrl))) {
        cloudId = resource.id;
        break;
      }
    }
    if (!cloudId && resources.length > 0) {
      cloudId = resources[0].id; // Fallback to first available resource
    }
    if (!cloudId) {
      throw new SfError('Could not resolve Atlassian Cloud ID from accessible resources. Check CONFLUENCE_CLIENT_ID and CONFLUENCE_CLIENT_SECRET.');
    }
    return cloudId;
  }

  private async validateParentPage() {
    if (!this.confluenceParentPageId) {
      return; // No parent page configured, nothing to validate
    }
    try {
      await this.axiosClient.get(`/wiki/api/v2/pages/${this.confluenceParentPageId}`);
      uxLog("log", this, c.grey(t('confluenceParentPageValidated', { pageId: this.confluenceParentPageId })));
    } catch (e: any) {
      const statusCode = e.response?.status;
      if (statusCode === 404) {
        throw new SfError(
          t('confluenceParentPageNotFound', { pageId: this.confluenceParentPageId }) +
          '\nPlease update the CONFLUENCE_PARENT_PAGE_ID environment variable with a valid page ID.'
        );
      }
      // For other errors (auth, network) just re-throw
      throw e;
    }
  }

  private async resolveSpaceId() {
    uxLog("action", this, c.cyan(t('confluenceResolvingSpaceId', { spaceKey: this.confluenceSpaceKey })));
    const response = await this.axiosClient.get('/wiki/api/v2/spaces', {
      params: { keys: this.confluenceSpaceKey },
    });
    const spaces = response.data?.results || [];
    if (spaces.length === 0) {
      throw new SfError(`Confluence space "${this.confluenceSpaceKey}" not found.`);
    }
    this.spaceId = spaces[0].id;
    uxLog("log", this, c.grey(t('confluenceSpaceResolved', { spaceKey: this.confluenceSpaceKey, spaceId: this.spaceId })));
  }

  /**
   * Build a map from markdown file path to page title from nav items (before any API calls).
   */
  private buildPageTitleMap(navItems: any[], _parentPath: string) {
    for (const item of navItems) {
      if (typeof item === 'string') {
        // Direct file reference without title
        const title = this.computePagePrefix(item) + this.titleFromFilePath(item) + this.confluencePageSuffix;
        this.pageTitleMap.set(item, title);
      } else if (typeof item === 'object') {
        for (const [label, value] of Object.entries(item)) {
          if (typeof value === 'string') {
            // Leaf page: { "Label": "file.md" }
            const title = this.computePagePrefix(value as string) + label + this.confluencePageSuffix;
            this.pageTitleMap.set(value as string, title);
          } else if (Array.isArray(value)) {
            // Section with array children: { "Label": [ ... ] }
            this.buildPageTitleMap(value as any[], label);
          } else if (typeof value === 'object' && value !== null) {
            // Section with flat object children: { "Label": { "Child": "file.md", ... } }
            this.buildPageTitleMapFromObject(value as Record<string, any>);
          }
        }
      }
    }
  }

  /**
   * Register titles for a flat-object nav section, e.g. { "Account": "objects/Account.md", ... }
   */
  private buildPageTitleMapFromObject(obj: Record<string, any>) {
    for (const [childLabel, childValue] of Object.entries(obj)) {
      if (typeof childValue === 'string') {
        this.pageTitleMap.set(childValue, this.computePagePrefix(childValue) + childLabel + this.confluencePageSuffix);
      } else if (Array.isArray(childValue)) {
        this.buildPageTitleMap(childValue as any[], childLabel);
      } else if (typeof childValue === 'object' && childValue !== null) {
        this.buildPageTitleMapFromObject(childValue as Record<string, any>);
      }
    }
  }

  private titleFromFilePath(filePath: string): string {
    const baseName = path.basename(filePath, '.md');
    return baseName
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  /**
   * Recursively publish pages from the mkdocs nav structure.
   * Siblings at each level are published in parallel (up to CONFLUENCE_PUBLISH_CONCURRENCY).
   * After publishing, pages are reordered via the Confluence move API to match nav order.
   */
  private async publishNavItems(navItems: any[], parentPageId: string | null) {
    const tasks: Array<() => Promise<void>> = [];
    const orderedPageIds: Array<string | null> = [];
    for (const item of navItems) {
      if (typeof item === 'string') {
        const slotIdx = orderedPageIds.length;
        orderedPageIds.push(null);
        tasks.push(async () => {
          await this.publishPage(item, this.pageTitleMap.get(item) || this.computePagePrefix(item) + this.titleFromFilePath(item) + this.confluencePageSuffix, parentPageId);
          orderedPageIds[slotIdx] = this.pageIdMap.get(item) || null;
        });
      } else if (typeof item === 'object') {
        for (const [label, value] of Object.entries(item)) {
          const slotIdx = orderedPageIds.length;
          orderedPageIds.push(null);
          if (typeof value === 'string') {
            // Leaf page: { "Label": "file.md" }
            tasks.push(async () => {
              await this.publishPage(value as string, this.pageTitleMap.get(value as string) || this.computePagePrefix(value as string) + label + this.confluencePageSuffix, parentPageId);
              orderedPageIds[slotIdx] = this.pageIdMap.get(value as string) || null;
            });
          } else if (Array.isArray(value)) {
            // Section with array children: create container then process children
            tasks.push(async () => {
              const sectionTitle = this.confluencePagePrefix + label + this.confluencePageSuffix;
              try {
                const sectionPageId = await this.createOrUpdatePage(sectionTitle, `<p>${this.escapeXml(label)}</p>`, parentPageId);
                orderedPageIds[slotIdx] = sectionPageId;
                if (sectionPageId) {
                  await this.publishNavItems(value as any[], sectionPageId);
                }
              } catch (e: any) {
                uxLog("warning", this, c.yellow(t('confluencePagePublishError', { title: sectionTitle, error: this.apiErrorMessage(e) })));
              }
            });
          } else if (typeof value === 'object' && value !== null) {
            // Section with flat object children: { "Label": { "Child": "file.md", ... } }
            tasks.push(async () => {
              const sectionTitle = this.confluencePagePrefix + label + this.confluencePageSuffix;
              try {
                const sectionPageId = await this.createOrUpdatePage(sectionTitle, `<p>${this.escapeXml(label)}</p>`, parentPageId);
                orderedPageIds[slotIdx] = sectionPageId;
                if (sectionPageId) {
                  await this.publishNavItemsFromObject(value as Record<string, any>, sectionPageId);
                }
              } catch (e: any) {
                uxLog("warning", this, c.yellow(t('confluencePagePublishError', { title: sectionTitle, error: this.apiErrorMessage(e) })));
              }
            });
          }
        }
      }
    }
    await this.runInParallel(tasks);
    // Reorder sibling pages to match nav order
    await this.reorderChildPages(orderedPageIds.filter((id): id is string => id !== null));
  }

  /**
   * Publish pages from a flat-object nav section, e.g. { "Account": "objects/Account.md", ... }
   */
  private async publishNavItemsFromObject(obj: Record<string, any>, parentPageId: string | null) {
    const tasks: Array<() => Promise<void>> = [];
    const orderedPageIds: Array<string | null> = [];
    for (const [childLabel, childValue] of Object.entries(obj)) {
      const slotIdx = orderedPageIds.length;
      orderedPageIds.push(null);
      if (typeof childValue === 'string') {
        tasks.push(async () => {
          await this.publishPage(childValue, this.pageTitleMap.get(childValue) || this.computePagePrefix(childValue) + childLabel + this.confluencePageSuffix, parentPageId);
          orderedPageIds[slotIdx] = this.pageIdMap.get(childValue) || null;
        });
      } else if (Array.isArray(childValue)) {
        tasks.push(async () => {
          const sectionTitle = this.confluencePagePrefix + childLabel + this.confluencePageSuffix;
          try {
            const sectionPageId = await this.createOrUpdatePage(sectionTitle, `<p>${this.escapeXml(childLabel)}</p>`, parentPageId);
            orderedPageIds[slotIdx] = sectionPageId;
            if (sectionPageId) {
              await this.publishNavItems(childValue as any[], sectionPageId);
            }
          } catch (e: any) {
            uxLog("warning", this, c.yellow(t('confluencePagePublishError', { title: sectionTitle, error: this.apiErrorMessage(e) })));
          }
        });
      } else if (typeof childValue === 'object' && childValue !== null) {
        tasks.push(async () => {
          const sectionTitle = this.confluencePagePrefix + childLabel + this.confluencePageSuffix;
          try {
            const sectionPageId = await this.createOrUpdatePage(sectionTitle, `<p>${this.escapeXml(childLabel)}</p>`, parentPageId);
            orderedPageIds[slotIdx] = sectionPageId;
            if (sectionPageId) {
              await this.publishNavItemsFromObject(childValue as Record<string, any>, sectionPageId);
            }
          } catch (e: any) {
            uxLog("warning", this, c.yellow(t('confluencePagePublishError', { title: sectionTitle, error: this.apiErrorMessage(e) })));
          }
        });
      }
    }
    await this.runInParallel(tasks);
    // Reorder sibling pages to match nav order
    await this.reorderChildPages(orderedPageIds.filter((id): id is string => id !== null));
  }

  /**
   * Publish a single markdown page to Confluence.
   */
  private async publishPage(mdRelPath: string, title: string, parentPageId: string | null) {
    const mdFilePath = path.join(this.docsRoot, mdRelPath);
    if (!fs.existsSync(mdFilePath)) {
      uxLog("warning", this, c.yellow(t('confluenceMarkdownFileNotFound', { file: mdRelPath })));
      this.failedPages.push(mdRelPath);
      this.pageReportRows.push({ type: 'page', pageName: title, file: mdRelPath, status: 'failure', failureReason: t('confluenceMarkdownFileNotFound', { file: mdRelPath }), url: '' });
      return;
    }

    const tempDir = path.join(os.tmpdir(), `sfdx-hardis-mermaid-${Date.now()}`);
    try {
      uxLog("action", this, c.cyan(t('confluencePublishingPage', { title, file: mdRelPath })));

      let markdownContent = await fs.readFile(mdFilePath, 'utf-8');
      // Strip UTF-8 BOM that some editors (e.g. Notepad on Windows) add to files
      if (markdownContent.charCodeAt(0) === 0xFEFF) {
        markdownContent = markdownContent.slice(1);
      }

      // Strip YAML frontmatter
      markdownContent = this.stripFrontmatter(markdownContent);

      // Convert MermaidJS diagrams to images in a temp directory (Confluence does not support mermaid natively)
      const { markdownWithImages, mermaidImages, mermaidResults } = await convertMermaidBlocksToImages(markdownContent, tempDir, mdRelPath);

      // Track mermaid conversion results in report
      for (const mr of mermaidResults) {
        this.pageReportRows.push({ type: 'mermaid', pageName: title, file: mr.imageName, status: mr.status, failureReason: mr.failureReason, url: '' });
      }

      // Convert markdown to Confluence storage format
      const confluenceContent = this.convertMarkdownToConfluenceStorage(markdownWithImages, mdRelPath);

      // Create or update the page
      const pageId = await this.createOrUpdatePage(title, confluenceContent, parentPageId);

      if (pageId) {
        this.pageIdMap.set(mdRelPath, pageId);

        // Upload images referenced in original markdown as attachments
        const imageUploadResults = await this.uploadImagesForPage(markdownContent, mdRelPath, pageId);
        for (const ir of imageUploadResults) {
          this.pageReportRows.push({ type: 'image', pageName: title, file: ir.fileName, status: ir.status, failureReason: ir.failureReason, url: '' });
        }

        // Upload mermaid-generated images as attachments
        for (const imgFile of mermaidImages) {
          if (fs.existsSync(imgFile)) {
            const imgName = path.basename(imgFile);
            try {
              await this.uploadAttachment(pageId, imgFile, imgName);
              this.pageReportRows.push({ type: 'image', pageName: title, file: imgName, status: 'success', failureReason: '', url: '' });
              uxLog("log", this, c.grey(t('confluenceImageUploaded', { image: imgName, page: mdRelPath })));
            } catch (e: any) {
              this.pageReportRows.push({ type: 'image', pageName: title, file: imgName, status: 'failure', failureReason: this.apiErrorMessage(e), url: '' });
              uxLog("warning", this, c.yellow(t('confluenceImageUploadError', { image: imgName, error: this.apiErrorMessage(e) })));
            }
          }
        }

        const pageUrl = `${this.confluenceBaseUrl}/wiki/spaces/${this.confluenceSpaceKey}/pages/${pageId}`;
        this.pageReportRows.push({ type: 'page', pageName: title, file: mdRelPath, status: 'success', failureReason: '', url: pageUrl });
        uxLog("success", this, c.green(t('confluencePagePublished', { title })));
        this.publishedPageCount++;
        WebSocketClient.sendProgressStepMessage(this.publishedPageCount, this.pageTitleMap.size);
      }
    } catch (e: any) {
      uxLog("warning", this, c.yellow(t('confluencePagePublishError', { title, error: this.apiErrorMessage(e) })));
      this.failedPages.push(mdRelPath);
      this.pageReportRows.push({ type: 'page', pageName: title, file: mdRelPath, status: 'failure', failureReason: this.apiErrorMessage(e), url: '' });
    } finally {
      // Clean up temp directory used for mermaid image generation
      if (fs.existsSync(tempDir)) {
        await fs.remove(tempDir);
      }
    }
  }


  private stripFrontmatter(content: string): string {
    const frontmatterRegex = /^---\s*\n[\s\S]*?\n---\s*\n/;
    return content.replace(frontmatterRegex, '');
  }

  /**
   * Convert markdown text to Confluence Storage Format (XHTML subset).
   */
  protected convertMarkdownToConfluenceStorage(markdown: string, currentFilePath: string): string {
    let html = markdown;
    const codeBlockPlaceholders: string[] = [];

    // Normalize line endings to avoid regex issues on Windows (\r\n) or old Mac (\r)
    html = html.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Strip trailing whitespace from each line (markdown editors often leave trailing spaces,
    // which breaks table detection that expects rows to end exactly with '|')
    html = html.replace(/[ \t]+$/gm, '');

    // Remove HTML comments
    html = html.replace(/<!--[\s\S]*?-->/g, '');

    // Convert fenced code blocks to Confluence code macro
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const langAttr = lang ? `<ac:parameter ac:name="language">${this.escapeXml(lang)}</ac:parameter>` : '';
      const macro = `<ac:structured-macro ac:name="code">${langAttr}<ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body></ac:structured-macro>`;
      const placeholder = `@@HARDIS_CODE_BLOCK_${codeBlockPlaceholders.length}@@`;
      codeBlockPlaceholders.push(macro);
      return placeholder;
    });

    // Convert inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Convert images: ![alt](path) → placeholder (will be replaced after attachment upload)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, imgPath) => {
      if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) {
        return `<ac:image><ri:url ri:value="${this.escapeXml(imgPath)}" /></ac:image>`;
      }
      const resolvedFileName = path.basename(imgPath);
      return `<ac:image ac:alt="${this.escapeXml(alt)}"><ri:attachment ri:filename="${this.escapeXml(resolvedFileName)}" /></ac:image>`;
    });

    // Convert internal page links: [text](page.md) → Confluence link macro
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, href) => {
      // External links stay as HTML <a>
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        return `<a href="${this.escapeXml(href)}">${this.escapeXml(text)}</a>`;
      }
      // Internal page links: resolve to Confluence page title
      const cleanHref = href.split('#')[0]; // Remove anchors
      const resolvedPath = this.resolveRelativePath(currentFilePath, cleanHref);
      const targetTitle = this.pageTitleMap.get(resolvedPath);
      if (targetTitle) {
        return `<ac:link><ri:page ri:content-title="${this.escapeXml(targetTitle)}" /><ac:plain-text-link-body><![CDATA[${text}]]></ac:plain-text-link-body></ac:link>`;
      }
      // Fallback: render as plain text link
      return `<a href="${this.escapeXml(href)}">${this.escapeXml(text)}</a>`;
    });

    // Convert tables
    html = this.convertTables(html);

    // Convert headings (h1-h6)
    for (let level = 6; level >= 1; level--) {
      const regex = new RegExp(`^${'#'.repeat(level)}\\s+(.+)$`, 'gm');
      html = html.replace(regex, `<h${level}>$1</h${level}>`);
    }

    // Convert bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Convert italic using *text* and _text_ variants.
    // For _text_, apply strict boundaries so Salesforce API names like Siren__c are preserved.
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, '<em>$1</em>');

    // Convert lists (supports nested bullet and ordered lists)
    html = this.convertLists(html);

    // Convert horizontal rules
    html = html.replace(/^---+$/gm, '<hr />');

    // Convert paragraphs: blank-line separated text blocks.
    // Block-level elements (<ul>, <table>, <ac:>, etc.) flush the pending text buffer immediately.
    const lines = html.split('\n');
    const paragraphed: string[] = [];
    let buffer = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        if (buffer.trim()) {
          paragraphed.push(this.wrapInParagraphIfNeeded(buffer.trim()));
        }
        buffer = '';
      } else if (/^<(h[1-6]|p|ul|ol|li|table|ac:|div|hr|blockquote)/i.test(trimmed) || /^@@HARDIS_CODE_BLOCK_\d+@@$/.test(trimmed)) {
        // Block-level element: flush pending text first, then add the block directly
        if (buffer.trim()) {
          paragraphed.push(this.wrapInParagraphIfNeeded(buffer.trim()));
          buffer = '';
        }
        paragraphed.push(trimmed);
      } else {
        buffer += line + '\n';
      }
    }
    if (buffer.trim()) {
      paragraphed.push(this.wrapInParagraphIfNeeded(buffer.trim()));
    }
    html = paragraphed.join('\n');

    // Restore code block macros after paragraph processing.
    html = html.replace(/@@HARDIS_CODE_BLOCK_(\d+)@@/g, (_match, index) => codeBlockPlaceholders[parseInt(index, 10)] || '');

    return html;
  }

  private wrapInParagraphIfNeeded(text: string): string {
    // Don't wrap if already wrapped in a block element
    if (/^<(h[1-6]|p|ul|ol|table|ac:|div|hr|blockquote)/i.test(text)) {
      return text;
    }
    return `<p>${text}</p>`;
  }

  private convertTables(markdown: string): string {
    const tableRegex = /(?:^|\n)((?:\|[^\n]+\|(?:\n|$))+)/g;
    return markdown.replace(tableRegex, (_match, tableBlock: string) => {
      const rows = tableBlock.trim().split('\n').filter((row) => row.trim());
      if (rows.length < 2) return tableBlock;

      // Check if second row is separator
      const secondRow = rows[1];
      if (!/^\|[\s:|-]+\|$/.test(secondRow.trim())) return tableBlock;

      const parseRow = (row: string): string[] =>
        row.split('|').slice(1, -1).map((cell) => cell.trim());

      const headerCells = parseRow(rows[0]);
      const dataRows = rows.slice(2);

      let table = '<table><thead><tr>';
      for (const cell of headerCells) {
        table += `<th>${cell}</th>`;
      }
      table += '</tr></thead><tbody>';
      for (const row of dataRows) {
        const cells = parseRow(row);
        table += '<tr>';
        for (const cell of cells) {
          table += `<td>${cell}</td>`;
        }
        table += '</tr>';
      }
      table += '</tbody></table>';
      return '\n' + table + '\n';
    });
  }

  /**
   * Resolve a relative path from a markdown file to an absolute docs-relative path.
   */
  private resolveRelativePath(currentFilePath: string, relativePath: string): string {
    if (!relativePath || relativePath === '') return currentFilePath;
    const currentDir = path.dirname(currentFilePath);
    const resolved = path.posix.normalize(path.posix.join(currentDir.replace(/\\/g, '/'), relativePath.replace(/\\/g, '/')));
    return resolved;
  }

  /**
   * Create or update a Confluence page. Returns the page ID.
   */
  private async createOrUpdatePage(title: string, body: string, parentPageId: string | null): Promise<string | null> {
    // Search for existing page with the same title in the space
    const existingPage = await this.findPageByTitle(title);

    if (existingPage) {
      // Fetch full page by ID to ensure we have the current version number
      const currentPage = await this.axiosClient.get(`/wiki/api/v2/pages/${existingPage.id}`).then(r => r.data);
      const currentVersion = parseInt(currentPage.version?.number ?? currentPage.version ?? '1', 10);
      // Update existing page
      uxLog("log", this, c.grey(t('confluenceUpdatingExistingPage', { title })));
      const updatePayload: any = {
        id: existingPage.id,
        status: 'current',
        title,
        spaceId: this.spaceId,
        body: {
          representation: 'storage',
          value: body,
        },
        version: {
          number: currentVersion + 1,
        },
      };
      // Preserve the existing parent to avoid hierarchy changes
      if (currentPage.parentId) {
        updatePayload.parentId = currentPage.parentId;
      }
      try {
        const response = await this.axiosClient.put(`/wiki/api/v2/pages/${existingPage.id}`, updatePayload);
        return response.data.id;
      } catch (e: any) {
        throw new Error(this.apiErrorMessage(e));
      }
    }

    // Create new page
    uxLog("log", this, c.grey(t('confluenceCreatingNewPage', { title })));
    const payload: any = {
      spaceId: this.spaceId,
      status: 'current',
      title,
      body: {
        representation: 'storage',
        value: body,
      },
    };
    if (parentPageId) {
      payload.parentId = parentPageId;
    }
    try {
      const response = await this.axiosClient.post('/wiki/api/v2/pages', payload);
      return response.data.id;
    } catch (e: any) {
      throw new Error(this.apiErrorMessage(e));
    }
  }

  private async findPageByTitle(title: string): Promise<any | null> {
    const response = await this.axiosClient.get('/wiki/api/v2/pages', {
      params: {
        spaceId: this.spaceId,
        title,
        status: 'current',
      },
    });
    const results = response.data?.results || [];
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Upload images referenced in markdown as Confluence page attachments.
   */
  private async uploadImagesForPage(markdownContent: string, mdRelPath: string, pageId: string): Promise<Array<{ fileName: string; status: string; failureReason: string }>> {
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    const uploadedFiles = new Set<string>();
    const results: Array<{ fileName: string; status: string; failureReason: string }> = [];

    while ((match = imageRegex.exec(markdownContent)) !== null) {
      const imgPath = match[2];
      // Skip external URLs
      if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) {
        continue;
      }

      const resolvedImgPath = path.join(this.docsRoot, path.dirname(mdRelPath), imgPath);
      const fileName = path.basename(imgPath);

      // Avoid uploading the same file twice
      if (uploadedFiles.has(fileName)) {
        continue;
      }

      if (!fs.existsSync(resolvedImgPath)) {
        uxLog("warning", this, c.yellow(t('confluenceImageNotFound', { image: imgPath, page: mdRelPath })));
        results.push({ fileName, status: 'failure', failureReason: t('confluenceImageNotFound', { image: imgPath, page: mdRelPath }) });
        continue;
      }

      try {
        await this.uploadAttachment(pageId, resolvedImgPath, fileName);
        uploadedFiles.add(fileName);
        results.push({ fileName, status: 'success', failureReason: '' });
        uxLog("log", this, c.grey(t('confluenceImageUploaded', { image: fileName, page: mdRelPath })));
      } catch (e: any) {
        results.push({ fileName, status: 'failure', failureReason: this.apiErrorMessage(e) });
        uxLog("warning", this, c.yellow(t('confluenceImageUploadError', { image: fileName, error: this.apiErrorMessage(e) })));
      }
    }
    return results;
  }

  /**
   * Builds a human-readable error message from an axios (or plain) error.
   * For HTTP errors the Confluence response body is appended so failures are easy to investigate.
   */
  private apiErrorMessage(e: any): string {
    if (e?.response?.data) {
      return `${e.message} \u2014 Confluence details: ${JSON.stringify(e.response.data)}`;
    }
    return e?.message ?? String(e);
  }

  /**
   * Upload a file as an attachment to a Confluence page using v1 API.
   */
  private async uploadAttachment(pageId: string, filePath: string, fileName: string) {
    const fileBuffer = await fs.readFile(filePath);
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', fileBuffer, { filename: fileName });
    form.append('minorEdit', 'true');

    try {
      await this.axiosClient.post(
        `/wiki/rest/api/content/${pageId}/child/attachment`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'X-Atlassian-Token': 'nocheck',
          },
        }
      );
    } catch (e: any) {
      // Confluence returns 400 when an attachment with the same filename already exists.
      // For mermaid images the filename embeds a content fingerprint, so an existing attachment
      // with the same name is guaranteed to be identical — skip silently.
      const body = e?.response?.data;
      const msg: string = body?.message ?? e?.message ?? '';
      if (e?.response?.status === 400 && msg.includes('same file name as an existing attachment')) {
        uxLog("log", this, c.grey(t('confluenceAttachmentAlreadyExists', { fileName })));
        return;
      }
      throw e;
    }
  }

  /**
   * Compute a page prefix based on the markdown file's top-level folder.
   * e.g. objects/Contact.md → "[Object] ", apex/Foo.md → "[Apex] "
   * Falls back to confluencePagePrefix for root-level files.
   */
  private computePagePrefix(mdRelPath?: string): string {
    if (!mdRelPath) return this.confluencePagePrefix;
    const normalized = mdRelPath.replace(/\\/g, '/');
    const firstSlash = normalized.indexOf('/');
    if (firstSlash <= 0) return this.confluencePagePrefix;
    const folderName = normalized.substring(0, firstSlash);
    const singular = this.singularizeFolderName(folderName);
    const humanName = singular
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    return `[${humanName}] `;
  }

  /** Basic English singularization for common Salesforce folder names. */
  private singularizeFolderName(name: string): string {
    if (name.endsWith('sses')) return name.slice(0, -2); // classes → class
    if (name.endsWith('ies')) return name.slice(0, -3) + 'y'; // categories → category
    if (name.endsWith('s') && name.length > 3) return name.slice(0, -1); // objects → object
    return name;
  }

  /**
   * Reorder sibling Confluence pages to match the given ordered list of page IDs.
   * Uses the Confluence v1 move API (PUT /wiki/rest/api/content/{id}/move/after/{targetId})
   * to position each page after its predecessor — O(n-1) API calls per level.
   */
  private async reorderChildPages(orderedPageIds: string[]): Promise<void> {
    if (orderedPageIds.length < 2) return;
    uxLog("log", this, c.grey(t('confluenceReorderingPages', { count: orderedPageIds.length })));
    for (let i = 1; i < orderedPageIds.length; i++) {
      const prevId = orderedPageIds[i - 1];
      const currId = orderedPageIds[i];
      try {
        await this.axiosClient.put(`/wiki/rest/api/content/${currId}/move/after/${prevId}`);
      } catch (e: any) {
        uxLog("warning", this, c.yellow(t('confluencePageReorderError', { id: currId, error: this.apiErrorMessage(e) })));
      }
    }
  }

  /**
   * Run an array of async tasks with a max concurrency.
   * Concurrency is controlled by the CONFLUENCE_PUBLISH_CONCURRENCY env var (default: 5).
   */
  private async runInParallel(tasks: Array<() => Promise<void>>): Promise<void> {
    const concurrency = Math.max(1, parseInt(getEnvVar('CONFLUENCE_PUBLISH_CONCURRENCY') || '5', 10));
    for (let i = 0; i < tasks.length; i += concurrency) {
      await Promise.all(tasks.slice(i, i + concurrency).map(fn => fn()));
    }
  }

  /**
   * Convert markdown list blocks (including nested lists) to proper HTML <ul>/<ol>.
   * Handles arbitrary nesting depth; each call processes lines at a given indent level.
   */
  private convertLists(markdown: string): string {
    const lines = markdown.split('\n');
    let i = 0;
    const result: string[] = [];
    while (i < lines.length) {
      const match = /^( *)([-*]|\d+\.) /.exec(lines[i]);
      if (match) {
        const baseIndent = match[1].length;
        const [listHtml, consumed] = this.parseList(lines, i, baseIndent);
        if (consumed > 0) {
          result.push(listHtml);
          i += consumed;
        } else {
          result.push(lines[i]);
          i++;
        }
      } else {
        result.push(lines[i]);
        i++;
      }
    }
    return result.join('\n');
  }

  private parseList(lines: string[], startIdx: number, baseIndent: number): [string, number] {
    const items: string[] = [];
    let i = startIdx;
    let listType: 'ul' | 'ol' = 'ul';

    while (i < lines.length) {
      const match = /^( *)([-*]|\d+\.) (.*)/.exec(lines[i]);
      if (!match) break;
      const indent = match[1].length;
      if (indent < baseIndent) break;
      if (indent > baseIndent) break;

      listType = /^\d+\./.test(match[2]) ? 'ol' : 'ul';
      // marker width: e.g. "1." (2) + space (1) = 3; "-" (1) + space (1) = 2
      const markerWidth = match[2].length + 1;
      // Minimum indentation for body continuation lines
      const bodyIndent = baseIndent + markerWidth;
      const content = match[3].trim();
      i++;

      const bodyParts: string[] = [];

      // Collect the body of this list item: continuation paragraphs and nested lists.
      // Handles "loose lists" where items and body are separated by blank lines.
      while (i < lines.length) {
        const line = lines[i];

        if (line.trim() === '') {
          // Blank line — look ahead past all consecutive blanks to decide what follows
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === '') j++;
          if (j >= lines.length) break;

          const peekLine = lines[j];
          const peekListMatch = /^( *)([-*]|\d+\.) /.exec(peekLine);
          const peekIndent = (peekLine.match(/^( *)/)?.[1] ?? '').length;

          if (peekListMatch) {
            const peekLevel = peekListMatch[1].length;
            if (peekLevel === baseIndent) {
              // Next sibling at same level — advance past blank lines and stop body
              i = j;
              break;
            } else if (peekLevel > baseIndent) {
              // Nested list follows after blank lines — skip blanks and continue
              i = j;
              continue;
            } else {
              // Outer-level item — end of current list
              break;
            }
          } else if (peekIndent >= bodyIndent) {
            // Indented continuation paragraph
            i = j;
            bodyParts.push(`<p>${lines[i].trim()}</p>`);
            i++;
            continue;
          } else {
            // Insufficient indentation — end of this list
            break;
          }
        }

        // Non-blank line: nested list or continuation
        const listMatch = /^( *)([-*]|\d+\.) /.exec(line);
        if (listMatch) {
          const curLevel = listMatch[1].length;
          if (curLevel === baseIndent) break; // next sibling (no blank line before it)
          if (curLevel > baseIndent) {
            const [nestedHtml, consumed] = this.parseList(lines, i, curLevel);
            bodyParts.push(nestedHtml);
            i += consumed;
            continue;
          }
          break; // outer-level item
        }

        // Plain indented continuation line (no blank line before it)
        const lineIndent = (line.match(/^( *)/)?.[1] ?? '').length;
        if (lineIndent >= bodyIndent || lineIndent > baseIndent) {
          bodyParts.push(`<p>${line.trim()}</p>`);
          i++;
          continue;
        }
        break;
      }

      if (bodyParts.length > 0) {
        items.push(`<li><p>${content}</p>${bodyParts.join('')}</li>`);
      } else {
        items.push(`<li>${content}</li>`);
      }
    }

    if (items.length === 0) return ['', 0];
    return [`<${listType}>${items.join('')}</${listType}>`, i - startIdx];
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
