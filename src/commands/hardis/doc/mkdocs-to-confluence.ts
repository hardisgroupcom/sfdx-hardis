/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import fs from 'fs-extra';
import c from "chalk";
import * as path from "path";
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import axios, { AxiosInstance } from 'axios';
import { uxLog } from '../../../common/utils/index.js';
import { CONSTANTS, getEnvVar } from '../../../config/index.js';
import { readMkDocsFile } from '../../../common/docBuilder/docUtils.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { t } from '../../../common/utils/i18n.js';

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
| **Basic Auth**                    |                                                                           |                      |
| \`CONFLUENCE_BASE_URL\`            | Confluence instance base URL (e.g. \`https://mycompany.atlassian.net\`)    | _Required for Basic_ |
| \`CONFLUENCE_USERNAME\`            | Confluence username (email for Confluence Cloud)                          | _Required for Basic_ |
| \`CONFLUENCE_TOKEN\`               | Confluence API token (personal access token)                              | _Required for Basic_ |
| **OAuth2 (service account)**      |                                                                           |                      |
| \`CONFLUENCE_CLIENT_ID\`           | Atlassian OAuth2 client ID                                                | _Required for OAuth_ |
| \`CONFLUENCE_CLIENT_SECRET\`       | Atlassian OAuth2 client secret                                            | _Required for OAuth_ |
| \`CONFLUENCE_BASE_URL\`            | Confluence instance base URL, used to match the right Atlassian resource  | First available      |

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
    await this.setupConfluenceClient();

    // Read mkdocs.yml nav structure
    const mkdocsYml = readMkDocsFile(mkdocsYmlFile);
    const navItems = mkdocsYml.nav || [];

    // Resolve the space ID
    await this.resolveSpaceId();

    // Build page title map first (needed for link resolution)
    this.buildPageTitleMap(navItems, "");

    // Publish pages recursively following the nav tree
    const totalPages = this.pageTitleMap.size;
    uxLog("action", this, c.cyan(t('publishingPagesToConfluence', { count: totalPages })));
    WebSocketClient.sendProgressStartMessage(t('publishingPagesToConfluence', { count: totalPages }), totalPages);
    await this.publishNavItems(navItems, this.confluenceParentPageId);
    WebSocketClient.sendProgressEndMessage(totalPages);

    // Summary
    if (this.failedPages.length > 0) {
      uxLog("warning", this, c.yellow(t('confluenceSomePagesFailedToPublish', { count: this.failedPages.length })));
      for (const failed of this.failedPages) {
        uxLog("warning", this, c.yellow(`  - ${failed}`));
      }
    } else {
      uxLog("success", this, c.green(t('confluenceAllPagesPublishedSuccessfully', { count: this.pageTitleMap.size })));
    }

    return { success: this.failedPages.length === 0, publishedPages: this.pageTitleMap.size, failedPages: this.failedPages.length };
  }

  private async setupConfluenceClient() {
    this.confluenceBaseUrl = (getEnvVar('CONFLUENCE_BASE_URL') || '').replace(/\/+$/, '');
    this.confluenceSpaceKey = getEnvVar('CONFLUENCE_SPACE_KEY') || '';
    this.confluenceUsername = getEnvVar('CONFLUENCE_USERNAME') || '';
    this.confluenceToken = getEnvVar('CONFLUENCE_TOKEN') || '';
    this.confluenceClientId = getEnvVar('CONFLUENCE_CLIENT_ID') || null;
    this.confluenceClientSecret = getEnvVar('CONFLUENCE_CLIENT_SECRET') || null;
    this.confluenceParentPageId = getEnvVar('CONFLUENCE_PARENT_PAGE_ID') || null;
    this.confluencePagePrefix = getEnvVar('CONFLUENCE_PAGE_PREFIX') || '[Doc] ';

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
        const title = this.confluencePagePrefix + this.titleFromFilePath(item);
        this.pageTitleMap.set(item, title);
      } else if (typeof item === 'object') {
        for (const [label, value] of Object.entries(item)) {
          if (typeof value === 'string') {
            // Leaf page: { "Label": "file.md" }
            const title = this.confluencePagePrefix + label;
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
        this.pageTitleMap.set(childValue, this.confluencePagePrefix + childLabel);
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
   */
  private async publishNavItems(navItems: any[], parentPageId: string | null) {
    for (const item of navItems) {
      if (typeof item === 'string') {
        await this.publishPage(item, this.pageTitleMap.get(item) || this.confluencePagePrefix + this.titleFromFilePath(item), parentPageId);
      } else if (typeof item === 'object') {
        for (const [label, value] of Object.entries(item)) {
          if (typeof value === 'string') {
            // Leaf page: { "Label": "file.md" }
            await this.publishPage(value as string, this.pageTitleMap.get(value as string) || this.confluencePagePrefix + label, parentPageId);
          } else if (Array.isArray(value)) {
            // Section with array children: { "Label": [ ... ] }
            const sectionTitle = this.confluencePagePrefix + label;
            const sectionPageId = await this.createOrUpdatePage(sectionTitle, `<p>${label}</p>`, parentPageId);
            if (sectionPageId) {
              await this.publishNavItems(value as any[], sectionPageId);
            }
          } else if (typeof value === 'object' && value !== null) {
            // Section with flat object children: { "Label": { "Child": "file.md", ... } }
            const sectionTitle = this.confluencePagePrefix + label;
            const sectionPageId = await this.createOrUpdatePage(sectionTitle, `<p>${label}</p>`, parentPageId);
            if (sectionPageId) {
              await this.publishNavItemsFromObject(value as Record<string, any>, sectionPageId);
            }
          }
        }
      }
    }
  }

  /**
   * Publish pages from a flat-object nav section, e.g. { "Account": "objects/Account.md", ... }
   */
  private async publishNavItemsFromObject(obj: Record<string, any>, parentPageId: string | null) {
    for (const [childLabel, childValue] of Object.entries(obj)) {
      if (typeof childValue === 'string') {
        await this.publishPage(childValue, this.pageTitleMap.get(childValue) || this.confluencePagePrefix + childLabel, parentPageId);
      } else if (Array.isArray(childValue)) {
        const sectionTitle = this.confluencePagePrefix + childLabel;
        const sectionPageId = await this.createOrUpdatePage(sectionTitle, `<p>${childLabel}</p>`, parentPageId);
        if (sectionPageId) {
          await this.publishNavItems(childValue as any[], sectionPageId);
        }
      } else if (typeof childValue === 'object' && childValue !== null) {
        const sectionTitle = this.confluencePagePrefix + childLabel;
        const sectionPageId = await this.createOrUpdatePage(sectionTitle, `<p>${childLabel}</p>`, parentPageId);
        if (sectionPageId) {
          await this.publishNavItemsFromObject(childValue as Record<string, any>, sectionPageId);
        }
      }
    }
  }

  /**
   * Publish a single markdown page to Confluence.
   */
  private async publishPage(mdRelPath: string, title: string, parentPageId: string | null) {
    const mdFilePath = path.join(this.docsRoot, mdRelPath);
    if (!fs.existsSync(mdFilePath)) {
      uxLog("warning", this, c.yellow(t('confluenceMarkdownFileNotFound', { file: mdRelPath })));
      this.failedPages.push(mdRelPath);
      return;
    }

    try {
      uxLog("action", this, c.cyan(t('confluencePublishingPage', { title, file: mdRelPath })));

      let markdownContent = await fs.readFile(mdFilePath, 'utf-8');

      // Strip YAML frontmatter
      markdownContent = this.stripFrontmatter(markdownContent);

      // Convert markdown to Confluence storage format
      const confluenceContent = this.convertMarkdownToConfluenceStorage(markdownContent, mdRelPath);

      // Create or update the page
      const pageId = await this.createOrUpdatePage(title, confluenceContent, parentPageId);

      if (pageId) {
        this.pageIdMap.set(mdRelPath, pageId);

        // Upload images as attachments
        await this.uploadImagesForPage(markdownContent, mdRelPath, pageId);

        uxLog("success", this, c.green(t('confluencePagePublished', { title })));
        this.publishedPageCount++;
        WebSocketClient.sendProgressStepMessage(this.publishedPageCount, this.pageTitleMap.size);
      }
    } catch (e: any) {
      uxLog("warning", this, c.yellow(t('confluencePagePublishError', { title, error: e.message })));
      this.failedPages.push(mdRelPath);
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

    // Remove HTML comments
    html = html.replace(/<!--[\s\S]*?-->/g, '');

    // Convert fenced code blocks to Confluence code macro
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const langAttr = lang ? `<ac:parameter ac:name="language">${this.escapeXml(lang)}</ac:parameter>` : '';
      return `<ac:structured-macro ac:name="code">${langAttr}<ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body></ac:structured-macro>`;
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

    // Convert italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Convert unordered lists (basic single-level)
    html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');

    // Convert ordered lists (basic single-level)
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

    // Wrap consecutive <li> elements in <ul>
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Convert horizontal rules
    html = html.replace(/^---+$/gm, '<hr />');

    // Convert paragraphs: blank-line separated text blocks
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
      } else {
        buffer += line + '\n';
      }
    }
    if (buffer.trim()) {
      paragraphed.push(this.wrapInParagraphIfNeeded(buffer.trim()));
    }
    html = paragraphed.join('\n');

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
    const tableRegex = /(?:^|\n)((?:\|[^\n]+\|\n)+)/g;
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
      // Update existing page
      uxLog("log", this, c.grey(t('confluenceUpdatingExistingPage', { title })));
      const response = await this.axiosClient.put(`/wiki/api/v2/pages/${existingPage.id}`, {
        id: existingPage.id,
        status: 'current',
        title,
        spaceId: this.spaceId,
        body: {
          representation: 'storage',
          value: body,
        },
        version: {
          number: (existingPage.version?.number || 1) + 1,
          message: 'Updated by sfdx-hardis',
        },
      });
      return response.data.id;
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
    const response = await this.axiosClient.post('/wiki/api/v2/pages', payload);
    return response.data.id;
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
  private async uploadImagesForPage(markdownContent: string, mdRelPath: string, pageId: string) {
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    const uploadedFiles = new Set<string>();

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
        continue;
      }

      try {
        await this.uploadAttachment(pageId, resolvedImgPath, fileName);
        uploadedFiles.add(fileName);
        uxLog("log", this, c.grey(t('confluenceImageUploaded', { image: fileName, page: mdRelPath })));
      } catch (e: any) {
        uxLog("warning", this, c.yellow(t('confluenceImageUploadError', { image: fileName, error: e.message })));
      }
    }
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
