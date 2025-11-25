import { XMLParser } from 'fast-xml-parser';

export interface VfComponentUsage {
  name: string;
  namespace: string;
  attributes: Record<string, string>;
  lineNumber?: number;
}

export interface VfFieldReference {
  expression: string;
  context: string;
  lineNumber?: number;
}

export interface VfParsedInfo {
  controllerName?: string;
  extensionNames: string[];
  components: VfComponentUsage[];
  fieldReferences: VfFieldReference[];
  apexExpressions: string[];
  hasForms: boolean;
  hasRemoteObjects: boolean;
  hasStaticResources: boolean;
  templateFragments: string[];
}

export class VfParser {
  private static xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    allowBooleanAttributes: true,
    alwaysCreateTextNode: false,
    processEntities: true,
    stopNodes: ["*.script", "*.style"],
    preserveOrder: false,
    trimValues: true,
  });

  public static async parse(vfContent: string): Promise<VfParsedInfo> {
    const result: VfParsedInfo = {
      extensionNames: [],
      components: [],
      fieldReferences: [],
      apexExpressions: [],
      hasForms: false,
      hasRemoteObjects: false,
      hasStaticResources: false,
      templateFragments: [],
    };

    try {
      const parsedData = VfParser.xmlParser.parse(vfContent);

      if (!parsedData || (typeof parsedData !== 'object') || !parsedData['apex:page']) {
        // If XML parsing fails or is not a VF page, use fallback
        console.warn('VF Parser: XML parsing did not find <apex:page> root, performing basic regex extraction.');
        VfParser._extractBasicVfInfo(vfContent, result); // Use the new shared method
        VfParser.extractApexExpressions(vfContent, result); // Still need to extract expressions
        return result;
      }

      const pageTag = parsedData['apex:page'];

      // Extract controller and extension names
      if (pageTag.standardController) {
        result.controllerName = pageTag.standardController;
      }
      if (pageTag.extensions) {
        result.extensionNames = pageTag.extensions.split(',').map((ext: string) => ext.trim());
      }

      // Check for forms
      result.hasForms = vfContent.includes('<apex:form');

      // Check for remote objects
      result.hasRemoteObjects = vfContent.includes('apex:remoteObjectModel') ||
        vfContent.includes('Visualforce.remoting');

      // Check for static resources
      result.hasStaticResources = vfContent.includes('$Resource.') ||
        vfContent.includes('apex:stylesheet') ||
        vfContent.includes('apex:includeScript');

      // Extract template fragments
      result.templateFragments = this.extractTemplateFragments(vfContent);

      // Helper to traverse nodes and extract info
      const traverse = (node: any, currentContext: string = 'unknown') => {
        if (typeof node !== 'object' || node === null) return;

        for (const key in node) {
          if (!Object.prototype.hasOwnProperty.call(node, key)) continue;

          const value = node[key];
          const newContext = key.startsWith('@_') ? `${currentContext}.${key.substring(2)}` : key;

          // Identify VF components (excluding apex:page and text nodes)
          if (key.includes(':') && key !== 'apex:page' && key !== '#text') {
            const [namespace, name] = key.split(':');
            if (namespace && name) {
              const attributes: Record<string, string> = {};

              // Extract attributes
              for (const attrKey in value) {
                if (attrKey.startsWith('@_')) {
                  attributes[attrKey.substring(2)] = String(value[attrKey]);
                  this.extractApexExpressions(String(value[attrKey]), result, `${namespace}:${name}.${attrKey.substring(2)}`);
                } else if (typeof value[attrKey] !== 'object' && !attrKey.includes(':') && !attrKey.startsWith('#')) {
                  attributes[attrKey] = String(value[attrKey]);
                  this.extractApexExpressions(String(value[attrKey]), result, `${namespace}:${name}.${attrKey}`);
                }
              }

              result.components.push({
                namespace,
                name,
                attributes,
              });
            }
          }

          // Process text content for Apex expressions
          if (key === '#text' && typeof value === 'string') {
            this.extractApexExpressions(value, result, currentContext);
          }

          // Recursively traverse
          if (typeof value === 'object' && value !== null) {
            if (Array.isArray(value)) {
              for (const item of value) {
                traverse(item, newContext);
              }
            } else {
              traverse(value, newContext);
            }
          }
        }
      };

      traverse(pageTag, 'apex:page');

      // Filter unique apex expressions and sort by complexity
      result.apexExpressions = Array.from(new Set(result.apexExpressions))
        .sort((a, b) => {
          // Sort by complexity (method calls first, then properties)
          const aComplexity = a.includes('(') ? 2 : a.includes('.') ? 1 : 0;
          const bComplexity = b.includes('(') ? 2 : b.includes('.') ? 1 : 0;
          return bComplexity - aComplexity;
        });

      // Sort components by frequency for better analysis
      // This is a statistical sort, may not be strictly "unique" components
      const componentCounts = new Map<string, number>();
      for (const comp of result.components) {
        const key = `${comp.namespace}:${comp.name}`;
        componentCounts.set(key, (componentCounts.get(key) || 0) + 1);
      }

      result.components.sort((a, b) => {
        const aCount = result.components.filter(c => c.name === a.name).length;
        const bCount = result.components.filter(c => c.name === b.name).length;
        return bCount - aCount;
      });

    } catch (err: any) {
      console.warn('VF Parser: Error parsing Visualforce content with XML parser, using fallback extraction:', err.message);
      this._extractBasicVfInfo(vfContent, result); // Use the new shared method
      this.extractApexExpressions(vfContent, result); // Still need to extract expressions from raw content
    }

    return result;
  }

  private static extractApexExpressions(text: string, result: VfParsedInfo, context: string = 'unknown'): void {
    const expressionRegex = /\{!([^}]+)\}/g;
    let match;

    while ((match = expressionRegex.exec(text)) !== null) {
      const exprContent = match[1].trim();

      // Enhanced classification of expressions
      if (exprContent.includes('(') && exprContent.includes(')')) {
        // Method call
        result.apexExpressions.push(exprContent);
      } else if (exprContent.includes('.')) {
        // Complex property access
        result.apexExpressions.push(exprContent);
      } else {
        // Simple property or variable
        result.fieldReferences.push({
          expression: exprContent,
          context: context
        });
      }
    }
  }

  private static extractTemplateFragments(vfContent: string): string[] {
    const fragments: string[] = [];
    const patterns = [
      { regex: /<apex:composition\s+template="([^"]+)"/g, label: 'Template' },
      { regex: /<apex:insert\s+name="([^"]+)"/g, label: 'Insert Point' },
      { regex: /<apex:define\s+name="([^"]+)"/g, label: 'Content Definition' },
      { regex: /<apex:composition\s+define="([^"]+)"/g, label: 'Composition Definition' }
    ];

    for (const { regex, label } of patterns) {
      let match;
      while ((match = regex.exec(vfContent)) !== null) {
        if (match[1]) {
          fragments.push(`${label}: ${match[1]}`);
        }
      }
    }

    return Array.from(new Set(fragments));
  }

  // NEW SHARED METHOD
  public static _extractBasicVfInfo(vfContent: string, result: VfParsedInfo): void {
    const controllerMatch = vfContent.match(/standardController\s*=\s*"([^"]*)"/);
    if (controllerMatch) {
      result.controllerName = controllerMatch[1];
    }

    const extensionsMatch = vfContent.match(/extensions\s*=\s*"([^"]*)"/);
    if (extensionsMatch) {
      result.extensionNames = extensionsMatch[1].split(',').map(ext => ext.trim());
    }

    const componentRegex = /<([a-z]+):([a-zA-Z]+)/g;
    let compMatch;
    const uniqueComponents = new Set<string>(); // Use a set to avoid duplicate component entries for basic info
    while ((compMatch = componentRegex.exec(vfContent)) !== null) {
      const componentKey = `${compMatch[1]}:${compMatch[2]}`;
      if (!uniqueComponents.has(componentKey)) {
        result.components.push({
          namespace: compMatch[1],
          name: compMatch[2],
          attributes: {} // Attributes cannot be extracted with this simple regex
        });
        uniqueComponents.add(componentKey);
      }
    }
    // Note: extractApexExpressions is called separately as it might be needed outside this basic parse
  }

  // Exposed simplifiedParse method for DocBuilderVf
  public static simplifiedParse(content: string): VfParsedInfo {
    const result: VfParsedInfo = {
      extensionNames: [],
      components: [],
      fieldReferences: [],
      apexExpressions: [],
      hasForms: false,
      hasRemoteObjects: false,
      hasStaticResources: false,
      templateFragments: [],
    };
    VfParser._extractBasicVfInfo(content, result);
    VfParser.extractApexExpressions(content, result);
    // Populate other boolean flags based on regex as well
    result.hasForms = content.includes('<apex:form');
    result.hasRemoteObjects = content.includes('apex:remoteObjectModel') || content.includes('Visualforce.remoting');
    result.hasStaticResources = content.includes('$Resource.') || content.includes('<apex:stylesheet') || content.includes('<apex:includeScript');
    result.templateFragments = VfParser.extractTemplateFragments(content);
    return result;
  }
}
