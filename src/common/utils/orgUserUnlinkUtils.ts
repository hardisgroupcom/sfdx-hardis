import c from 'chalk';
import puppeteer, { Browser, Frame } from 'puppeteer-core';
import { uxLog } from './index.js';
import { getChromeExecutablePath } from './orgConfigUtils.js';
import { t } from './i18n.js';

export type UnlinkMethodKey = 'securityKey' | 'salesforceAuthenticator' | 'totp' | 'tempCode';

export interface UnlinkMethodSpec {
  key: UnlinkMethodKey;
  /*
   * Brand / spec tokens that Salesforce does NOT translate. The anchor finder
   * locates the row containing one of these tokens and clicks the link inside
   * it - this works regardless of the org's UI language.
   */
  sectionTextMarkers: string[];
  /*
   * Best-effort href fragment patterns - used only as a fallback when no row
   * marker matches. The exact internal Salesforce URLs are not publicly
   * documented; refine these regexes after observing a real Setup page.
   */
  hrefPatterns: RegExp[];
  labelKey: string;
}

export interface UnlinkTarget {
  username: string;
  userId: string | null;
  isActive: boolean;
  name?: string;
  preStatus: 'notFound' | 'inactive' | 'pending';
}

export interface UnlinkResultEntry {
  username: string;
  userId: string | null;
  status: 'unlinked' | 'notLinked' | 'notFound' | 'inactive' | 'error';
  methodsUnlinked: string[];
  methodsNotLinked: string[];
  message: string;
}

/*
 * Salesforce groups U2F and WebAuthn under a single "Security Key (U2F or WebAuthn)"
 * entry with one Delete link - they are NOT two separate disconnect targets.
 */
export const MFA_METHODS: Record<UnlinkMethodKey, UnlinkMethodSpec> = {
  securityKey: {
    key: 'securityKey',
    sectionTextMarkers: ['U2F', 'WebAuthn', 'Security Key'],
    hrefPatterns: [
      /u2f.*(delete|remove|disconnect)/i,
      /webauthn.*(delete|remove|disconnect)/i,
      /securitykey.*(delete|remove|disconnect)/i,
    ],
    labelKey: 'unlinkSecurityKeyMethodLabelSecurityKey',
  },
  salesforceAuthenticator: {
    key: 'salesforceAuthenticator',
    sectionTextMarkers: ['Salesforce Authenticator'],
    hrefPatterns: [/removetwofactorauth/i, /salesforceauthenticator.*(delete|remove|disconnect)/i],
    labelKey: 'unlinkSecurityKeyMethodLabelSalesforceAuthenticator',
  },
  totp: {
    key: 'totp',
    sectionTextMarkers: ['One-Time Password Authenticator', 'TOTP'],
    hrefPatterns: [/removetimebased/i, /removetotp/i, /onetimepassword.*(delete|remove|disconnect)/i],
    labelKey: 'unlinkSecurityKeyMethodLabelTotp',
  },
  tempCode: {
    key: 'tempCode',
    /*
     * "Temporary verification code" is localized by Salesforce - the row-marker
     * strategy only matches in English orgs. Admins on non-English orgs can pass
     * --text-markers '{"tempCode":["<localized label>"]}' to extend the match.
     */
    sectionTextMarkers: ['Temporary verification code'],
    hrefPatterns: [/tempidentityverification.*expire/i, /tempcode.*(expire|delete|remove)/i],
    labelKey: 'unlinkSecurityKeyMethodLabelTempCode',
  },
};

