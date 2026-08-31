import { DocBuilderComponentRoot } from "./docBuilderComponentRoot.js";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { buildGenericMarkdownTable } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { buildUsesTable, extractVisualforceDependencies, VisualforceDependency } from "../utils/metadataReferenceUtils.js";
import { renderJsdocMarkdown } from "../utils/jsdocMarkdown.js";
import fs from '../utils/fsUtils.js';
import path from "path";
import { t } from '../utils/i18n.js';

// Extension of the bundle definition file, giving the kind of Aura metadata
const AURA_TYPE_LABEL_KEYS: Record<string, string> = {
  ".cmp": "docMdAuraTypeComponent",
  ".app": "docMdAuraTypeApplication",
  ".evt": "docMdAuraTypeEvent",
  ".intf": "docMdAuraTypeInterface",
  ".tokens": "docMdAuraTypeTokens",
};

// The JavaScript files of a bundle whose JSDoc is rendered, in reading order
const AURA_JS_FILES = [
  { suffix: "Controller.js", labelKey: "docMdAuraController" },
  { suffix: "Helper.js", labelKey: "docMdAuraHelper" },
  { suffix: "Renderer.js", labelKey: "docMdAuraRenderer" },
];

// Fenced code block language per bundle file extension
const AURA_CODE_LANGUAGES: Record<string, string> = {
  ".js": "javascript",
  ".css": "css",
  ".cmp": "html",
  ".app": "html",
  ".evt": "html",
  ".intf": "html",
  ".tokens": "html",
  ".design": "html",
  ".auradoc": "html",
};

// Files never sent to AI: styling brings no behavior, and the SVG only holds the palette icon
const AI_EXCLUDED_EXTENSIONS = [".css", ".svg"];

// One readdir per bundle folder, shared by the sources, the source section and the file list
const BUNDLE_FILES_CACHE: Map<string, string[]> = new Map();

export class DocBuilderAura extends DocBuilderComponentRoot {

  public docType = "Aura";
  public docsSection = "aura";
  public placeholder = "<!-- Aura description -->";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_AURA_BUNDLE";
  public xmlRootKey = "AuraDefinitionBundle";

  /** Localized kind of the bundle, read from the extension of its -meta.xml file */
  public static getTypeLabel(metaFile: string): string {
    const definitionFile = path.basename(metaFile).replace(/-meta\.xml$/, "");
    const definitionExtension = path.extname(definitionFile);
    return t(AURA_TYPE_LABEL_KEYS[definitionExtension] || "docMdAuraTypeComponent");
  }

  /** Concatenates the bundle sources that describe its behavior, used for the AI prompt and its cache key */
  public static async readBundleSources(auraPath: string): Promise<string> {
    let bundleCode = "";
    for (const file of await DocBuilderAura.listBundleFiles(auraPath)) {
      // The -meta.xml is passed separately as AURA_META, no need to send it twice
      if (AI_EXCLUDED_EXTENSIONS.includes(path.extname(file)) || file.endsWith("-meta.xml")) {
        continue;
      }
      const fileContent = await fs.readFile(path.join(auraPath, file), "utf-8");
      bundleCode += `// File: ${file}\n${fileContent}\n\n`;
    }
    return bundleCode;
  }

  private static async listBundleFiles(auraPath: string): Promise<string[]> {
    if (!auraPath || !fs.existsSync(auraPath)) {
      return [];
    }
    const cached = BUNDLE_FILES_CACHE.get(auraPath);
    if (cached) {
      return cached;
    }
    const files: string[] = [];
    for (const file of await fs.readdir(auraPath)) {
      const stats = await fs.stat(path.join(auraPath, file));
      if (stats.isFile()) {
        files.push(file);
      }
    }
    files.sort();
    BUNDLE_FILES_CACHE.set(auraPath, files);
    return files;
  }

  public static buildIndexTable(prefix: string, auraDescriptions: any[], filterObject: string | null = null) {
    return DocBuilderAura.buildComponentIndexTable({
      prefix: prefix,
      descriptions: auraDescriptions,
      filterObject: filterObject,
      title: t('docMdAura'),
      relatedTitle: t('docMdRelatedAura'),
      columnLabels: [t('docMdColAuraComponent'), t('docMdColType'), t('docMdColDescription'), t('docMdColApexControllers')],
      columnAlignments: [":--------", ":--:", ":----------", ":----------"],
      buildValueCells: (aura) => [
        aura.type || "",
        aura.description || "",
        (aura.apexControllers || []).join(", "),
      ],
    });
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    const mdLines: string[] = [
      ...this.buildComponentHeaderLines(),
      ...(await this.buildJsDocumentationSection()),
      ...(await this.buildComponentDocumentationSection()),
      ...this.buildUsesLines(),
      ...this.buildWhereUsedLines(),
    ];
    if (!this.additionalVariables.HIDE_CODE) {
      mdLines.push(...(await this.buildSourceSection()));
    }
    mdLines.push(...[
      `## ${t('docMdFilesSection')}`,
      '',
      await this.listComponentFiles(),
      ''
    ]);
    return mdLines;
  }

