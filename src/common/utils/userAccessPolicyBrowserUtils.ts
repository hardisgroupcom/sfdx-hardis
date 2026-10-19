import { Connection, Org } from '@salesforce/core';
import c from 'chalk';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import { uxLog } from './index.js';
import { soqlQuery } from './apiUtils.js';
import { getChromeExecutablePath } from './orgConfigUtils.js';
import { t } from './i18n.js';
import type { UserAccessPolicyRecord } from '../actionsProvider/userAccessPolicyAction.js';

// The classic page behind Setup > User Access Policies > policy > Preview Users.
// Its buttons keep the same id whatever the language of the user.
export const APPLY_TO_ALL_BUTTON_SELECTOR = '#apply_policy_btn';
const PAGE_TIMEOUT_MS = 60000;
// Salesforce writes a UserAccessChange row once the policy has run for the users
const APPLY_CONFIRM_TIMEOUT_MINUTES = 5;
const APPLY_CONFIRM_POLL_INTERVAL_MS = 10000;

export interface ApplyToAllUsersResult {
  success: boolean;
  outputLines: string[];
}

/**
 * Clicks "Apply To All" for each policy, then waits until Salesforce records the run.
 * One browser serves all the policies, and it is always closed.
 */
export async function applyUserAccessPoliciesToAllUsers(
  conn: Connection,
  policies: UserAccessPolicyRecord[]
): Promise<ApplyToAllUsersResult> {
  const outputLines: string[] = [];
  let browser: Browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true,
      executablePath: getChromeExecutablePath(),
    });
  } catch (e: any) {
    const message = t('userAccessPolicyBrowserError', { name: policies.map((p) => p.DeveloperName).join(', '), message: e.message });
    uxLog('error', this, c.red(`[DeploymentActions] ${message}`));
    uxLog('error', this, c.red(t('youMightNeedToSetThePuppeteerexecutablepath')));
    return { success: false, outputLines: [message, t('youMightNeedToSetThePuppeteerexecutablepath')] };
  }
  try {
    const page = await browser.newPage();
    // Apply To All asks no confirmation today: accept one if Salesforce adds it, rather than wait for nothing
    page.on('dialog', (dialog) => dialog.accept().catch(() => undefined));
    for (const policy of policies) {
      const failure = await applyPolicyToAllUsers(page, conn, policy);
      if (failure) {
        uxLog('error', this, c.red(`[DeploymentActions] ${failure}`));
        outputLines.push(failure);
        return { success: false, outputLines };
      }
      const message = t('userAccessPolicyAppliedToAll', { name: policy.DeveloperName });
      uxLog('log', this, c.green(`[DeploymentActions] ${message}`));
      outputLines.push(message);
    }
    return { success: true, outputLines };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * One-time login URL that opens the given path of the org, the one sf org open uses. It works on orgs
 * that refuse a frontdoor.jsp?sid= login, and the session is refreshed first: the endpoint answers an
 * expired one with a 403 that jsforce does not refresh by itself.
 */
export async function getSingleAccessUrl(conn: Connection, redirectPath: string): Promise<string> {
  const org = await Org.create({ connection: conn });
  return org.getFrontDoorUrl(redirectPath);
}

/** Removes the one-time login token or session id a URL can carry, before a message is logged. */
export function scrubLoginSecrets(message: string): string {
  return String(message || '').replace(/(otp|sid)=[^&\s'"]+/g, '$1=[redacted]');
}

/** Path of the classic page listing the users of a policy, with its Apply To All button. */
export function buildApplyPolicyPath(policyId: string): string {
  return `/005?id=${policyId.substring(0, 15)}&isUserEntityOverride=1`;
}

// Returns the failure message, or null when Salesforce recorded the run
async function applyPolicyToAllUsers(page: Page, conn: Connection, policy: UserAccessPolicyRecord): Promise<string | null> {
  const name = policy.DeveloperName;
  uxLog('log', this, c.grey(`[DeploymentActions] ${t('userAccessPolicyApplyingToAll', { name })}`));
  try {
    const previousRunDate = await findLatestRunDate(conn, policy.Id);
    const loginUrl = await getSingleAccessUrl(conn, buildApplyPolicyPath(policy.Id));
    await page.goto(loginUrl, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });
    const button = await page
      .waitForSelector(APPLY_TO_ALL_BUTTON_SELECTOR, { visible: true, timeout: PAGE_TIMEOUT_MS })
      .catch(() => null);
    if (!button) {
      return t('userAccessPolicyApplyButtonNotFound', { name });
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: PAGE_TIMEOUT_MS }).catch(() => null),
      button.click(),
    ]);
    const confirmed = await waitForNewRun(conn, policy.Id, previousRunDate);
    return confirmed ? null : t('userAccessPolicyApplyNotConfirmed', { name, minutes: APPLY_CONFIRM_TIMEOUT_MINUTES });
  } catch (e: any) {
    return t('userAccessPolicyBrowserError', { name, message: scrubLoginSecrets(e?.message || String(e)) });
  }
}

async function findLatestRunDate(conn: Connection, policyId: string): Promise<string | null> {
  const ids = [policyId.substring(0, 15), policyId].map((id) => `'${id}'`).join(',');
  const result = await soqlQuery(
    `SELECT CreatedDate FROM UserAccessChange WHERE Source IN (${ids}) ORDER BY CreatedDate DESC LIMIT 1`,
    conn
  );
  return result.records?.[0]?.CreatedDate || null;
}

async function waitForNewRun(conn: Connection, policyId: string, previousRunDate: string | null): Promise<boolean> {
  const deadline = Date.now() + APPLY_CONFIRM_TIMEOUT_MINUTES * 60 * 1000;
  while (Date.now() < deadline) {
    const latestRunDate = await findLatestRunDate(conn, policyId);
    if (latestRunDate && latestRunDate !== previousRunDate) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, APPLY_CONFIRM_POLL_INTERVAL_MS));
  }
  return false;
}
