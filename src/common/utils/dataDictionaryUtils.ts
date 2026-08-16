import path from 'path';
import fs from 'fs-extra';
import Papa from 'papaparse';
import { Connection } from '@salesforce/core';
import c from 'chalk';
import { uxLog } from './index.js';
import { soqlQuery } from './apiUtils.js';
import {
  createXlsxFromCsvFiles,
  ExcelColumnStyle,
  generateReportPath,
} from './filesUtils.js';
import { t } from './i18n.js';

// Picklists with hundreds of values would produce unreadable cells: cap the listing and flag the overflow.
export const MAX_PICKLIST_VALUES_IN_CELL = 50;

export interface ObjectDataDictionary {
  apiName: string;
  label: string;
  custom: boolean;
  keyPrefix: string;
  fields: Record<string, string>[];
}

const NUMERIC_FIELD_TYPES = new Set(['currency', 'double', 'int', 'percent', 'long']);

const yesNo = (value: boolean): string => (value ? 'Yes' : 'No');

// A custom API name is "local" (not from a managed package) when it carries exactly one "__"
// separator (the suffix, e.g. "__c"). Managed components add a namespace prefix, which produces a
// second "__" (e.g. "ns__Field__c"). Standard names carry none.
export function isLocallyCustomApiName(apiName: string): boolean {
  return ((apiName || '').match(/__/g) || []).length === 1;
}

// An object has local customizations when it is itself a local custom object, or when it carries at
// least one local custom field. Standard objects without custom fields and managed package objects
// without local custom fields return false.
export function hasLocalCustomizations(dict: ObjectDataDictionary): boolean {
  if (dict.custom === true && isLocallyCustomApiName(dict.apiName)) {
    return true;
  }
  return dict.fields.some(
    (field) => field['Custom'] === 'Yes' && isLocallyCustomApiName(field['API Name'] || '')
  );
}

export function formatPicklistValues(field: any): string {
  const values = Array.isArray(field?.picklistValues) ? field.picklistValues : [];
  const activeValues = values
    .filter((entry: any) => entry?.active !== false)
    .map((entry: any) => entry?.value)
    .filter((value: any) => typeof value === 'string' && value.length > 0);
  if (activeValues.length === 0) {
    return '';
  }
  if (activeValues.length > MAX_PICKLIST_VALUES_IN_CELL) {
    const shown = activeValues.slice(0, MAX_PICKLIST_VALUES_IN_CELL);
    const remaining = activeValues.length - MAX_PICKLIST_VALUES_IN_CELL;
    return `${shown.join('; ')} (+${remaining} more)`;
  }
  return activeValues.join('; ');
}

function formatLengthPrecision(field: any): string {
  const type = (field?.type || '').toLowerCase();
  if (NUMERIC_FIELD_TYPES.has(type)) {
    return `${field.precision ?? ''},${field.scale ?? ''}`;
  }
  return field?.length ? String(field.length) : '';
}

