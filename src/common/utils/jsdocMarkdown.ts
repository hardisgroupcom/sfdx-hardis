/**
 * Dependency-free JSDoc to markdown renderer, tailored for Lightning Web Component JavaScript files.
 *
 * It replaces jsdoc-to-markdown for the LWC documentation use case: it extracts every `/** ... *\/` block,
 * looks at the declaration that follows it (class, constructor, method, getter/setter, class field with
 * `@api` / `@track` / `@wire` decorators, exported function or constant), parses the usual JSDoc tags and
 * renders a markdown section per documented symbol.
 *
 * The renderer never throws on malformed input: it returns an empty string when nothing is documented.
 */

export interface JsdocParam {
  name: string;
  type: string;
  description: string;
  optional: boolean;
  defaultValue?: string;
}

export interface JsdocTyped {
  type: string;
  description: string;
}

export type JsdocSymbolKind =
  | 'class'
  | 'constructor'
  | 'method'
  | 'getter'
  | 'setter'
  | 'property'
  | 'function'
  | 'constant'
  | 'typedef'
  | 'file';

export interface JsdocSymbol {
  name: string;
  kind: JsdocSymbolKind;
  description: string;
  params: JsdocParam[];
  properties: JsdocParam[];
  returns?: JsdocTyped;
  throws: JsdocTyped[];
  type?: string;
  examples: string[];
  deprecated?: string;
  fires: string[];
  see: string[];
  decorators: string[];
  isStatic: boolean;
  isAsync: boolean;
  isPrivate: boolean;
  extendsName?: string;
  defaultValue?: string;
  memberOf?: string;
  /** Parameter names taken from the code signature (used for headings when no @param tag is present) */
  signatureParams: string[];
}

export interface RenderJsdocOptions {
  fileName?: string;
}

interface ParsedTags {
  description: string;
  name?: string;
  kind?: JsdocSymbolKind;
  memberOf?: string;
  params: JsdocParam[];
  properties: JsdocParam[];
  returns?: JsdocTyped;
  throws: JsdocTyped[];
  type?: string;
  examples: string[];
  deprecated?: string;
  fires: string[];
  see: string[];
  decorators: string[];
  isStatic: boolean;
  isAsync: boolean;
  isPrivate: boolean;
  extendsName?: string;
  defaultValue?: string;
}

interface Declaration {
  kind: JsdocSymbolKind;
  name?: string;
  params: string[];
  isStatic: boolean;
  isAsync: boolean;
  extendsName?: string;
  defaultValue?: string;
  decorators: string[];
  index: number;
}

interface ClassRange {
  name: string;
  start: number;
  end: number;
}

const DOC_COMMENT_REGEX = /\/\*\*(?!\/)([\s\S]*?)\*\//g;
const IDENTIFIER = '[A-Za-z_$#][\\w$]*';
const RESERVED_WORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'super', 'typeof', 'await', 'new', 'do', 'else', 'throw', 'import', 'export', 'with', 'yield', 'delete', 'void', 'in', 'of',
]);

/* ---------------------------------------------------------------------------------------------- */
/* Public API                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Render the JSDoc comments of a JavaScript source file as markdown.
 * Returns an empty string when the source contains no documented symbol.
 */
