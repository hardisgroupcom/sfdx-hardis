import { Document, parse, Scalar, visit } from 'yaml';

/**
 * The only YAML library of sfdx-hardis is `yaml`, which can also edit a file in place and keep its
 * comments. These helpers read and write YAML the way js-yaml did before, so the files sfdx-hardis
 * writes do not change: tests compare their output with what js-yaml wrote.
 */

// Merge keys (<<) and dates are read like js-yaml read them. No warning printed for a tag the
// library does not know (!ENV, !!python/name: in a mkdocs.yml): it reads the value under it.
const PARSE_OPTIONS = { merge: true, customTags: ['timestamp' as const], logLevel: 'error' as const };

// Strings that a YAML 1.1 reader (PyYAML reads mkdocs.yml) takes for a boolean or a number: the
// lists js-yaml quoted
const YAML_1_1_BOOLEANS = new Set(['y', 'Y', 'yes', 'Yes', 'YES', 'n', 'N', 'no', 'No', 'NO', 'on', 'On', 'ON', 'off', 'Off', 'OFF', 'true', 'True', 'TRUE', 'false', 'False', 'FALSE']);
const YAML_1_1_SEXAGESIMAL = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
// A binary integer for js-yaml, a string for the YAML 1.2 core schema
const JS_YAML_BINARY_INT = /^[-+]?0b[01_]*[01]$/;
// The indicators js-yaml never wrote at the start of a plain string
const PLAIN_UNSAFE_FIRST = /^[-?:,[\]{}#&*!|=>'"%@`]/;
const DATE_MARKER = '__sfdx_hardis_date__';
const DOUBLE_QUOTED_MARKER = '__sfdx_hardis_double_quoted__';
const JS_YAML_ESCAPES: Record<number, string> = {
  0x00: '\\0',
  0x07: '\\a',
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0b: '\\v',
  0x0c: '\\f',
  0x0d: '\\r',
  0x1b: '\\e',
  0x22: '\\"',
  0x5c: '\\\\',
  0x85: '\\N',
  0xa0: '\\_',
  0x2028: '\\L',
  0x2029: '\\P',
};

export interface DumpYamlOptions {
  /** Quotes of the strings that need some: single (js-yaml default) or double */
  quotes?: 'single' | 'double';
  /** Width where long strings are folded, 0 for never (default) */
  lineWidth?: number;
}

/** Parse a YAML text: undefined for an empty text, an error for an invalid one (duplicate keys included) */
export function parseYaml(text: string): any {
  if (!text || !text.trim()) {
    return undefined;
  }
  return parse(text, PARSE_OPTIONS);
}

/** YAML text of a value, with the quoting js-yaml used */
export function dumpYaml(value: unknown, options: DumpYamlOptions = {}): string {
  const quotes = options.quotes ?? 'single';
  const doc = new Document(markDates(value), { aliasDuplicateObjects: false });
  // A double-quoted string is written here, escaped the way js-yaml escaped it: the yaml library
  // leaves some characters raw (a line separator, a no-break space) and folds long strings
  const doubleQuotedTexts: string[] = [];
  visit(doc, {
    Scalar(_key, node) {
      if (typeof node.value === 'string') {
        const type = quoteTypeOf(node.value, quotes);
        if (type === Scalar.QUOTE_DOUBLE) {
          doubleQuotedTexts.push(`"${escapeLikeJsYaml(node.value)}"`);
          node.value = `${DOUBLE_QUOTED_MARKER}${doubleQuotedTexts.length - 1}${DOUBLE_QUOTED_MARKER}`;
        } else if (type) {
          node.type = type;
        }
      }
    },
  });
  const text = doc.toString({ lineWidth: options.lineWidth ?? 0, minContentWidth: 0, singleQuote: quotes === 'single' });
  return emptyFirstBlankLineOfBlocks(text)
    .replace(new RegExp(`${DOUBLE_QUOTED_MARKER}(\\d+)${DOUBLE_QUOTED_MARKER}`, 'g'), (_match, index: string) => doubleQuotedTexts[Number(index)])
    .replaceAll(DATE_MARKER, '');
}

/**
 * YAML for a file of the repository, written the way Prettier writes it.
 *
 * Prettier runs through MegaLinter on every Pull Request of a project built
 * with sfdx-hardis. When it changes a file, MegaLinter pushes the change as a
 * commit of its own on the contributor's branch, and a Pull Request whose head
 * is a bot commit waits for checks that never start. So the output leaves
 * Prettier nothing to change:
 * - double quotes (dumpYaml defaults to single ones, `command: ''`), and long
 *   strings kept on one line;
 * - single quotes for a string holding a double quote and no other escape,
 *   which is what Prettier picks;
 * - no trailing spaces in multi-line strings, which Prettier strips from a
 *   block literal.
 *
 * The same helper lives in vscode-sfdx-hardis, which writes the same files: keep the two alike.
 *
 * Prettier's default quotes are assumed: neither the sfdx-hardis project
 * template nor the training course ships a `.prettierrc` with `singleQuote`.
 */
export function dumpRepositoryYaml(doc: unknown): string {
  const dumped = dumpYaml(withoutTrailingSpaces(doc), { quotes: 'double' });
  return quoteLikePrettier(dumped);
}

function withoutTrailingSpaces(value: unknown): unknown {
  if (typeof value === "string") {
    return value.includes("\n") ? value.replace(/[ \t]+$/gm, "") : value;
  }
  if (Array.isArray(value)) {
    return value.map(withoutTrailingSpaces);
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        withoutTrailingSpaces(item),
      ]),
    );
  }
  return value;
}