// Maps the technical describe type (e.g. "reference", "int") to the Salesforce field type as named
// in metadata / Setup (e.g. "Lookup", "MasterDetail", "Number"). Formula and roll-up summary fields
// keep their return type but are tagged accordingly.
export function formatFieldType(field: any): string {
  const type = (field?.type || '').toLowerCase();
  let base: string;
  switch (type) {
    case 'string':
      base = field?.autoNumber === true ? 'AutoNumber' : 'Text';
      break;
    case 'textarea':
      if (field?.htmlFormatted === true || (field?.extraTypeInfo || '').toLowerCase() === 'richtextarea') {
        base = 'Html';
      } else if (typeof field?.length === 'number' && field.length > 255) {
        base = 'LongTextArea';
      } else {
        base = 'TextArea';
      }
      break;
    case 'int':
    case 'double':
    case 'long':
      base = 'Number';
      break;
    case 'currency':
      base = 'Currency';
      break;
    case 'percent':
      base = 'Percent';
      break;
    case 'boolean':
      base = 'Checkbox';
      break;
    case 'date':
      base = 'Date';
      break;
    case 'datetime':
      base = 'DateTime';
      break;
    case 'time':
      base = 'Time';
      break;
    case 'email':
      base = 'Email';
      break;
    case 'phone':
      base = 'Phone';
      break;
    case 'url':
      base = 'Url';
      break;
    case 'picklist':
    case 'combobox':
      base = 'Picklist';
      break;
    case 'multipicklist':
      base = 'MultiselectPicklist';
      break;
    case 'reference':
      // relationshipOrder is 0/1 on master-detail fields and null on lookups.
      base =
        field?.relationshipOrder !== null && field?.relationshipOrder !== undefined ? 'MasterDetail' : 'Lookup';
      break;
    case 'encryptedstring':
      base = 'EncryptedText';
      break;
    case 'location':
      base = 'Location';
      break;
    case 'address':
      base = 'Address';
      break;
    case 'base64':
      base = 'Base64';
      break;
    case 'id':
      base = 'Id';
      break;
    case 'anytype':
      base = 'AnyType';
      break;
    case 'datacategorygroupreference':
      base = 'DataCategoryGroupReference';
      break;
    default:
      base = field?.type || '';
  }
  if (field?.calculatedFormula) {
    return `Formula (${base})`;
  }
  // Roll-up summary fields are calculated but carry no user formula.
  if (field?.calculated === true && type !== 'reference') {
    return `Roll-Up Summary (${base})`;
  }
  return base;
}

function formatReferenceTo(field: any): string {
  const references = Array.isArray(field?.referenceTo) ? field.referenceTo : [];
  if (references.length === 0) {
    return '';
  }
  const joined = references.join(', ');
  return field?.relationshipName ? `${joined} (${field.relationshipName})` : joined;
}

function formatDefaultValue(field: any): string {
  if (field?.defaultValueFormula) {
    return String(field.defaultValueFormula);
  }
  if (field?.defaultValue !== null && field?.defaultValue !== undefined && field?.defaultValue !== '') {
    return String(field.defaultValue);
  }
  return '';
}

function buildFieldRow(field: any): Record<string, string> {
  return {
    'API Name': field?.name || '',
    'Label': field?.label || '',
    'Type': formatFieldType(field),
    'Required': yesNo(field?.nillable === false),
    'Unique': yesNo(field?.unique === true),
    'External ID': yesNo(field?.externalId === true),
    'Length/Precision': formatLengthPrecision(field),
    'Reference To': formatReferenceTo(field),
    'Picklist Values': formatPicklistValues(field),
    'Default Value': formatDefaultValue(field),
    'Formula': field?.calculatedFormula || '',
    'Help Text': field?.inlineHelpText || '',
    'Description': field?.description || '',
    'Custom': yesNo(field?.custom === true),
  };
}

export async function collectObjectDictionary(
  conn: Connection,
  objectName: string,
  commandThis: any
): Promise<ObjectDataDictionary | null> {
  try {
    const describeResult: any = await conn.describe(objectName);
    const fields = (Array.isArray(describeResult?.fields) ? describeResult.fields : [])
      .map((field: any) => buildFieldRow(field))
      .sort((a: Record<string, string>, b: Record<string, string>) =>
        (a['API Name'] || '').localeCompare(b['API Name'] || '')
      );
    return {
      apiName: describeResult?.name || objectName,
      label: describeResult?.label || objectName,
      custom: describeResult?.custom === true,
      keyPrefix: describeResult?.keyPrefix || '',
      fields,
    };
  } catch (e) {
    uxLog('warning', commandThis, c.yellow(t('unableToDescribeObject', { sObjectName: objectName })));
    uxLog('other', commandThis, c.grey((e as Error).message));
    return null;
  }
}

