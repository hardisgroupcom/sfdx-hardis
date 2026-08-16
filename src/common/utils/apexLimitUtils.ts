/**
 * Apex character limit monitoring utilities.
 * Queries ApexClass and ApexTrigger
 * from Tooling API, excludes @isTest classes from the limit percentage.
 */

import { Connection } from '@salesforce/core';
import { soqlQueryTooling } from './apiUtils.js';
import { getEnvVar } from '../../config/index.js';

/** Default Apex character limit (6M for standard orgs; 3M/10M vary by edition) */
const DEFAULT_APEX_CHARACTER_LIMIT = 6_000_000;

/**
 * Return true if the Apex class is annotated with @isTest at class level.
 * Checks Body for @isTest before the class keyword (excluding comments).
 */
export function isTestClass(body: string | null | undefined): boolean {
  if (!body || typeof body !== 'string') {
    return false;
  }
  // Remove block comments /* ... */
  const bodyNoBlock = body.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove line comments // ...
  const bodyNoComments = bodyNoBlock.replace(/\/\/[^\n]*/g, '');
  // Find first "class " keyword
  const classMatch = bodyNoComments.match(/\bclass\s+\w+/i);
  if (!classMatch) {
    return false;
  }
  const matchIndex = bodyNoComments.indexOf(classMatch[0]);
  if (matchIndex === -1) return false;
  // Check if @isTest appears before the class keyword
  const beforeClass = bodyNoComments.substring(0, matchIndex);
  return /@isTest\b/i.test(beforeClass);
}

export interface ApexLimitUsage {
  used: number;
  max: number;
  percentUsed: number;
  totalClasses: number;
  totalTriggers: number;
  totalChars: number;
  classDetails: Array<{ id: string; name: string; length: number; isTest: boolean }>;
  triggerDetails: Array<{ id: string; name: string; length: number }>;
}

/**
 * Monitor Apex character usage: per-class/trigger length and overall limit percentage.
 * Queries ApexClass and ApexTrigger from Tooling API (custom only, NamespacePrefix = null).
 * Excludes @isTest classes from the limit percentage.
 */
export async function getApexCharacterLimitUsage(conn: Connection): Promise<ApexLimitUsage> {
  const apexLimit = Number(getEnvVar('APEX_CHARACTER_LIMIT') || DEFAULT_APEX_CHARACTER_LIMIT);

  const classesQuery = `
    SELECT Id, Name, LengthWithoutComments, Body
    FROM ApexClass
    WHERE NamespacePrefix = null
    ORDER BY LengthWithoutComments DESC
  `;
  const triggersQuery = `
    SELECT Id, Name, LengthWithoutComments
    FROM ApexTrigger
    WHERE NamespacePrefix = null
    ORDER BY LengthWithoutComments DESC
  `;

  const classesRes = await soqlQueryTooling(classesQuery.trim(), conn);
  const triggersRes = await soqlQueryTooling(triggersQuery.trim(), conn);

  const classes = classesRes.records || [];
  const triggers = triggersRes.records || [];

  const classDetails: ApexLimitUsage['classDetails'] = [];
  let totalClassesChars = 0;

  for (const record of classes) {
    const length = record.LengthWithoutComments != null ? Number(record.LengthWithoutComments) : 0;
    const isTest = isTestClass(record.Body);
    classDetails.push({
      id: record.Id,
      name: record.Name,
      length,
      isTest,
    });
    if (!isTest) {
      totalClassesChars += length;
    }
  }

  const triggerDetails: ApexLimitUsage['triggerDetails'] = [];
  let totalTriggersChars = 0;

  for (const record of triggers) {
    const length = record.LengthWithoutComments != null ? Number(record.LengthWithoutComments) : 0;
    triggerDetails.push({
      id: record.Id,
      name: record.Name,
      length,
    });
    totalTriggersChars += length;
  }

  const totalChars = totalClassesChars + totalTriggersChars;
  const percentUsed = apexLimit > 0 ? (totalChars / apexLimit) * 100 : 0;

  return {
    used: totalChars,
    max: apexLimit,
    percentUsed: Math.round(percentUsed * 100) / 100,
    totalClasses: classes.length,
    totalTriggers: triggers.length,
    totalChars,
    classDetails,
    triggerDetails,
  };
}