export function renderJsdocMarkdown(jsSource: string, options: RenderJsdocOptions = {}): string {
  try {
    const symbols = parseJsdocSymbols(jsSource, options).filter((symbol) => !symbol.isPrivate);
    if (symbols.length === 0) {
      return '';
    }
    const lines: string[] = [];
    for (const symbol of symbols) {
      lines.push(...renderSymbol(symbol, options));
      lines.push('');
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return '';
  }
}

/**
 * Parse the JSDoc comments of a JavaScript source file into symbol descriptors (source order).
 * Private symbols (`@private`, `@ignore`, `@access private`, `#name` fields) are returned with `isPrivate = true`.
 */
export function parseJsdocSymbols(jsSource: string, options: RenderJsdocOptions = {}): JsdocSymbol[] {
  const source = typeof jsSource === 'string' ? jsSource.replace(/\r\n?/g, '\n') : '';
  if (!source) {
    return [];
  }
  const classRanges = findClassRanges(source);
  const symbols: JsdocSymbol[] = [];
  const regex = new RegExp(DOC_COMMENT_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    let tags: ParsedTags;
    let declaration: Declaration | null;
    try {
      tags = parseCommentBody(match[1]);
      declaration = parseDeclaration(source, match.index + match[0].length);
    } catch {
      continue;
    }
    const symbol = buildSymbol(tags, declaration, classRanges, options);
    if (symbol) {
      symbols.push(symbol);
    }
  }
  return symbols;
}

/* ---------------------------------------------------------------------------------------------- */
/* Comment parsing                                                                                */
/* ---------------------------------------------------------------------------------------------- */

function parseCommentBody(body: string): ParsedTags {
  const rawLines = body.split('\n').map((line) => line.replace(/^\s*\*(?!\/)\s?/, '').replace(/\s+$/, ''));
  // Remove leading and trailing blank lines
  while (rawLines.length > 0 && rawLines[0].trim() === '') {
    rawLines.shift();
  }
  while (rawLines.length > 0 && rawLines[rawLines.length - 1].trim() === '') {
    rawLines.pop();
  }

  const descriptionLines: string[] = [];
  const sections: { tag: string; lines: string[] }[] = [];
  for (const line of rawLines) {
    const tagMatch = /^@([A-Za-z]+)\b\s?(.*)$/.exec(line);
    if (tagMatch) {
      sections.push({ tag: tagMatch[1].toLowerCase(), lines: [tagMatch[2]] });
    } else if (sections.length > 0) {
      sections[sections.length - 1].lines.push(line);
    } else {
      descriptionLines.push(line);
    }
  }

  const tags: ParsedTags = {
    description: descriptionLines.join('\n').trim(),
    params: [],
    properties: [],
    throws: [],
    examples: [],
    fires: [],
    see: [],
    decorators: [],
    isStatic: false,
    isAsync: false,
    isPrivate: false,
  };

  for (const section of sections) {
    const text = section.lines.map((l) => l.trim()).join(' ').trim();
    switch (section.tag) {
      case 'description':
      case 'desc':
        tags.description = [tags.description, section.lines.join('\n').trim()].filter(Boolean).join('\n\n');
        break;
      case 'param':
      case 'arg':
      case 'argument':
        tags.params.push(parseTypedNamed(text));
        break;
      case 'property':
      case 'prop':
        tags.properties.push(parseTypedNamed(text));
        break;
      case 'returns':
      case 'return': {
        const typed = parseTyped(text);
        tags.returns = typed;
        break;
      }
      case 'throws':
      case 'exception':
        tags.throws.push(parseTyped(text));
        break;
      case 'type':
        tags.type = parseTyped(text).type || text;
        break;
      case 'example':
        tags.examples.push(formatExample(section.lines));
        break;
      case 'deprecated':
        tags.deprecated = text || 'Deprecated';
        break;
      case 'fires':
      case 'emits':
        if (text) {
          tags.fires.push(text);
        }
        break;
      case 'see':
        if (text) {
          tags.see.push(text);
        }
        break;
      case 'api':
      case 'track':
      case 'wire':
        tags.decorators.push('@' + section.tag + (text ? ' ' + text : ''));
        break;
      case 'private':
      case 'ignore':
        tags.isPrivate = true;
        break;
      case 'access':
        if (text.toLowerCase() === 'private') {
          tags.isPrivate = true;
        }
        break;
      case 'name':
        tags.name = text || tags.name;
        break;
      case 'function':
      case 'func':
      case 'method':
        tags.kind = tags.kind || 'function';
        tags.name = text || tags.name;
        break;
      case 'class':
      case 'constructor': {
        const typed = parseTyped(text);
        tags.kind = 'class';
        tags.name = typed.description.split(/\s+/)[0] || tags.name;
        break;
      }
      case 'typedef':
      case 'callback': {
        const typed = parseTyped(text);
        tags.kind = 'typedef';
        tags.type = typed.type || (section.tag === 'callback' ? 'function' : tags.type);
        tags.name = typed.description.split(/\s+/)[0] || tags.name;
        break;
      }
      case 'constant':
      case 'const': {
        const typed = parseTyped(text);
        tags.kind = 'constant';
        tags.type = typed.type || tags.type;
        tags.name = typed.description.split(/\s+/)[0] || tags.name;
        break;
      }
      case 'member':
      case 'var': {
        const typed = parseTyped(text);
        tags.kind = 'property';
        tags.type = typed.type || tags.type;
        tags.name = typed.description.split(/\s+/)[0] || tags.name;
        break;
      }
      case 'memberof':
        tags.memberOf = text.replace(/[#.~]$/, '') || tags.memberOf;
        break;
      case 'extends':
      case 'augments':
        tags.extendsName = parseTyped(text).type || text;
        break;
      case 'static':
        tags.isStatic = true;
        break;
      case 'async':
        tags.isAsync = true;
        break;
      case 'default':
      case 'defaultvalue':
        tags.defaultValue = text;
        break;
      case 'file':
      case 'fileoverview':
      case 'overview':
        tags.kind = 'file';
        tags.description = [section.lines.join('\n').trim(), tags.description].filter(Boolean).join('\n\n');
        break;
      default:
        // Unknown or presentation-only tags (@since, @author, @todo, @readonly, @public ...) are ignored
        break;
    }
  }
  return tags;
}

/** Parse `{Type} description` */
function parseTyped(text: string): JsdocTyped {
  let rest = text.trim();
  let type = '';
  if (rest.startsWith('{')) {
    const end = findMatching(rest, 0, '{', '}');
    if (end > 0) {
      type = rest.slice(1, end).trim();
      rest = rest.slice(end + 1).trim();
    }
  }
  return { type, description: rest.replace(/^[-:]\s*/, '').trim() };
}

/** Parse `{Type} [name=default] - description` */
function parseTypedNamed(text: string): JsdocParam {
  const typed = parseTyped(text);
  let rest = text.trim();
  let type = typed.type;
  if (rest.startsWith('{')) {
    const end = findMatching(rest, 0, '{', '}');
    rest = end > 0 ? rest.slice(end + 1).trim() : rest;
  }
  let optional = false;
  let defaultValue: string | undefined;
  let name = '';
  if (rest.startsWith('[')) {
    const end = findMatching(rest, 0, '[', ']');
    const inner = end > 0 ? rest.slice(1, end) : rest.slice(1);
    rest = end > 0 ? rest.slice(end + 1) : '';
    optional = true;
    const eq = inner.indexOf('=');
    if (eq >= 0) {
      name = inner.slice(0, eq).trim();
      defaultValue = inner.slice(eq + 1).trim();
    } else {
      name = inner.trim();
    }
  } else {
    const nameMatch = /^([\w$.]+)/.exec(rest);
    name = nameMatch ? nameMatch[1] : '';
    rest = rest.slice(name.length);
  }
  if (type.endsWith('=')) {
    type = type.slice(0, -1).trim();
    optional = true;
  }
  const description = rest.trim().replace(/^[-:]\s*/, '').trim();
  return { name, type, description, optional, defaultValue };
}

function formatExample(lines: string[]): string {
  const exampleLines = [...lines];
  while (exampleLines.length > 0 && exampleLines[0].trim() === '') {
    exampleLines.shift();
  }
  while (exampleLines.length > 0 && exampleLines[exampleLines.length - 1].trim() === '') {
    exampleLines.pop();
  }
  let caption = '';
  if (exampleLines.length > 0) {
    const captionMatch = /^\s*<caption>([\s\S]*?)<\/caption>\s*/.exec(exampleLines[0]);
    if (captionMatch) {
      caption = captionMatch[1].trim();
      exampleLines[0] = exampleLines[0].slice(captionMatch[0].length);
      if (exampleLines[0].trim() === '') {
        exampleLines.shift();
      }
    }
  }
  const indents = exampleLines.filter((l) => l.trim() !== '').map((l) => /^\s*/.exec(l)![0].length);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  const code = exampleLines.map((l) => l.slice(minIndent)).join('\n');
  const fenced = code.trim().startsWith('```') ? code : '```js\n' + code + '\n```';
  return caption ? `_${caption}_\n\n${fenced}` : fenced;
}

/* ---------------------------------------------------------------------------------------------- */
/* Declaration parsing                                                                            */
/* ---------------------------------------------------------------------------------------------- */

/** Read the decorators and the declaration that follow a doc comment ending at `fromIndex` */
function parseDeclaration(source: string, fromIndex: number): Declaration | null {
  const n = source.length;
  let i = fromIndex;
  const decorators: string[] = [];
  while (i < n) {
    while (i < n && /\s/.test(source[i])) {
      i++;
    }
    if (i >= n) {
      return null;
    }
    if (source.startsWith('//', i)) {
      const eol = source.indexOf('\n', i);
      i = eol === -1 ? n : eol + 1;
      continue;
    }
    if (source.startsWith('/**', i) && !source.startsWith('/**/', i)) {
      // Another doc comment follows: the current one is orphan
      return null;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (source[i] === '@') {
      const nameMatch = /^@[\w$.]+/.exec(source.slice(i, i + 200));
      if (!nameMatch) {
        return null;
      }
      let j = i + nameMatch[0].length;
      let args = '';
      let k = j;
      while (k < n && (source[k] === ' ' || source[k] === '\t')) {
        k++;
      }
      if (source[k] === '(') {
        const end = findMatching(source, k, '(', ')');
        if (end > 0) {
          args = source.slice(k, end + 1);
          j = end + 1;
        }
      }
      decorators.push(nameMatch[0] + args.replace(/\s+/g, ' '));
      i = j;
      continue;
    }
    break;
  }
  const eol = source.indexOf('\n', i);
  const line = source.slice(i, eol === -1 ? n : eol).trim();
  if (!line) {
    return null;
  }
  const parsed = parseDeclarationLine(line, source, i);
  if (!parsed) {
    return null;
  }
  return { ...parsed, decorators, index: i };
}

function parseDeclarationLine(line: string, source: string, index: number): Omit<Declaration, 'decorators' | 'index'> | null {
  let m: RegExpExecArray | null;

  // class Foo extends Bar {
  m = /^(?:export\s+)?(?:default\s+)?class\b(?:\s+(?!extends\b)([A-Za-z_$][\w$]*))?(?:\s+extends\s+([\w$.]+))?/.exec(line);
  if (m) {
    return { kind: 'class', name: m[1], params: [], isStatic: false, isAsync: false, extendsName: m[2] };
  }

  // function foo(a, b) {
  m = /^(?:export\s+)?(?:default\s+)?(?:(async)\s+)?function\b\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/.exec(line);
  if (m) {
    return { kind: 'function', name: m[2], params: readParams(source, index + m[0].length - 1), isStatic: false, isAsync: !!m[1] };
  }

  // const foo = (a) => / const foo = function / const FOO = 'bar'
  m = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/.exec(line);
  if (m) {
    const fn = readFunctionValue(source, index + m[0].length);
    if (fn) {
      return { kind: 'function', name: m[1], params: fn.params, isStatic: false, isAsync: fn.isAsync };
    }
    return { kind: 'constant', name: m[1], params: [], isStatic: false, isAsync: false, defaultValue: readDefaultValue(line.slice(m[0].length)) };
  }

  // constructor(a, b) {
  m = /^constructor\s*\(/.exec(line);
  if (m) {
    return { kind: 'constructor', name: 'constructor', params: readParams(source, index + m[0].length - 1), isStatic: false, isAsync: false };
  }

  // get foo() / set foo(value)
  m = new RegExp(`^(?:(static)\\s+)?(get|set)\\s+(${IDENTIFIER})\\s*\\(`).exec(line);
  if (m) {
    return { kind: m[2] === 'get' ? 'getter' : 'setter', name: m[3], params: readParams(source, index + m[0].length - 1), isStatic: !!m[1], isAsync: false };
  }

  // async foo(a) { / static foo() { / *generator() {
  m = new RegExp(`^(?:(static)\\s+)?(?:(async)\\s+)?\\*?\\s*(${IDENTIFIER})\\s*\\(`).exec(line);
  if (m && !RESERVED_WORDS.has(m[3])) {
    return { kind: 'method', name: m[3], params: readParams(source, index + m[0].length - 1), isStatic: !!m[1], isAsync: !!m[2] };
  }

  // foo: function(a) { / foo: (a) => (object literal, Aura style)
  m = new RegExp(`^(${IDENTIFIER})\\s*:\\s*`).exec(line);
  if (m) {
    const fn = readFunctionValue(source, index + m[0].length);
    if (fn) {
      return { kind: 'method', name: m[1], params: fn.params, isStatic: false, isAsync: fn.isAsync };
    }
  }

  // foo = (a) => / foo = async () => (class field arrow function) / foo = 'bar'; (class field)
  m = new RegExp(`^(?:(static)\\s+)?(${IDENTIFIER})\\s*(?:=\\s*)?`).exec(line);
  if (m && !RESERVED_WORDS.has(m[2])) {
    const hasAssignment = m[0].includes('=');
    if (hasAssignment) {
      const fn = readFunctionValue(source, index + m[0].length);
      if (fn) {
        return { kind: 'method', name: m[2], params: fn.params, isStatic: !!m[1], isAsync: fn.isAsync };
      }
      return { kind: 'property', name: m[2], params: [], isStatic: !!m[1], isAsync: false, defaultValue: readDefaultValue(line.slice(m[0].length)) };
    }
    const rest = line.slice(m[0].length).trim();
    if (rest === '' || rest.startsWith(';') || rest.startsWith('//') || rest.startsWith('/*')) {
      return { kind: 'property', name: m[2], params: [], isStatic: !!m[1], isAsync: false };
    }
  }
  return null;
}

/** Detect a function expression or arrow function starting at `index`, returning its parameters */
function readFunctionValue(source: string, index: number): { params: string[]; isAsync: boolean } | null {
  let i = index;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
    i++;
  }
  let isAsync = false;
  const asyncMatch = /^async\b\s*/.exec(source.slice(i, i + 20));
  if (asyncMatch) {
    isAsync = true;
    i += asyncMatch[0].length;
  }
  const functionMatch = /^function\b\s*\*?\s*[A-Za-z_$]?[\w$]*\s*\(/.exec(source.slice(i, i + 200));
  if (functionMatch) {
    return { params: readParams(source, i + functionMatch[0].length - 1), isAsync };
  }
  if (source[i] === '(') {
    const end = findMatching(source, i, '(', ')');
    if (end > 0 && /^\s*=>/.test(source.slice(end + 1, end + 20))) {
      return { params: readParams(source, i), isAsync };
    }
    return null;
  }
  const singleParam = /^([A-Za-z_$][\w$]*)\s*=>/.exec(source.slice(i, i + 200));
  if (singleParam) {
    return { params: [singleParam[1]], isAsync };
  }
  return null;
}

/** Read the comma-separated parameters of the parenthesis opening at `openIndex` */
function readParams(source: string, openIndex: number): string[] {
  if (source[openIndex] !== '(') {
    return [];
  }
  const end = findMatching(source, openIndex, '(', ')');
  const inner = end > 0 ? source.slice(openIndex + 1, end) : source.slice(openIndex + 1, source.indexOf('\n', openIndex) === -1 ? undefined : source.indexOf('\n', openIndex));
  return splitTopLevel(inner)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p !== '');
}

function readDefaultValue(rawValue: string): string | undefined {
  let value = rawValue.trim().replace(/\s*(?:;|,)?\s*(?:\/\/.*)?$/, '').trim();
  if (!value) {
    return undefined;
  }
  const openers: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
  const first = value[0];
  if (openers[first] && findMatching(value, 0, first, openers[first]) === -1) {
    value = `${first}...${openers[first]}`;
  } else if (/^["'`]/.test(value) && !/["'`]$/.test(value)) {
    value = value + '...';
  }
  return value;
}

/** Find top-level class declarations with their body ranges */
function findClassRanges(source: string): ClassRange[] {
  const ranges: ClassRange[] = [];
  const regex = /^[ \t]*(?:export\s+)?(?:default\s+)?class\b(?:\s+(?!extends\b)([A-Za-z_$][\w$]*))?(?:\s+extends\s+[\w$.]+)?\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(source)) !== null) {
    const openIndex = m.index + m[0].length - 1;
    const end = findMatching(source, openIndex, '{', '}');
    ranges.push({ name: m[1] || '', start: m.index, end: end === -1 ? source.length : end });
  }
  return ranges;
}

/** Index of the bracket closing the one opening at `openIndex`, skipping strings and comments (-1 if unbalanced) */
function findMatching(text: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let i = openIndex;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(text, i);
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const eol = text.indexOf('\n', i);
      if (eol === -1) {
        return -1;
      }
      i = eol + 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) {
        return -1;
      }
      i = end + 2;
      continue;
    }
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

function skipString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) {
      return i + 1;
    }
    if (quote !== '`' && text[i] === '\n') {
      return i;
    }
    i++;
  }
  return text.length;
}