export async function fetchValidationRules(
  conn: Connection,
  objectNames: string[],
  commandThis: any
): Promise<Record<string, string>[]> {
  if (objectNames.length === 0) {
    return [];
  }
  const objectSet = new Set(objectNames);
  try {
    const listResult = await conn.metadata.list([{ type: 'ValidationRule' }]);
    const fullNames = (Array.isArray(listResult) ? listResult : [])
      .map((item: any) => item?.fullName)
      .filter((fullName: any) => typeof fullName === 'string' && fullName.includes('.'))
      .filter((fullName: string) => objectSet.has(fullName.substring(0, fullName.indexOf('.'))));
    const rows: Record<string, string>[] = [];
    for (let i = 0; i < fullNames.length; i += 10) {
      const batch = fullNames.slice(i, i + 10);
      const readResult = await conn.metadata.read('ValidationRule', batch);
      const rules = Array.isArray(readResult) ? readResult : [readResult];
      for (const rule of rules) {
        const fullName: string = (rule as any)?.fullName || '';
        if (!fullName.includes('.')) {
          continue;
        }
        rows.push({
          'Object': fullName.substring(0, fullName.indexOf('.')),
          'Name': fullName.substring(fullName.indexOf('.') + 1),
          'Active': yesNo((rule as any)?.active === true || (rule as any)?.active === 'true'),
          'Error Message': (rule as any)?.errorMessage || '',
          'Error Location': (rule as any)?.errorDisplayField || '',
          'Formula': (rule as any)?.errorConditionFormula || '',
          'Description': (rule as any)?.description || '',
        });
      }
    }
    return rows;
  } catch (e) {
    uxLog('warning', commandThis, c.yellow(t('unableToRetrieveValidationRules', { error: (e as Error).message })));
    return [];
  }
}

export async function fetchRecordTypes(
  conn: Connection,
  objectNames: string[],
  commandThis: any
): Promise<Record<string, string>[]> {
  if (objectNames.length === 0) {
    return [];
  }
  const inClause = objectNames.map((name) => `'${name.replace(/'/g, "\\'")}'`).join(',');
  const query = `SELECT DeveloperName, Name, IsActive, Description, SobjectType FROM RecordType WHERE SobjectType IN (${inClause}) ORDER BY SobjectType, DeveloperName`;
  try {
    const result = await soqlQuery(query, conn);
    return (result?.records || []).map((record: any) => ({
      'Object': record?.SobjectType || '',
      'Developer Name': record?.DeveloperName || '',
      'Label': record?.Name || '',
      'Active': yesNo(record?.IsActive === true),
      'Description': record?.Description || '',
    }));
  } catch (e) {
    uxLog('warning', commandThis, c.yellow(t('unableToRetrieveRecordTypes', { error: (e as Error).message })));
    return [];
  }
}

// Blue underlined style matching Excel's default hyperlink look.
const HYPERLINK_FONT = { color: { argb: 'FF0563C1' }, underline: true };

