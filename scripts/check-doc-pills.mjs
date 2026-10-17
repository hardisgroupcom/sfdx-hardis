#!/usr/bin/env node
/**
 * Checks that the pills drawn on a screenshot and the pills a VS Code guide
 * refers to are the same pills.
 *
 *   node scripts/check-doc-pills.mjs
 *
 * Ported from the sfdx-hardis-training repository (scripts/verify/check-pills.mjs).
 * The rule the guides are written to: an image carries numbered pills, and the
 * step that shows it refers to those numbers in its text as **(n)**. The two
 * drift apart silently, because nothing fails when a guide says "(3)" over an
 * image with two pills, or when a pill nobody mentions is left on an image.
 *
 * Scope: the VS Code guides, docs/vscode-extension*.md. For every screenshot
 * they show (PNG, JPEG or WebP, as Markdown or <img>):
 *   - it must be the annotated copy (docs/assets/images/annotated/...)
 *   - the pill numbers declared for it in docs/assets/annotations.json must be
 *     exactly the **(n)** references of its step (a heading down to the next)
 * Animated GIFs are not screenshots of a step and are left alone.
 *
 * It also proves that docs/stylesheets/extra.css paints each (n) reference in
 * the colour of its pill, and lists annotated images no page uses.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PILL_PALETTE, loadSpec, resolveKey } from "./annotate-doc-images.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DOCS = path.join(ROOT, "docs");
const EXTRA_CSS = path.join(DOCS, "stylesheets", "extra.css");
const ANNOTATED = "assets/images/annotated/";

const pillsByFile = new Map();
for (const [key, entry] of loadSpec()) {
  pillsByFile.set(
    resolveKey(key).out,
    (entry.pills || []).map((pill) => Number(pill.n)).sort((a, b) => a - b)
  );
}

const pages = fs
  .readdirSync(DOCS)
  .filter((name) => /^vscode-extension.*\.md$/.test(name))
  .map((name) => path.join(DOCS, name));

const problems = [];
const referenced = new Set();
let checked = 0;

for (const file of pages) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  // Fenced code blocks are blanked, keeping line numbers: a "## " or a **(2)**
  // inside a YAML or Markdown sample is not a step or a pill reference
  let fenced = false;
  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return "";
      }
      return fenced ? "" : line;
    });

  // Cut the page into steps: a heading and everything under it, up to the next
  // heading. A step is what a reader has in front of them at one moment, and it
  // is the unit the pills and the text have to agree on.
  const bounds = [0];
  lines.forEach((line, index) => {
    if (/^#{2,4} /.test(line)) {
      bounds.push(index);
    }
  });
  bounds.push(lines.length);

  for (let b = 0; b < bounds.length - 1; b++) {
    const from = bounds[b];
    const block = lines.slice(from, bounds[b + 1]);
    const heading = lines[from].replace(/^#+ /, "");

    const images = [];
    block.forEach((line, offset) => {
      // Markdown and HTML images of any still format: a raw .jpg must fail as
      // surely as a raw .png. Animated GIFs are the panel recordings, not steps.
      const still = /\.(png|jpe?g|webp)$/i;
      const targets = [
        ...[...line.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map((m) => m[1]),
        ...[...line.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]),
      ];
      for (const target of targets.filter((t) => still.test(t))) {
        images.push({ target, line: from + offset + 1 });
      }
    });
    const cited = new Set([...block.join("\n").matchAll(/\*\*\((\d+)\)\*\*/g)].map((m) => Number(m[1])));
    if (images.length === 0) {
      if (cited.size > 0) {
        problems.push(`${rel}:${from + 1} "${heading}" cites (${[...cited].join("), (")}) but shows no screenshot`);
      }
      continue;
    }

    const before = problems.length;
    const declared = new Set();
    for (const image of images) {
      if (!image.target.includes(ANNOTATED)) {
        problems.push(`${rel}:${image.line} points at a raw screenshot, not the annotated copy: ${image.target}`);
        continue;
      }
      const name = image.target.split(ANNOTATED)[1];
      referenced.add(name);
      checked++;
      const pills = pillsByFile.get(name);
      if (!pills) {
        problems.push(`${rel}:${image.line} uses ${name}, which has no entry in docs/assets/annotations.json`);
        continue;
      }
      pills.forEach((n) => declared.add(n));
    }
    if (problems.length > before) {
      continue;
    }
    const shown = images.map((i) => i.target.split("/").pop()).join(", ");
    const invented = [...cited].filter((n) => !declared.has(n)).sort((a, b) => a - b);
    const uncited = [...declared].filter((n) => !cited.has(n)).sort((a, b) => a - b);
    if (invented.length > 0) {
      problems.push(`${rel}:${images[0].line} "${heading}" cites (${invented.join("), (")}) which no pill in ${shown} carries`);
    }
    if (uncited.length > 0) {
      problems.push(`${rel}:${images[0].line} "${heading}" shows pill(s) ${uncited.join(", ")} in ${shown} that the step never mentions`);
    }
  }
}

// The (n) references are painted by docs/javascripts/pill-refs.js with the
// classes of extra.css: a colour missing there would paint "(3)" in the wrong hue
const css = fs.existsSync(EXTRA_CSS) ? fs.readFileSync(EXTRA_CSS, "utf8").toLowerCase() : "";
PILL_PALETTE.forEach((color, index) => {
  const rule = new RegExp(`\\.pill-ref-${index + 1}\\s*\\{[^}]*${color.toLowerCase()}`);
  if (!rule.test(css)) {
    problems.push(`docs/stylesheets/extra.css: .pill-ref-${index + 1} is not ${color}, the colour of pill ${index + 1}`);
  }
});

const orphans = [...pillsByFile.keys()].filter((name) => !referenced.has(name));

console.log(`${checked} image reference(s) in ${pages.length} page(s) checked against ${pillsByFile.size} annotated image(s).`);

if (orphans.length > 0) {
  console.log(`\n${orphans.length} annotated image(s) no page references:`);
  orphans.forEach((name) => console.log(`  ${name}`));
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  problems.forEach((line) => console.error(`  ${line}`));
  process.exit(1);
}

console.log("Every guide cites exactly the pills its screenshots carry.");
