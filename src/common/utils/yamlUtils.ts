import * as yaml from 'js-yaml';

/**
 * YAML for a file of the repository, written the way Prettier writes it.
 *
 * Prettier runs through MegaLinter on every Pull Request of a project built
 * with sfdx-hardis. When it changes a file, MegaLinter pushes the change as a
 * commit of its own on the contributor's branch, and a Pull Request whose head
 * is a bot commit waits for checks that never start. So the output leaves
 * Prettier nothing to change:
 * - double quotes (js-yaml defaults to single ones, `command: ''`), and long
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
  const dumped = yaml.dump(withoutTrailingSpaces(doc), {
    quotingType: '"',
    lineWidth: -1,
  });
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
// ": " of a key. js-yaml writes each on one line when lineWidth is -1.
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