/** Split on commas that are not nested in brackets or strings */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipString(text, i);
      current += text.slice(i, end);
      i = end;
      continue;
    }
    if ('([{'.includes(ch)) {
      depth++;
    } else if (')]}'.includes(ch)) {
      depth--;
    }
    if (ch === ',' && depth <= 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
    i++;
  }
  parts.push(current);
  return parts;
}

/* ---------------------------------------------------------------------------------------------- */
/* Symbol assembly                                                                                */
/* ---------------------------------------------------------------------------------------------- */

function buildSymbol(tags: ParsedTags, declaration: Declaration | null, classRanges: ClassRange[], options: RenderJsdocOptions): JsdocSymbol | null {
  const fileBaseName = options.fileName ? options.fileName.replace(/\.[^.]+$/, '') : undefined;
  let kind: JsdocSymbolKind | undefined = tags.kind || declaration?.kind;
  let name = tags.name || declaration?.name;

  if (kind === 'file') {
    return {
      name: options.fileName || 'File',
      kind: 'file',
      description: tags.description,
      params: [],
      properties: [],
      throws: [],
      examples: tags.examples,
      fires: [],
      see: tags.see,
      decorators: [],
      isStatic: false,
      isAsync: false,
      isPrivate: tags.isPrivate,
      signatureParams: [],
    };
  }
  if (kind === 'class' && !name) {
    name = fileBaseName || 'default';
  }
  if (!kind && name) {
    kind = tags.params.length > 0 || tags.returns ? 'function' : 'property';
  }
  if (!kind || !name) {
    return null;
  }
  if (kind === 'function' && declaration && ['method', 'getter', 'setter', 'constructor'].includes(declaration.kind)) {
    kind = declaration.kind;
  }

  const isMember = ['constructor', 'method', 'getter', 'setter', 'property'].includes(kind);
  let memberOf = tags.memberOf;
  if (!memberOf && isMember && declaration) {
    const owner = classRanges.find((range) => declaration.index > range.start && declaration.index < range.end);
    memberOf = owner ? owner.name || fileBaseName || 'default' : undefined;
  }
  if (kind === 'constructor') {
    name = memberOf || name;
  }

  const decorators = [...(declaration?.decorators || [])];
  for (const tagDecorator of tags.decorators) {
    if (!decorators.some((d) => d.split(/[\s(]/)[0] === tagDecorator.split(/[\s(]/)[0])) {
      decorators.push(tagDecorator);
    }
  }

  return {
    name,
    kind,
    description: tags.description,
    params: tags.params,
    properties: tags.properties,
    returns: tags.returns,
    throws: tags.throws,
    type: tags.type || (kind === 'setter' && tags.params[0]?.type ? tags.params[0].type : undefined),
    examples: tags.examples,
    deprecated: tags.deprecated,
    fires: tags.fires,
    see: tags.see,
    decorators,
    isStatic: tags.isStatic || !!declaration?.isStatic,
    isAsync: tags.isAsync || !!declaration?.isAsync,
    isPrivate: tags.isPrivate || name.startsWith('#'),
    extendsName: tags.extendsName || declaration?.extendsName,
    defaultValue: tags.defaultValue || declaration?.defaultValue,
    memberOf,
    signatureParams: declaration?.params || [],
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Markdown rendering                                                                             */
/* ---------------------------------------------------------------------------------------------- */

function renderSymbol(symbol: JsdocSymbol, options: RenderJsdocOptions): string[] {
  const lines: string[] = [];
  if (symbol.kind === 'file') {
    if (symbol.description) {
      lines.push(inlineLinks(symbol.description), '');
    }
    if (options.fileName) {
      lines.push(`**File**: <code>${escapeHtml(options.fileName)}</code>`, '');
    }
    return lines;
  }

  const isTopLevel = ['class', 'function', 'constant', 'typedef'].includes(symbol.kind);
  const headingLevel = isTopLevel ? '###' : '####';
  lines.push(`${headingLevel} ${renderHeading(symbol)}`, '');

  if (symbol.description) {
    lines.push(inlineLinks(symbol.description), '');
  }

  const meta: string[] = [];
  meta.push(`**Kind**: ${renderKind(symbol)}`);
  if (symbol.extendsName) {
    meta.push(`**Extends**: <code>${escapeHtml(symbol.extendsName)}</code>`);
  }
  if (symbol.decorators.length > 0) {
    meta.push(`**Decorators**: ${symbol.decorators.map((d) => `<code>${escapeHtml(d)}</code>`).join(', ')}`);
  }
  if (symbol.defaultValue !== undefined && symbol.defaultValue !== '') {
    meta.push(`**Default**: <code>${escapeHtml(symbol.defaultValue)}</code>`);
  }
  if (symbol.deprecated) {
    meta.push(`**Deprecated**: ${inlineLinks(symbol.deprecated)}`);
  }
  if (symbol.returns && (symbol.returns.type || symbol.returns.description)) {
    const typePart = symbol.returns.type ? renderType(symbol.returns.type) : '';
    const descPart = symbol.returns.description ? inlineLinks(symbol.returns.description) : '';
    meta.push(`**Returns**: ${[typePart, descPart].filter(Boolean).join(' - ')}`);
  }
  for (const thrown of symbol.throws) {
    const typePart = thrown.type ? renderType(thrown.type) : '';
    const descPart = thrown.description ? inlineLinks(thrown.description) : '';
    meta.push(`**Throws**: ${[typePart, descPart].filter(Boolean).join(' - ')}`);
  }
  if (symbol.fires.length > 0) {
    meta.push(`**Fires**: ${symbol.fires.map((f) => `<code>${escapeHtml(f)}</code>`).join(', ')}`);
  }
  if (symbol.see.length > 0) {
    meta.push(`**See**: ${symbol.see.map((s) => inlineLinks(s)).join(', ')}`);
  }
  lines.push(...meta.map((line) => `${line}  `), '');

  if (symbol.params.length > 0) {
    lines.push(...renderParamsTable('Param', symbol.params), '');
  }
  if (symbol.properties.length > 0) {
    lines.push('**Properties**', '', ...renderParamsTable('Name', symbol.properties), '');
  }
  for (const example of symbol.examples) {
    lines.push('**Example**', '', example, '');
  }
  return lines;
}

function renderHeading(symbol: JsdocSymbol): string {
  const name = escapeMarkdown(symbol.name);
  switch (symbol.kind) {
    case 'class':
      return name;
    case 'constructor':
      return `new ${name}(${renderSignature(symbol)})`;
    case 'method':
    case 'function': {
      const returnsPart = symbol.returns?.type ? ` ⇒ ${renderType(symbol.returns.type)}` : '';
      return `${name}(${renderSignature(symbol)})${returnsPart}`;
    }
    case 'typedef':
      return `${name} : ${renderType(symbol.type || 'Object')}`;
    default:
      return symbol.type ? `${name} : ${renderType(symbol.type)}` : name;
  }
}

function renderSignature(symbol: JsdocSymbol): string {
  if (symbol.params.length > 0) {
    return symbol.params
      .filter((p) => p.name && !p.name.includes('.'))
      .map((p) => (p.optional ? `[${p.name}]` : p.name))
      .join(', ');
  }
  return symbol.signatureParams
    .map((p) => {
      const eq = p.indexOf('=');
      if (eq > 0 && !p.startsWith('{') && !p.startsWith('[')) {
        return `[${p.slice(0, eq).trim()}]`;
      }
      return p;
    })
    .join(', ');
}

function renderKind(symbol: JsdocSymbol): string {
  const scope = symbol.isStatic ? 'static' : 'instance';
  const owner = symbol.memberOf ? ` of <code>${escapeHtml(symbol.memberOf)}</code>` : '';
  switch (symbol.kind) {
    case 'class':
      return 'global class';
    case 'function':
      return 'global function';
    case 'constant':
      return 'global constant';
    case 'typedef':
      return 'global typedef';
    case 'constructor':
      return symbol.memberOf ? `constructor of <code>${escapeHtml(symbol.memberOf)}</code>` : 'constructor';
    case 'method':
      return symbol.memberOf ? `${scope} ${symbol.isAsync ? 'async ' : ''}method${owner}` : `global ${symbol.isAsync ? 'async ' : ''}function`;
    case 'getter':
      return `${scope} property (getter)${owner}`;
    case 'setter':
      return `${scope} property (setter)${owner}`;
    case 'property':
      return symbol.memberOf ? `${scope} property${owner}` : 'global property';
    default:
      return symbol.kind;
  }
}

function renderParamsTable(firstColumn: string, params: JsdocParam[]): string[] {
  const hasDefault = params.some((p) => p.defaultValue !== undefined && p.defaultValue !== '');
  const header = [firstColumn, 'Type', ...(hasDefault ? ['Default'] : []), 'Description'];
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const param of params) {
    const nameCell = param.optional ? `[${param.name}]` : param.name;
    const cells = [escapeCell(nameCell), param.type ? renderType(param.type) : ''];
    if (hasDefault) {
      cells.push(param.defaultValue ? `<code>${escapeHtml(param.defaultValue)}</code>` : '');
    }
    cells.push(escapeCell(inlineLinks(param.description)));
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines;
}

function renderType(type: string): string {
  return type
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<code>${escapeHtml(part)}</code>`)
    .join(' \\| ');
}

/** Convert `{@link url|text}`, `{@link url text}` and `{@link X}` to markdown */
function inlineLinks(text: string): string {
  return text.replace(/\{@(?:link|linkcode|linkplain)\s+([^}|\s]+)(?:[|\s]+([^}]*))?\}/g, (_all, target: string, label?: string) => {
    const isUrl = /^(?:https?:|mailto:|\/|#)/.test(target);
    const displayed = (label || '').trim() || target;
    return isUrl ? `[${displayed}](${target})` : `<code>${escapeHtml(displayed)}</code>`;
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeMarkdown(text: string): string {
  return text.replace(/\*/g, '\\*');
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
