/**
 * Neutralize a cell a spreadsheet would execute as a formula.
 *
 * A notebook is written by a human, rendered to xlsx, and opened by another human: a cell
 * starting with `=`, `+`, `-` or `@` is run by Excel and LibreOffice on open, which is the
 * classic CSV injection path. Prefixing an apostrophe is the standard mitigation and keeps
 * the value readable.
 */
export function sanitizeCell(value: unknown): string {
  const text = String(value ?? '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
