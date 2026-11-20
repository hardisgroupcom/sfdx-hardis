// Picklist values as the local sources describe them: the value set of a custom field, a global
// value set or a standard value set.
import * as path from 'path';
import { globMetadataInPackageDirectories } from './projectUtils.js';
import { parseXmlFile } from './xmlUtils.js';

export type PicklistMetadataType = 'CustomField' | 'GlobalValueSet' | 'StandardValueSet';

export interface PicklistValueInSources {
  // The metadata that holds the value: a field that uses a global value set gives the global value set
  metadataType: PicklistMetadataType;
  metadataFullName: string;
  apiName: string;
  label: string;
  file: string;
}

/**
 * The value with this label in the local sources of a field (Object.Field) or of a value set (Name),
 * or null when the sources do not have it. Never throws.
 */
export async function findPicklistValueByLabel(componentName: string, label: string, cwd = process.cwd()): Promise<PicklistValueInSources | null> {
  const name = (componentName || '').trim();
  const wantedLabel = (label || '').trim();
  if (name === '' || wantedLabel === '') {
    return null;
  }
  try {
    if (name.includes('.')) {
      return await findInCustomField(name, wantedLabel, cwd);
    }
    return (
      (await findInValueSet('GlobalValueSet', name, wantedLabel, cwd)) ||
      (await findInValueSet('StandardValueSet', name, wantedLabel, cwd))
    );
  } catch {
    return null;
  }
}

async function findInCustomField(fieldName: string, label: string, cwd: string): Promise<PicklistValueInSources | null> {
  const [objectName, ...fieldParts] = fieldName.split('.');
  const file = await findSourceFile(`**/objects/${objectName}/fields/${fieldParts.join('.')}.field-meta.xml`, cwd);
  if (!file) {
    return null;
  }
  const valueSet = (await parseXmlFile(path.join(cwd, file)))?.CustomField?.valueSet?.[0];
  const globalValueSetName = valueSet?.valueSetName?.[0];
  if (globalValueSetName) {
    // The values live in the global value set, renamed there
    return await findInValueSet('GlobalValueSet', String(globalValueSetName), label, cwd);
  }
  return findValue(valueSet?.valueSetDefinition?.[0]?.value, label, { metadataType: 'CustomField', metadataFullName: fieldName, file });
}

async function findInValueSet(metadataType: 'GlobalValueSet' | 'StandardValueSet', name: string, label: string, cwd: string): Promise<PicklistValueInSources | null> {
  const folder = metadataType === 'GlobalValueSet' ? 'globalValueSets' : 'standardValueSets';
  const suffix = metadataType === 'GlobalValueSet' ? 'globalValueSet' : 'standardValueSet';
  const file = await findSourceFile(`**/${folder}/${name}.${suffix}-meta.xml`, cwd);
  if (!file) {
    return null;
  }
  const root = (await parseXmlFile(path.join(cwd, file)))?.[metadataType];
  const values = metadataType === 'GlobalValueSet' ? root?.customValue : root?.standardValue;
  return findValue(values, label, { metadataType, metadataFullName: name, file });
}

async function findSourceFile(pattern: string, cwd: string): Promise<string | null> {
  const files = await globMetadataInPackageDirectories(pattern, cwd);
  return files.length > 0 ? files.sort()[0] : null;
}

function findValue(
  values: any[] | undefined,
  label: string,
  holder: { metadataType: PicklistMetadataType; metadataFullName: string; file: string }
): PicklistValueInSources | null {
  for (const value of values || []) {
    const apiName = decodeApiName(String(value?.fullName?.[0] ?? '').trim());
    // A value without a label element shows its API name as label
    const valueLabel = String(value?.label?.[0] ?? apiName).trim();
    if (apiName !== '' && valueLabel === label) {
      return { ...holder, apiName, label: valueLabel };
    }
  }
  return null;
}

// The source format encodes some characters of a value's API name (%2C for a comma...)
function decodeApiName(fullName: string): string {
  try {
    return decodeURIComponent(fullName);
  } catch {
    return fullName;
  }
}
