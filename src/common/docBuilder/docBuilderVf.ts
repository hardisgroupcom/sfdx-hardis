import crypto from "crypto";
import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import { GLOB_IGNORE_PATTERNS } from '../../common/utils/projectUtils.js';
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { DocBuilderRoot } from "./docBuilderRoot.js";
import { getCache, setCache } from "../cache/index.js";
import { VfParser, VfParsedInfo } from "../utils/visualForce/vfParser.js";
import { ApexParser, ApexParsedInfo } from "../utils/visualForce/apexParser.js";

export interface VfDocGenerationResult {
  markdownContent: string;
  shortDescription: string;
  name: string;
  outputPath: string;
  impactedObjects?: string[];
}

export interface VfPerformanceMetrics {
  componentCount: number;
  apexExpressionCount: number;
  estimatedRenderComplexity: 'low' | 'medium' | 'high';
  largeDataTables: boolean;
  recommendations: string[];
}

export interface VfBestPractices {
  usesViewState: boolean;
  hasJavaScriptRemoting: boolean;
  usesApexActionFunctions: boolean;
  usesCompositionTemplates: boolean;
  recommendations: string[];
}

export interface VfSecurityAnalysis {
  potentialSoqlInjection: boolean;
  potentialXss: boolean;
  unescapedOutput: boolean;
  recommendations: string[];
}

export interface VfDocBuilderConfig {
  enableSecurityAnalysis?: boolean;
  enablePerformanceMetrics?: boolean;
  enableBestPractices?: boolean;
  enableCrossReferences?: boolean;
  maxApexClassesToParse?: number;
}

export class DocBuilderVf extends DocBuilderRoot {
  public docType = "Visualforce";
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_VF";
  public placeholder = "<!-- VF description -->";
  private _sourceHash: string | null = null;

  private vfRawContent: string;
  private projectRoot: string;
  private config: VfDocBuilderConfig;

  private vfParsedInfo: VfParsedInfo | undefined;
  private apexParsedInfoMap: Map<string, ApexParsedInfo> = new Map();
  private parserFallbackMarkdown: string = '';

  constructor(
    public metadataName: string,
    public vfFilePath: string, // This is the actual file path
    outputMarkdownRoot: string,
    projectRoot: string,
    config: VfDocBuilderConfig = {}
  ) {
    // metadataName is the sourceName, vfFilePath is the sourcePath
    super(metadataName, vfFilePath, path.join(outputMarkdownRoot, "vf", `${metadataName}.md`), {});
    this.projectRoot = projectRoot;
    this.vfRawContent = '';
    this.config = {
      enableSecurityAnalysis: true,
      enablePerformanceMetrics: true,
      enableBestPractices: true,
      enableCrossReferences: true,
      maxApexClassesToParse: 10,
      ...config
    };
  }

  /** Compute a hash of the VF source to detect changes */
  public get sourceHash(): string {
    if (!this._sourceHash) {
      this._sourceHash = crypto
        .createHash("md5")
        .update(this.vfRawContent || "")
        .digest("hex");
    }
    return this._sourceHash;
  }

  /**
   * Main method to build the Visualforce documentation for this page.
   */
  public async build(): Promise<VfDocGenerationResult> {
    const mdFilePath = this.outputFile;
    const pageName = this.metadataName;

    // 1. Load Raw VF Content from the correct path (this.sourcePath is vfFilePath)
    this.vfRawContent = await fs.readFile(this.vfFilePath, "utf-8");

    // 2. Parse Visualforce Page (with size optimization)
    this.vfParsedInfo = await this.parseVfContentWithOptimization(this.vfRawContent);

    // 3. Parse Apex Controllers/Extensions
    await this.parseAndFormatApexControllers();

    // 4. Generate Parser-only Fallback Markdown
    this.parserFallbackMarkdown = this.generateParserOnlyMarkdown();

    // 5. Prepare Variables for AI Prompt
    this.additionalVariables = this.preparePromptVariables();

    // 6. Attempt AI Generation with Caching and Fallback
    const finalMdContent = await this.completeDocWithAiDescription();

    // 7. Extract shortDescription from AI output (or fallback)
    const shortDescription = this.extractShortDescription(finalMdContent);

    // 8. Write the markdown file
    await fs.ensureDir(path.dirname(mdFilePath));
    await fs.writeFile(mdFilePath, finalMdContent, "utf-8");

    return {
      markdownContent: finalMdContent,
      shortDescription: shortDescription,
      name: pageName,
      outputPath: mdFilePath,
    };
  }