export async function unlinkUserSecurityKeys(
  targets: UnlinkTarget[],
  conn: any,
  methods: UnlinkMethodSpec[],
  options: { debug?: boolean; dumpAnchors?: boolean } = { debug: false }
): Promise<UnlinkResultEntry[]> {
  const results: UnlinkResultEntry[] = [];
  const pending: UnlinkTarget[] = [];

  for (const target of targets) {
    if (target.preStatus === 'notFound') {
      results.push({
        username: target.username,
        userId: null,
        status: 'notFound',
        methodsUnlinked: [],
        methodsNotLinked: [],
        message: t('unlinkSecurityKeyUserNotFound', { username: target.username }),
      });
    } else if (target.preStatus === 'inactive') {
      results.push({
        username: target.username,
        userId: target.userId,
        status: 'inactive',
        methodsUnlinked: [],
        methodsNotLinked: [],
        message: t('unlinkSecurityKeyUserInactive', { username: target.username }),
      });
    } else {
      pending.push(target);
    }
  }

  if (pending.length === 0) {
    uxLog('warning', this, c.yellow(t('unlinkSecurityKeyNoTargets')));
    return results;
  }

  const chromeExecutablePath = getChromeExecutablePath();
  let browser: Browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: !(options.debug === true),
      executablePath: chromeExecutablePath,
    });
  } catch (e: any) {
    uxLog('error', this, c.red(t('unlinkSecurityKeyBrowserLaunchError', { message: e.message })));
    uxLog('error', this, c.red(t('youMightNeedToSetThePuppeteerexecutablepath')));
    for (const target of pending) {
      results.push({
        username: target.username,
        userId: target.userId,
        status: 'error',
        methodsUnlinked: [],
        methodsNotLinked: [],
        message: e.message,
      });
    }
    return results;
  }

  try {
    const page = await browser.newPage();
    const instanceUrl = conn.instanceUrl;

    const loginUrl = `${instanceUrl}/secur/frontdoor.jsp?sid=${conn.accessToken}`;
    uxLog('other', this, `Opening frontdoor login URL`);
    await page.goto(loginUrl, { waitUntil: ['domcontentloaded', 'networkidle0'] });

    for (const target of pending) {
      uxLog('action', this, c.cyan(t('unlinkSecurityKeyProcessingUser', { username: target.username })));
      const userId = target.userId as string;
      const detailUrl = `${instanceUrl}/lightning/setup/ManageUsers/page?address=%2F${userId}%3Fnoredirect%3D1%26isUserEntityOverride%3D1`;

      const methodsUnlinked: string[] = [];
      const methodsNotLinked: string[] = [];
      let errorMessage = '';

      try {
        for (const method of methods) {
          try {
            await page.goto(detailUrl, { waitUntil: ['domcontentloaded', 'networkidle0'] });
            const detailFrame = await waitForUserDetailFrame(page, userId);
            if (!detailFrame) {
              throw new Error('Unable to locate user detail iframe');
            }
            if (options.dumpAnchors) {
              await dumpAnchorsForDiagnostic(detailFrame, target.username, method.key);
            }
            const anchor = await findMfaAnchor(detailFrame, method);
            if (!anchor) {
              methodsNotLinked.push(method.key);
              uxLog(
                'log',
                this,
                c.grey(
                  t('unlinkSecurityKeyMethodNotLinked', {
                    method: t(method.labelKey),
                    username: target.username,
                  })
                )
              );
              continue;
            }

            page.once('dialog', async (dialog) => {
              try {
                await dialog.accept();
              } catch {
                /* dialog may already have been handled */
              }
            });
            try {
              await Promise.all([
                page.waitForNavigation({ timeout: 10000, waitUntil: ['domcontentloaded'] }).catch(() => null),
                anchor.click(),
              ]);
            } catch {
              /* some Disconnect actions render a modal; ignore navigation timeout */
            }

            await tryClickConfirmButton(page, method.hrefPatterns);

            methodsUnlinked.push(method.key);
            uxLog(
              'success',
              this,
              c.green(
                t('unlinkSecurityKeyMethodUnlinked', {
                  method: t(method.labelKey),
                  username: target.username,
                })
              )
            );
          } catch (methodErr: any) {
            errorMessage = methodErr?.message || String(methodErr);
            uxLog(
              'error',
              this,
              c.red(
                t('unlinkSecurityKeyUserError', {
                  username: target.username,
                  message: `${method.key}: ${errorMessage}`,
                })
              )
            );
          }
        }
      } catch (userErr: any) {
        errorMessage = userErr?.message || String(userErr);
      }

      let status: UnlinkResultEntry['status'];
      let message: string;
      if (methodsUnlinked.length > 0) {
        status = 'unlinked';
        message = t('unlinkSecurityKeyMethodUnlinked', {
          method: methodsUnlinked.join(', '),
          username: target.username,
        });
      } else if (errorMessage) {
        status = 'error';
        message = errorMessage;
      } else {
        status = 'notLinked';
        message = t('unlinkSecurityKeyMethodNotLinked', {
          method: methods.map((m) => m.key).join(', '),
          username: target.username,
        });
      }

      results.push({
        username: target.username,
        userId: target.userId,
        status,
        methodsUnlinked,
        methodsNotLinked,
        message,
      });
    }
  } finally {
    try {
      await browser.close();
    } catch {
      /* nothing to do */
    }
  }

  return results;
}

