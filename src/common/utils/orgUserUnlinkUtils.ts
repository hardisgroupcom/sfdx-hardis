import c from 'chalk';
import puppeteer, { Browser, Frame } from 'puppeteer-core';
import { uxLog } from './index.js';
import { getChromeExecutablePath } from './orgConfigUtils.js';
import { t } from './i18n.js';

export type UnlinkMethodKey = 'securityKey' | 'salesforceAuthenticator' | 'totp' | 'tempCode';

export interface UnlinkMethodSpec {
  key: UnlinkMethodKey;
  /*
   * Stable Salesforce anchor IDs (locale-independent). When present and found
   * in the DOM, these are clicked directly - the most reliable strategy.
   */
  anchorIds?: string[];
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
    anchorIds: ['DisableU2FOrWebAuthn'],
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
    await page.goto(loginUrl, { waitUntil: ['domcontentloaded'] });

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
            /*
             * Lightning Setup constantly polls in the background, so networkidle0
             * routinely times out. domcontentloaded is enough - we then poll every
             * frame for the method section content separately.
             */
            await page.goto(detailUrl, { waitUntil: ['domcontentloaded'] });
            const detailFrame = await waitForFrameWithMethodSection(page, method, {
              debug: options.debug === true,
            });
            if (!detailFrame) {
              /*
               * Section markers never appeared in any frame within the timeout.
               * Treat as notLinked rather than error: most likely the user has
               * no row for this method at all (e.g. org doesn't expose it).
               */
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

/*
 * Find the frame containing the method's section in any frame of the page.
 *
 * The previous URL-based heuristic (match a frame whose URL contains the userId
 * plus noredirect/isUserEntityOverride) is brittle: Lightning Setup nests the
 * Classic user detail page inside chrome iframes whose URLs do not always
 * surface those tokens. This polls every frame for the actual section content
 * (anchor IDs or text markers) and returns the first frame that owns it. If
 * no frame contains the section within the timeout, returns null.
 */
async function waitForFrameWithMethodSection(
  page: any,
  method: UnlinkMethodSpec,
  options: { debug?: boolean } = {}
): Promise<Frame | null> {
  const start = Date.now();
  const timeoutMs = 25000;
  const anchorIds = method.anchorIds || [];
  const markers = method.sectionTextMarkers;
  let lastFrameDump = '';
  while (Date.now() - start < timeoutMs) {
    const frames: Frame[] = page.frames();
    for (const frame of frames) {
      let frameUrl = '';
      try {
        frameUrl = frame.url() || '';
      } catch {
        continue;
      }
      try {
        const matches = await frame.evaluate(
          (idsIn: string[], markersIn: string[]) => {
            /* esbuild __name polyfill - see comment in findMfaAnchor */
            const g = globalThis as any;
            if (typeof g.__name !== 'function') g.__name = (fn: any) => fn;
            for (const id of idsIn) {
              if (document.getElementById(id)) return true;
            }
            const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
            const cells = Array.from(document.querySelectorAll('td, th, label, span'));
            for (const el of cells) {
              const text = norm((el as HTMLElement).textContent);
              if (!text || text.length > 250) continue;
              if (markersIn.some((m) => text.includes(m))) return true;
            }
            return false;
          },
          anchorIds,
          markers
        );
        if (matches) {
          if (options.debug) {
            uxLog('log', this, c.grey(`[unlink-security-key] Found ${method.key} section in frame: ${frameUrl}`));
          }
          return frame;
        }
      } catch {
        /* cross-origin/detached frames - skip */
      }
    }
    if (options.debug) {
      const dump = frames.map((f) => f.url()).join('\n  ');
      if (dump !== lastFrameDump) {
        uxLog(
          'log',
          this,
          c.grey(`[unlink-security-key] Polling frames for ${method.key} (${frames.length} frames):\n  ${dump}`)
        );
        lastFrameDump = dump;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function findMfaAnchor(frame: Frame, method: UnlinkMethodSpec): Promise<any> {
  const markers = method.sectionTextMarkers;
  const anchorIds = method.anchorIds || [];
  const hrefPatternSources = method.hrefPatterns.map((rx) => rx.source);

  const handle = await frame.evaluateHandle(
    (anchorIdsIn: string[], markersIn: string[], hrefPatternSrcsIn: string[]) => {
      /*
       * Polyfill for esbuild's __name helper. The TS bundler wraps inner named
       * arrow functions (const fn = () => ...) with __name(fn, "fn") for stack
       * traces, but __name is only defined in the Node bundle - in the browser
       * page context where evaluate() runs, it would throw ReferenceError.
       */
      const g = globalThis as any;
      if (typeof g.__name !== 'function') g.__name = (fn: any) => fn;
      /*
       * "Visible" text only: skip descendants hidden via display:none so a
       * mouseover tooltip cannot inflate the row text past the length filter.
       */
      const visibleText = (el: Element): string => {
        const win = el.ownerDocument && el.ownerDocument.defaultView;
        let out = '';
        const walk = (n: Node) => {
          if (n.nodeType === Node.TEXT_NODE) {
            out += n.nodeValue || '';
            return;
          }
          if (n.nodeType !== Node.ELEMENT_NODE) return;
          const e = n as HTMLElement;
          if (win) {
            const style = win.getComputedStyle(e);
            if (style && (style.display === 'none' || style.visibility === 'hidden')) return;
          }
          for (const child of Array.from(e.childNodes)) walk(child);
        };
        walk(el);
        return out.replace(/\s+/g, ' ').trim();
      };
      const hrefRxs = hrefPatternSrcsIn.map((s) => new RegExp(s, 'i'));

      /* Strategy 0: known stable anchor IDs (locale-independent, most reliable) */
      for (const id of anchorIdsIn) {
        const byId = document.getElementById(id) as HTMLAnchorElement | null;
        if (byId) return byId;
      }

      /* Strategy 1: locate a row whose text contains a brand/spec marker, click the link inside */
      const rowSel = 'tr, [role="row"], li, .detailRow, .data-row';
      const rows = Array.from(document.querySelectorAll(rowSel));
      for (const row of rows) {
        const text = visibleText(row);
        if (!text || text.length > 400) continue;
        if (markersIn.some((m) => text.includes(m))) {
          const a = row.querySelector('a[href]') as HTMLAnchorElement | null;
          if (a) return a;
        }
      }

      /*
       * Strategy 2: find an element whose text contains a marker, then look for
       * an anchor *inside its row container only*. Walking up by parentElement
       * is unsafe: when the marker row has no anchor (method not registered),
       * the walker reaches <tbody> and returns the first anchor in the entire
       * table - which could be an unrelated link or the wrong method's Remove
       * link from another row.
       */
      const rowContainerSel = 'tr, [role="row"], li, .detailRow, .data-row';
      const allEls = Array.from(document.querySelectorAll('th, td, span, label, div'));
      for (const el of allEls) {
        const text = visibleText(el);
        if (!text || text.length > 250) continue;
        if (!markersIn.some((m) => text.includes(m))) continue;
        const rowContainer = el.closest(rowContainerSel);
        if (!rowContainer) continue;
        const a = rowContainer.querySelector('a[href]') as HTMLAnchorElement | null;
        if (a) return a;
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
    anchorIds,
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
      /* esbuild __name polyfill - see comment in findMfaAnchor */
      const g = globalThis as any;
      if (typeof g.__name !== 'function') g.__name = (fn: any) => fn;
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
