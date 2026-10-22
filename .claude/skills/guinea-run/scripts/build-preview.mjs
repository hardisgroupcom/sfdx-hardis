// Builds the playable preview of Guinea Run, published as a claude.ai Artifact.
//   node build-preview.mjs <outDir>
// Copies the game, the pictures it loads and the badge banners from the
// sibling sfdx-hardis-training, renames the .glb models .wasm (an Artifact only
// serves standard web media types; application/wasm passes, and the glTF
// loader reads the bytes the same) and points game.js and core/models.js at
// them, adds the launcher page, and writes <outDir>/files.json: the `files`
// map to publish with `root` set to <outDir>.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TRAINING } from "./training-repo.mjs";

const out = process.argv[2];
if (!out) {
  console.error("usage: node build-preview.mjs <outDir>");
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const theme = path.join(TRAINING, "site-theme");
const files = {};

function copy(from, to) {
  fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
  fs.copyFileSync(from, path.join(out, to));
  files[to] = to.endsWith(".wasm") ? { from: to, contentType: "application/wasm" } : to;
}

function copyTree(fromDir, toDir) {
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, entry.name);
    const to = toDir + "/" + entry.name;
    if (entry.isDirectory()) {
      copyTree(from, to);
    } else if (entry.name.endsWith(".glb")) {
      copy(from, to.replace(/\.glb$/, ".wasm"));
    } else if (!entry.name.endsWith(".txt")) {
      copy(from, to);
    }
  }
}

copyTree(path.join(theme, "javascripts", "guinea-run"), "theme/javascripts/guinea-run");
// The lab titles of the map cards: written by scripts/build/site.mjs, not kept in site-theme
const labs = ["site-src", "site"].map((dir) => path.join(TRAINING, dir, "theme", "javascripts", "guinea-run", "labs.js")).find((file) => fs.existsSync(file));
if (labs) {
  copy(labs, "theme/javascripts/guinea-run/labs.js");
} else {
  console.warn("No labs.js: run node scripts/build/site.mjs in the training repository, or the cards show no lab links");
}
for (const name of ["game.js", "core/models.js"]) {
  const file = path.join(out, "theme/javascripts/guinea-run", name);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll(".glb", ".wasm"));
}
for (const name of ["cloudity-text-logo-white.svg", "guinea-pig.webp", "mariia.svg", "romain.svg"]) {
  copy(path.join(theme, "images", name), "theme/images/" + name);
}
copyTree(path.join(theme, "images", "bosses"), "theme/images/bosses");
for (const level of [1, 2, 3]) {
  copy(path.join(TRAINING, "badges", "img", "banner-level-" + level + ".svg"), "badges/img/banner-level-" + level + ".svg");
}
// The Hall of Fame as committed: an Artifact may not reach raw.githubusercontent, the game then reads this copy
const board = path.join(TRAINING, "hall-of-fame", "hall-of-fame.json");
if (fs.existsSync(board)) {
  copy(board, "hall-of-fame/hall-of-fame.json");
}
fs.copyFileSync(path.join(here, "preview", "index.html"), path.join(out, "index.html"));
fs.writeFileSync(path.join(out, "files.json"), JSON.stringify(files, null, 2));
console.log(Object.keys(files).length + " files in " + out + ", the page is index.html, the publish map is files.json");
