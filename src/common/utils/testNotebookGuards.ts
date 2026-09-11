import { NormalizedTestCase, TEST_CASE_TODO } from './testNotebookTypes.js';

/**
 * Literals a generator may have stringified into a cell instead of leaving it empty. Pushing
 * a test case whose expected result reads "undefined" is worse than not pushing it.
 */
const FORBIDDEN_LITERALS = new Set(['null', 'none', 'undefined', 'nan', 'n/a']);
/** `{SCENARIO_TITLE}` and friends: the notebook templates ship such tokens. */
const PLACEHOLDER_RE = /^\{[^}]*\}$/;

function _assertClean(where: string, value: unknown, required: boolean): void {
  const text = String(value ?? '').trim();
  if (FORBIDDEN_LITERALS.has(text.toLowerCase())) {
    throw new Error(`${where}: forbidden literal ${JSON.stringify(value)}. Fill the cell or leave it empty.`);
  }
  if (PLACEHOLDER_RE.test(text)) {
    throw new Error(`${where}: unresolved template placeholder ${JSON.stringify(value)}.`);
  }
  if (text === '' && required) {
    throw new Error(`${where}: required value is empty.`);
  }
}

/**
 * Refuse the whole upsert when any case is not finished, listing every offender at once.
 *
 * Two distinct failures are caught here, and both were observed in practice:
 *  - a case still carrying the completion marker, i.e. a notebook that was rendered but not
 *    written;
 *  - a case carrying a template token or a stringified null, i.e. a generator that ran
 *    without substitution.
 *
 * Nothing partial is written: an incomplete notebook is an authoring problem, and sending
 * half of it to a client tracker only creates cleanup work.
 */
export function assertPushable(cases: NormalizedTestCase[]): void {
  const offenders: string[] = [];
  for (const testCase of cases) {
    _assertClean(`${testCase.id}.title`, testCase.title, true);
    _assertClean(`${testCase.id}.expected`, testCase.expected, true);
    (testCase.steps || []).forEach((step, i) => {
      _assertClean(`${testCase.id}.steps[${i}].action`, step.action, true);
      _assertClean(`${testCase.id}.steps[${i}].expected`, step.expected, true);
    });
    // The advisory query is NOT required, so an empty cell passes; a placeholder in it does not.
    _assertClean(`${testCase.id}.soql`, testCase.soql, false);

    const reasons: string[] = [];
    if (String(testCase.expected || '').includes(TEST_CASE_TODO)) {
      reasons.push('Résultat attendu');
    }
    (testCase.steps || []).forEach((step, i) => {
      if (String(step.action || '').includes(TEST_CASE_TODO)) {
        reasons.push(`step ${i + 1} (action)`);
      }
      if (String(step.expected || '').includes(TEST_CASE_TODO)) {
        reasons.push(`step ${i + 1} (expected)`);
      }
    });
    if (reasons.length > 0) {
      offenders.push(`${testCase.id} -> ${reasons.join(', ')}`);
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `Upsert refused: ${offenders.length} test case(s) still contain "${TEST_CASE_TODO}".\n  ` +
        offenders.join('\n  ') +
        '\nComplete them in the notebook, then run the command again.'
    );
  }
}

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

/**
 * Reverse of `sanitizeCell`, applied when a notebook is read back: without it, a title such as
 * `-1 day` would come back as `'-1 day` and the apostrophe would be sent to the tracker.
 */
export function unsanitizeCell(value: unknown): string {
  return String(value ?? '').replace(/^'(?=[=+\-@\t\r])/, '');
}
