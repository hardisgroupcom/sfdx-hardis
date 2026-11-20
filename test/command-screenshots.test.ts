import { strict as assert } from 'assert';
import ExcelJS from 'exceljs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { selectSpecs, slugOf, specFileOf, validateSpec } from '../scripts/command-screenshots/lib/specs.mjs';
import { findReportXlsx, prepareRealReport } from '../scripts/command-screenshots/lib/reports.mjs';

const COMMANDS_DIR = path.join(process.cwd(), 'src', 'commands');
const SRC_DIR = path.join(process.cwd(), 'src');

function listFiles(dir: string, suffix: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(full, suffix);
    }
    return entry.name.endsWith(suffix) ? [full] : [];
  });
}

// The `file` keys a command declares in `public static reports`, read from its source
function declaredReportFiles(source: string): { file: string; title: string; description: string }[] {
  const block = source.match(/public static reports: CommandReport\[\] = \[([\s\S]*?)\n {2}\];/);
  if (!block) {
    return [];
  }
  const entries: { file: string; title: string; description: string }[] = [];
  // Single or double quotes, as each file writes its strings
  const entryRegex = /file: (['"])(.*?)\1,\s*title: (['"])((?:(?!\3)[^\\]|\\.)*)\3,\s*description:\s*(['"])((?:(?!\5)[^\\]|\\.)*)\5/g;
  let match = entryRegex.exec(block[1]);
  while (match) {
    entries.push({ file: match[2], title: match[4], description: match[6] });
    match = entryRegex.exec(block[1]);
  }
  return entries;
}

describe('command screenshots: declared reports', () => {
  const sources = listFiles(COMMANDS_DIR, '.ts').map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }));
  const allSources = listFiles(SRC_DIR, '.ts')
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');

  it('declares each report with a file prefix, a title and a description, once per command', () => {
    for (const { file, source } of sources) {
      if (!source.includes('public static reports')) {
        continue;
      }
      const reports = declaredReportFiles(source);
      assert.ok(reports.length > 0, `${file}: its reports field could not be read`);
      // "unused-users-" and "unused-users" are the same files
      const keys = reports.map((report) => report.file.replace(/[-_]+$/, ''));
      assert.equal(new Set(keys).size, keys.length, `${file}: a report file prefix is declared twice`);
      for (const report of reports) {
        assert.ok(report.file && report.title && report.description, `${file}: report ${report.file} misses a field`);
        assert.ok(!/—/.test(report.title + report.description), `${file}: no em dash in report texts`);
      }
    }
  });

  it('names report prefixes that the code really writes', () => {
    for (const { file, source } of sources) {
      for (const report of declaredReportFiles(source)) {
        const prefix = report.file.replace(/[-_]+$/, '');
        assert.ok(
          allSources.includes(`'${prefix}`) || allSources.includes(`"${prefix}`) || allSources.includes('`' + prefix),
          `${file}: no string of the code starts with the report prefix "${prefix}"`
        );
      }
    }
  });
});

