import { Connection } from '@salesforce/core';

export type WhatWillBreakCheckKey =
  | 'idleRefreshTokens'
  | 'refreshTokenCadence'
  | 'deviceFlow'
  | 'soapLoginPermission'
  | 'soapLoginIpRange'
  | 'soapLoginInactivity'
  | 'usernamePasswordFlow'
  | 'sfConnectLegacyAuth'
  | 'soapLoginRetirement'
  | 'legacyApiVersions'
  | 'releaseUpdates'
  | 'connectedAppsToEca';

export type WhatWillBreakFamily = 'auth' | 'apiVersions' | 'releaseUpdates' | 'connectedApps';

// A check key, or a Salesforce date of a check that covers several of them
export type WhatWillBreakDeadlineKey = WhatWillBreakCheckKey | 'legacyApiRetired';

export type WhatWillBreakSeverity = 'success' | 'info' | 'warning' | 'error';

export interface WhatWillBreakDeadline {
  // Empty when every finding has its own date (release updates)
  productionDate: string;
  sandboxDate?: string;
  // Salesforce gives a release, not a day: the date is only used to compute the severity
  releaseLabel?: string;
  // The change is already enforced and keeps acting every day (findings are warnings, not errors)
  rolling?: boolean;
  articleUrl: string;
  // Anchor of the "How to fix" section of this check on the doc page
  fixAnchor: string;
}

// One finding of a check, in the check's own report
export interface WhatWillBreakDetailRow {
  Check: string;
  CheckKey: WhatWillBreakCheckKey;
  Severity: WhatWillBreakSeverity;
  Deadline: string;
  Item: string;
  Details: string;
  LastSeen: string;
  Count: number | string;
  Recommendation: string;
  HowToFix: string;
  Article: string;
}

// One row of the main report: something that will break, or a check that found nothing
export interface WhatWillBreakMainRow {
  Status: string;
  Check: string;
  'What will break': string;
  Date: string;
  'What to do': string;
  'Salesforce announcement': string;
  'How to fix': string;
  Count: number | string;
  'Detail report': string;
  CheckKey: WhatWillBreakCheckKey;
  Severity: WhatWillBreakSeverity | 'notChecked';
}

// A main report row and its date (YYYY-MM-DD, or empty), to sort the earliest first
export interface WhatWillBreakDatedMainRow {
  row: WhatWillBreakMainRow;
  date: string;
}

export interface WhatWillBreakCheckResult {
  key: WhatWillBreakCheckKey;
  status: WhatWillBreakSeverity;
  title: string;
  detail: string;
  deadline: string;
  howToFixUrl: string;
  rows: WhatWillBreakDetailRow[];
  // true when the check could not run on this org (missing object or permission)
  notChecked?: boolean;
  // undefined when the check could not run on this org: no metric is sent then
  metric?: number;
  // Main report rows built by the check itself, when it covers several dates (one row per release update...)
  mainRows?: WhatWillBreakDatedMainRow[];
  // Names to list in the main report row (app names: never usernames, which the anonymization cannot reach there)
  impactItems?: string[];
  // Rows of the check's own report when they are not detail rows (release update records...)
  detailReportRows?: any[];
  detailReportTitle?: string;
  // Report files the check already wrote itself (legacy API calls)
  reportFiles?: string[];
}

export interface WhatWillBreakOptions {
  conn: Connection;
  checks: WhatWillBreakCheckKey[];
  lookbackDays: number;
  idleWarningDays: number;
  ignoreUsers: string[];
  today?: Date;
  // Command instance, for the logs and report messages of the checks that have their own reports
  commandThis?: any;
  debugMode?: boolean;
}

export interface WhatWillBreakResult {
  checks: WhatWillBreakCheckResult[];
  metrics: Record<string, number>;
  severity: 'error' | 'warning' | 'log';
  isSandbox: boolean;
}

export interface LoginContext {
  failed: boolean;
  records: any[];
  usernameById: Map<string, string>;
  activeUserIds: Set<string>;
}

export interface CheckContext {
  conn: Connection;
  today: Date;
  isSandbox: boolean;
  lookbackDays: number;
  idleWarningDays: number;
  ignoreSet: Set<string>;
  // Filled by loadLoginHistory, only when a selected check needs the logins
  logins: LoginContext;
  commandThis?: any;
  debugMode?: boolean;
}