const DOUBLE_QUOTED = /^"((?:[^"\\]|\\.)*)"/;
const BLOCK_SCALAR_START = /(?:^|: |- )[|>][1-9]?[+-]?$/;

// Prettier writes '...' when the double-quoted text only escapes double quotes
function toPrettierQuotes(quoted: string): string {
  const raw = quoted.slice(1, -1);
  if (!raw.includes('\\"') || /\\[^"]/.test(raw)) {
    return quoted;
  }
  return `'${raw.replace(/\\"/g, '"').replace(/'/g, "''")}'`;
}

// A quoted scalar starts a line (after indentation and "- "), or follows the
// ": " of a key. dumpYaml writes each on one line.
function quoteLine(line: string): string {
  const [, prefix, content] = /^(\s*(?:- )*)(.*)$/.exec(line)!;
  let rest = content;
  let out = prefix;
  const quotedKeyOrValue = DOUBLE_QUOTED.exec(rest);
  if (quotedKeyOrValue) {
    out += toPrettierQuotes(quotedKeyOrValue[0]);
    rest = rest.slice(quotedKeyOrValue[0].length);
    if (!rest.startsWith(": ")) {
      return out + rest;
    }
  } else {
    const keyEnd = rest.indexOf(": ");
    if (keyEnd < 0) {
      return out + rest;
    }
    out += rest.slice(0, keyEnd);
    rest = rest.slice(keyEnd);
  }
  out += ": ";
  rest = rest.slice(2);
  const quotedValue = DOUBLE_QUOTED.exec(rest);
  if (quotedValue) {
    out += toPrettierQuotes(quotedValue[0]);
    rest = rest.slice(quotedValue[0].length);
  }
  return out + rest;
}

function quoteLikePrettier(dumped: string): string {
  let blockIndent = -1;
  return dumped
    .split("\n")
    .map((line) => {
      const indent = line.length - line.trimStart().length;
      if (blockIndent >= 0) {
        if (line.trim() === "" || indent > blockIndent) {
          return line;
        }
        blockIndent = -1;
      }
      const withQuotes = quoteLine(line);
      if (BLOCK_SCALAR_START.test(withQuotes)) {
        blockIndent = indent;
      }
      return withQuotes;
    })
    .join("\n");
}

// The Document turns a Date into an ISO string that would then be quoted: js-yaml wrote it plain
function markDates(value: unknown): unknown {
  if (value instanceof Date) {
    return DATE_MARKER + value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(markDates);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, markDates(item)]));
  }
  return value;
}

// A string is quoted when it would not be read back as the same string, like js-yaml did
function quoteTypeOf(value: string, quotes: 'single' | 'double'): Scalar.Type | null {
  // A text of spaces and new lines only loses its spaces in the block the yaml library writes for it
  if (hasNonPrintableCharacter(value) || (value.includes('\n') && value.includes(' ') && /^[ \n]+$/.test(value))) {
    return Scalar.QUOTE_DOUBLE;
  }
  const quoted =
    value === '' ||
    YAML_1_1_BOOLEANS.has(value) ||
    YAML_1_1_SEXAGESIMAL.test(value) ||
    JS_YAML_BINARY_INT.test(value) ||
    value === '<<' ||
    (!value.includes('\n') && (PLAIN_UNSAFE_FIRST.test(value) || !readsBackAsTheSameString(value)));
  if (!quoted) {
    return null;
  }
  return quotes === 'double' ? Scalar.QUOTE_DOUBLE : Scalar.QUOTE_SINGLE;
}

// A character js-yaml escaped (a tab, a control character, a line separator...), but not a new
// line, which a block of text holds
function hasNonPrintableCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code !== 0x0a && !isPrintableForJsYaml(code)) {
      return true;
    }
  }
  return false;
}

function isPrintableForJsYaml(code: number): boolean {
  return (
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0xa1 && code <= 0xd7ff && code !== 0x2028 && code !== 0x2029) ||
    (code >= 0xe000 && code <= 0xfffd && code !== 0xfeff) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

function readsBackAsTheSameString(value: string): boolean {
  try {
    return parse(value, { ...PARSE_OPTIONS, logLevel: 'silent' }) === value;
  } catch {
    return false;
  }
}

function escapeLikeJsYaml(value: string): string {
  let escaped = '';
  for (const character of value) {
    const code = character.codePointAt(0)!;
    const escape = JS_YAML_ESCAPES[code];
    if (escape) {
      escaped += escape;
    } else if (isPrintableForJsYaml(code)) {
      escaped += character;
    } else {
      const hex = code.toString(16).toUpperCase();
      escaped += code <= 0xff ? `\\x${hex.padStart(2, '0')}` : code <= 0xffff ? `\\u${hex.padStart(4, '0')}` : `\\U${hex.padStart(8, '0')}`;
    }
  }
  return escaped;
}

// The yaml library indents the first line of a block of text when that line is empty, where js-yaml
// wrote it empty. Only that line, and only when its spaces are the indentation of the block: the
// other lines made of spaces are part of the text.
function emptyFirstBlankLineOfBlocks(text: string): string {
  const lines = text.split('\n');
  for (let index = 1; index < lines.length; index++) {
    const header = /^((?:[ ]*- )*[ ]*)((?:.*: )?)[|>][1-9]?[-+]?$/.exec(lines[index - 1]);
    if (!header || !/^[ ]+$/.test(lines[index])) {
      continue;
    }
    const blockIndent = header[1].length + (header[2] === '' ? 0 : 2);
    if (lines[index].length === blockIndent) {
      lines[index] = '';
    }
  }
  return lines.join('\n');
}
