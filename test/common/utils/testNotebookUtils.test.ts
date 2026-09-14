/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import ExcelJS from 'exceljs';
import fs from '../../../src/common/utils/fsUtils.js';
import os from 'os';
import path from 'path';
import {
  assertPushable,
  deriveTicketAndKind,
  idempotencyKey,
  NormalizedTestCase,
  normalizePriority,
  normalizeSoql,
  parseNotebookCsv,
  parseNotebookFile,
  parseNotebookMarkdown,
  parseNotebookXlsx,
  parseSteps,
  renderStepsFlat,
  resolveNotebookInput,
  sanitizeCsvCell,
  TEST_CASE_TODO,
  TestCaseStep,
  unsanitizeCsvCell,
  validateNormalizedCases,
} from '../../../src/common/utils/testNotebookUtils.js';

const BOM = String.fromCharCode(0xfeff);

/** Run a sync or async function and return the error it throws. Fails when nothing is thrown. */
async function errorOf(fn: () => unknown): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('Expected an error to be thrown');
}

/**
 * Messages come from t(). While a key is not translated yet, t() returns the key itself and the
 * interpolated values are lost, so the fragments are only checked once the message is translated.
 */
function expectMention(message: string, key: string, ...fragments: string[]): void {
  if (message.includes(key)) {
    return;
  }
  for (const fragment of fragments) {
    expect(message).to.contain(fragment);
  }
}

function makeCase(overrides: Partial<NormalizedTestCase> = {}): NormalizedTestCase {
  return {
    id: 'PROJ-123-F01',
    ticket: 'PROJ-123',
    kind: 'functional',
    module: 'Sales',
    priority: 1,
    title: 'Create a quote',
    preconditions: 'An active account',
    soql: 'SELECT Id FROM Account LIMIT 1',
    steps: [
      { action: 'Open the account', expected: 'The account page is shown' },
      { action: 'Click New quote', expected: 'The quote is created' },
    ],
    expected: 'The quote exists',
    ...overrides,
  };
}

