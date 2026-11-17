/**
 * docs/assets/command-screenshots.json: what the command pages show. Written by the runner for
 * the commands of a run (the others are kept as they are), read by hardis:doc:plugin:generate.
 *
 * {
 *   "commands": {
 *     "hardis:org:diagnose:unusedusers": {
 *       "shots": [{ "image": "assets/images/commands/org/diagnose/unusedusers.webp",
 *                   "caption": "...", "pills": [{ "n": 1, "x": 10, "y": 20, "w": 5, "h": 3, "legend": "..." }] }],
 *       "reports": { "unused-users": { "image": "assets/images/commands/org/diagnose/unusedusers-report-unused-users.webp" } }
 *     },
 *     "hardis:doc:plugin:generate": { "skip": "why it has no screenshot" }
 *   }
 * }
 *
 * Image paths are relative to the docs folder.
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const COMMENT =
  "Screenshots of the command pages, written by scripts/command-screenshots/run.mjs (yarn screenshots:commands) and read by hardis:doc:plugin:generate. Image paths are relative to docs/. Pill coordinates are percentages of the image, legends are shown under it as (n).";

export function readManifest(file) {
  if (!fs.existsSync(file)) {
    return { _comment: COMMENT, commands: {} };
  }
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.commands = manifest.commands || {};
  return manifest;
}

export function writeManifest(file, manifest) {
  const commands = Object.fromEntries(Object.keys(manifest.commands).sort().map((key) => [key, manifest.commands[key]]));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ _comment: COMMENT, commands }, null, 2) + "\n");
}

/** Where the images of a command go, relative to docs/. */
export function imagePathOf(commandPathParts, suffix = "") {
  const parts = [...commandPathParts];
  const name = parts.pop();
  return ["assets", "images", "commands", ...parts, `${name}${suffix}.webp`].join("/");
}

/**
 * Draws the pills on each capture and writes it as WebP under docs/. `items`:
 * [{ source: png, pills: [...], image: path relative to docs/ }]
 */
export async function renderImages(repoRoot, items) {
  if (items.length === 0) {
    return;
  }
  const annotate = await import(pathToFileURL(path.join(repoRoot, "scripts", "annotate-doc-images.mjs")).href);
  const browser = await annotate.launchBrowser();
  try {
    const page = await browser.newPage();
    for (const item of items) {
      await annotate.renderAnnotated(
        page,
        item.source,
        (item.pills || []).map(({ n, x, y, w, h }) => ({ n, x, y, w, h })),
        path.join(repoRoot, "docs", ...item.image.split("/"))
      );
    }
  } finally {
    await browser.close();
  }
}
