import { CONSTANTS } from '../../config/index.js';
import { t } from '../utils/i18n.js';
import { WhatWillBreakDeadline, WhatWillBreakDeadlineKey } from './whatWillBreakTypes.js';

// Salesforce dates of every change. When Salesforce moves a date, update it here only.
export const WHAT_WILL_BREAK_DEADLINES: Record<WhatWillBreakDeadlineKey, WhatWillBreakDeadline> = {
  idleRefreshTokens: {
    productionDate: '2026-11-04',
    sandboxDate: '2026-10-21',
    rolling: true,
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005461275&type=1',
    fixAnchor: 'fix-idle-refresh-tokens',
  },
  refreshTokenCadence: {
    productionDate: '2026-11-04',
    sandboxDate: '2026-10-21',
    rolling: true,
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005461275&type=1',
    fixAnchor: 'fix-refresh-token-cadence',
  },
  deviceFlow: {
    productionDate: '2026-11-30',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005461280&type=1',
    fixAnchor: 'fix-device-flow',
  },
  soapLoginPermission: {
    productionDate: '2026-12-01',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005132110&type=1',
    fixAnchor: 'fix-soap-login-permission',
  },
  soapLoginIpRange: {
    productionDate: '2027-01-31',
    sandboxDate: '2026-12-15',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005132110&type=1',
    fixAnchor: 'fix-soap-login-ip-range',
  },
  soapLoginInactivity: {
    productionDate: '2027-01-31',
    sandboxDate: '2026-12-15',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005132110&type=1',
    fixAnchor: 'fix-soap-login-inactivity',
  },
  usernamePasswordFlow: {
    productionDate: '2027-02-20',
    articleUrl:
      'https://help.salesforce.com/s/articleView?id=release-notes.rn_security_oauth_unpw.htm&release=264&type=5',
    fixAnchor: 'fix-username-password-flow',
  },
  sfConnectLegacyAuth: {
    productionDate: '2027-02-13',
    releaseLabel: "Spring '27",
    articleUrl:
      'https://help.salesforce.com/s/articleView?id=release-notes.rn_sf_connect_xorg_legacy_auth_retiring_ru.htm&release=264&type=5',
    fixAnchor: 'fix-salesforce-connect',
  },
  soapLoginRetirement: {
    productionDate: '2027-06-01',
    releaseLabel: "Summer '27",
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005132110&type=1',
    fixAnchor: 'fix-soap-login-retirement',
  },
  connectedAppsToEca: {
    productionDate: '2027-06-01',
    releaseLabel: "Summer '27",
    articleUrl: 'https://help.salesforce.com/s/articleView?id=xcloud.migrate_connected_app_to_external_client_app.htm&type=5',
    fixAnchor: 'fix-connected-apps-to-eca',
  },
  // API versions 31.0 to 40.0: deprecated in Summer '27, retired in Summer '28
  legacyApiVersions: {
    productionDate: '2028-06-01',
    releaseLabel: "Summer '28",
    articleUrl: 'https://help.salesforce.com/s/articleView?id=005321531&type=1',
    fixAnchor: 'fix-legacy-api-versions',
  },
  // API versions 30.0 and older: retired since Summer '25
  legacyApiRetired: {
    productionDate: '2025-06-14',
    releaseLabel: "Summer '25",
    articleUrl: 'https://help.salesforce.com/s/articleView?id=000389618&type=1',
    fixAnchor: 'fix-legacy-api-versions',
  },
  // Every release update has its own due date, read from the org
  releaseUpdates: {
    productionDate: '',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=sf.release_updates.htm&type=5',
    fixAnchor: 'fix-release-updates',
  },
};

export const WHAT_WILL_BREAK_DOC_URL = `${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-what-will-break/`;

// A finding becomes an error when its date is closer than this
export const WHAT_WILL_BREAK_ERROR_DAYS = 60;

const DAY_MS = 86400000;

// Severity of a finding of a check, from the time left before its date
export function getDeadlineSeverity(key: WhatWillBreakDeadlineKey, isSandbox: boolean, today: Date): 'error' | 'warning' {
  const deadline = WHAT_WILL_BREAK_DEADLINES[key];
  if (deadline.rolling) {
    return 'warning';
  }
  return getDateSeverity(getDeadlineDate(key, isSandbox), today);
}

// Human readable date of a check: "Enforced since 2026-11-04", "2026-12-01 (16 days left)", "Summer '27 (2027-06)"
export function getDeadlineLabel(key: WhatWillBreakDeadlineKey, isSandbox: boolean, today: Date): string {
  const date = getDeadlineDate(key, isSandbox);
  if (!date) {
    return t('whatWillBreakDateVaries');
  }
  return getDateLabel(date, today, WHAT_WILL_BREAK_DEADLINES[key].releaseLabel);
}

export function getDeadlineDate(key: WhatWillBreakDeadlineKey, isSandbox: boolean): string {
  const deadline = WHAT_WILL_BREAK_DEADLINES[key];
  return isSandbox && deadline.sandboxDate ? deadline.sandboxDate : deadline.productionDate;
}

// Severity of a dated finding: error when the date has passed or is less than WHAT_WILL_BREAK_ERROR_DAYS away
export function getDateSeverity(date: string, today: Date): 'error' | 'warning' {
  return getDaysLeft(date, today) <= WHAT_WILL_BREAK_ERROR_DAYS ? 'error' : 'warning';
}

// Label of a date (YYYY-MM-DD...), with the release name when Salesforce only gives a release
export function getDateLabel(date: string, today: Date, releaseLabel?: string): string {
  const day = date.substring(0, 10);
  if (getDaysLeft(day, today) <= 0) {
    return t('authRetirementsDeadlinePassed', { date: releaseLabel ? `${releaseLabel} (${day.substring(0, 7)})` : day });
  }
  if (releaseLabel) {
    return `${releaseLabel} (${day.substring(0, 7)})`;
  }
  return t('authRetirementsDeadlineIn', { date: day, days: getDaysLeft(day, today) });
}

// Link to the "How to fix" section of a check on the doc page
export function getFixDocUrl(key: WhatWillBreakDeadlineKey): string {
  return `${WHAT_WILL_BREAK_DOC_URL}#${WHAT_WILL_BREAK_DEADLINES[key].fixAnchor}`;
}

function getDaysLeft(date: string, today: Date): number {
  const day = new Date(`${date.substring(0, 10)}T00:00:00Z`);
  return Math.ceil((day.getTime() - today.getTime()) / DAY_MS);
}