describe('testNotebookUtils', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-notebook-utils-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  /* ---------------------------------------------------------------------------------------- */
  describe('contract', () => {
    describe('deriveTicketAndKind', () => {
      it('derives the kind from the letter before the counter', () => {
        expect(deriveTicketAndKind('PROJ-123-F01')).to.deep.equal({
          ticket: 'PROJ-123',
          kind: 'functional',
        });
        expect(deriveTicketAndKind('PROJ-123-T02')).to.deep.equal({
          ticket: 'PROJ-123',
          kind: 'technical',
        });
        expect(deriveTicketAndKind('PROJ-123-03')).to.deep.equal({
          ticket: 'PROJ-123',
          kind: 'maintenance',
        });
      });

      it('accepts a 3 digit counter and trims the id', () => {
        expect(deriveTicketAndKind('  PROJ-123-F101 ')).to.deep.equal({
          ticket: 'PROJ-123',
          kind: 'functional',
        });
      });

      it('keeps the dashes of a ticket key', () => {
        expect(deriveTicketAndKind('DSI-2026-14545-F01')).to.deep.equal({
          ticket: 'DSI-2026-14545',
          kind: 'functional',
        });
      });

      it('refuses a bare ticket key whose last segment has more than 3 digits', async () => {
        const error = await errorOf(() => deriveTicketAndKind('DSI-2026-14545'));
        expectMention(error.message, 'testCasesUnreadableId', 'DSI-2026-14545');
      });

      it('refuses a counter of a single digit or of 4 digits', async () => {
        await errorOf(() => deriveTicketAndKind('PROJ-123-F1'));
        await errorOf(() => deriveTicketAndKind('PROJ-123-F1000'));
      });

      it('refuses an id holding a quote, a space or a query operator', async () => {
        await errorOf(() => deriveTicketAndKind("PROJ-1'23-F01"));
        await errorOf(() => deriveTicketAndKind('PROJ 123-F01'));
        await errorOf(() => deriveTicketAndKind('PROJ-123"-F01'));
        await errorOf(() => deriveTicketAndKind('PROJ=123-F01'));
      });

      it('refuses an empty or missing id', async () => {
        await errorOf(() => deriveTicketAndKind(''));
        await errorOf(() => deriveTicketAndKind(undefined as unknown as string));
      });
    });

    describe('idempotencyKey', () => {
      it('is built from the ticket of the id and the short id', () => {
        expect(idempotencyKey('PROJ-123-F01')).to.equal('TESTKIT:PROJ-123:F01');
        expect(idempotencyKey('DSI-2026-14545-T12')).to.equal('TESTKIT:DSI-2026-14545:T12');
        expect(idempotencyKey(' PROJ-123-07 ')).to.equal('TESTKIT:PROJ-123:07');
      });
    });

    describe('normalizePriority', () => {
      it('reads P1, 2 and a number typed by a spreadsheet', () => {
        expect(normalizePriority('P1')).to.equal(1);
        expect(normalizePriority('2')).to.equal(2);
        expect(normalizePriority(3)).to.equal(3);
        expect(normalizePriority(' p3 ')).to.equal(3);
      });

      it('leaves an empty value undefined', () => {
        expect(normalizePriority('')).to.be.undefined;
        expect(normalizePriority('   ')).to.be.undefined;
        expect(normalizePriority(undefined)).to.be.undefined;
        expect(normalizePriority(null)).to.be.undefined;
      });

      it('defaults an unreadable value to 2', () => {
        expect(normalizePriority('High')).to.equal(2);
        expect(normalizePriority('P7')).to.equal(2);
      });
    });

    describe('normalizeSoql', () => {
      it('collapses the query on one line and drops the trailing semicolon', () => {
        expect(normalizeSoql("SELECT Id\n  FROM Account\r\n WHERE Name = 'Acme' ;  ")).to.equal("SELECT Id FROM Account WHERE Name = 'Acme'");
        expect(normalizeSoql(undefined)).to.equal('');
      });
    });
  });

  /* ---------------------------------------------------------------------------------------- */
  describe('assertPushable', () => {
    it('accepts finished cases, optional fields left undefined and steps with no expected result', () => {
      expect(() =>
        assertPushable([
          makeCase(),
          makeCase({
            id: 'PROJ-123-F02',
            module: undefined,
            preconditions: undefined,
            soql: undefined,
            target: undefined,
            steps: [{ action: 'Click Save', expected: '' }],
          }),
          makeCase({
            id: 'PROJ-123-F03',
            steps: undefined,
            module: '',
            soql: '',
          }),
        ])
      ).to.not.throw();
    });

    it('does not see a JSON object or a lower case brace as a placeholder', () => {
      expect(() =>
        assertPushable([
          makeCase({
            expected: 'The body is {"status": "ok"} and {name} is shown',
          }),
        ])
      ).to.not.throw();
    });

    it('collects every problem of every case in a single error', async () => {
      const cases = [
        makeCase({ id: 'PROJ-123-F01' }),
        makeCase({ id: 'PROJ-123-F01' }),
        makeCase({
          id: 'PROJ-123-F02',
          title: '  ',
          expected: 'null',
          module: '{MODULE_NAME}',
          preconditions: `An account, ${TEST_CASE_TODO}`,
          target: 'N/A',
          soql: 'SELECT Id FROM {{OBJECT}}',
          steps: [
            { action: '', expected: 'none' },
            { action: 'Click Save', expected: 'The record is saved' },
          ],
        }),
      ];
      const error = await errorOf(() => assertPushable(cases));
      const lines = error.message.split('\n');
      // Header line, then: duplicated id, title empty, expected forbidden, module placeholder,
      // preconditions marker, target forbidden, soql placeholder, step 1 action empty, step 1 expected forbidden
      expect(lines).to.have.lengthOf(1 + 9);
      expectMention(error.message, 'testCasesCheckDuplicatedIds', 'PROJ-123-F01');
      expectMention(error.message, 'testCasesCheckEmpty', 'PROJ-123-F02 title', 'PROJ-123-F02 step 1 action');
      expectMention(error.message, 'testCasesCheckForbiddenLiteral', 'PROJ-123-F02 expected', 'PROJ-123-F02 target', 'PROJ-123-F02 step 1 expected');
      expectMention(error.message, 'testCasesCheckPlaceholder', '{MODULE_NAME}', '{{OBJECT}}');
      expectMention(error.message, 'testCasesCheckTodoMarker', 'PROJ-123-F02 preconditions');
    });

    it('requires the expected result even when steps are there', async () => {
      const error = await errorOf(() => assertPushable([makeCase({ expected: '' })]));
      expect(error.message.split('\n')).to.have.lengthOf(2);
      expectMention(error.message, 'testCasesCheckEmpty', 'PROJ-123-F01 expected');
    });

    // Non-regression: notebooks written before the English rendering hold the French marker, and
    // they are exactly the ones the header aliases keep readable, so they must be refused too.
    it('refuses the legacy French marker, whatever its accents and case', async () => {
      const error = await errorOf(() =>
        assertPushable([
          makeCase({ id: 'PROJ-123-F01', expected: 'À COMPLÉTER' }),
          makeCase({ id: 'PROJ-123-F02', expected: 'a completer' }),
        ])
      );
      expect(error.message.split('\n')).to.have.lengthOf(3);
      expectMention(error.message, 'testCasesCheckTodoMarker', 'PROJ-123-F01 expected', 'PROJ-123-F02 expected');
    });

    it('finds the marker and the placeholder in the middle of a cell', async () => {
      const error = await errorOf(() =>
        assertPushable([
          makeCase({
            title: `Create a quote ${TEST_CASE_TODO}`,
            expected: 'Shows {SCENARIO_TITLE} in the header',
          }),
        ])
      );
      expect(error.message.split('\n')).to.have.lengthOf(3);
    });
  });

  /* ---------------------------------------------------------------------------------------- */
  describe('CSV cell guard', () => {
    it('prefixes an apostrophe on a formula lead character', () => {
      expect(sanitizeCsvCell('=1+1')).to.equal("'=1+1");
      expect(sanitizeCsvCell('+33 6 00 00 00 00')).to.equal("'+33 6 00 00 00 00");
      expect(sanitizeCsvCell('-1 day')).to.equal("'-1 day");
      expect(sanitizeCsvCell('@SUM(A1)')).to.equal("'@SUM(A1)");
      expect(sanitizeCsvCell('\tvalue')).to.equal("'\tvalue");
      expect(sanitizeCsvCell('Plain text')).to.equal('Plain text');
      expect(sanitizeCsvCell(3)).to.equal('3');
      expect(sanitizeCsvCell(undefined)).to.equal('');
    });

    it('guards a value an earlier guard already prefixed, so reading it back is lossless', () => {
      const values = ['=1+1', "'=1+1", "''-1 day", "'quoted", 'Plain', '', "It's fine"];
      for (const value of values) {
        expect(unsanitizeCsvCell(sanitizeCsvCell(value))).to.equal(value);
      }
    });

    it('leaves an apostrophe that does not guard anything', () => {
      expect(unsanitizeCsvCell("'quoted'")).to.equal("'quoted'");
    });
  });

  /* ---------------------------------------------------------------------------------------- */
  describe('steps', () => {
    function roundTrip(steps: TestCaseStep[], separator?: string): TestCaseStep[] {
      return parseSteps(renderStepsFlat(steps, separator));
    }

    it('reads numbered steps separated by <br> or line breaks', () => {
      expect(parseSteps('1. Open the page → The page is shown<br>2) Click Save → Saved<br/>3. Close')).to.deep.equal([
        { action: 'Open the page', expected: 'The page is shown' },
        { action: 'Click Save', expected: 'Saved' },
        { action: 'Close', expected: '' },
      ]);
      expect(parseSteps('1. Open → Shown\r\n\r\n2. Close → Closed')).to.have.lengthOf(2);
    });

    it('returns no step for an empty cell', () => {
      expect(parseSteps('')).to.deep.equal([]);
      expect(parseSteps(undefined)).to.deep.equal([]);
      expect(renderStepsFlat(undefined)).to.equal('');
      expect(renderStepsFlat([])).to.equal('');
    });

    it('renders numbered steps with an arrow only when there is an expected result', () => {
      expect(
        renderStepsFlat([
          { action: 'Open', expected: 'Shown' },
          { action: 'Click Save', expected: '' },
        ])
      ).to.equal('1. Open → Shown<br>2. Click Save');
      expect(
        renderStepsFlat(
          [
            { action: 'Open', expected: 'Shown' },
            { action: 'Close', expected: 'Closed' },
          ],
          '\n'
        )
      ).to.equal('1. Open → Shown\n2. Close → Closed');
    });

    it('keeps a step with an empty expected result through a round trip', () => {
      const steps = [
        { action: 'Open the record', expected: '' },
        { action: 'Click Save', expected: 'The record is saved' },
      ];
      expect(roundTrip(steps)).to.deep.equal(steps);
      expect(roundTrip(steps, '\n')).to.deep.equal(steps);
    });

    it('splits on a typed -> separator', () => {
      expect(parseSteps('1. Open the record -> The record is shown')).to.deep.equal([{ action: 'Open the record', expected: 'The record is shown' }]);
    });

    it('splits on the first arrow only, so the expected result may hold one', () => {
      const steps = parseSteps('1. Open Setup → Users → Profiles is shown');
      expect(steps).to.deep.equal([{ action: 'Open Setup', expected: 'Users → Profiles is shown' }]);
      const kept = [{ action: 'Open Setup', expected: 'Users -> Profiles is shown' }];
      expect(roundTrip(kept)).to.deep.equal(kept);
    });

    it('does not split on an arrow glued to a word', () => {
      expect(parseSteps('1. Compute A->B')).to.deep.equal([{ action: 'Compute A->B', expected: '' }]);
    });

    it('keeps a "- " prefix as text', () => {
      const steps = [{ action: '- Open the record', expected: '- The record is shown' }];
      expect(parseSteps('- Open the record → - The record is shown')).to.deep.equal(steps);
      expect(roundTrip(steps)).to.deep.equal(steps);
    });

    it('reads a leading arrow as an empty action', () => {
      expect(parseSteps('→ Record saved')).to.deep.equal([{ action: '', expected: 'Record saved' }]);
      expect(parseSteps('1. -> Record saved')).to.deep.equal([{ action: '', expected: 'Record saved' }]);
    });

    it('folds a multi-line action onto one line when rendering', () => {
      expect(roundTrip([{ action: 'Open\nthe record', expected: 'Shown\r\n  twice' }])).to.deep.equal([
        { action: 'Open the record', expected: 'Shown twice' },
      ]);
    });
  });

  /* ---------------------------------------------------------------------------------------- */
  describe('parseNotebookMarkdown', () => {
    it('reads every table holding an ID column, with the line breaks of a cell', () => {
      const content = [
        '# Test notebook',
        '',
        '| Key | Value |',
        '|---|---|',
        '| Owner | QA team |',
        '',
        '## Sales',
        '',
        '| ID | Module | Priority | Test case | Preconditions and data | SOQL query | Steps | Expected result |',
        '|---|---|:---:|---|---|---|---|---|',
        '| PROJ-123-F01 | Sales | P1 | Create a quote | An active account<br>A contact | SELECT Id FROM Account; | 1. Open → Shown<br>2. Save | Quote A \\| B created |',
        '|  |  |  |  |  |  |  |  |',
        '',
        '## Billing',
        '',
        '| ID | Module | Priority | Test case | Preconditions and data | SOQL query | Steps | Expected result |',
        '|---|---|---|---|---|---|---|---|',
        '| PROJ-123-F02 | Billing | 3 | Send an invoice <!-- draft --> | | | | Invoice sent |',
      ].join('\n');
      const cases = parseNotebookMarkdown(content);
      expect(cases.map((testCase) => testCase.id)).to.deep.equal(['PROJ-123-F01', 'PROJ-123-F02']);
      expect(cases[0]).to.deep.include({
        ticket: 'PROJ-123',
        kind: 'functional',
        module: 'Sales',
        priority: 1,
        title: 'Create a quote',
        preconditions: 'An active account\nA contact',
        soql: 'SELECT Id FROM Account',
        expected: 'Quote A | B created',
      });
      expect(cases[0].steps).to.deep.equal([
        { action: 'Open', expected: 'Shown' },
        { action: 'Save', expected: '' },
      ]);
      expect(cases[1].priority).to.equal(3);
      expect(cases[1].title).to.equal('Send an invoice');
      expect(cases[1].steps).to.deep.equal([]);
      expect(cases[1].preconditions).to.equal('');
    });

    it('refuses a row whose cell count differs from the header, with its line number', async () => {
      const content = ['Intro', '', '| ID | Test case | Expected result |', '|---|---|---|', '| PROJ-123-F01 | Pick A | B | Shown |'].join('\n');
      const error = await errorOf(() => parseNotebookMarkdown(content));
      expectMention(error.message, 'testCasesMarkdownCellCount', '5', '4', '3');
    });

    it('refuses a content without a test case table', async () => {
      const error = await errorOf(() => parseNotebookMarkdown('| Key | Value |\n|---|---|\n| a | b |'));
      expect(error.message).to.be.a('string').and.not.equal('');
    });

    it('locates an unreadable id', async () => {
      const content = ['| ID | Test case | Expected result |', '|---|---|---|', '| PROJ-123 F01 | Title | Done |'].join('\n');
      const error = await errorOf(() => parseNotebookMarkdown(content));
      expectMention(error.message, 'testCasesUnreadableId', 'PROJ-123 F01');
    });

    it('leaves the fields of missing columns undefined', () => {
      const content = ['| ID | Test case | Expected result |', '|---|---|---|', '| PROJ-123-07 | Purge the logs | Logs purged |'].join('\n');
      const [testCase] = parseNotebookMarkdown(content);
      expect(testCase).to.deep.include({
        id: 'PROJ-123-07',
        ticket: 'PROJ-123',
        kind: 'maintenance',
        title: 'Purge the logs',
        expected: 'Logs purged',
      });
      for (const field of ['module', 'priority', 'target', 'preconditions', 'soql', 'steps', 'actual', 'comment', 'status'] as const) {
        expect(testCase[field], field).to.be.undefined;
      }
    });

    it('still reads the French headers of older notebooks', () => {
      const content = [
        '| ID | Module | Priorité | Classe / Méthode | Cas de test | Prérequis et données | Requête SOQL | Étapes | Résultat attendu | Résultat obtenu | Commentaire | Statut |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|',
        '| PROJ-123-T01 | Sales | P2 | QuoteService.create | Create a quote | An account | SELECT Id FROM Quote | 1. Run → Done | Quote created | Quote created | Checked twice | Passed |',
      ].join('\n');
      const [testCase] = parseNotebookMarkdown(content);
      expect(testCase).to.deep.include({
        kind: 'technical',
        priority: 2,
        target: 'QuoteService.create',
        title: 'Create a quote',
        preconditions: 'An account',
        soql: 'SELECT Id FROM Quote',
        expected: 'Quote created',
        actual: 'Quote created',
        comment: 'Checked twice',
        status: 'Passed',
      });
      expect(testCase.steps).to.deep.equal([{ action: 'Run', expected: 'Done' }]);
    });

    it('applies the ticket override without touching the id', () => {
      const content = ['| ID | Test case | Expected result |', '|---|---|---|', '| PROJ-123-F01 | Title | Done |'].join('\n');
      const [testCase] = parseNotebookMarkdown(content, 'OTHER-9');
      expect(testCase.ticket).to.equal('OTHER-9');
      expect(testCase.id).to.equal('PROJ-123-F01');
      expect(idempotencyKey(testCase.id)).to.equal('TESTKIT:PROJ-123:F01');
    });
  });

  /* ---------------------------------------------------------------------------------------- */
  describe('parseNotebookCsv', () => {
    it('reads a comma separated notebook with a BOM, and a text holding semicolons', () => {
      const content =
        BOM +
        'ID,Module,Priority,Test case,Steps,Expected result\r\n' +
        'PROJ-123-F01,Sales,P1,Create a quote,"1. Open → Shown<br>2. Save → Saved","Total; tax included, rounded"\r\n' +
        'PROJ-123-F02,Sales,P2,Delete a quote,1. Delete,"Quote deleted; related lines too"\r\n';
      const cases = parseNotebookCsv(content);
      expect(cases).to.have.lengthOf(2);
      expect(cases[0]).to.deep.include({
        id: 'PROJ-123-F01',
        module: 'Sales',
        priority: 1,
        expected: 'Total; tax included, rounded',
      });
      expect(cases[0].steps).to.deep.equal([
        { action: 'Open', expected: 'Shown' },
        { action: 'Save', expected: 'Saved' },
      ]);
      expect(cases[1].expected).to.equal('Quote deleted; related lines too');
    });

    it('reads a semicolon separated notebook, and a text holding commas', () => {
      const content =
        'ID;Module;Priority;Test case;Expected result\n' +
        'PROJ-123-F01;Sales;P1;Create a quote, then save it;Quote created, total computed\n' +
        'PROJ-123-F02;Sales;3;Delete a quote;Quote deleted\n';
      const cases = parseNotebookCsv(content);
      expect(cases).to.have.lengthOf(2);
      expect(cases[0]).to.deep.include({
        title: 'Create a quote, then save it',
        expected: 'Quote created, total computed',
      });
      expect(cases[1].priority).to.equal(3);
    });

    it('reads an unescaped quote in the middle of a field as a character', () => {
      const content = 'ID,Test case,Expected result\r\nPROJ-123-F01,Shows a 5" badge,Badge shown\r\nPROJ-123-F02,Other,Done\r\n';
      const cases = parseNotebookCsv(content);
      expect(cases).to.have.lengthOf(2);
      expect(cases[0].title).to.equal('Shows a 5" badge');
      expect(cases[0].expected).to.equal('Badge shown');
    });

    it('refuses a quote left open instead of swallowing the next rows', async () => {
      const content = 'ID,Test case,Expected result\r\nPROJ-123-F01,"Open quote,Done\r\nPROJ-123-F02,Other,Done\r\n';
      const error = await errorOf(() => parseNotebookCsv(content));
      expectMention(error.message, 'testCasesCsvQuoteError');
    });

    it('stops at the SUMMARY marker row and skips empty rows', () => {
      const content = [
        'ID,Module,Priority,Test case,Expected result',
        'PROJ-123-F01,Sales,P1,Create a quote,Quote created',
        ',,,,',
        'PROJ-123-F02,Billing,P2,Send an invoice,Invoice sent',
        ',,,,',
        'SUMMARY,,,,',
        'Module,Tests,P1,P2,P3',
        'Sales,1,1,0,0',
        'TOTAL,2,1,1,0',
      ].join('\r\n');
      const cases = parseNotebookCsv(content);
      expect(cases.map((testCase) => testCase.id)).to.deep.equal(['PROJ-123-F01', 'PROJ-123-F02']);
    });

    it('removes the formula guard and restores the line breaks of a field', () => {
      const content = "ID,Test case,Preconditions and data,Expected result\r\nPROJ-123-F01,'=1+1,An account<br>A contact,'-1 day\r\n";
      const [testCase] = parseNotebookCsv(content);
      expect(testCase.title).to.equal('=1+1');
      expect(testCase.preconditions).to.equal('An account\nA contact');
      expect(testCase.expected).to.equal('-1 day');
    });

    it('refuses a notebook without an ID column or empty', async () => {
      await errorOf(() => parseNotebookCsv('Name,Expected result\r\nA,B\r\n'));
      await errorOf(() => parseNotebookCsv(''));
    });

    it('leaves the fields of missing columns undefined', () => {
      const [testCase] = parseNotebookCsv('ID,Title,Expected\r\nPROJ-123-T01,Run the batch,Batch done\r\n');
      expect(testCase).to.deep.include({
        kind: 'technical',
        title: 'Run the batch',
        expected: 'Batch done',
      });
      for (const field of ['module', 'priority', 'target', 'preconditions', 'soql', 'steps', 'actual', 'comment', 'status'] as const) {
        expect(testCase[field], field).to.be.undefined;
      }
    });

    it('still reads the French headers of older notebooks', () => {
      const content = 'ID;Priorité;Cas de test;Étapes;Résultat attendu;Statut\nPROJ-123-F01;P1;Create a quote;1. Open → Shown;Quote created;Failed\n';
      const [testCase] = parseNotebookCsv(content);
      expect(testCase).to.deep.include({
        priority: 1,
        title: 'Create a quote',
        expected: 'Quote created',
        status: 'Failed',
      });
      expect(testCase.steps).to.deep.equal([{ action: 'Open', expected: 'Shown' }]);
    });
  });

  /* ---------------------------------------------------------------------------------------- */
  describe('parseNotebookXlsx', () => {
    const HEADERS = ['ID', 'Module', 'Priority', 'Test case', 'Steps', 'Expected result'];

    it('reads every sheet holding an ID column and skips the others', async () => {
      const file = path.join(tmpDir, 'multi.xlsx');
      const workbook = new ExcelJS.Workbook();
      const readme = workbook.addWorksheet('Read me');
      readme.addRow(['How to fill this notebook']);
      const sales = workbook.addWorksheet('Sales');
      sales.addRow(HEADERS);
      sales.addRow(['PROJ-123-F01', 'Sales', 3, 'Create a quote', '1. Open → Shown\n2. Save', 'Quote created']);
      sales.addRow(['', '', '', '', '', '']);
      sales.addRow([null, null, null, null, null, null]);
      const billing = workbook.addWorksheet('Billing');
      billing.addRow(HEADERS);
      billing.addRow(['PROJ-123-F02', 'Billing', 'P2', 'Send an invoice', '', 'Invoice sent']);
      const summary = workbook.addWorksheet('Summary');
      summary.addRow(['Module', 'Tests']);
      summary.addRow(['Sales', 1]);
      await workbook.xlsx.writeFile(file);

      const cases = await parseNotebookXlsx(file);
      expect(cases.map((testCase) => testCase.id)).to.deep.equal(['PROJ-123-F01', 'PROJ-123-F02']);
      expect(cases[0].priority).to.equal(3);
      expect(cases[0].steps).to.deep.equal([
        { action: 'Open', expected: 'Shown' },
        { action: 'Save', expected: '' },
      ]);
      expect(cases[1].module).to.equal('Billing');
    });

    it('flattens rich text, hyperlinks and formulas, and reads a formula error as empty', async () => {
      const file = path.join(tmpDir, 'cells.xlsx');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Functional');
      sheet.addRow([...HEADERS, 'Comment']);
      const row = sheet.addRow(['PROJ-123-F01', '', 'P1', '', '', '', '']);
      row.getCell(2).value = {
        formula: 'NA()',
        result: { error: '#N/A' },
      } as ExcelJS.CellFormulaValue;
      row.getCell(4).value = {
        richText: [{ text: 'Create ' }, { text: 'a quote', font: { bold: true } }],
      };
      row.getCell(5).value = {
        formula: 'CONCATENATE("1. Open"," → Shown")',
        result: '1. Open → Shown',
      };
      row.getCell(6).value = {
        text: 'See the quote page',
        hyperlink: 'https://example.com/quote',
      };
      row.getCell(7).value = {
        text: {
          richText: [{ text: 'Linked ' }, { text: 'ticket', font: { italic: true } }],
        },
        hyperlink: 'https://example.com/ticket',
      } as unknown as ExcelJS.CellHyperlinkValue;
      await workbook.xlsx.writeFile(file);

      const [testCase] = await parseNotebookXlsx(file);
      expect(testCase.module).to.equal('');
      expect(testCase.title).to.equal('Create a quote');
      expect(testCase.steps).to.deep.equal([{ action: 'Open', expected: 'Shown' }]);
      expect(testCase.expected).to.equal('See the quote page');
      expect(testCase.comment).to.equal('Linked ticket');
      expect(JSON.stringify(testCase)).to.not.contain('[object Object]');
    });

    it('leaves the fields of missing columns undefined and reads French headers', async () => {
      const file = path.join(tmpDir, 'legacy.xlsx');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Maintenance');
      sheet.addRow(['ID', 'Cas de test', 'Prérequis et données', 'Résultat attendu']);
      sheet.addRow(['PROJ-123-01', 'Purge the logs', 'Logs older than 30 days\nAn admin user', 'Logs purged']);
      await workbook.xlsx.writeFile(file);

      const [testCase] = await parseNotebookXlsx(file);
      expect(testCase).to.deep.include({
        kind: 'maintenance',
        title: 'Purge the logs',
        preconditions: 'Logs older than 30 days\nAn admin user',
        expected: 'Logs purged',
      });
      for (const field of ['module', 'priority', 'target', 'soql', 'steps', 'actual', 'comment', 'status'] as const) {
        expect(testCase[field], field).to.be.undefined;
      }
    });

    it('names the sheets when none holds an ID column', async () => {
      const file = path.join(tmpDir, 'none.xlsx');
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet('Read me').addRow(['Nothing here']);
      await workbook.xlsx.writeFile(file);
      const error = await errorOf(() => parseNotebookXlsx(file));
      expectMention(error.message, 'testCasesXlsxNoIdSheet', 'Read me');
    });

    it('locates an unreadable id with its sheet and row', async () => {
      const file = path.join(tmpDir, 'bad-id.xlsx');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sales');
      sheet.addRow(HEADERS);
      sheet.addRow(['PROJ-123-F01', 'Sales', 'P1', 'Title', '', 'Done']);
      sheet.addRow(['DSI-2026-14545', 'Sales', 'P1', 'Title', '', 'Done']);
      await workbook.xlsx.writeFile(file);
      const error = await errorOf(() => parseNotebookXlsx(file));
      expectMention(error.message, 'testCasesWhereSheetRow', 'Sales', '3');
    });
  });

  /* ---------------------------------------------------------------------------------------- */
  describe('JSON payload', () => {
    it('fills ticket and kind from the id, maps tma to maintenance and defaults step expected results', () => {
      const cases = validateNormalizedCases([
        {
          id: ' PROJ-123-F01 ',
          title: 'Create a quote',
          expected: 'Quote created',
          steps: [{ action: 'Open' }],
          soql: 'SELECT Id\nFROM Quote;',
        },
        {
          id: 'PROJ-123-01',
          title: 'Purge the logs',
          expected: 'Logs purged',
          kind: 'tma',
        },
      ]);
      expect(cases[0]).to.deep.include({
        id: 'PROJ-123-F01',
        ticket: 'PROJ-123',
        kind: 'functional',
        soql: 'SELECT Id FROM Quote',
      });
      expect(cases[0].steps).to.deep.equal([{ action: 'Open', expected: '' }]);
      expect(cases[1].kind).to.equal('maintenance');
      expect(cases[1].steps).to.be.undefined;
      expect(cases[1].soql).to.be.undefined;
      expect(cases[1].module).to.be.undefined;
    });

    it('reports every problem of an entry with its index', async () => {
      const error = await errorOf(() =>
        validateNormalizedCases([
          { id: 'PROJ-123-F01', title: 'Fine', expected: 'Fine' },
          {
            id: 'PROJ-123',
            title: '',
            priority: 4,
            kind: 'other',
            steps: 'Open',
          },
        ])
      );
      expectMention(error.message, 'testCasesJsonInvalidEntry', '1', '"title"', '"expected"', '"priority"', '"kind"', '"steps"');
    });

    it('refuses a payload that is not an array', async () => {
      await errorOf(() => validateNormalizedCases({ id: 'PROJ-123-F01' }));
    });

    it('applies the ticket override without changing the idempotency key', () => {
      const [testCase] = validateNormalizedCases([{ id: 'PROJ-123-F01', ticket: 'PROJ-123', title: 'T', expected: 'E' }], 'OTHER-42');
      expect(testCase.ticket).to.equal('OTHER-42');
      expect(idempotencyKey(testCase.id)).to.equal('TESTKIT:PROJ-123:F01');
    });

    it('accepts an id made of a ticket key holding dashes, and refuses the bare ticket key', async () => {
      const [testCase] = validateNormalizedCases([{ id: 'DSI-2026-14545-F01', title: 'T', expected: 'E' }]);
      expect(testCase.ticket).to.equal('DSI-2026-14545');
      await errorOf(() => validateNormalizedCases([{ id: 'DSI-2026-14545', title: 'T', expected: 'E' }]));
      await errorOf(() => validateNormalizedCases([{ id: "PROJ-123-F01' OR Id != null", title: 'T', expected: 'E' }]));
    });
  });

  /* ---------------------------------------------------------------------------------------- */
  describe('parseNotebookFile and resolveNotebookInput', () => {
    const payload = [
      {
        id: 'PROJ-123-F01',
        title: 'Create a quote',
        expected: 'Quote created',
      },
    ];

    it('reads a JSON file written with a BOM and applies --ticket-number to it', async () => {
      const file = path.join(tmpDir, 'cases.json');
      await fs.writeFile(file, BOM + JSON.stringify(payload), 'utf8');
      const cases = await resolveNotebookInput({
        testsjsonfile: file,
        'ticket-number': ' OTHER-42 ',
      });
      expect(cases).to.have.lengthOf(1);
      expect(cases[0].ticket).to.equal('OTHER-42');
      expect(idempotencyKey(cases[0].id)).to.equal('TESTKIT:PROJ-123:F01');
    });

    it('reads a notebook by its extension, with the ticket override', async () => {
      const file = path.join(tmpDir, 'notebook.MD');
      await fs.writeFile(file, '| ID | Test case | Expected result |\n|---|---|---|\n| PROJ-123-F01 | Title | Done |\n', 'utf8');
      const cases = await resolveNotebookInput({
        notebook: file,
        'ticket-number': 'OTHER-42',
      });
      expect(cases[0].ticket).to.equal('OTHER-42');
      const withoutOverride = await parseNotebookFile(file);
      expect(withoutOverride[0].ticket).to.equal('PROJ-123');
    });

    it('reads a JSON notebook passed with --notebook', async () => {
      const file = path.join(tmpDir, 'cases.json');
      await fs.writeFile(file, JSON.stringify(payload), 'utf8');
      expect(await parseNotebookFile(file)).to.have.lengthOf(1);
    });

    it('refuses an unreadable JSON, an unsupported extension and a missing file', async () => {
      const bad = path.join(tmpDir, 'bad.json');
      await fs.writeFile(bad, '[{', 'utf8');
      const unreadable = await errorOf(() => parseNotebookFile(bad));
      expectMention(unreadable.message, 'testCasesJsonUnreadable', bad);

      const txt = path.join(tmpDir, 'notebook.txt');
      await fs.writeFile(txt, 'ID', 'utf8');
      const unsupported = await errorOf(() => parseNotebookFile(txt));
      expectMention(unsupported.message, 'testCasesUnsupportedExtension', '.txt');

      const missing = path.join(tmpDir, 'missing.csv');
      const notFound = await errorOf(() => parseNotebookFile(missing));
      expectMention(notFound.message, 'testCasesFileNotFound', missing);
      await errorOf(() =>
        resolveNotebookInput({
          testsjsonfile: path.join(tmpDir, 'missing.json'),
        })
      );
    });

    it('requires exactly one input', async () => {
      await errorOf(() => resolveNotebookInput({}));
      await errorOf(() => resolveNotebookInput({ notebook: 'a.md', testsjsonfile: 'b.json' }));
    });
  });
});

