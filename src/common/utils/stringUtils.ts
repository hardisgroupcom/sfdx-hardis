/**
 * Returns true if the given string is a valid email address.
 *
 * @example
 * isValidEmail('user@example.com') // => true
 * isValidEmail('not-an-email')     // => false
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Replace `{key}` or `{0}`, `{1}` placeholders in a string using a replacements array or object.
 * Unknown placeholders are left unchanged.
 *
 * @example
 * formatTemplate('Hello {name}', { name: 'World' })     // => 'Hello World'
 * formatTemplate('Item {0} of {1}', ['foo', 'bar'])      // => 'Item foo of bar'
 */
export function formatTemplate(str: string, replacements: any): string {
  return str.replace(/\{(\w+)\}/g, (match, key) => (replacements[key] != null ? String(replacements[key]) : match));
}

/**
 * One argument of a command line shown to a user: as it is when it only holds name characters,
 * else quoted for bash and PowerShell, the two shells the VS Code extension opens.
 */
export function quoteShellArgument(value: string): string {
  if (/^[A-Za-z0-9_.@:/=-]+$/.test(value)) {
    return value;
  }
  // Reports, Dashboards and Email Templates of the default folder are named unfiled$public: inside
  // double quotes a shell would expand that dollar sign. Single quotes are literal in bash and in
  // PowerShell.
  if (value.includes('$') && !value.includes("'")) {
    return `'${value}'`;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Decode common HTML entities in a string.
 *
 * @example
 * decodeHtmlEntities('Hello &amp; &quot;World&quot;') // => 'Hello & "World"'
 */
export function decodeHtmlEntities(str: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'",
  };
  return str.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (match) => entities[match] || match);
}

/**
 * Convert a string to PascalCase.
 * Handles separators: hyphens, underscores, and spaces.
 *
 * @example
 * toPascalCase('my-folder-name') // => 'MyFolderName'
 * toPascalCase('my_template')    // => 'MyTemplate'
 * toPascalCase('hello world')    // => 'HelloWorld'
 */
export function toPascalCase(str: string): string {
  return str.replace(/(^|[-_\s]+)(\w)/g, (_m, _sep, ch) => ch.toUpperCase());
}
