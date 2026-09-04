/**
 * Public contract of the test notebook commands.
 *
 * `hardis:project:test-cases:push` and `:render` both accept a pre-normalized
 * `NormalizedTestCase[]` JSON file through `--testsjsonfile`, so this shape is a
 * versioned public contract, not an internal convenience type: a pipeline may produce it
 * without ever going through the parser.
 */

export interface TestCaseStep {
  action: string;
  expected: string;
}

export type TestCaseKind = 'functional' | 'technical' | 'tma';

export interface NormalizedTestCase {
  /** Full identifier as written in the notebook, e.g. "PROJ-123-F01" */
  id: string;
  /** Derived from the id prefix, or overridden by --ticket-number */
  ticket: string;
  /** Derived from the id suffix */
  kind: TestCaseKind;
  module: string;
  priority: 1 | 2 | 3;
  title: string;
  preconditions: string;
  /**
   * Apex class / method under test. Only the technical notebook carries it (its
   * "Classe / Méthode" column); empty for functional and TMA. Part of the contract so a
   * JSON round-trip does not silently drop a rendered column.
   */
  target?: string;
  /** Advisory helper query. Empty is a NORMAL state and never blocks a push. */
  soql?: string;
  steps: TestCaseStep[];
  expected: string;
}

/** Placeholder the notebook uses for a value the author still has to fill in. */
export const TEST_CASE_TODO = 'À COMPLÉTER';

// A suffix is either -F<digits> (functional), -T<digits> (technical) or -<digits> (tma).
const ID_SUFFIX_RE = /^(.*)-([FT]?)(\d+)$/;

/**
 * Split an identifier into its carrier ticket and its kind. Everything before the last
 * segment is the ticket, so a ticket key holding dashes (DSI-2026-14545) still works.
 *
 * Fails loudly on an unreadable id: the commands must never guess a kind, because guessing
 * "functional" for a technical case silently renders the wrong column set.
 */
export function deriveTicketAndKind(id: string): { ticket: string; kind: TestCaseKind } {
  const match = ID_SUFFIX_RE.exec(String(id ?? '').trim());
  if (!match || !match[1]) {
    throw new Error(
      `Unreadable test case id ${JSON.stringify(id)}. Expected <TICKET>-F01 (functional), ` +
        '<TICKET>-T01 (technical) or <TICKET>-01 (TMA).'
    );
  }
  const [, ticket, letter] = match;
  const kind: TestCaseKind = letter === 'F' ? 'functional' : letter === 'T' ? 'technical' : 'tma';
  return { ticket, kind };
}

/** `P1` / `1` / `1` -> 1. Anything unreadable defaults to 2. */
export function normalizePriority(value: unknown): 1 | 2 | 3 {
  const match = /([123])/.exec(String(value ?? ''));
  return match ? (Number(match[1]) as 1 | 2 | 3) : 2;
}

/** Collapse the advisory query to a single line and drop a trailing semicolon. */
export function normalizeSoql(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim()
    .replace(/;\s*$/, '')
    .trim();
}