describe('testNotebookUtils follow-up checks', () => {
  it('writes an arrow inside an action as => so the round trip keeps the action whole', () => {
    const steps: TestCaseStep[] = [
      { action: 'Click Quotes → New', expected: 'Panel' },
      { action: 'Go to A -> B', expected: '' },
    ];
    expect(parseSteps(renderStepsFlat(steps))).to.deep.equal([
      { action: 'Click Quotes => New', expected: 'Panel' },
      { action: 'Go to A => B', expected: '' },
    ]);
  });

  it('refuses a JSON kind that does not match the id suffix', async () => {
    const error = await errorOf(() =>
      validateNormalizedCases([{ id: 'PROJ-1-F01', kind: 'technical', title: 'Title', expected: 'Expected' }])
    );
    expect(error.message).to.contain('technical');
  });

  it('refuses a ticket key holding a quote, in JSON and in --ticket-number', async () => {
    const payload = [{ id: 'PROJ-1-F01', ticket: "x' OR 1=1", title: 'Title', expected: 'Expected' }];
    await errorOf(() => validateNormalizedCases(payload));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tc-ticket-'));
    const file = path.join(dir, 'cases.json');
    await fs.writeFile(file, JSON.stringify([{ id: 'PROJ-1-F01', title: 'Title', expected: 'Expected' }]));
    await errorOf(() => resolveNotebookInput({ testsjsonfile: file, 'ticket-number': 'PROJ 1' }));
    await fs.remove(dir);
  });

  it('only stops a CSV notebook at the exact SUMMARY marker', () => {
    const csv = 'ID,Test case,Expected result\r\nSUMMARY-1-F01,Title,Expected\r\n';
    expect(parseNotebookCsv(csv).map((testCase) => testCase.id)).to.deep.equal(['SUMMARY-1-F01']);
  });

  it('reads a priority only from P1..P3 or 1..3', () => {
    expect(normalizePriority('P3')).to.equal(3);
    expect(normalizePriority('12')).to.equal(2);
  });
});
