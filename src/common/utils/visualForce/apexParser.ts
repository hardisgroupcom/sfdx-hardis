export interface ApexProperty {
  name: string;
  type: string;
  accessModifier: string;
  hasGetter: boolean;
  hasSetter: boolean;
  javaDoc?: string;
  line?: number;
  isStatic?: boolean;
  isFinal?: boolean;
}

export interface ApexMethod {
  name: string;
  returnType: string;
  accessModifier: string;
  parameters: string[];
  javaDoc?: string;
  line?: number;
  isStatic?: boolean;
  isTest?: boolean;
  modifiers: string[];
}

export interface ApexParsedInfo {
  className: string;
  properties: ApexProperty[];
  methods: ApexMethod[];
  javaDoc?: string;
  interfaces?: string[];
  superClass?: string;
}

export class ApexParser {
  // Regex for Javadoc-like comments (multi-line or single-line before declarations)
  private static JAVADOC_REGEX = /\/\*\*(.*?)\*\/\s*/s;
  // Regex for method declarations. Added non-capturing groups for optional modifiers.
  private static METHOD_REGEX = /(public|private|global|protected)\s+(?:(static|virtual|override|abstract|testMethod|webservice)\s+)*(?:<[^>]+>\s+)?([a-zA-Z0-9_<>.\\[\]]+)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(?:throws\s+[^{]+)?\s*(\{)?/;
  // Regex for property declarations. Corrected the character set for variable names.
  private static PROPERTY_REGEX = /(public|private|global|protected)\s+(?:(static|final)\s+)*([a-zA-Z0-9_<>.\\[\]]+)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?: \{ ([^}]*) \})?;/;
  private static CLASS_DECLARATION_REGEX = /(?:public|private|global|protected)?\s*(?:with\s+sharing|without\s+sharing|inherited\s+sharing)?\s*class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:extends\s+([a-zA-Z_][a-zA-Z0-9_]*))?\s*(?:implements\s+([^{]+))?\{/;

  public static async parse(apexContent: string, className: string): Promise<ApexParsedInfo> {
    const result: ApexParsedInfo = {
      className,
      properties: [],
      methods: [],
    };

    const lines = apexContent.split('\n');
    let currentJavaDoc: string[] = [];

    // Extract class-level information
    const classMatch = apexContent.match(this.CLASS_DECLARATION_REGEX);
    if (classMatch) {
      result.superClass = classMatch[2];
      if (classMatch[3]) {
        result.interfaces = classMatch[3].split(',').map(i => i.trim());
      }
    }

    // Extract class-level Javadoc
    const classJavadocRegex = new RegExp(`^\\s*${this.JAVADOC_REGEX.source}\\s*(?:public|private|global|protected)?\\s*(?:with\\s+sharing|without\\s+sharing|inherited\\s+sharing)?\\s*class\\s+${className}`, 's');
    const classJavadocMatch = apexContent.match(classJavadocRegex);
    if (classJavadocMatch && classJavadocMatch[1]) {
      result.javaDoc = this.cleanJavadoc(classJavadocMatch[1]);
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Capture Javadoc-like comments
      if (line.startsWith('/**')) {
        currentJavaDoc = [line];
        let j = i + 1;
        while (j < lines.length && !lines[j].includes('*/')) {
          currentJavaDoc.push(lines[j]);
          j++;
        }
        if (j < lines.length) {
          currentJavaDoc.push(lines[j]); // Add the line with '*/'
        }
        i = j; // Move the main loop's index past the Javadoc block
        continue;
      }

      // Capture single-line Javadoc comments
      const singleLineJavadocMatch = line.match(/^\/\/\/\s*(.*)/); // For `///` style comments if preferred
      if (singleLineJavadocMatch) {
        currentJavaDoc.push(`* ${singleLineJavadocMatch[1]}`); // Format as javadoc line
        continue;
      }

      // Skip empty lines and comments in Javadoc tracking
      if (line === '' || line.startsWith('//')) {
        continue;
      }

      // Method parsing with enhanced regex
      const methodMatch = line.match(this.METHOD_REGEX);
      if (methodMatch) {
        const modifiers = methodMatch[2] ? methodMatch[2].split(/\s+/) : [];
        const isTest = modifiers.includes('testMethod') || methodMatch[4].toLowerCase().startsWith('test');

        result.methods.push({
          name: methodMatch[4],
          returnType: methodMatch[3],
          accessModifier: methodMatch[1],
          parameters: methodMatch[5].split(',').map(p => p.trim()).filter(p => p.length > 0),
          javaDoc: currentJavaDoc.length > 0 ? this.cleanJavadoc(currentJavaDoc.join('\n')) : undefined,
          line: i + 1,
          isStatic: modifiers.includes('static'),
          isTest: isTest,
          modifiers: modifiers
        });
        currentJavaDoc = [];
        continue;
      }

      // Property parsing with enhanced regex
      const propertyMatch = line.match(this.PROPERTY_REGEX);
      if (propertyMatch) {
        const getterSetterContent = propertyMatch[5] || '';
        const modifiers = propertyMatch[2] ? propertyMatch[2].split(/\s+/) : [];

        result.properties.push({
          name: propertyMatch[4],
          type: propertyMatch[3],
          accessModifier: propertyMatch[1],
          hasGetter: getterSetterContent.includes('get'),
          hasSetter: getterSetterContent.includes('set'),
          javaDoc: currentJavaDoc.length > 0 ? this.cleanJavadoc(currentJavaDoc.join('\n')) : undefined,
          line: i + 1,
          isStatic: modifiers.includes('static'),
          isFinal: modifiers.includes('final')
        });
        currentJavaDoc = [];
        continue;
      }

      // Reset Javadoc if we hit a non-comment, non-empty line that's not a method/property
      if (currentJavaDoc.length > 0) {
        currentJavaDoc = [];
      }
    }

    return result;
  }

  // Utility to clean Javadoc content
  private static cleanJavadoc(javadocContent: string): string {
    return javadocContent
      .replace(/^\s*\/\*\*?/, '')
      .replace(/\*\/$/, '')
      .replace(/^\s*\*\s?/gm, '')
      .replace(/\{@[^}]+\}/g, '')
      .trim();
  }

  // Formats parsed Apex info into a string suitable for the AI prompt
  public static formatForPrompt(
    methods: ApexMethod[],
    properties: ApexProperty[],
    className?: string,
    classJavadoc?: string
  ): string {
    const lines: string[] = [];

    if (className) {
      lines.push(`// Apex Class: ${className}`);
    }
    if (classJavadoc) {
      const firstParagraph = classJavadoc.split('\n\n')[0];
      lines.push(`// Description: ${firstParagraph}`);
    }
    if (className || classJavadoc) {
      lines.push('');
    }

    // Group methods by type for better organization
    const testMethods = methods.filter(m => m.isTest);
    const staticMethods = methods.filter(m => m.isStatic && !m.isTest);
    const instanceMethods = methods.filter(m => !m.isStatic && !m.isTest);

    if (properties.length > 0) {
      lines.push('// --- Properties ---');
      const staticProps = properties.filter(p => p.isStatic);
      const instanceProps = properties.filter(p => !p.isStatic);

      if (staticProps.length > 0) {
        lines.push('// Static Properties:');
        for (const prop of staticProps) {
          lines.push(this.formatProperty(prop));
        }
      }

      if (instanceProps.length > 0) {
        lines.push('// Instance Properties:');
        for (const prop of instanceProps) {
          lines.push(this.formatProperty(prop));
        }
      }
      lines.push('');
    }

    if (staticMethods.length > 0) {
      lines.push('// --- Static Methods ---');
      for (const method of staticMethods) {
        lines.push(this.formatMethod(method));
      }
      lines.push('');
    }

    if (instanceMethods.length > 0) {
      lines.push('// --- Instance Methods ---');
      for (const method of instanceMethods) {
        lines.push(this.formatMethod(method));
      }
      lines.push('');
    }

    if (testMethods.length > 0) {
      lines.push('// --- Test Methods ---');
      for (const method of testMethods.slice(0, 5)) { // Limit test methods
        lines.push(this.formatMethod(method));
      }
      if (testMethods.length > 5) {
        lines.push(`// ... and ${testMethods.length - 5} more test methods`);
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  }

  private static formatProperty(prop: ApexProperty): string {
    let propLine = `// ${prop.accessModifier} `;
    if (prop.isStatic) propLine += 'static ';
    if (prop.isFinal) propLine += 'final ';
    propLine += `${prop.type} ${prop.name}`;

    if (prop.hasGetter || prop.hasSetter) {
      propLine += ` {${prop.hasGetter ? 'get;' : ''}${prop.hasSetter ? 'set;' : ''}}`;
    }

    if (prop.javaDoc) {
      propLine += ` // Javadoc: ${prop.javaDoc.split('\n')[0].substring(0, 100)}`; // Limit length
      if (prop.javaDoc.split('\n')[0].length > 100) propLine += '...';
    }

    return propLine;
  }

  private static formatMethod(method: ApexMethod): string {
    let methodLine = `// ${method.accessModifier} `;
    if (method.modifiers.includes('static')) methodLine += 'static ';
    if (method.modifiers.includes('virtual')) methodLine += 'virtual ';
    if (method.modifiers.includes('override')) methodLine += 'override ';
    if (method.modifiers.includes('abstract')) methodLine += 'abstract ';
    if (method.modifiers.includes('webservice')) methodLine += 'webservice '; // Added webservice
    methodLine += `${method.returnType} ${method.name}(${method.parameters.join(', ')})`;

    if (method.javaDoc) {
      methodLine += ` // Javadoc: ${method.javaDoc.split('\n')[0].substring(0, 100)}`; // Limit length
      if (method.javaDoc.split('\n')[0].length > 100) methodLine += '...';
    }

    return methodLine;
  }
}