  /** Parse VF content with optimization for large files */
  private async parseVfContentWithOptimization(content: string): Promise<VfParsedInfo> {
    if (content.length > 100000) { // 100KB threshold
      console.warn(`Large Visualforce page detected (${content.length} bytes), using simplified parsing`);
      return VfParser.simplifiedParse(content); // Use the static method directly
    }
    return VfParser.parse(content);
  }

  /** Helper to find Apex class file */
  private async findApexClassFile(className: string): Promise<string | undefined> {
    const apexFiles = await glob(`**/${className}.cls`, {
      cwd: this.projectRoot,
      ignore: GLOB_IGNORE_PATTERNS
    });
    if (apexFiles.length > 0) {
      return path.join(this.projectRoot, apexFiles[0]);
    }
    return undefined;
  }

  /** Parses related Apex controllers/extensions with limits */
  private async parseAndFormatApexControllers(): Promise<void> {
    if (!this.vfParsedInfo) return;

    const controllerNamesToParse = [
      ...(this.vfParsedInfo.controllerName ? [this.vfParsedInfo.controllerName] : []),
      ...this.vfParsedInfo.extensionNames
    ].slice(0, this.config.maxApexClassesToParse);

    for (const controllerName of controllerNamesToParse) {
      const apexFilePath = await this.findApexClassFile(controllerName);
      if (apexFilePath && await fs.pathExists(apexFilePath)) {
        try {
          const apexContent = await fs.readFile(apexFilePath, 'utf-8');
          const parsedInfo = await ApexParser.parse(apexContent, controllerName);
          this.apexParsedInfoMap.set(controllerName, parsedInfo);
        } catch (err: any) {
          console.warn(`Failed to parse Apex class ${controllerName}:`, err);
        }
      }
    }
  }

  /** Enhanced cache key including dependent file hashes */
  public async getEnhancedCacheKey(): Promise<string> {
    const dependentHashes = await this.getDependentFileHashes();
    return `vf-${this.metadataName}-${this.sourceHash}-${dependentHashes.join('-')}`;
  }

  /** Get hashes of dependent Apex files for cache invalidation */
  private async getDependentFileHashes(): Promise<string[]> {
    const hashes: string[] = [];

    // Include the hash of the main VF page content
    hashes.push(this.sourceHash);

    // Add hashes of any detected Apex controllers/extensions
    const controllerNames = [
      ...(this.vfParsedInfo?.controllerName ? [this.vfParsedInfo.controllerName] : []),
      ...(this.vfParsedInfo?.extensionNames || [])
    ];

    for (const controllerName of controllerNames) {
      const apexFile = await this.findApexClassFile(controllerName);
      if (apexFile) {
        try {
          const content = await fs.readFile(apexFile, 'utf-8');
          const hash = crypto.createHash('md5').update(content).digest('hex');
          hashes.push(`${controllerName}:${hash}`); // Include class name for clarity in hash key
        } catch (_error: any) { // Renamed 'error' to '_error' and used in log
          console.warn(`Could not read dependent file ${apexFile} for cache key: ${_error.message}`);
        }
      }
    }

    return hashes;
  }

  /** Generates a simple markdown description from parser data */
  private generateParserOnlyMarkdown(): string {
    const sections: string[] = [
      this.generateHeaderSection(),
      this.generateControllerSection(),
      this.generateComponentsSection(),
      this.generateApexSection(),
      this.generateAnalysisSections()
    ].filter(section => section.length > 0);

    return sections.join('\n\n');
  }

  private generateHeaderSection(): string {
    return `## ${this.metadataName}\n\n---\n**Automated Parser Summary (AI generation failed or not available)**\n---\n`;
  }

