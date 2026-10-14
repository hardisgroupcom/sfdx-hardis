#!/usr/bin/env node
/*
 * Visual check of the Pull Request comments sfdx-hardis writes (runbook section 5quater).
 *
 * The comment audit (audit-pr-comments.cjs) reads the markdown source. This script looks at what
 * the provider draws from it: it opens one comment of every type the run produced, in a real
 * browser, takes a picture of it, and checks its DOM against its source.
 *
 *   node check-comments-visual.cjs <comments.json> <out dir> [--render page|api] [--cdp <url>]
 *        [--per-type <n>] [--only <type prefix>] [--width <px>]
 *
 *   <comments.json>  the dump written by dump_pr_comments of a provider library
 *   <out dir>        receives one <type>-pr<number>.png (as shown) and one ...-open.png (every folded
 *                    section opened) per comment, and visual.json
 *   --render page    (default for azure and bitbucket) the real Pull Request page of the provider,
 *                    in a Chrome started with --remote-debugging-port and logged in to the provider:
 *                    --cdp, else E2E_CDP_URL, else http://127.0.0.1:9222
 *   --render api     (default for github and gitlab) the HTML the provider's own markdown API
 *                    returns, drawn in a headless Chrome: no session needed. GitHub: `gh` logged in
 *                    and REPO; GitLab: GL_HOST, GL_TOKEN and PROJECT_PATH
 *   --per-type <n>   comments captured per type (default 1, the longest ones)
 *
 * Types: validation and deployment comments by verdict (success, failed) and by what they carry
 * (manual actions, conflict markers), the Deployment Actions comment (with and without manual
 * actions), the Backpromotes comment, a MegaLinter comment, any other sfdx-hardis comment by its
 * message key, and the description of a promotion Pull Request (with and without conflicts).
 *
 * Checked for each comment, FAIL unless said otherwise:
 *   - the comment is found on the page and is not empty;
 *   - no markdown or HTML source left as text outside code blocks (a table row in pipes, **bold**,
 *     a [link](url), a heading in #, a <details> or <br/> tag, an HTML comment marker);
 *   - as many tables drawn as the source holds;
 *   - as many folded sections as the source holds <details> blocks;
 *   - every image loaded;
 *   - a checkbox drawn for every task item, and none left as "[ ]" text;
 *   - WARN: a table or a code block wider than the comment (it scrolls or is cut).
 *
 * The pictures are the other half: read each one (see the runbook for what to look at). A check
 * that passes says the markup was understood, not that the comment reads well.
 *
 * Exit code 1 when a comment fails, 2 on a usage or browser error.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const positional = [];
const options = { perType: 1, width: 1000 };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--render') options.render = args[++i];
  else if (arg === '--cdp') options.cdp = args[++i];
  else if (arg === '--per-type') options.perType = Number(args[++i]);
  else if (arg === '--only') options.only = args[++i];
  else if (arg === '--width') options.width = Number(args[++i]);
  else positional.push(arg);
}
const [dumpFile, outDir] = positional;
if (!dumpFile || !outDir) {
  console.error('usage: check-comments-visual.cjs <comments.json> <out dir> [--render page|api] [--cdp <url>] [--per-type <n>] [--only <type prefix>]');
  process.exit(2);
}

const dump = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));
const provider = dump.provider;
const render = options.render || (provider === 'azure' || provider === 'bitbucket' ? 'page' : 'api');
const cdpUrl = options.cdp || process.env.E2E_CDP_URL || 'http://127.0.0.1:9222';
fs.mkdirSync(outDir, { recursive: true });

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  console.error('puppeteer-core not found: run yarn install in the sfdx-hardis working copy');
  process.exit(2);
}

// A step that hangs must say which one: the browser, a page load, a provider that asks to log in
let currentStep = 'start';
let watchdog = null;
function step(name, seconds = 120) {
  currentStep = name;
  if (watchdog) clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    console.error(`WATCHDOG: "${currentStep}" did not end in ${seconds}s`);
    process.exit(2);
  }, seconds * 1000);
}

// ------------------------------------------------------------------ what to capture

const MESSAGE_KEY_REGEX = /<!-- sfdx-hardis message-key (.+?) -->/;
const RUN_SUMMARY_REGEX = /<!-- sfdx-hardis run-summary (\S+) -->/;

function runStatus(body) {
  const encoded = (body.match(RUN_SUMMARY_REGEX) || [])[1];
  if (encoded) {
    try {
      const summary = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      const status = String(summary.status || summary.s || '').toLowerCase();
      if (status) {
        return /valid|success|ok/.test(status) && !/invalid/.test(status) ? 'success' : 'failed';
      }
    } catch {
      // an unreadable marker: fall back to the text
    }
  }
  const head = body.replace(/<!--[\s\S]*?-->/g, '').slice(0, 1500);
  return head.includes('❌') ? 'failed' : 'success';
}

function commentType(body) {
  const manual = body.includes('sfdx-hardis-manual-action') ? '+manual' : '';
  if (body.includes('<!-- sfdx-hardis deployment-actions-state')) return `deployment-actions${manual}`;
  if (body.includes('<!-- sfdx-hardis backpromotes -->')) return 'backpromotes';
  if (/<!-- megalinter|MegaLinter/.test(body) && !MESSAGE_KEY_REGEX.test(body)) return 'code-quality';
  const key = (body.match(MESSAGE_KEY_REGEX) || [])[1];
  if (!key) return null;
  const conflict = /conflict markers/i.test(body) ? '+conflict-markers' : '';
  if (key.startsWith('deployment-check-')) return `validation-${runStatus(body)}${manual}${conflict}`;
  if (key.startsWith('deployment-')) return `deployment-${runStatus(body)}${manual}`;
  return `other-${key.replace(/[^a-z]+/gi, '-').replace(/-+$/, '').toLowerCase()}`;
}

function descriptionType(pullRequest) {
  const description = pullRequest.description || '';
  if (!/promotionPullRequests/.test(description)) return null;
  return /conflict/i.test(description) ? 'promotion-description+conflicts' : 'promotion-description';
}

function pullRequestUrl(pullRequest) {
  if (pullRequest.url) return pullRequest.url;
  const commentUrl = (pullRequest.comments || []).map((c) => c.url).find(Boolean) || '';
  if (commentUrl) {
    return commentUrl.replace(/[?#].*$/, '').replace(/\/_\/diff$/, '');
  }
  // A Pull Request without a comment: its address is the one of any other, with its number
  for (const other of dump.prs || []) {
    const sample = (other.comments || []).map((c) => c.url).find(Boolean);
    const match = sample && sample.match(/^(.*\/(?:pull-requests|pullrequest|pull|merge_requests)\/)\d+/);
    if (match) {
      return `${match[1]}${pullRequest.number}`;
    }
  }
  return '';
}

const byType = new Map();
for (const pullRequest of dump.prs || []) {
  const add = (type, body, url, what) => {
    if (!type || !body) return;
    if (options.only && !type.startsWith(options.only)) return;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push({ type, body, url, what, pr: pullRequest.number, title: pullRequest.title });
  };
  add(descriptionType(pullRequest), pullRequest.description, pullRequestUrl(pullRequest), 'description');
  for (const comment of pullRequest.comments || []) {
    add(commentType(comment.body || ''), comment.body, comment.url || pullRequestUrl(pullRequest), 'comment');
  }
}
const selected = [];
for (const [, items] of [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  items.sort((a, b) => b.body.length - a.body.length);
  selected.push(...items.slice(0, options.perType));
}
if (selected.length === 0) {
  console.error('no sfdx-hardis comment in this dump');
  process.exit(2);
}

// ------------------------------------------------------------------ what the source promises

function withoutCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/````[\s\S]*?````/g, '').replace(/`[^`\n]*`/g, '');
}

function sourceFacts(markdown) {
  const text = withoutCode(markdown).replace(/<!--[\s\S]*?-->/g, '');
  return {
    tables: (text.match(/^\s*\|?\s*:?-{3,}:?\s*\|.*$/gm) || []).length,
    details: (text.match(/<details\b/gi) || []).length,
    tasks: (text.match(/^\s*[-*] \[[ xX]\] /gm) || []).length,
    images: (text.match(/!\[[^\]]*\]\([^)]+\)|<img\b/gi) || []).length,
  };
}

// Words of the comment a reader sees as they are written: what finds it among the comments of a
// page. Words, not sentences: a provider splits a sentence across elements, adds spaces around an
// emoji, or draws a number in a tag of its own.
function probes(markdown) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/https?:\S+/g, " ")
    .replace(/<[^>]+>/g, " ");
  const words = text.match(/[A-Za-z][A-Za-z0-9-]{5,}/g) || [];
  return [...new Set(words)].slice(0, 60);
}

// ------------------------------------------------------------------ rendering through the provider API

function renderThroughApi(item) {
  if (provider === 'github') {
    const repository = process.env.REPO;
    if (!repository) throw new Error('--render api on GitHub needs REPO');
    const file = path.join(outDir, '.markdown-request.json');
    fs.writeFileSync(file, JSON.stringify({ text: item.body, mode: 'gfm', context: repository }));
    try {
      return execFileSync('gh', ['api', 'markdown', '--input', file], { encoding: 'utf8', maxBuffer: 50e6 });
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
  if (provider === 'gitlab') {
    const host = process.env.GL_HOST;
    const token = process.env.GL_TOKEN;
    const project = process.env.PROJECT_PATH;
    if (!host || !token || !project) throw new Error('--render api on GitLab needs GL_HOST, GL_TOKEN and PROJECT_PATH');
    const file = path.join(outDir, '.markdown-request.json');
    fs.writeFileSync(file, JSON.stringify({ text: item.body, gfm: true, project }));
    try {
      const answer = execFileSync(
        'curl',
        ['-sS', '-X', 'POST', '-H', `PRIVATE-TOKEN: ${token}`, '-H', 'Content-Type: application/json', '--data-binary', `@${file}`, `${host}/api/v4/markdown`],
        { encoding: 'utf8', maxBuffer: 50e6 },
      );
      const html = JSON.parse(answer).html;
      if (typeof html !== 'string') throw new Error(`GitLab markdown API: ${answer.slice(0, 200)}`);
      return html;
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
  throw new Error(`--render api is not available for ${provider}: it has no markdown API, use --render page`);
}

function apiPage(html) {
  // The frame of a comment, close to what GitHub and GitLab draw: width, font, table and code
  // rules. The markup itself comes from the provider.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body { background: #fff; margin: 0; padding: 24px; font: 14px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1f2328; }
  #comment { width: ${options.width - 80}px; border: 1px solid #d1d9e0; border-radius: 6px; padding: 16px; overflow: hidden; }
  #comment table { border-collapse: collapse; display: block; max-width: 100%; overflow: auto; margin: 8px 0; }
  #comment th, #comment td { border: 1px solid #d1d9e0; padding: 6px 13px; }
  #comment pre { background: #f6f8fa; padding: 12px; overflow: auto; border-radius: 6px; }
  #comment code { background: #eff1f3; padding: 1px 4px; border-radius: 4px; font-size: 12px; }
  #comment pre code { background: none; padding: 0; }
  #comment img { max-width: 100%; }
  #comment details { margin: 8px 0; }
  #comment summary { cursor: pointer; }
  #comment ul.contains-task-list, #comment ul.task-list { list-style: none; padding-left: 8px; }
</style></head><body><div id="comment">${html}</div></body></html>`;
}

// ------------------------------------------------------------------ in the page

// Runs in the browser. Finds the element holding the comment, and compares it with its source.
function inspectInPage(input) {
  const { anchors, facts, selector } = input;
  let element = selector ? document.querySelector(selector) : null;
  let hits = 0;
  if (!element) {
    // The container of a comment on each provider, then anything that looks like one. The comment
    // is the container holding the most words of the source, the smallest one when several do.
    const containers = [
      ...document.querySelectorAll(
        ".markdown-content, .comment-body, .markdown-body, .note-text, .description .md, .ak-renderer-document, [data-testid*=comment] , [class*=markdown], [class*=Markdown]",
      ),
    ];
    let best = null;
    for (const candidate of containers) {
      const text = candidate.textContent || "";
      const found = anchors.filter((anchor) => text.includes(anchor)).length;
      if (!best || found > best.found || (found === best.found && text.length < best.length)) {
        best = { candidate, found, length: text.length };
      }
    }
    if (best && anchors.length > 0 && best.found >= Math.max(3, Math.ceil(anchors.length * 0.6))) {
      element = best.candidate;
      hits = best.found;
    }
  }
  if (!element) {
    return { found: false };
  }
  element.setAttribute('data-e2e-comment', '1');
  element.scrollIntoView({ block: 'start' });

  const clone = element.cloneNode(true);
  clone.querySelectorAll('pre, code, textarea, script, style').forEach((node) => node.remove());
  const text = clone.textContent || '';
  const leaks = [];
  const leak = (label, regex) => {
    const match = text.match(regex);
    if (match) leaks.push(`${label}: "${match[0].replace(/\s+/g, ' ').slice(0, 60)}"`);
  };
  leak('table row left in pipes', /\|[^|\n]{1,80}\|[^|\n]{1,80}\|/);
  leak('table separator', /\|\s*:?-{3,}/);
  leak('bold left in asterisks', /\*\*[^*\n]{1,80}\*\*/);
  leak('link left in brackets', /\]\(https?:\/\//);
  leak('heading left in #', /(^|\n)\s{0,3}#{1,6} \S/);
  leak('HTML tag left as text', /<\/?(details|summary|br|sub|sup|b|i|a|img|table|tr|td)\b[^>]{0,40}>/i);
  leak('HTML comment marker', /<!--|-->/);
  leak('code fence', /```/);
  leak('task item left as text', /(^|\n)\s*[-*]?\s*\[[ xX]\] /);

  const images = [...element.querySelectorAll('img')];
  const brokenImages = images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.getAttribute('src') || '');
  const width = element.clientWidth;
  const tooWide = [...element.querySelectorAll('table, pre')]
    .filter((node) => node.scrollWidth > node.clientWidth + 2 || node.getBoundingClientRect().width > element.getBoundingClientRect().width + 2)
    .map((node) => `${node.tagName.toLowerCase()} ${Math.round(Math.max(node.scrollWidth, node.getBoundingClientRect().width))}px in ${width}px`);
  const checkboxes = element.querySelectorAll('input[type="checkbox"], [role="checkbox"], [class*="markdown-checkbox"]:not([class*="container"])').length;
  // Bitbucket draws no checkbox: sfdx-hardis sends a box symbol there, which counts as one
  const boxSymbols = ((element.textContent || '').match(/[\u2610\u2611]/g) || []).length;
  return {
    found: true,
    wordsFound: hits + "/" + anchors.length,
    tag: `${element.tagName.toLowerCase()}.${String(element.className || '').split(/\s+/).slice(0, 2).join('.')}`,
    textLength: (element.textContent || '').trim().length,
    tables: element.querySelectorAll('table').length,
    details: element.querySelectorAll('details').length,
    images: images.length,
    brokenImages,
    checkboxes: checkboxes + boxSymbols,
    tooWide,
    leaks,
    expected: facts,
  };
}

function verdict(item, seen) {
  const problems = [];
  const warnings = [];
  if (!seen.found) {
    return { status: 'FAIL', problems: ['comment not found on the page (not logged in, a deleted comment, or a page that draws it lazily)'], warnings };
  }
  const facts = seen.expected;
  if (seen.textLength < 40) problems.push(`the comment is drawn almost empty (${seen.textLength} characters)`);
  problems.push(...seen.leaks);
  if (seen.tables < facts.tables) problems.push(`${facts.tables} table(s) in the source, ${seen.tables} drawn`);
  if (seen.details < facts.details) problems.push(`${facts.details} folded section(s) in the source, ${seen.details} drawn`);
  if (seen.brokenImages.length > 0) problems.push(`${seen.brokenImages.length} image(s) not loaded: ${seen.brokenImages.slice(0, 2).join(', ')}`);
  if (facts.tasks > 0 && seen.checkboxes < facts.tasks) problems.push(`${facts.tasks} task item(s) in the source, ${seen.checkboxes} checkbox(es) drawn`);
  if (seen.tooWide.length > 0) warnings.push(`wider than the comment: ${seen.tooWide.slice(0, 3).join('; ')}`);
  return { status: problems.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'OK', problems, warnings };
}

// ------------------------------------------------------------------ main

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function openBrowser() {
  if (render === 'page') {
    step(`connect to the Chrome of ${cdpUrl}`, 30);
    try {
      return { browser: await puppeteer.connect({ browserURL: cdpUrl, defaultViewport: null }), own: false };
    } catch (error) {
      throw new Error(
        `no Chrome answers on ${cdpUrl} (${error.message}). Start one with --remote-debugging-port=9222 and a --user-data-dir of its own, log in to the provider in it, then run this again`,
      );
    }
  }
  const executablePath = findChrome();
  if (!executablePath) throw new Error('Chrome not found: set CHROME_PATH');
  step('start a headless Chrome', 60);
  return { browser: await puppeteer.launch({ executablePath, headless: true, args: ['--no-first-run'] }), own: true };
}

// A page that scrolls inside a container of its own only paints what its window shows: the window
// is made as tall as the comment before the picture.
async function shoot(page, file) {
  const height = await page.evaluate(() => Math.ceil(document.querySelector('[data-e2e-comment="1"]').getBoundingClientRect().height));
  await page.setViewport({ width: options.width + 400, height: Math.min(Math.max(1100, height + 400), 12000), deviceScaleFactor: 1 });
  await page.evaluate(() => document.querySelector('[data-e2e-comment="1"]').scrollIntoView({ block: 'start' }));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  // A margin around the comment: a picture cut flush with the text looks like text cut by the page
  const box = await (await page.$('[data-e2e-comment="1"]')).boundingBox();
  const margin = 16;
  await page.screenshot({
    path: file,
    // The window is already as tall as the comment: capturing beyond it would lay the page out again
    // and the clip would no longer be where the comment is (a page that scrolls in a container of its own)
    captureBeyondViewport: false,
    clip: { x: Math.max(0, box.x - margin), y: Math.max(0, box.y - margin), width: box.width + 2 * margin, height: box.height + 2 * margin },
  });
}

async function capture(page, item, selector) {
  const anchors = probes(item.body);
  const facts = sourceFacts(item.body);
  const base = path.join(outDir, `${item.type.replace(/[^a-z0-9+-]+/gi, '-')}-pr${item.pr}`);
  let seen = { found: false };
  // A provider page draws its comments after the load: look again for a while
  for (let attempt = 0; attempt < 8; attempt++) {
    seen = await page.evaluate(inspectInPage, { anchors, facts, selector });
    if (seen.found && seen.textLength > 40) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const result = { type: item.type, pr: item.pr, what: item.what, url: item.url, render, ...verdict(item, seen), seen };
  if (seen.found) {
    // A provider page keeps bars stuck to the top of the window: they would cover the top of the
    // picture. Hidden once the DOM has been read, the page is thrown away after the picture.
    await page.evaluate(() => {
      const target = document.querySelector('[data-e2e-comment="1"]');
      for (const node of document.querySelectorAll('body *')) {
        const position = getComputedStyle(node).position;
        if ((position === 'fixed' || position === 'sticky') && !node.contains(target) && !target.contains(node)) {
          node.style.visibility = 'hidden';
        }
      }
    });
    result.picture = `${base}.png`;
    await shoot(page, result.picture);
    // A page can draw the comment again after the window changed size, and lose the mark: find it again
    await page.evaluate(inspectInPage, { anchors, facts, selector });
    const opened = await page.evaluate(() => {
      const target = document.querySelector('[data-e2e-comment="1"]');
      const folded = [...target.querySelectorAll('details:not([open])')];
      folded.forEach((details) => details.setAttribute('open', ''));
      return folded.length;
    });
    if (opened > 0) {
      // A page draws what was folded only once it shows: give it the time
      await page.evaluate(() => document.querySelector('[data-e2e-comment="1"]').scrollIntoView({ block: 'end' }));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const again = await page.evaluate(inspectInPage, { anchors, facts, selector: '[data-e2e-comment="1"]' });
      const openVerdict = verdict(item, again);
      for (const problem of openVerdict.problems) {
        if (!result.problems.includes(problem)) result.problems.push(`once unfolded: ${problem}`);
      }
      for (const warning of openVerdict.warnings) {
        if (!result.warnings.includes(warning)) result.warnings.push(`once unfolded: ${warning}`);
      }
      result.status = result.problems.length > 0 ? 'FAIL' : result.warnings.length > 0 ? 'WARN' : 'OK';
      result.pictureOpen = `${base}-open.png`;
      await shoot(page, result.pictureOpen);
    }
    await page.evaluate(() => document.querySelectorAll('[data-e2e-comment]').forEach((node) => node.removeAttribute('data-e2e-comment')));
  }
  return result;
}

(async () => {
  const { browser, own } = await openBrowser();
  const results = [];
  const page = await browser.newPage();
  await page.setViewport({ width: options.width + 400, height: 1100, deviceScaleFactor: 1 });
  try {
    for (const item of selected) {
      step(`${item.type} of Pull Request ${item.pr}`, 150);
      let result;
      try {
        if (render === 'api') {
          await page.setContent(apiPage(renderThroughApi(item)), { waitUntil: 'domcontentloaded', timeout: 60000 });
          // GitLab hands images over for its own lazy loader (data-src) and with paths of its
          // host: give them their address, then wait for them without waiting for the network to
          // go quiet, which a page of its own never does when one request hangs
          await page.evaluate(async (base) => {
            for (const image of document.querySelectorAll('img')) {
              const source = image.getAttribute('data-src') || image.getAttribute('src') || '';
              if (source) image.src = source.startsWith('/') && base ? base + source : source;
            }
            const pending = [...document.querySelectorAll('img')].filter((image) => !image.complete);
            await Promise.race([
              Promise.all(pending.map((image) => new Promise((resolve) => ((image.onload = resolve), (image.onerror = resolve))))),
              new Promise((resolve) => setTimeout(resolve, 15000)),
            ]);
          }, process.env.GL_HOST || '');
          result = await capture(page, item, '#comment');
        } else {
          if (!item.url) throw new Error('no URL for this comment in the dump');
          await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 90000 });
          result = await capture(page, item, null);
          if (!result.seen.found) {
            result.problems.push(`page reached: ${page.url().slice(0, 120)}`);
          }
        }
      } catch (error) {
        result = { type: item.type, pr: item.pr, what: item.what, url: item.url, render, status: 'FAIL', problems: [error.message.split('\n')[0]], warnings: [] };
      }
      results.push(result);
      const notes = [...result.problems, ...result.warnings.map((warning) => `(warning) ${warning}`)].join('; ');
      console.log(`V | ${result.status} | ${result.type} | PR ${result.pr} ${result.what} | ${result.picture ? path.basename(result.picture) : 'no picture'}${notes ? ` | ${notes}` : ''}`);
    }
  } finally {
    step('close', 30);
    await page.close().catch(() => {});
    if (own) await browser.close().catch(() => {});
    else await browser.disconnect();
  }
  const counts = { OK: 0, WARN: 0, FAIL: 0 };
  for (const result of results) counts[result.status] += 1;
  fs.writeFileSync(path.join(outDir, 'visual.json'), JSON.stringify({ provider, render, counts, results }, null, 2));
  console.log(`VISUAL CHECK (${provider}, ${render}): ${counts.OK} OK, ${counts.WARN} WARN, ${counts.FAIL} FAIL over ${results.length} comment type(s). Pictures in ${outDir}`);
  clearTimeout(watchdog);
  process.exit(counts.FAIL > 0 ? 1 : 0);
})().catch((error) => {
  console.error(`visual check stopped at "${currentStep}": ${error.message}`);
  process.exit(2);
});
