import { expect } from 'chai';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { countLinesInFile, createXlsxFromCsvFiles } from '../../../src/common/utils/filesUtils.js';

describe('filesUtils', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sfdx-hardis-filesutils-${Date.now()}`);
    await fs.ensureDir(tmpDir);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  describe('countLinesInFile()', () => {
    it('counts lines in a multi-line file', async () => {
      const file = path.join(tmpDir, 'multiline.txt');
      await fs.writeFile(file, 'line1\nline2\nline3\n');
      const count = await countLinesInFile(file);
      expect(count).to.equal(3);
    });

    it('counts a single line without trailing newline', async () => {
      const file = path.join(tmpDir, 'single.txt');
      await fs.writeFile(file, 'only one line');
      const count = await countLinesInFile(file);
      expect(count).to.equal(1);
    });

    it('returns 0 for an empty file', async () => {
      const file = path.join(tmpDir, 'empty.txt');
      await fs.writeFile(file, '');
      const count = await countLinesInFile(file);
      expect(count).to.equal(0);
    });

    it('handles CRLF line endings', async () => {
      const file = path.join(tmpDir, 'crlf.txt');
      await fs.writeFile(file, 'line1\r\nline2\r\nline3\r\n');
      const count = await countLinesInFile(file);
      expect(count).to.equal(3);
    });

    it('counts a large file correctly', async () => {
      const file = path.join(tmpDir, 'large.txt');
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
      await fs.writeFile(file, lines);
      const count = await countLinesInFile(file);
      expect(count).to.equal(100);
    });
  });

  describe('createXlsxFromCsvFiles() forceTextColumns', () => {
    let previousNoOpen: string | undefined;

    beforeEach(() => {
      // Prevent the generated XLSX from being opened in a desktop app during the test
      previousNoOpen = process.env.NO_OPEN;
      process.env.NO_OPEN = 'true';
    });

    afterEach(() => {
      if (previousNoOpen === undefined) {
        delete process.env.NO_OPEN;
      } else {
        process.env.NO_OPEN = previousNoOpen;
      }
    });

    const readXlsx = async (csvPath: string): Promise<ExcelJS.Worksheet> => {
      const xlsxPath = path.join(path.dirname(csvPath), 'xls', path.basename(csvPath).replace('.csv', '.xlsx'));
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(xlsxPath);
      return wb.worksheets[0];
    };

    it('keeps leading-zero values as text for forced-text columns', async () => {
      const csvPath = path.join(tmpDir, 'dict.csv');
      await fs.writeFile(csvPath, 'API Name,Key Prefix,Fields\nAccount,001,534\nContact,003,227\n');
      await createXlsxFromCsvFiles([csvPath], csvPath, { forceTextColumns: ['Key Prefix'] });
      const ws = await readXlsx(csvPath);
      // Row 2 = first data row; column 2 = Key Prefix
      const keyPrefixCell = ws.getCell(2, 2);
      expect(keyPrefixCell.value).to.equal('001');
      expect(typeof keyPrefixCell.value).to.equal('string');
      // Other numeric columns are still coerced to numbers
      const fieldsCell = ws.getCell(2, 3);
      expect(fieldsCell.value).to.equal(534);
      expect(typeof fieldsCell.value).to.equal('number');
    });

    it('loses leading zeros without forceTextColumns (default coercion)', async () => {
      const csvPath = path.join(tmpDir, 'dict-default.csv');
      await fs.writeFile(csvPath, 'API Name,Key Prefix,Fields\nAccount,001,534\n');
      await createXlsxFromCsvFiles([csvPath], csvPath, {});
      const ws = await readXlsx(csvPath);
      const keyPrefixCell = ws.getCell(2, 2);
      expect(keyPrefixCell.value).to.equal(1);
      expect(typeof keyPrefixCell.value).to.equal('number');
    });
  });
});
