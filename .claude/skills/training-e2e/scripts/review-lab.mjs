#!/usr/bin/env node
/**
 * Lays out everything needed to review one lab's text against its images.
 *
 *   node review-lab.mjs 1.4
 *   node review-lab.mjs 1.4 --locale fr
 *   node review-lab.mjs --level 2          every lab of a level
 *
 * It walks the lab step by step, the way the course is written: a step is a
 * heading, it can show several images, and the pills of all of them are pooled
 * and cited once in that step's text. For each step it prints the images to open
 * with the Read tool, the pills drawn on them, and the step's text.
 *
 * scripts/verify/check-pills.mjs in the course repository is the authority on
 * whether the numbers agree, and it is the one to run for a verdict. What it
 * cannot do is look at the picture, and that is the failure this course keeps
 * having: a screenshot whose numbers still line up but whose panel no longer
 * looks like the product. So this prints the text and hands over the image; the
 * judgement is the reviewer's.
 */
import fs from "fs";
import path from "path";
import { COURSE } from "./env.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const locale = flag("locale", "en");
const level = flag("level", null);
const ids = argv.filter((a) => /^\d+\.\d+$/.test(a));

const manifest = JSON.parse(fs.readFileSync(path.join(COURSE, "training-manifest.json"), "utf8"));
const spec = JSON.parse(fs.readFileSync(path.join(COURSE, "labs", "_assets", "annotations.json"), "utf8")).images || {};

/**
 * annotations.json keys an image variant as "vscode/cards.png#new-user-story",
 * and annotate.mjs writes it as "vscode/cards--new-user-story.png". Same
 * transform as check-pills.mjs: keep the two in step.
 */
function annotatedName(key) {
  const [rel, variant] = key.split("#");
  if (!variant) {
    return rel;
  }
  const ext = path.extname(rel);
  return `${rel.slice(0, -ext.length)}--${variant}${ext}`;
}

const pillsByFile = new Map(
  Object.entries(spec).map(([key, entry]) => [
    annotatedName(key),
    (entry.pills || []).map((p) => Number(p.n)).sort((a, b) => a - b)
  ])
);

const wanted = manifest.labs.filter((l) => {
  const id = `${l.level}.${l.lab}`;
  return ids.length ? ids.includes(id) : level ? String(l.level) === String(level) : true;
});
if (wanted.length === 0) {
  console.log("no lab matched. Give an id like 1.4, or --level 2.");
  process.exit(1);
}

for (const lab of wanted) {
  const id = `${lab.level}.${lab.lab}`;
  const rel = locale === "en" ? lab.file : lab.translations?.[locale]?.file;
  const url = locale === "en" ? lab.url : lab.translations?.[locale]?.url;
  if (!rel) {
    console.log(`\nLab ${id}: no ${locale} version.`);
    continue;
  }
  const abs = path.join(COURSE, rel);
  const lines = fs.readFileSync(abs, "utf8").split("\n");

  console.log(`\n${"=".repeat(78)}\nLab ${id} - ${lab.title}\n${url}\n${rel}`);

  // Step boundaries: every heading. The step is the unit the pills and the text
  // have to agree on.
  const bounds = [];
  lines.forEach((line, i) => {
    if (/^#{2,}\s/.test(line)) {
      bounds.push(i);
    }
  });
  bounds.push(lines.length);

  let shown = 0;
  for (let b = 0; b < bounds.length - 1; b++) {
    const from = bounds[b];
    const block = lines.slice(from, bounds[b + 1]);
    const heading = lines[from].replace(/^#+ /, "");
    const images = block
      .map((line) => line.match(/!\[[^\]]*\]\(([^)]+\.png)\)/))
      .filter(Boolean)
      .map((m) => m[1]);
    if (images.length === 0) {
      continue;
    }
    shown += images.length;

    const declared = new Set();
    console.log(`\n  ## ${heading}`);
    for (const target of images) {
      const name = target.split("_assets/annotated/")[1];
      const file = path.resolve(path.dirname(abs), target);
      if (!name) {
        console.log(`  --- ${target}\n      RAW: points at a screenshot that carries no pills`);
        continue;
      }
      const pills = pillsByFile.get(name);
      (pills || []).forEach((n) => declared.add(n));
      console.log(`  --- ${name}`);
      console.log(`      read:  ${file}`);
      console.log(`      pills: ${pills ? pills.join(", ") || "(none drawn)" : "NO ENTRY in annotations.json"}`);
      if (!fs.existsSync(file)) {
        console.log(`      MISSING: the image file does not exist`);
      }
    }

    // What the step cites. Bold is the course's notation: **(1)**
    const cited = [...new Set([...block.join("\n").matchAll(/\*\*\((\d+)\)\*\*/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
    console.log(`      cited in this step: ${cited.join(", ") || "(none)"}`);

    console.log(`\n${block.join("\n").split("\n").map((l) => `      ${l}`).join("\n")}`);
  }

  if (shown === 0) {
    console.log("\n  No image in this lab. Check the text against the product on its own.");
  }
}