  protected buildAttributesTable(): string {
    const attributes: any = {
      masterLabel: this.parsedXmlObject?.masterLabel,
      type: this.additionalVariables.AURA_TYPE,
      apiVersion: this.parsedXmlObject?.apiVersion,
      description: this.parsedXmlObject?.description,
    };
    // Apex controllers declared on the bundle root tag
    const apexControllers = this.additionalVariables.AURA_APEX_CONTROLLERS;
    if (apexControllers && apexControllers !== "none") {
      attributes.controller = String(apexControllers)
        .split(",")
        .map((controller: string) => controller.trim())
        .filter((controller: string) => controller.length > 0)
        .map((controller: string) => `[${controller}](../apex/${controller}.md)`)
        .join(", ");
    }
    return buildGenericMarkdownTable(attributes, ["masterLabel", "type", "apiVersion", "description", "controller"], `## ${t('docMdAuraAttributes')}`, []);
  }

  /** Outbound dependencies of the Aura markup: other Aura bundles, VF pages, static resources, labels */
  protected buildUsesLines(): string[] {
    const sources = String(this.additionalVariables.AURA_SOURCES || "");
    const byKey = new Map<string, VisualforceDependency>();
    for (const dependency of extractVisualforceDependencies(sources, this.metadataName)) {
      // <c:> in Aura markup is an Aura/LWC reference, not a Visualforce component
      if (dependency.kind === 'apexComponents') {
        continue;
      }
      byKey.set(`${dependency.kind}|${dependency.name}`, dependency);
    }
    for (const match of sources.matchAll(/\bextends\s*=\s*"c:([A-Za-z_][A-Za-z0-9_]*)"/g)) {
      if (match[1] !== this.metadataName) {
        byKey.set(`auraBundles|${match[1]}`, {
          kind: 'auraBundles',
          name: match[1],
          docLink: `aura/${match[1]}.md`,
        });
      }
    }
    for (const match of sources.matchAll(/markup:\/\/c:([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (match[1] !== this.metadataName) {
        byKey.set(`auraBundles|${match[1]}`, {
          kind: 'auraBundles',
          name: match[1],
          docLink: `aura/${match[1]}.md`,
        });
      }
    }
    for (const match of sources.matchAll(/<c:([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (match[1] !== this.metadataName) {
        byKey.set(`auraBundles|${match[1]}`, {
          kind: 'auraBundles',
          name: match[1],
          docLink: `aura/${match[1]}.md`,
        });
      }
    }
    return buildUsesTable([...byKey.values()], '../');
  }

  private async buildJsDocumentationSection(): Promise<string[]> {
    const auraPath = this.additionalVariables.AURA_PATH;
    const documentedFiles: string[] = [];
    for (const auraJsFile of AURA_JS_FILES) {
      const jsFile = path.join(auraPath || "", `${this.metadataName}${auraJsFile.suffix}`);
      if (!fs.existsSync(jsFile)) {
        continue;
      }
      try {
        const jsSource = await fs.readFile(jsFile, "utf-8");
        const jsdocOutput = renderJsdocMarkdown(jsSource, { fileName: path.basename(jsFile) });
        documentedFiles.push(...[
          `### ${t(auraJsFile.labelKey)}`,
          '',
          jsdocOutput || t('docMdNoJsDocAvailable'),
          ''
        ]);
      } catch (error) {
        documentedFiles.push(...[
          `### ${t(auraJsFile.labelKey)}`,
          '',
          t('docMdErrorGeneratingJsDoc', { message: (error as any).message }),
          ''
        ]);
      }
    }
    if (documentedFiles.length === 0) {
      return [];
    }
    return [`## ${t('docMdJsDocumentation')}`, '', ...documentedFiles];
  }

  private async buildComponentDocumentationSection(): Promise<string[]> {
    const auraPath = this.additionalVariables.AURA_PATH;
    const auraDocFile = path.join(auraPath || "", `${this.metadataName}.auradoc`);
    if (!fs.existsSync(auraDocFile)) {
      return [];
    }
    const auraDocContent = await fs.readFile(auraDocFile, "utf-8");
    return [
      `## ${t('docMdAuraDocumentation')}`,
      '',
      '```html',
      auraDocContent,
      '```',
      ''
    ];
  }

  private async buildSourceSection(): Promise<string[]> {
    const auraPath = this.additionalVariables.AURA_PATH;
    const files = await DocBuilderAura.listBundleFiles(auraPath);
    const sourceLines: string[] = [];
    for (const file of files) {
      const extension = path.extname(file);
      if (file.endsWith("-meta.xml") || extension === ".svg") {
        continue;
      }
      const fileContent = await fs.readFile(path.join(auraPath, file), "utf-8");
      sourceLines.push(...[
        `### ${file}`,
        '',
        '```' + (AURA_CODE_LANGUAGES[extension] || ''),
        fileContent,
        '```',
        ''
      ]);
    }
    if (sourceLines.length === 0) {
      return [];
    }
    return [`## ${t('docMdAuraSource')}`, '', ...sourceLines];
  }

  private async listComponentFiles(): Promise<string> {
    try {
      const files = await DocBuilderAura.listBundleFiles(this.additionalVariables.AURA_PATH);
      const fileList = files.map(file => `- \`${file}\``).join("\n");
      return fileList || t('docMdNoFilesFoundForComponent');
    } catch (error) {
      return t('docMdErrorListingComponentFiles', { message: (error as any).message });
    }
  }

  // Only the bundle sources are sent to AI: the "Where Used" section changes whenever another metadata
  // of the project changes, and would invalidate the AI cache of an untouched Aura component.
  public async stripXmlForAi(): Promise<string> {
    if (this.additionalVariables.AURA_SOURCES) {
      return this.additionalVariables.AURA_SOURCES;
    }
    return DocBuilderAura.readBundleSources(this.additionalVariables.AURA_PATH);
  }
}