// Adds in-workbook navigation: from the Index sheet to each object / Validation Rules / Record Types
// sheet, and a "Back to Index" link below every other sheet. Runs after the workbook is built so it
// can resolve the final (truncated and de-duplicated) worksheet names.
function addDataDictionaryNavigation(
  workbook: any,
  worksheetNameByCsvFile: Record<string, string>,
  nav: {
    indexPath: string;
    objectCsvByApiName: Record<string, string>;
    vrPath: string | null;
    rtPath: string | null;
  }
): void {
  const indexName = worksheetNameByCsvFile[nav.indexPath];
  const indexWs = indexName ? workbook.getWorksheet(indexName) : null;

  const linkCell = (cell: any, sheetName: string) => {
    if (!cell || !sheetName) {
      return;
    }
    const text = (cell.text ?? cell.value ?? '').toString();
    cell.value = { text, hyperlink: `#'${sheetName}'!A1` };
    cell.font = { ...(cell.font || {}), ...HYPERLINK_FONT };
  };

  // The count columns hold numbers; keep them right-aligned even after a count cell is turned into a
  // hyperlink (which stores it as text and would otherwise left-align it).
  const rightAlign = (cell: any) => {
    if (cell) {
      cell.alignment = { ...(cell.alignment || {}), horizontal: 'right' };
    }
  };

  if (indexWs) {
    const headerRow = indexWs.getRow(1);
    const columnByHeader: Record<string, number> = {};
    headerRow.eachCell((cell: any, colNumber: number) => {
      columnByHeader[(cell.text ?? cell.value ?? '').toString().trim()] = colNumber;
    });
    const apiNameCol = columnByHeader['API Name'];
    const fieldsCol = columnByHeader['Fields'];
    const vrCol = columnByHeader['Validation Rules'];
    const rtCol = columnByHeader['Record Types'];
    const vrName = nav.vrPath ? worksheetNameByCsvFile[nav.vrPath] : null;
    const rtName = nav.rtPath ? worksheetNameByCsvFile[nav.rtPath] : null;

    for (let rowNumber = 2; rowNumber <= indexWs.rowCount; rowNumber++) {
      const row = indexWs.getRow(rowNumber);
      if (apiNameCol) {
        const cell = row.getCell(apiNameCol);
        const apiName = (cell.text ?? cell.value ?? '').toString().trim();
        const targetCsv = nav.objectCsvByApiName[apiName];
        const targetName = targetCsv ? worksheetNameByCsvFile[targetCsv] : null;
        if (targetName) {
          linkCell(cell, targetName);
        }
      }
      if (fieldsCol) {
        rightAlign(row.getCell(fieldsCol));
      }
      if (vrCol) {
        if (vrName) {
          linkCell(row.getCell(vrCol), vrName);
        }
        rightAlign(row.getCell(vrCol));
      }
      if (rtCol) {
        if (rtName) {
          linkCell(row.getCell(rtCol), rtName);
        }
        rightAlign(row.getCell(rtCol));
      }
    }
  }

  // "Back to Index" link a couple of rows below the data of every other sheet.
  if (indexName) {
    workbook.eachSheet((sheet: any) => {
      if (sheet.name === indexName) {
        return;
      }
      const backCell = sheet.getCell(`A${sheet.rowCount + 2}`);
      backCell.value = { text: 'Back to Index', hyperlink: `#'${indexName}'!A1` };
      backCell.font = { ...HYPERLINK_FONT };
    });
  }
}

