#!/usr/bin/env node
/**
 * Draws numbered pills on documentation screenshots, so a guide can say
 * "click (2)" instead of describing where a button is.
 *
 *   node scripts/annotate-doc-images.mjs             # everything that changed
 *   node scripts/annotate-doc-images.mjs --force     # everything
 *   node scripts/annotate-doc-images.mjs --check     # nothing is missing or stale
 *
 * Ported from the sfdx-hardis-training repository (scripts/build/annotate.mjs),
 * with the same palette and the same spec format, so a pill looks the same in
 * the course and in the product documentation.
 *
 * Sources stay untouched: the screenshot scripts of vscode-sfdx-hardis
 * (yarn screenshots + scripts/build-doc-images.py) write docs/assets/images and
 * overwrite it whenever the captures are taken again. The annotated copies are
 * written under docs/assets/images/annotated/, which is what the pages reference.
 *
 * The pill positions live in docs/assets/annotations.json, in percentages of the
 * image, so re-taking a screenshot at another resolution does not move them.
 *
 * Rendering needs a local Chrome, which CI does not have, so the annotated
 * images are committed and --check proves they match the spec: each stamp of
 * .stamps.json holds the hash of the source, the spec entry and the drawing
 * code, and the hash of the image drawn from them. Set
 * PUPPETEER_EXECUTABLE_PATH when Chrome is not installed in its default place.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const IMAGES = path.join(ROOT, "docs", "assets", "images");
export const SPEC = path.join(ROOT, "docs", "assets", "annotations.json");
const OUT_ROOT = path.join(IMAGES, "annotated");
const STAMPS = path.join(OUT_ROOT, ".stamps.json");

const FORCE = process.argv.includes("--force");
const CHECK = process.argv.includes("--check");

// One colour per number, so "the 3" is findable in a busy screenshot even before
// you read the digit. Deliberately high contrast against both VS Code themes.
// Same values as the training: docs/stylesheets/extra.css repeats them for the
// (n) references in the text, and check-doc-pills.mjs proves the two agree.
export const PILL_PALETTE = [
  "#e5322d", // 1 red
  "#0b72d9", // 2 blue
  "#e08800", // 3 amber
  "#128a4a", // 4 green
  "#8a37c9", // 5 purple
  "#c2185b", // 6 pink
  "#00838f", // 7 teal
  "#5d4037", // 8 brown
  "#3949ab", // 9 indigo
  "#455a64", // 10 slate
];

export function pillColor(n) {
  return PILL_PALETTE[(Number(n) - 1) % PILL_PALETTE.length];
}

// Width and height straight out of the PNG IHDR chunk, so this needs no image library
function pngSize(file) {
  const fd = fs.openSync(file, "r");
  const head = Buffer.alloc(24);
  fs.readSync(fd, head, 0, 24, 0);
  fs.closeSync(fd);
  if (head.toString("ascii", 1, 4) !== "PNG") {
    throw new Error(`Not a PNG: ${file}`);
  }
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

// A key may carry a variant after a "#", so one screenshot can be marked up
// several times for several steps:
//   "vscode-guide/devops-pipeline.png#branch"
//     source docs/assets/images/vscode-guide/devops-pipeline.png
//     output docs/assets/images/annotated/vscode-guide/devops-pipeline--branch.png
export function resolveKey(key) {
  const [rel, variant] = key.split("#");
  if (!variant) {
    return { source: rel, out: rel };
  }
  const ext = path.extname(rel);
  return { source: rel, out: `${rel.slice(0, -ext.length)}--${variant}${ext}` };
}

export function loadSpec() {
  const raw = JSON.parse(fs.readFileSync(SPEC, "utf8"));
  return Object.entries(raw.images || {});
}

function sha1(...parts) {
  const hash = crypto.createHash("sha1");
  parts.forEach((part) => hash.update(part));
  return hash.digest("hex").slice(0, 16);
}

// Changing how pills are drawn (buildHtml) makes every stamp stale, like
// changing a source screenshot or its spec entry does
function specHash(source, entry) {
  return sha1(fs.readFileSync(source), JSON.stringify(entry), buildHtml.toString());
}

// A stamp is current when it was drawn from this spec and the committed image
// is the one it wrote: a hand-edited or replaced annotated image is stale too
function isCurrent(item, stamp) {
  return (
    Boolean(stamp) &&
    stamp.spec === item.hash &&
    fs.existsSync(item.out) &&
    stamp.out === sha1(fs.readFileSync(item.out))
  );
}

function buildHtml(dataUri, size, marks, scale) {
  const shapes = marks
    .map((mark) => {
      const color = mark.color || pillColor(mark.n);
      const pieces = [];
      if (mark.w && mark.h) {
        pieces.push(
          `<div class="box" style="left:${mark.x}%;top:${mark.y}%;width:${mark.w}%;height:${mark.h}%;border-color:${color}"></div>`
        );
      }
      // The pill sits on the corner of the box, or on the point when there is no
      // box. px/py override it, for a target too close to an edge to carry it.
      const px = mark.px === undefined ? mark.x : mark.px;
      const py = mark.py === undefined ? mark.y : mark.py;
      pieces.push(`<div class="pill" style="left:${px}%;top:${py}%;background:${color}">${mark.n}</div>`);
      return pieces.join("");
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#00000000}
    #wrap{position:relative;width:${size.width}px;height:${size.height}px;transform-origin:0 0;transform:scale(${scale})}
    #wrap img{display:block;width:${size.width}px;height:${size.height}px}
    .box{position:absolute;border:3px solid;border-radius:6px;box-sizing:border-box;
         box-shadow:0 0 0 2px rgba(255,255,255,.75),0 2px 10px rgba(0,0,0,.35)}
    .pill{position:absolute;transform:translate(-72%,-72%);
          min-width:30px;height:30px;padding:0 7px;border-radius:15px;
          display:flex;align-items:center;justify-content:center;
          font:700 18px/1 "Segoe UI",system-ui,sans-serif;color:#fff;
          border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5)}
  </style></head><body><div id="wrap"><img src="${dataUri}">${shapes}</div></body></html>`;
}

function workItem(key, entry) {
  const { source: srcRel, out: outRel } = resolveKey(key);
  const source = path.join(IMAGES, srcRel);
  return { rel: key, entry, source, out: path.join(OUT_ROOT, outRel), hash: specHash(source, entry) };
}

async function launchBrowser() {
  const { default: puppeteer } = await import("puppeteer-core");
  // Its own headless Chrome, never the user's browser: this only renders local
  // files, so it needs no session, and an isolated instance cannot be blocked by
  // whatever the user is doing in theirs.
  const options = { headless: true };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else {
    options.channel = "chrome";
  }
  return puppeteer.launch(options);
}

async function main() {
  const entries = loadSpec();
  const stamps = fs.existsSync(STAMPS) ? JSON.parse(fs.readFileSync(STAMPS, "utf8")) : {};
  const todo = [];
  const problems = [];

  for (const [key, entry] of entries) {
    const { source: srcRel } = resolveKey(key);
    if (!fs.existsSync(path.join(IMAGES, srcRel))) {
      problems.push(`${key}: no such screenshot in docs/assets/images`);
      continue;
    }
    // Past the palette, pill 11 would be drawn red like pill 1 while its (11)
    // in the text has no colour at all
    for (const pill of entry.pills || []) {
      const n = Number(pill.n);
      if (!Number.isInteger(n) || n < 1 || n > PILL_PALETTE.length) {
        problems.push(`${key}: pill ${pill.n} is outside 1-${PILL_PALETTE.length}`);
      }
    }
    const item = workItem(key, entry);
    if (!isCurrent(item, stamps[key])) {
      todo.push(item);
    }
  }

  if (problems.length > 0) {
    problems.forEach((p) => console.error(p));
    process.exit(1);
  }

  if (CHECK) {
    if (todo.length === 0) {
      console.log(`${entries.length} annotated screenshot(s), all current.`);
      return;
    }
    console.error(`${todo.length} annotated screenshot(s) missing or stale:`);
    todo.forEach((t) => console.error(`  ${t.rel}`));
    console.error("\nRun: yarn doc:annotate");
    process.exit(1);
  }

  const work = FORCE ? entries.map(([key, entry]) => workItem(key, entry)) : todo;
  if (work.length === 0) {
    console.log(`${entries.length} annotated screenshot(s), all current.`);
    return;
  }

  // Stamps of keys removed from the spec go, so the file never grows stale
  const known = new Set(entries.map(([key]) => key));
  const kept = Object.fromEntries(Object.entries(stamps).filter(([key]) => known.has(key)));
  const saveStamps = () => {
    fs.mkdirSync(OUT_ROOT, { recursive: true });
    fs.writeFileSync(STAMPS, `${JSON.stringify(kept, null, 2)}\n`);
  };

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    for (const item of work) {
      const size = pngSize(item.source);
      const dataUri = `data:image/png;base64,${fs.readFileSync(item.source).toString("base64")}`;
      // A very large viewport is slow, so wide screenshots are drawn at a scale
      // that keeps them workable
      const scale = Math.min(1, 1600 / size.width);
      const vw = Math.ceil(size.width * scale);
      const vh = Math.ceil(size.height * scale);
      await page.setViewport({ width: vw, height: vh });
      await page.setContent(buildHtml(dataUri, size, item.entry.pills || [], scale), { waitUntil: "load" });
      fs.mkdirSync(path.dirname(item.out), { recursive: true });
      await page.screenshot({ path: item.out, clip: { x: 0, y: 0, width: vw, height: vh } });
      // Saved after every image: a failure halfway keeps the work already done
      kept[item.rel] = { spec: item.hash, out: sha1(fs.readFileSync(item.out)) };
      saveStamps();
      console.log(`${item.rel} (${(item.entry.pills || []).length} pill(s))`);
    }
  } finally {
    await browser.close();
  }
  saveStamps();
  console.log(`\n${work.length} screenshot(s) annotated into docs/assets/images/annotated/.`);
}

// Only when this file is the command being run: check-doc-pills.mjs imports the
// palette from here, and importing a module must not draw every pill.
// Node resolves symlinks and junctions in import.meta.url, not in argv[1].
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