describe('command screenshots: specs', () => {
  const specsDir = path.join(os.tmpdir(), 'specs-test');
  const spec = (command: string, extra: Record<string, unknown> = {}) => ({
    command,
    run: `sf ${command}`,
    file: specFileOf(specsDir, command),
    ...extra,
  });

  it('places a spec at the path of its command, without the hardis topic', () => {
    assert.equal(slugOf('hardis:org:diagnose:licenses'), 'org-diagnose-licenses');
    assert.equal(specFileOf(specsDir, 'hardis:org:diagnose:licenses'), path.join(specsDir, 'org', 'diagnose', 'licenses.yml'));
  });

  it('selects specs by id, by pattern with or without the hardis topic, or all', () => {
    const specs = [spec('hardis:org:diagnose:licenses'), spec('hardis:org:diagnose:mfa'), spec('hardis:lint:access')];
    assert.deepEqual(
      selectSpecs(specs, ['org:diagnose:*']).map((item: any) => item.command),
      ['hardis:org:diagnose:licenses', 'hardis:org:diagnose:mfa']
    );
    assert.deepEqual(
      selectSpecs(specs, ['hardis:lint:access']).map((item: any) => item.command),
      ['hardis:lint:access']
    );
    assert.equal(selectSpecs(specs, []).length, 3);
  });

  it('reports the problems of a spec', () => {
    assert.deepEqual(validateSpec(spec('hardis:lint:access'), specsDir, ['hardis:lint:access']), []);
    const problems = validateSpec(
      spec('hardis:lint:access', { run: 'sf other', org: 'prod', answers: [{ q: 'x' }] }),
      specsDir,
      ['hardis:lint:access']
    );
    assert.equal(problems.length, 3);
    assert.equal(validateSpec(spec('hardis:lint:gone'), specsDir, ['hardis:lint:access']).length, 1);
    assert.deepEqual(validateSpec(spec('hardis:lint:access', { skip: 'no UI', run: undefined }), specsDir, null), []);
  });
});

describe('command screenshots: reports', () => {
  let dir: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-report-'));
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Users');
    sheet.addRow(['Username', 'Profile']);
    sheet.addRow(['real.person@customer.com', 'System Administrator']);
    sheet.getRow(2).getCell(1).font = { bold: true };
    await workbook.xlsx.writeFile(path.join(dir, 'unused-users-main.xlsx'));
    fs.writeFileSync(path.join(dir, 'unused-users-apex-main.xlsx'), '');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('finds the main report of a prefix, declared with or without its separator', () => {
    const files = [path.join(dir, 'unused-users-apex-main.xlsx'), path.join(dir, 'unused-users-main.xlsx'), path.join(dir, 'other.xlsx')];
    assert.equal(findReportXlsx(files, dir, 'unused-users'), path.join(dir, 'unused-users-main.xlsx'));
    assert.equal(findReportXlsx(files, dir, 'unused-users-'), path.join(dir, 'unused-users-main.xlsx'));
    assert.equal(findReportXlsx(files, dir, 'licenses'), null);
  });

  it('masks real values and appends overlay rows in the style of the first row', async () => {
    const out = path.join(dir, 'out.xlsx');
    await prepareRealReport({
      xlsxFile: path.join(dir, 'unused-users-main.xlsx'),
      overlay: { mode: 'append', rows: [{ Username: 'mariia.kowalska@helios-solar.demo', Profile: 'Standard User' }] },
      maskRules: [{ find: 'real.person@customer.com', replace: 'victor.martin@helios-solar.demo' }],
      outFile: out,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(out);
    const sheet = workbook.getWorksheet('Users')!;
    assert.equal(sheet.getRow(2).getCell(1).value, 'victor.martin@helios-solar.demo');
    assert.equal(sheet.getRow(3).getCell(1).value, 'mariia.kowalska@helios-solar.demo');
    assert.equal(sheet.getRow(3).getCell(1).font?.bold, true);
  });

  it('replaces the rows, and refuses a column the report does not have', async () => {
    const out = path.join(dir, 'out.xlsx');
    await prepareRealReport({
      xlsxFile: path.join(dir, 'unused-users-main.xlsx'),
      overlay: { mode: 'replace', rows: [{ Username: 'a@helios-solar.demo' }, { Username: 'b@helios-solar.demo' }] },
      maskRules: [],
      outFile: out,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(out);
    const sheet = workbook.getWorksheet('Users')!;
    assert.equal(sheet.rowCount, 3);
    assert.equal(sheet.getRow(2).getCell(1).value, 'a@helios-solar.demo');
    await assert.rejects(
      prepareRealReport({
        xlsxFile: path.join(dir, 'unused-users-main.xlsx'),
        overlay: { mode: 'append', rows: [{ Nope: 'x' }] },
        maskRules: [],
        outFile: out,
      }),
      /column the report does not have/
    );
  });
});