async function waitForUserDetailFrame(page: any, userId: string): Promise<Frame | null> {
  const start = Date.now();
  const timeoutMs = 15000;
  while (Date.now() - start < timeoutMs) {
    const frames: Frame[] = page.frames();
    const match = frames.find((f) => {
      const url = f.url() || '';
      return url.includes(userId) && (url.includes('noredirect') || url.includes('isUserEntityOverride'));
    });
    if (match) {
      return match;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function findMfaAnchor(frame: Frame, method: UnlinkMethodSpec): Promise<any> {
  const markers = method.sectionTextMarkers;
  const hrefPatternSources = method.hrefPatterns.map((rx) => rx.source);

  const handle = await frame.evaluateHandle(
    (markersIn: string[], hrefPatternSrcsIn: string[]) => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const hrefRxs = hrefPatternSrcsIn.map((s) => new RegExp(s, 'i'));

      /* Strategy 1: locate a row whose text contains a brand/spec marker, click the link inside */
      const rowSel = 'tr, [role="row"], li, .detailRow, .data-row';
      const rows = Array.from(document.querySelectorAll(rowSel));
      for (const row of rows) {
        const text = norm((row as HTMLElement).textContent);
        if (!text || text.length > 400) continue;
        if (markersIn.some((m) => text.includes(m))) {
          const a = row.querySelector('a[href]') as HTMLAnchorElement | null;
          if (a) return a;
        }
      }

      /* Strategy 2: walk up from any element whose text contains a marker, find the nearest anchor */
      const allEls = Array.from(document.querySelectorAll('th, td, span, label, div'));
      for (const el of allEls) {
        const text = norm((el as HTMLElement).textContent);
        if (!text || text.length > 250) continue;
        if (!markersIn.some((m) => text.includes(m))) continue;
        let walker: HTMLElement | null = el as HTMLElement;
        for (let i = 0; i < 6 && walker; i++) {
          const a = walker.querySelector ? (walker.querySelector('a[href]') as HTMLAnchorElement | null) : null;
          if (a) return a;
          walker = walker.parentElement;
        }
      }

      /* Strategy 3: href pattern fallback */
      const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (hrefRxs.some((rx) => rx.test(href))) {
          return a;
        }
      }

      return null;
    },
    markers,
    hrefPatternSources
  );

  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    return null;
  }
  return element;
}

async function tryClickConfirmButton(page: any, patterns: RegExp[]): Promise<void> {
  try {
    const patternSources = patterns.map((rx) => rx.source);
    const handle = await page.evaluateHandle((sources: string[]) => {
      const rxs = sources.map((s) => new RegExp(s, 'i'));
      const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (rxs.some((rx) => rx.test(href))) return a;
      }
      const submit = document.querySelector(
        'input[type="submit"][name*="confirm" i], button[type="submit"][name*="confirm" i]'
      );
      return submit || null;
    }, patternSources);
    const element = handle.asElement();
    if (element) {
      await Promise.all([
        page.waitForNavigation({ timeout: 5000, waitUntil: ['domcontentloaded'] }).catch(() => null),
        (element as any).click(),
      ]);
    } else {
      await handle.dispose();
    }
  } catch {
    /* best-effort */
  }
}

async function dumpAnchorsForDiagnostic(frame: Frame, username: string, methodKey: string): Promise<void> {
  try {
    const anchors = (await frame.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      return Array.from(document.querySelectorAll('a[href]'))
        .map((a) => {
          const el = a as HTMLAnchorElement;
          const row = (el.closest('tr') || el.closest('[role="row"]') || el.parentElement?.parentElement) as
            | HTMLElement
            | null;
          return {
            text: norm(el.textContent).slice(0, 80),
            href: el.getAttribute('href') || '',
            rowText: row ? norm(row.textContent).slice(0, 200) : '',
          };
        })
        .filter((entry) => entry.href && !entry.href.startsWith('javascript:void'))
        .slice(0, 60);
    })) as Array<{ text: string; href: string; rowText: string }>;
    uxLog('log', this, c.grey(`[unlink-security-key] Anchor dump for ${username} / ${methodKey}:`));
    for (const a of anchors) {
      uxLog('log', this, c.grey(`  text="${a.text}"  href="${a.href}"  row="${a.rowText}"`));
    }
  } catch {
    /* best-effort */
  }
}
