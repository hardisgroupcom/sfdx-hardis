// Generates the Pull Request comment banner images used by sfdx-hardis.
// One image per comment type and status, so a reader identifies a comment while scrolling a Pull Request:
// the background palette says which comment it is, the status color and badge say how it went.
//
// Rendered with headless Chrome through puppeteer-core (already a dependency of the project).
// Chrome is located the same way as the runtime commands: PUPPETEER_EXECUTABLE_PATH, then the
// installations found by chrome-launcher.
//
// Run from the repository root:
//   node scripts/generate-pr-banners.mjs
// Output: docs/assets/images/pr-banner-*.png

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import { Launcher } from 'chrome-launcher';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const imagesDir = path.join(rootDir, 'docs/assets/images');
const assetsDir = path.join(rootDir, 'scripts/pr-banner-assets');

const WIDTH = 1200;
const HEIGHT = 128;

// Cloudity palettes. Violet to blue is sampled on the official Cloudity banner, teal is the
// color of the logo mark: three backgrounds a reader tells apart at a glance while scrolling.
const TYPES = {
  validation: { label: 'Validation', icon: 'search', from: '#00718F', to: '#36BDE8' },
  deployment: { label: 'Deployment', icon: 'cloudUp', from: '#610EED', to: '#0152FF' },
  actions: { label: 'Deployment Actions', icon: 'checklist', from: '#150C33', to: '#4A2AA8' },
};

const STATUSES = {
  success: { color: '#2FD07E', icon: 'check' },
  failure: { color: '#FF5B70', icon: 'cross' },
  pending: { color: '#FFB020', icon: 'clock' },
};

// Validation and deployment comments are only posted once completed: their only statuses are
// success and failure, so no pending banner exists for them.
const VARIANTS = [
  { file: 'pr-banner-validation-success.png', type: 'validation', status: 'success', text: 'Deployment simulation successful' },
  { file: 'pr-banner-validation-failure.png', type: 'validation', status: 'failure', text: 'Deployment simulation failed' },
  { file: 'pr-banner-deployment-success.png', type: 'deployment', status: 'success', text: 'Deployment successful' },
  { file: 'pr-banner-deployment-failure.png', type: 'deployment', status: 'failure', text: 'Deployment failed' },
  { file: 'pr-banner-actions-completed.png', type: 'actions', status: 'success', text: 'All actions completed' },
  { file: 'pr-banner-actions-pending.png', type: 'actions', status: 'pending', text: 'Manual actions pending' },
  { file: 'pr-banner-actions-error.png', type: 'actions', status: 'failure', text: 'Actions in error' },
];

// Lucide icon paths, drawn as strokes so they stay sharp at any size
const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  cloudUp: '<path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/>',
  checklist: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  cross: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
};

const icon = (name, size, strokeWidth = 2.2) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const base64 = (file) => fs.readFileSync(file).toString('base64');
const font = (weight) => base64(path.join(assetsDir, `poppins-${weight}.woff2`));
const logo = base64(path.join(imagesDir, 'cloudity-text-logo-white.svg'));

function buildHtml(variant) {
  const type = TYPES[variant.type];
  const status = STATUSES[variant.status];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Poppins;font-weight:500;src:url(data:font/woff2;base64,${font(500)}) format('woff2')}
@font-face{font-family:Poppins;font-weight:600;src:url(data:font/woff2;base64,${font(600)}) format('woff2')}
@font-face{font-family:Poppins;font-weight:700;src:url(data:font/woff2;base64,${font(700)}) format('woff2')}
*{margin:0;padding:0;box-sizing:border-box}
body{background:transparent;font-family:Poppins,sans-serif;-webkit-font-smoothing:antialiased}
.banner{width:${WIDTH}px;height:${HEIGHT}px;border-radius:16px;overflow:hidden;position:relative;display:flex;align-items:center;
  background:linear-gradient(100deg,${type.from},${type.to})}
</style></head><body>
<div class="banner">
  <div style="position:absolute;right:-155px;top:-155px;width:440px;height:440px;border-radius:50%;background:#05050D"></div>
  <div style="position:absolute;left:-70px;top:-130px;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.18),transparent 62%)"></div>
  <div style="position:absolute;left:0;top:0;bottom:0;width:9px;background:${status.color}"></div>
  <div style="position:relative;display:flex;align-items:center;gap:20px;padding-left:34px;flex:none">
    <div style="width:66px;height:66px;border-radius:20px;background:rgba(255,255,255,.16);border:1.5px solid rgba(255,255,255,.34);display:flex;align-items:center;justify-content:center;color:#fff;flex:none">${icon(type.icon, 34)}</div>
    <div>
      <div style="font-size:15px;font-weight:600;letter-spacing:2.4px;text-transform:uppercase;color:rgba(255,255,255,.72);line-height:1">${type.label}</div>
      <div style="margin-top:7px;font-size:31px;font-weight:700;color:#fff;letter-spacing:-.4px;line-height:1.05">${variant.text}</div>
    </div>
  </div>
  <div style="position:relative;flex:1;display:flex;justify-content:flex-end;padding-right:34px">
    <div style="width:62px;height:62px;border-radius:50%;background:${status.color};display:flex;align-items:center;justify-content:center;color:#0B0A16;box-shadow:0 8px 22px rgba(0,0,0,.28)">${icon(status.icon, 32, 3)}</div>
  </div>
  <div style="position:relative;padding-right:26px;display:flex;flex-direction:column;align-items:center;gap:5px;flex:none">
    <div style="font-size:17px;font-weight:600;color:#fff;letter-spacing:.2px">sfdx-hardis</div>
    <div style="display:flex;align-items:center;gap:7px">
      <span style="font-size:11px;color:rgba(255,255,255,.6);font-weight:500">by</span>
      <img src="data:image/svg+xml;base64,${logo}" style="width:104px">
    </div>
  </div>
</div></body></html>`;
}

function getChromeExecutablePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || '';
  if (fromEnv !== '' && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  const installations = Launcher.getInstallations();
  if (installations && installations.length > 0) {
    return installations[0];
  }
  throw new Error('No Chrome installation found. Install Chrome or set PUPPETEER_EXECUTABLE_PATH.');
}

const browser = await puppeteer.launch({
  executablePath: getChromeExecutablePath(),
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH + 40, height: HEIGHT + 40, deviceScaleFactor: 1 });

for (const variant of VARIANTS) {
  await page.setContent(buildHtml(variant), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const element = await page.$('.banner');
  const filePath = path.join(imagesDir, variant.file);
  await element.screenshot({ path: filePath, omitBackground: true });
  console.log(`Generated ${filePath}`);
}

await browser.close();