export async function writeDataDictionaryReports(
  commandThis: any,
  objectDicts: ObjectDataDictionary[],
  validationRules: Record<string, string>[],
  recordTypes: Record<string, string>[],
  outputFile: string | null
): Promise<any[]> {
  const reportFiles: any[] = [];
  const csvFiles: string[] = [];
  const worksheetNames: Record<string, string> = {};
  // Track which CSV file backs each navigation target so the workbook post-processor can turn
  // Index cells into internal hyperlinks once the final (truncated/de-duplicated) sheet names are known.
  const objectCsvByApiName: Record<string, string> = {};
  let vrPath: string | null = null;
  let rtPath: string | null = null;

  const validationRulesByObject = countByObject(validationRules);
  const recordTypesByObject = countByObject(recordTypes);

  // Index sheet
  const indexRows = objectDicts.map((dict) => ({
    'API Name': dict.apiName,
    'Label': dict.label,
    'Fields': String(dict.fields.length),
    'Validation Rules': String(validationRulesByObject[dict.apiName] || 0),
    'Record Types': String(recordTypesByObject[dict.apiName] || 0),
    'Custom': yesNo(dict.custom),
    'Key Prefix': dict.keyPrefix,
  }));
  const indexPath = await generateReportPath('data-dictionary-index', '', { withDate: true });
  await writeSheetCsv(indexRows, indexPath);
  worksheetNames[indexPath] = 'Index';
  csvFiles.push(indexPath);
  reportFiles.push({ type: 'csv', file: indexPath });

  // One fields sheet per object
  for (const dict of objectDicts) {
    if (dict.fields.length === 0) {
      continue;
    }
    const fieldsPath = await generateReportPath(`data-dictionary-${dict.apiName}`, '', { withDate: true });
    await writeSheetCsv(dict.fields, fieldsPath);
    worksheetNames[fieldsPath] = dict.apiName;
    objectCsvByApiName[dict.apiName] = fieldsPath;
    csvFiles.push(fieldsPath);
    reportFiles.push({ type: 'csv', file: fieldsPath });
  }

  // Consolidated Validation Rules sheet
  if (validationRules.length > 0) {
    vrPath = await generateReportPath('data-dictionary-validation-rules', '', { withDate: true });
    await writeSheetCsv(validationRules, vrPath);
    worksheetNames[vrPath] = 'Validation Rules';
    csvFiles.push(vrPath);
    reportFiles.push({ type: 'csv', file: vrPath });
  }

  // Consolidated Record Types sheet
  if (recordTypes.length > 0) {
    rtPath = await generateReportPath('data-dictionary-record-types', '', { withDate: true });
    await writeSheetCsv(recordTypes, rtPath);
    worksheetNames[rtPath] = 'Record Types';
    csvFiles.push(rtPath);
    reportFiles.push({ type: 'csv', file: rtPath });
  }

  const consolidatedBase =
    outputFile || (await generateReportPath('data-dictionary', '', { withDate: true }));
  // Wrapped columns are capped in height, so top-align them: when the content is taller than the cap
  // and gets truncated, the first line stays visible instead of the middle/bottom.
  const columnsCustomStyles: Record<string, ExcelColumnStyle> = {
    'picklist values': { wrap: true, width: 45, maxHeight: 150, verticalAlignment: 'top' },
    'formula': { wrap: true, width: 45, maxHeight: 150, verticalAlignment: 'top' },
    'description': { wrap: true, width: 45, maxHeight: 150, verticalAlignment: 'top' },
    'help text': { wrap: true, width: 35, maxHeight: 120, verticalAlignment: 'top' },
    'error message': { wrap: true, width: 45, maxHeight: 120, verticalAlignment: 'top' },
    'reference to': { wrap: true, width: 25 },
    // Length/Precision holds composite values like "18,2" (precision,scale); keep it text so Excel
    // does not read it as a number, but right-align it so it still reads like numeric data.
    'length/precision': { horizontalAlignment: 'right' },
  };
  await createXlsxFromCsvFiles(csvFiles, consolidatedBase, {
    fileTitle: 'Data dictionary',
    worksheetNames,
    columnsCustomStyles,
    // The Index "Key Prefix" column holds leading-zero identifiers (e.g. "001") that must not be auto-typed.
    // "Length/Precision" holds values such as "18,2" that must stay text, not be coerced to numbers.
    forceTextColumns: ['Key Prefix', 'Length/Precision'],
    postProcessWorkbook: (workbook, context) =>
      addDataDictionaryNavigation(workbook, context.worksheetNameByCsvFile, {
        indexPath,
        objectCsvByApiName,
        vrPath,
        rtPath,
      }),
  });
  const consolidatedXlsx = path.join(
    path.dirname(consolidatedBase),
    'xls',
    path.basename(consolidatedBase).replace('.csv', '.xlsx')
  );
  reportFiles.push({ type: 'xlsx', file: consolidatedXlsx });

  return reportFiles;
}

// Write an intermediate CSV directly; these files are only consumed by createXlsxFromCsvFiles,
// so we skip generateCsvFile (which would log a misleading "no XLS generated" line per file).
async function writeSheetCsv(rows: Record<string, string>[], outputPath: string): Promise<void> {
  const csvContent = Papa.unparse(rows);
  await fs.writeFile(outputPath, csvContent, 'utf8');
}

function countByObject(rows: Record<string, string>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const objectName = row['Object'];
    if (!objectName) {
      continue;
    }
    counts[objectName] = (counts[objectName] || 0) + 1;
  }
  return counts;
}
