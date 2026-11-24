import { Document, parse, Scalar, visit } from 'yaml';

/**
 * The only YAML library of sfdx-hardis is `yaml`, which can also edit a file in place and keep its
 * comments. These helpers read and write YAML the way js-yaml did before, so the files sfdx-hardis
 * writes do not change: tests compare their output with what js-yaml wrote.
 */

// Merge keys (<<) and dates are read like js-yaml read them
const PARSE_OPTIONS = { merge: true, customTags: ['timestamp' as const] };

// Strings that a YAML 1.1 reader (PyYAML reads mkdocs.yml) takes for a boolean or a number
const YAML_1_1_BOOLEANS = new Set(['y', 'Y', 'yes', 'Yes', 'YES', 'n', 'N', 'no', 'No', 'NO', 'on', 'On', 'ON', 'off', 'Off', 'OFF', 'true', 'True', 'TRUE', 'false', 'False', 'FALSE']);
const YAML_1_1_SEXAGESIMAL = /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+(?:\.[0-9_]*)?$/;
const DATE_MARKER = '__sfdx_hardis_date__';

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
  visit(doc, {
    Scalar(_key, node) {
      if (typeof node.value === 'string') {
        const type = quoteTypeOf(node.value, quotes);
        if (type) {
          node.type = type;
        }
      }
    },
  });
  return doc
    .toString({ lineWidth: options.lineWidth ?? 0, minContentWidth: 0, singleQuote: quotes === 'single' })
    // The blank lines of a block of text hold its indentation: js-yaml writes them empty
    .replace(/^[ ]+$/gm, '')
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

// A string is quoted when it would not be read back as the same string, like js-yaml did
function quoteTypeOf(value: string, quotes: 'single' | 'double'): Scalar.Type | null {
  if (hasControlCharacter(value)) {
    return Scalar.QUOTE_DOUBLE;
  }
  const quoted =
    value === '' ||
    YAML_1_1_BOOLEANS.has(value) ||
    YAML_1_1_SEXAGESIMAL.test(value) ||
    value === '<<' ||
    value === '=' ||
    value.startsWith('?') ||
    (!value.includes('\n') && !readsBackAsTheSameString(value));
  if (!quoted) {
    return null;
  }
  return quotes === 'double' ? Scalar.QUOTE_DOUBLE : Scalar.QUOTE_SINGLE;
}

// A tab or another control character, but not a new line, which a block of text holds
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code < 0x20 && code !== 0x0a) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function readsBackAsTheSameString(value: string): boolean {
  try {
    return parse(value, { ...PARSE_OPTIONS, logLevel: 'silent' }) === value;
  } catch {
    return false;
  }
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