  private generateControllerSection(): string {
    if (!this.vfParsedInfo) return '';

    const lines: string[] = [];
    lines.push(`**Standard Controller:** ${this.vfParsedInfo.controllerName ? `\`${this.vfParsedInfo.controllerName}\`` : 'N/A'}`);
    lines.push(`**Extensions:** ${this.vfParsedInfo.extensionNames.length > 0 ? this.vfParsedInfo.extensionNames.map(ext => `\`${ext}\``).join(', ') : 'N/A'}`);
    return lines.join('\n');
  }

  private generateComponentsSection(): string {
    if (!this.vfParsedInfo || this.vfParsedInfo.components.length === 0) return '';

    const lines: string[] = ['### Identified Visualforce Components'];
    for (const comp of this.vfParsedInfo.components.slice(0, 20)) { // Limit for large pages
      lines.push(`- \`<${comp.namespace}:${comp.name}>\` (Attributes: \`${Object.keys(comp.attributes).join(', ')}\`)`);
    }
    if (this.vfParsedInfo.components.length > 20) {
      lines.push(`- *... and ${this.vfParsedInfo.components.length - 20} more components*`);
    }
    return lines.join('\n');
  }

  private generateApexSection(): string {
    if (this.apexParsedInfoMap.size === 0) return '';

    const lines: string[] = ['### Related Apex Code Details'];
    for (const [controllerName, apexInfo] of this.apexParsedInfoMap) {
      lines.push(`#### ${controllerName}`);
      lines.push(ApexParser.formatForPrompt(apexInfo.methods, apexInfo.properties, apexInfo.className, apexInfo.javaDoc));
      lines.push('');
    }
    return lines.join('\n');
  }

  private generateAnalysisSections(): string {
    const sections: string[] = [];

    if (this.config.enablePerformanceMetrics) {
      const metrics = this.calculatePerformanceMetrics();
      // Only add section if there are meaningful metrics or recommendations
      if (metrics.componentCount > 0 || metrics.apexExpressionCount > 0 || metrics.recommendations.length > 0) {
        sections.push(this.formatPerformanceMetrics(metrics));
      }
    }

    if (this.config.enableSecurityAnalysis) {
      const security = this.analyzeSecurityConcerns();
      if (security.potentialSoqlInjection || security.potentialXss || security.unescapedOutput || security.recommendations.length > 0) {
        sections.push(this.formatSecurityAnalysis(security));
      }
    }

    if (this.config.enableBestPractices) {
      const practices = this.analyzeBestPractices();
      if (practices.usesViewState || practices.hasJavaScriptRemoting || practices.usesApexActionFunctions || practices.usesCompositionTemplates || practices.recommendations.length > 0) {
        sections.push(this.formatBestPractices(practices));
      }
    }

    if (this.config.enableCrossReferences) {
      const crossRefs = this.generateCrossReferences();
      if (crossRefs.length > 0) {
        sections.push(crossRefs);
      }
    }

    return sections.join('\n\n');
  }

  /** Calculate performance metrics for the Visualforce page */
  private calculatePerformanceMetrics(): VfPerformanceMetrics {
    const componentCount = this.vfParsedInfo?.components.length || 0;
    const apexExpressionCount = this.vfParsedInfo?.apexExpressions.length || 0;

    const metrics: VfPerformanceMetrics = {
      componentCount,
      apexExpressionCount,
      estimatedRenderComplexity: 'low',
      largeDataTables: false,
      recommendations: []
    };

    // Analyze for performance concerns
    // Check for large data tables using <apex:pageBlockTable> or similar constructs
    const pageBlockTableRowsMatch = this.vfRawContent.match(/<apex:pageBlockTable[^>]*\s+rows="(\d+)"/i);
    if (pageBlockTableRowsMatch && parseInt(pageBlockTableRowsMatch[1]) > 50) {
      metrics.largeDataTables = true;
      metrics.recommendations.push(`Large data table detected (apex:pageBlockTable rows="${pageBlockTableRowsMatch[1]}"), consider pagination or client-side rendering.`);
    } else {
      // Generic check for large number of rows attribute that might apply to apex:repeat or custom tables
      const genericRowsMatch = this.vfRawContent.match(/rows="(\d+)"/i);
      if (genericRowsMatch && parseInt(genericRowsMatch[1]) > 50) {
        // Only add if not already captured by pageBlockTable
        if (!metrics.largeDataTables) {
          metrics.largeDataTables = true;
          metrics.recommendations.push(`Potentially large iteration detected (rows="${genericRowsMatch[1]}"), consider pagination or optimizing data retrieval.`);
        }
      }
    }


    if (componentCount > 50) {
      metrics.estimatedRenderComplexity = 'high';
      metrics.recommendations.push('High component count may impact page performance (consider breaking into smaller components or using client-side rendering).');
    } else if (componentCount > 20) {
      metrics.estimatedRenderComplexity = 'medium';
      metrics.recommendations.push('Moderate component count, monitor page performance.');
    }

    if (apexExpressionCount > 30) {
      metrics.recommendations.push('High number of Apex expressions may impact ViewState size and server-side processing time.');
    }

    if (this.vfRawContent.includes('apex:repeat') && componentCount > 10) {
      metrics.recommendations.push('Consider using apex:pageBlockTable or custom iteration components instead of apex:repeat for large datasets for better performance and ViewState management.');
    }

    // Check for excessive use of Visualforce Remoting without throttling
    if (this.vfParsedInfo?.hasRemoteObjects && (this.vfRawContent.match(/Visualforce.remoting.Manager.invoke/g) || []).length > 5) {
      metrics.recommendations.push('Multiple Visualforce.remoting calls detected. Ensure appropriate throttling and error handling are in place.');
    }

    // Check for inline JavaScript or CSS that could be externalized
    if (this.vfRawContent.includes('<script>') && !this.vfParsedInfo?.hasStaticResources) {
      metrics.recommendations.push('Inline <script> tags detected. Consider moving JavaScript to static resources for better caching and maintainability.');
    }
    if (this.vfRawContent.includes('<style>') && !this.vfParsedInfo?.hasStaticResources) {
      metrics.recommendations.push('Inline <style> tags detected. Consider moving CSS to static resources for better caching and maintainability.');
    }


    return metrics;
  }

  private formatPerformanceMetrics(metrics: VfPerformanceMetrics): string {
    const lines: string[] = [
      '### Performance Analysis',
      `- **Component Count:** ${metrics.componentCount}`,
      `- **Apex Expressions:** ${metrics.apexExpressionCount}`,
      `- **Estimated Complexity:** ${metrics.estimatedRenderComplexity}`,
      `- **Potentially Large Data Tables/Iterations:** ${metrics.largeDataTables ? 'Yes' : 'No'}`,
    ];

    if (metrics.recommendations.length > 0) {
      lines.push('', '**Recommendations:**');
      lines.push(...metrics.recommendations.map(rec => `- ${rec}`));
    }

    return lines.join('\n');
  }

  /** Analyze security concerns in the Visualforce page */
  private analyzeSecurityConcerns(): VfSecurityAnalysis {
    const analysis: VfSecurityAnalysis = {
      potentialSoqlInjection: false,
      potentialXss: false,
      unescapedOutput: false,
      recommendations: []
    };

    // Check for potential SOQL injection (simplified check)
    // A more robust check would require deeper static analysis of Apex controllers
    const soqlInjectionIndicators = [
      '{!$CurrentPage.parameters', // User-controlled parameter
      'Database.query',           // Dynamic SOQL method
      'SOQL query string here'    // Placeholder for actual SOQL query patterns
    ];

    if (soqlInjectionIndicators.every(indicator => this.vfRawContent.includes(indicator))) {
      analysis.potentialSoqlInjection = true;
      analysis.recommendations.push('⚠️ Potential SOQL injection vulnerability: User input from `$CurrentPage.parameters` might be used in dynamic SOQL (`Database.query`). Ensure all user inputs are properly escaped or cast to the expected type.');
    } else if (this.vfRawContent.includes('Database.query') && this.vfRawContent.includes('{!')) {
      analysis.recommendations.push('Potential SOQL injection concern: Dynamic SOQL (`Database.query`) used with Visualforce expressions (`{!}`). Verify that all variables passed to `Database.query` are sanitized or safe from user input.');
    }


    // Check for XSS vulnerabilities (unescaped output)
    const unescapedOutputRegex = /\{!([^}]+)\}/g;
    let match;
    let foundUnescaped = false;

    while ((match = unescapedOutputRegex.exec(this.vfRawContent)) !== null) {
      const expression = match[1];
      // cspell:disable-next-line
      if (!/(HTMLENCODE|JSENCODE|URLENCODE|ESCAPEXML|TEXT|JSONENCODE)\s*\(/i.test(expression)) {
        // Further check if it's likely user-controlled or complex output
        if (expression.includes('$CurrentPage.parameters') || expression.includes('controller.') || expression.includes('extension.')) {
          analysis.potentialXss = true;
          foundUnescaped = true;
          analysis.recommendations.push(`⚠️ Potential XSS vulnerability: Unescaped dynamic content \`{!${expression}}\` may allow injection. Consider using \`HTMLENCODE\` for HTML contexts, \`JSENCODE\` for JavaScript contexts, etc.`);
          break; // One strong finding is enough
        }
      }
    }
    if (foundUnescaped) {
      analysis.unescapedOutput = true; // Set general unescaped flag if XSS is found
    }


    // Additional check for unescaped output (broader than XSS, but related)
    if (!analysis.unescapedOutput && this.vfRawContent.includes('{!') &&
      !this.vfRawContent.includes('HTMLENCODE') &&
      !this.vfRawContent.includes('JSENCODE') &&
      !this.vfRawContent.includes('URLENCODE') &&
      !this.vfRawContent.includes('ESCAPEXML') &&
      !this.vfRawContent.includes('TEXT')) {
      analysis.unescapedOutput = true;
      analysis.recommendations.push('Consider consistently using HTMLENCODE, JSENCODE, URLENCODE, ESCAPEXML, or TEXT functions for all dynamic content to prevent XSS and other output encoding issues.');
    }

    // Check for `apex:outputText escape="false"`
    if (this.vfRawContent.includes('<apex:outputText') && this.vfRawContent.includes('escape="false"')) {
      analysis.potentialXss = true;
      analysis.unescapedOutput = true;
      analysis.recommendations.push('⚠️ `apex:outputText escape="false"` found. This is a common XSS vector. Ensure the content being outputted is absolutely trusted or has been sanitized server-side.');
    }


    return analysis;
  }

  private formatSecurityAnalysis(analysis: VfSecurityAnalysis): string {
    const lines: string[] = [
      '### Security Analysis',
      `- **Potential SOQL Injection:** ${analysis.potentialSoqlInjection ? '⚠️ Yes' : '✅ No'}`,
      `- **Potential XSS:** ${analysis.potentialXss ? '⚠️ Yes' : '✅ No'}`,
      `- **Unescaped Output:** ${analysis.unescapedOutput ? '⚠️ Yes' : '✅ No'}`,
    ];

    if (analysis.recommendations.length > 0) {
      lines.push('', '**Recommendations:**');
      lines.push(...analysis.recommendations.map(rec => `- ${rec}`));
    }

    return lines.join('\n');
  }

  /** Analyze Visualforce best practices */
  private analyzeBestPractices(): VfBestPractices {
    const practices: VfBestPractices = {
      usesViewState: this.vfRawContent.includes('apex:form'),
      hasJavaScriptRemoting: this.vfRawContent.includes('Visualforce.remoting'),
      usesApexActionFunctions: this.vfRawContent.includes('apex:actionFunction'),
      usesCompositionTemplates: this.vfRawContent.includes('apex:composition') || this.vfRawContent.includes('apex:insert') || this.vfRawContent.includes('apex:define'),
      recommendations: []
    };

    // Generate recommendations
    if (practices.usesViewState && (this.vfParsedInfo?.components.length || 0) > 30) {
      practices.recommendations.push('Consider optimizing ViewState - page has many components or complex forms. Minimize components in `apex:form` or use `rerender` for partial page updates.');
    } else if (practices.usesViewState && (this.vfRawContent.match(/<apex:(page|pageBlock|form)/gi) || []).length > 1) {
      // Multiple forms or nested forms can also indicate viewstate issues
      practices.recommendations.push('Multiple `apex:form` or nested `apex:form` structures may lead to ViewState issues. Review design for ViewState optimization.');
    }

    if (this.vfRawContent.includes('apex:commandButton') || this.vfRawContent.includes('apex:commandLink')) {
      const hasRerender = this.vfRawContent.includes('rerender="');
      if (!hasRerender) {
        practices.recommendations.push('Consider adding `rerender` attributes to `apex:commandButton` or `apex:commandLink` for partial page updates to improve user experience and reduce ViewState size on postbacks.');
      }
    }

    const inputTextCount = (this.vfRawContent.match(/apex:inputText/g) || []).length;
    const inputFieldCount = (this.vfRawContent.match(/apex:inputField/g) || []).length;
    if (inputTextCount > 0 && inputFieldCount === 0 && this.vfParsedInfo?.controllerName) {
      practices.recommendations.push('Consider using `apex:inputField` instead of `apex:inputText` for standard object fields. `apex:inputField` automatically handles data types, formatting, and validation.');
    }

    if (!practices.usesCompositionTemplates && (this.vfParsedInfo?.components.length || 0) > 10) {
      practices.recommendations.push('Consider using composition templates (`apex:composition`, `apex:insert`, `apex:define`) for reusable page layouts and to reduce boilerplate code.');
    }

    if (!practices.hasJavaScriptRemoting && !practices.usesApexActionFunctions && (this.vfRawContent.includes('XMLHttpRequest') || this.vfRawContent.includes('jQuery.ajax'))) {
      practices.recommendations.push('Page uses custom AJAX calls (e.g., XMLHttpRequest, jQuery.ajax). Consider using `Visualforce.remoting` or `apex:actionFunction` for more integrated and potentially safer AJAX interactions with Apex controllers.');
    }

    // Check for hardcoded IDs in JavaScript that are prone to breakage
    if (this.vfRawContent.includes('document.getElementById') || this.vfRawContent.includes('$("#')) {
      const hardcodedIdRegex = /getElementById\(['"]([a-zA-Z0-9:]+)['"]\)/g;
      let idMatch;
      let hardcodedIdsFound = false;
      while ((idMatch = hardcodedIdRegex.exec(this.vfRawContent)) !== null) {
        if (!idMatch[1].includes(':')) { // If it doesn't contain a colon, it's likely a hardcoded VF ID
          hardcodedIdsFound = true;
          break;
        }
      }
      if (hardcodedIdsFound) {
        practices.recommendations.push('Avoid hardcoding component IDs in JavaScript (e.g., `document.getElementById("someId")`). Use `$Component` global variable to dynamically generate correct IDs, or assign `styleClass` attributes for robust selectors.');
      }
    }

    return practices;
  }

  private formatBestPractices(practices: VfBestPractices): string {
    const lines: string[] = [
      '### Best Practices Analysis',
      `- **Uses ViewState:** ${practices.usesViewState ? 'Yes' : 'No'}`,
      `- **Uses JavaScript Remoting:** ${practices.hasJavaScriptRemoting ? 'Yes' : 'No'}`,
      `- **Uses Action Functions:** ${practices.usesApexActionFunctions ? 'Yes' : 'No'}`,
      `- **Uses Composition Templates:** ${practices.usesCompositionTemplates ? 'Yes' : 'No'}`,
    ];

    if (practices.recommendations.length > 0) {
      lines.push('', '**Recommendations:**');
      lines.push(...practices.recommendations.map(rec => `- ${rec}`));
    }

    return lines.join('\n');
  }

  /** Generate cross-references to related components */
  private generateCrossReferences(): string {
    const lines: string[] = ['## Cross-References', ''];
    let hasReferences = false;

    // Link to related Apex classes
    if (this.apexParsedInfoMap.size > 0) {
      lines.push('### Related Apex Classes');
      for (const [className] of this.apexParsedInfoMap) {
        lines.push(`- [${className}](../apex/${className}.md)`);
      }
      lines.push('');
      hasReferences = true;
    }

    // Link to related objects if standard controller is used
    if (this.vfParsedInfo?.controllerName) {
      // Assuming standard controllers are often SObject names
      const sobjectName = this.vfParsedInfo.controllerName.endsWith('__c')
        ? this.vfParsedInfo.controllerName // Custom object
        : this.vfParsedInfo.controllerName; // Standard object (e.g., Account, Contact)

      lines.push('### Standard/Custom Object Context');
      lines.push(`- [${sobjectName}](../objects/${sobjectName}.md)`);
      lines.push('');
      hasReferences = true;
    }

    // Detect template fragments
    const templateFragments = this.detectTemplateFragments();
    if (templateFragments.length > 0) {
      lines.push('### Template Usage');
      templateFragments.forEach(fragment => lines.push(`- ${fragment}`));
      hasReferences = true;
    }

    return hasReferences ? lines.join('\n') : '';
  }

  private detectTemplateFragments(): string[] {
    const fragments: string[] = [];
    const templatePatterns = [
      { pattern: /<apex:composition\s+template="([^"]+)"/i, name: 'Uses template' },
      { pattern: /<apex:insert\s+name="([^"]+)"/i, name: 'Defines insert point' },
      { pattern: /<apex:define\s+name="([^"]+)"/i, name: 'Defines content for' }
    ];

    for (const { pattern, name } of templatePatterns) {
      const matches = this.vfRawContent.match(new RegExp(pattern, 'gi')); // 'gi' for global and case-insensitive
      if (matches) {
        matches.forEach(match => {
          const valueMatch = match.match(pattern);
          if (valueMatch && valueMatch[1]) {
            fragments.push(`${name}: \`${valueMatch[1]}\``);
          }
        });
      }
    }

    return Array.from(new Set(fragments)); // Ensure unique fragments
  }

  /** Prepares the variables object that will be sent to the AI prompt */
  private preparePromptVariables(): Record<string, any> {
    const allApexDetails: string[] = [];
    for (const apexInfo of this.apexParsedInfoMap.values()) {
      allApexDetails.push(ApexParser.formatForPrompt(
        apexInfo.methods,
        apexInfo.properties,
        apexInfo.className,
        apexInfo.javaDoc
      ));
    }
    const apexControllerInfo = allApexDetails.join('\n\n---\n\n');

    // Generate analysis summaries for AI context
    const performanceMetrics = this.calculatePerformanceMetrics();
    const securityAnalysis = this.analyzeSecurityConcerns();
    const bestPractices = this.analyzeBestPractices();

    return {
      VF_NAME: this.metadataName,
      VF_CODE: this.vfRawContent,
      RAW_VF_CODE: this.vfRawContent, // Keep for backward compatibility or explicit raw
      VF_CONTROLLER: apexControllerInfo,
      VF_COMPONENTS_SUMMARY: this.vfParsedInfo && this.vfParsedInfo.components.length > 0
        ? `Uses ${this.vfParsedInfo.components.length} components, including: ${this.vfParsedInfo.components.slice(0, 5).map(c => `<${c.namespace}:${c.name}>`).join(', ')}.`
        : 'No specific Visualforce components identified.',
      VF_ANALYSIS_SUMMARY: this.generateAnalysisSummary(performanceMetrics, securityAnalysis, bestPractices)
    };
  }

  private generateAnalysisSummary(performance: VfPerformanceMetrics, security: VfSecurityAnalysis, practices: VfBestPractices): string {
    const summaries: string[] = [];

    if (performance.estimatedRenderComplexity !== 'low') {
      summaries.push(`Performance: ${performance.estimatedRenderComplexity} render complexity.`);
    }
    if (performance.largeDataTables) {
      summaries.push('Performance: Potential large data tables/iterations detected.');
    }
    if (performance.recommendations.length > 0) {
      summaries.push('Performance: Recommendations for improvement are available.');
    }

    if (security.potentialSoqlInjection || security.potentialXss || security.unescapedOutput) {
      summaries.push('Security: Potential vulnerabilities detected.');
    }
    if (security.recommendations.length > 0) {
      summaries.push('Security: Recommendations for addressing concerns are available.');
    }

    if (practices.recommendations.length > 0) {
      summaries.push('Best Practices: Opportunities for adherence to best practices identified.');
    }
    if (practices.usesViewState) {
      summaries.push('Best Practices: Uses ViewState (consider optimization).');
    }


    return summaries.length > 0 ? summaries.join('; ') : 'No significant issues or recommendations detected in automated analysis.';
  }

  /** Build initial markdown lines (before AI description is injected) */
  public async buildInitialMarkdownLines(): Promise<string[]> {
    return [
      `# ${this.metadataName}`,
      '',
      this.placeholder,
      '',
      '## Visualforce Source',
      '```xml',
      this.vfRawContent,
      '```',
      '',
    ];
  }

  /** Main function to generate the AI description with caching and parser fallback */
  public async completeDocWithAiDescription(): Promise<string> {
    const cacheKey = await this.getEnhancedCacheKey();
    let cachedAIResult: string | null = null;

    try {
      cachedAIResult = await getCache(cacheKey, null);

      if (cachedAIResult) {
        return this.injectDescriptionIntoSkeleton(cachedAIResult);
      }

      // If no cache, try AI
      const aiDescription = await super.completeDocWithAiDescription();
      await setCache(cacheKey, aiDescription);
      return this.injectDescriptionIntoSkeleton(aiDescription);
    } catch (err: any) {
      console.warn(`AI generation failed for VF page ${this.metadataName}:`, err.message);
      // Cache the fallback result so we don't keep retrying failed AI calls
      const fallbackResult = this.parserFallbackMarkdown;
      await setCache(cacheKey, fallbackResult); // Cache the fallback
      return this.injectDescriptionIntoSkeleton(fallbackResult);
    }
  }

  /** Helper to inject a description (AI or fallback) into the markdown skeleton */
  private async injectDescriptionIntoSkeleton(descriptionContent: string): Promise<string> {
    const lines = await this.buildInitialMarkdownLines();
    const placeholderIndex = lines.indexOf(this.placeholder);
    if (placeholderIndex >= 0) {
      // Replace the placeholder with the actual description content
      lines.splice(placeholderIndex, 1, descriptionContent);
    }
    return lines.join("\n");
  }

  /** Extracts the shortDescription from AI JSON output or returns a default */
  private extractShortDescription(fullMarkdownContent: string): string {
    let shortDescription = 'No description available.';
    try {
      // Attempt to find a JSON block in the markdown content
      const jsonOutputMatch = fullMarkdownContent.match(/```json\s*(\{[\s\S]*?})\s*```/);
      if (jsonOutputMatch && jsonOutputMatch[1]) {
        const aiJson = JSON.parse(jsonOutputMatch[1]);
        shortDescription = aiJson.shortDescription || shortDescription;
      } else {
        // Fallback if no JSON block, maybe AI just returned raw text
        // Try to extract the first paragraph or line as a short description
        const firstParagraphMatch = fullMarkdownContent.match(/^(?!#).+?\n\n/s); // First non-heading paragraph
        if (firstParagraphMatch && firstParagraphMatch[0]) {
          shortDescription = firstParagraphMatch[0].trim().split('\n')[0].substring(0, 200) + '...';
        }
      }
    } catch (jsonErr: any) {
      console.warn(`Failed to parse AI JSON or extract shortDescription for ${this.metadataName}: ${jsonErr.message}`);
      // If parsing fails, use the fallback text from generateParserOnlyMarkdown as a short description
      const parserSummaryMatch = this.parserFallbackMarkdown.match(/Automated Parser Summary[\s\S]*?^#+/m);
      if (parserSummaryMatch) {
        shortDescription = parserSummaryMatch[0].split('\n')[2].substring(0, 200) + '...'; // Get a snippet from the fallback
      } else {
        shortDescription = 'AI description could not be parsed, using parser fallback or generic description.';
      }
    }
    return shortDescription;
  }

  /** Static method for building the index.md for all VF pages */
  public static buildIndexTable(
    outputRoot: string,
    vfDescriptions: VfDocGenerationResult[],
  ) {
    const filtered = vfDescriptions;

    if (filtered.length === 0) return [];

    const lines: string[] = [
      "## Visualforce Pages Overview", // More descriptive heading
      "",
      "| Visualforce Page | Description |",
      "| :--------------- | :---------- |"
    ];

    for (const vf of filtered) {
      const relativePathToIndex = path.relative(path.join(outputRoot, 'vf'), vf.outputPath);
      const pageCell = `[${vf.name}](${relativePathToIndex})`;
      const descriptionCell = vf.shortDescription || 'No description available.'
      lines.push(`| ${pageCell} | ${descriptionCell} |`);
    }

    lines.push("");
    return lines;
  }
}
