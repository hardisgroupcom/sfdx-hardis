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

  describe('createXlsxFromCsvFiles() workbook integrity', () => {
    let previousNoOpen: string | undefined;

    beforeEach(() => {
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

    const readWorkbook = async (csvPath: string): Promise<ExcelJS.Workbook> => {
      const xlsxPath = path.join(path.dirname(csvPath), 'xls', path.basename(csvPath).replace('.csv', '.xlsx'));
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(xlsxPath);
      return wb;
    };

    it('generates unique table names even when sheet names collide after truncation', async () => {
      // Two object names that share their first 25 characters would collapse to the same
      // truncated table name. Excel flags duplicate table names as unreadable content.
      const aliasA = 'Really_Long_Custom_Object_Alpha__c';
      const aliasB = 'Really_Long_Custom_Object_Beta__c';
      const csvA = path.join(tmpDir, 'a.csv');
      const csvB = path.join(tmpDir, 'b.csv');
      await fs.writeFile(csvA, 'API Name,Label\nName,Name\n');
      await fs.writeFile(csvB, 'API Name,Label\nName,Name\n');
      const outPath = path.join(tmpDir, 'multi.csv');
      await createXlsxFromCsvFiles([csvA, csvB], outPath, {
        worksheetNames: { [csvA]: aliasA.substring(0, 31), [csvB]: aliasB.substring(0, 31) },
      });
      const wb = await readWorkbook(outPath);
      const tableNames: string[] = [];
      for (const ws of wb.worksheets) {
        for (const table of Object.values((ws as any).tables ?? {})) {
          tableNames.push((table as any).name);
        }
      }
      expect(tableNames.length).to.equal(2);
      expect(new Set(tableNames).size).to.equal(tableNames.length);
    });

    it('sizes row height from content instead of forcing the max on every row', async () => {
      const csvPath = path.join(tmpDir, 'heights.csv');
      const shortValue = 'A; B; C';
      const longValue = Array.from({ length: 80 }, (_, i) => `Value_${i}`).join('; ');
      await fs.writeFile(
        csvPath,
        `API Name,Picklist Values\nShort,${shortValue}\nLong,${longValue}\nEmpty,\n`
      );
      await createXlsxFromCsvFiles([csvPath], csvPath, {
        columnsCustomStyles: { 'picklist values': { wrap: true, width: 45, maxHeight: 150 } },
      });
      const wb = await readWorkbook(csvPath);
      const ws = wb.worksheets[0];
      const shortHeight = ws.getRow(2).height;
      const longHeight = ws.getRow(3).height;
      const emptyHeight = ws.getRow(4).height;
      // Short content keeps a small height, long content is capped at maxHeight, empty stays default
      expect(longHeight).to.equal(150);
      expect(shortHeight === undefined || shortHeight < longHeight).to.equal(true);
      expect(emptyHeight === undefined || emptyHeight < (longHeight as number)).to.equal(true);
    });

    it('keeps a forced-text column as text and right-aligned', async () => {
      const csvPath = path.join(tmpDir, 'lenprec.csv');
      // "18,2" is precision,scale and must not be read as a number; "255" is a length.
      await fs.writeFile(csvPath, 'API Name,Length/Precision\nAmount,"18,2"\nName,255\n');
      await createXlsxFromCsvFiles([csvPath], csvPath, {
        forceTextColumns: ['Length/Precision'],
        columnsCustomStyles: { 'length/precision': { horizontalAlignment: 'right' } },
      });
      const wb = await readWorkbook(csvPath);
      const ws = wb.worksheets[0];
      const composite = ws.getCell(2, 2);
      const length = ws.getCell(3, 2);
      expect(composite.value).to.equal('18,2');
      expect(typeof composite.value).to.equal('string');
      expect(length.value).to.equal('255');
      expect(typeof length.value).to.equal('string');
      expect(composite.alignment?.horizontal).to.equal('right');
      expect(length.alignment?.horizontal).to.equal('right');
    });

    it('top-aligns multi-line cells and middle-aligns single-line cells', async () => {
      const csvPath = path.join(tmpDir, 'valign.csv');
      const longValue = Array.from({ length: 80 }, (_, i) => `Value_${i}`).join('; ');
      await fs.writeFile(csvPath, `API Name,Picklist Values\nBig,"${longValue}"\nSmall,"Yes; No"\n`);
      await createXlsxFromCsvFiles([csvPath], csvPath, {
        columnsCustomStyles: { 'picklist values': { wrap: true, width: 45, maxHeight: 150, verticalAlignment: 'top' } },
      });
      const wb = await readWorkbook(csvPath);
      const multiLine = wb.worksheets[0].getCell(2, 2);
      const singleLine = wb.worksheets[0].getCell(3, 2);
      expect(multiLine.alignment?.vertical).to.equal('top');
      expect(multiLine.alignment?.wrapText).to.equal(true);
      expect(singleLine.alignment?.vertical).to.equal('middle');
    });

    it('runs postProcessWorkbook with the final worksheet names before writing', async () => {
      const csvPath = path.join(tmpDir, 'hook.csv');
      await fs.writeFile(csvPath, 'API Name,Label\nName,Name\n');
      let seenNames: Record<string, string> | null = null;
      await createXlsxFromCsvFiles([csvPath], csvPath, {
        worksheetNames: { [csvPath]: 'Index' },
        postProcessWorkbook: (workbook, context) => {
          seenNames = context.worksheetNameByCsvFile;
          workbook.getWorksheet('Index')!.getCell('A4').value = {
            text: 'Back to Index',
            hyperlink: "#'Index'!A1",
          };
        },
      });
      expect(seenNames).to.deep.equal({ [csvPath]: 'Index' });
      const wb = await readWorkbook(csvPath);
      const cell = wb.getWorksheet('Index')!.getCell('A4');
      expect((cell.value as any).hyperlink).to.equal("#'Index'!A1");
    });
  });
});
