// Element paths of replacement rules, compiled to XPath bound to the Salesforce metadata namespace,
// so nobody writes "ns:" prefixes in their configuration.
//
//   NamedCredential/endpoint                       -> /ns:NamedCredential/ns:endpoint
//   //dayOfMonthToRun                              -> //ns:dayOfMonthToRun
//   Flow/screens//fields/styleProperties           -> /ns:Flow/ns:screens//ns:fields/ns:styleProperties
//   Workflow/alerts[fullName=Escalation_Alert]     -> /ns:Workflow/ns:alerts[ns:fullName='Escalation_Alert']
//   Layout/excludeButtons[.=SmartFillEnrich]       -> /ns:Layout/ns:excludeButtons[.='SmartFillEnrich']
//   Flow/*/group                                   -> /ns:Flow/*/ns:group

import xpath from 'xpath';

export const METADATA_NAMESPACE = 'http://soap.sforce.com/2006/04/metadata';

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

interface XmlPathStep {
  descendant: boolean;
  name: string;
  predicates: { field: string; value: string }[];
}

/** Compile an element path to an XPath expression using the "ns" prefix. Throws on a bad path. */
export function compileXmlPath(xmlPath: string): string {
  const steps = parseXmlPath(xmlPath);
  return steps
    .map((step) => {
      const name = step.name === '*' ? '*' : `ns:${step.name}`;
      const predicates = step.predicates
        .map((predicate) => `[${predicate.field === '.' ? '.' : `ns:${predicate.field}`}=${xpathLiteral(predicate.value)}]`)
        .join('');
      return `${step.descendant ? '//' : '/'}${name}${predicates}`;
    })
    .join('');
}

/** Select the nodes of a document matching an element path */
export function selectXmlPath(xmlPath: string, doc: any): any[] {
  const select = xpath.useNamespaces({ ns: METADATA_NAMESPACE });
  const nodes = select(compileXmlPath(xmlPath), doc);
  return Array.isArray(nodes) ? nodes : [];
}

/** Remove an element with the indentation before it, so the file keeps one element per line */
export function removeXmlNode(node: any): void {
  const parent = node?.parentNode;
  if (!parent) {
    return;
  }
  const previous = node.previousSibling;
  if (previous && previous.nodeType === 3 && /^\s*$/.test(previous.nodeValue || '')) {
    parent.removeChild(previous);
  }
  parent.removeChild(node);
}

/** Error message for a bad path, or null when the path is valid */
export function validateXmlPath(xmlPath: string): string | null {
  try {
    compileXmlPath(xmlPath);
    return null;
  } catch (e: any) {
    return e.message;
  }
}

function parseXmlPath(xmlPathInput: string): XmlPathStep[] {
  const xmlPath = String(xmlPathInput || '').trim();
  if (xmlPath === '') {
    throw new Error('empty element path');
  }
  const steps: XmlPathStep[] = [];
  let index = 0;
  let descendant = false;
  if (xmlPath.startsWith('//')) {
    descendant = true;
    index = 2;
  } else if (xmlPath.startsWith('/')) {
    index = 1;
  }
  while (index < xmlPath.length) {
    // Step name
    let name = '';
    while (index < xmlPath.length && xmlPath[index] !== '/' && xmlPath[index] !== '[') {
      name += xmlPath[index];
      index++;
    }
    name = name.trim();
    if (name !== '*' && !NAME_PATTERN.test(name)) {
      throw new Error(`invalid element name "${name}" in "${xmlPath}"`);
    }
    // Predicates
    const predicates: XmlPathStep['predicates'] = [];
    while (xmlPath[index] === '[') {
      const end = findPredicateEnd(xmlPath, index);
      if (end === -1) {
        throw new Error(`missing "]" in "${xmlPath}"`);
      }
      predicates.push(parsePredicate(xmlPath.substring(index + 1, end), xmlPath));
      index = end + 1;
    }
    steps.push({ descendant, name, predicates });
    descendant = false;
    if (index >= xmlPath.length) {
      break;
    }
    if (xmlPath[index] !== '/') {
      throw new Error(`unexpected "${xmlPath[index]}" in "${xmlPath}"`);
    }
    if (xmlPath[index + 1] === '/') {
      descendant = true;
      index += 2;
    } else {
      index += 1;
    }
    if (index >= xmlPath.length) {
      throw new Error(`"${xmlPath}" ends with "/"`);
    }
  }
  return steps;
}

// A value can contain "]" when it is quoted
function findPredicateEnd(xmlPath: string, start: number): number {
  let quote: string | null = null;
  for (let index = start + 1; index < xmlPath.length; index++) {
    const char = xmlPath[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ']') {
      return index;
    }
  }
  return -1;
}

function parsePredicate(content: string, xmlPath: string): { field: string; value: string } {
  const equal = content.indexOf('=');
  if (equal === -1) {
    throw new Error(`predicate "[${content}]" must be [element=value] or [.=value] in "${xmlPath}"`);
  }
  const field = content.substring(0, equal).trim();
  let value = content.substring(equal + 1).trim();
  if (field !== '.' && !NAME_PATTERN.test(field)) {
    throw new Error(`invalid element name "${field}" in predicate of "${xmlPath}"`);
  }
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
    value = value.substring(1, value.length - 1);
  }
  return { field, value };
}

// XPath 1.0 has no escape character: a value holding both quote kinds goes through concat()
function xpathLiteral(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  return `concat('${value.split("'").join(`', "'", '`)}')`;
}
