/* eslint-disable */
// "Trusted by" block of the documentation site, built from scripts/trusted-by/testimonials.yml.
// Called by build.cjs before the pages generated from README.md and docs/llms.txt.
// The made-up entries (example: true) are left out unless { examples: true } is passed, which only
// yarn build:trusted-by:examples does, for a local preview. Every file written with them carries
// EXAMPLES_MARKER, so the pre-commit hook (node build.cjs --check-trusted-by) refuses to commit it.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const DATA_FILE = "./scripts/trusted-by/testimonials.yml";
const IMAGES_DIR = "./docs/assets/images/trusted-by";
// The cards of the site use paths from the root of the site, so they work on any page depth.
// The README uses absolute URLs: npm does not resolve relative image paths.
const SITE_IMAGES_PATH = "/assets/images/trusted-by/";
const ABSOLUTE_IMAGES_URL = "https://sfdx-hardis.cloudity.com/assets/images/trusted-by/";
const PAGE_URL = "https://sfdx-hardis.cloudity.com/trusted-by/";
const CONTACT_URL = "https://cloudity.com/contact-us/";
const CARDS_FILE = "./docs/assets/trusted-by.json";
const PAGE_FILE = "./docs/trusted-by.md";
// docs/index.md is generated from README.md by sf hardis:doc:plugin:generate: updating it here too
// keeps it right between two runs of that command
const MARKED_FILES = ["./README.md", "./docs/index.md", "./docs/salesforce-devops-home.md"];
const START_MARKER = "<!-- trusted-by:start -->";
const END_MARKER = "<!-- trusted-by:end -->";
const MKDOCS_FILE = "./mkdocs.yml";
const NAV_ANCHOR = "  - What's new in v8: sfdx-hardis-v8.md";
const NAV_LINE = "  - Trusted by: trusted-by.md";
const EXAMPLES_MARKER = "trusted-by:examples";
const EXAMPLES_NOTE = `${EXAMPLES_MARKER}: local preview, never commit`;
const GENERATED_FILES = [...MARKED_FILES, CARDS_FILE, PAGE_FILE, MKDOCS_FILE];
// Below this number of real approved testimonials, nothing is shown: one or two cards look empty
const MIN_TESTIMONIALS = 3;
const MAX_QUOTE_WORDS = 40;
const LOGOS_PER_ROW = 4;
const REQUIRED_FIELDS = ["customer", "website", "logo", "person", "role", "quote"];
const LOGO_EXTENSIONS = [".svg", ".png"];
const PHOTO_EXTENSIONS = [".svg", ".png", ".jpg", ".jpeg", ".webp"];

function buildTrustedBy(writeFileIfChanged, options = {}) {
  console.log("Building the Trusted by block...");
  const testimonials = loadApprovedTestimonials(options.examples === true);
  const withExamples = testimonials.some((t) => t.example === true);
  for (const file of MARKED_FILES) {
    writeMarkedBlock(file, renderLogoGrid(testimonials, withExamples), writeFileIfChanged);
  }
  writeCardsFile(testimonials, withExamples, writeFileIfChanged);
  writePage(testimonials, withExamples, writeFileIfChanged);
  syncNavEntry(testimonials.length > 0, withExamples, writeFileIfChanged);
  console.log(`Trusted by: ${testimonials.length} testimonial(s) shown`);
}

// Fails when a staged file still holds the made-up testimonials of a local preview
function checkStagedTrustedByExamples() {
  const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], { encoding: "utf-8" })
    .split(/\r?\n/)
    .filter(Boolean);
  const generated = GENERATED_FILES.map((file) => path.posix.normalize(file));
  const withExamples = staged.filter(
    (file) =>
      generated.includes(file) &&
      execFileSync("git", ["show", `:${file}`], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }).includes(EXAMPLES_MARKER),
  );
  if (withExamples.length > 0) {
    console.error(
      `These staged files show the made-up Trusted by testimonials of a local preview:\n- ${withExamples.join("\n- ")}\n` +
        "Run yarn build:trusted-by, stage them again, then commit.",
    );
    process.exit(1);
  }
}

// Approved entries only, checked, featured first then in the order of the file.
// Entries that are not approved are skipped without being checked: a draft can be incomplete.
// The made-up ones (example: true) are kept only for a local preview, which also ignores MIN_TESTIMONIALS.
function loadApprovedTestimonials(includeExamples) {
  const data = yaml.load(fs.readFileSync(DATA_FILE, "utf-8")) || {};
  const approved = (data.testimonials || []).filter((t) => t && t.approved === true);
  checkTestimonials(approved);
  const examples = approved.filter((t) => t.example === true);
  if (examples.length > 0 && includeExamples) {
    console.warn(
      `WARNING: ${examples.length} made-up example testimonial(s) are shown, for a local preview only. Run yarn build:trusted-by before committing.`,
    );
  } else if (examples.length > 0) {
    console.log(`${examples.length} made-up example testimonial(s) left out. Preview them locally with yarn build:trusted-by:examples.`);
  }
  const shown = includeExamples ? approved : approved.filter((t) => t.example !== true);
  if (!includeExamples && shown.length < MIN_TESTIMONIALS) {
    if (shown.length > 0) {
      console.log(`${shown.length} real testimonial(s) approved: the Trusted by block stays hidden until there are ${MIN_TESTIMONIALS}.`);
    }
    return [];
  }
  return [...shown.filter((t) => t.featured === true), ...shown.filter((t) => t.featured !== true)];
}

function checkTestimonials(testimonials) {
  const errors = [];
  const seen = new Set();
  for (const t of testimonials) {
    const label = `${t.customer || "?"} / ${t.person || "?"}`;
    for (const field of REQUIRED_FIELDS) {
      if (typeof t[field] !== "string" || t[field].trim() === "") {
        errors.push(`${label}: ${field} is missing`);
      }
    }
    if (typeof t.website === "string" && !t.website.startsWith("https://")) {
      errors.push(`${label}: website must start with https://`);
    }
    checkImage(t.logo, LOGO_EXTENSIONS, `${label}: logo`, errors);
    if (t.photo !== undefined && t.photo !== null) {
      checkImage(t.photo, PHOTO_EXTENSIONS, `${label}: photo`, errors);
    }
    if (seen.has(label)) {
      errors.push(`${label}: listed twice`);
    }
    seen.add(label);
    const words = typeof t.quote === "string" ? t.quote.trim().split(/\s+/).length : 0;
    if (words > MAX_QUOTE_WORDS) {
      console.warn(`WARNING: ${label}: the quote has ${words} words, ${MAX_QUOTE_WORDS} at most keeps the cards readable`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid testimonials in ${DATA_FILE}:\n- ${errors.join("\n- ")}`);
  }
}

function checkImage(file, extensions, label, errors) {
  if (typeof file !== "string" || file.trim() === "") {
    return;
  }
  if (!extensions.includes(path.extname(file).toLowerCase())) {
    errors.push(`${label} must be ${extensions.join(", ")}`);
  }
  if (!fs.existsSync(path.join(IMAGES_DIR, file))) {
    errors.push(`${label} ${file} is not in ${IMAGES_DIR}`);
  }
}

// Plain HTML, so GitHub and npm show it: no class they would keep, no style, no script.
// On the documentation site, trusted-by.js replaces it with the carousel.
function renderLogoGrid(testimonials, withExamples) {
  if (testimonials.length === 0) {
    return "";
  }
  const rows = [];
  for (let i = 0; i < testimonials.length; i += LOGOS_PER_ROW) {
    const cells = testimonials.slice(i, i + LOGOS_PER_ROW).map(
      (t) =>
        `<td align="center"><a href="${escapeHtml(t.website)}"><img src="${ABSOLUTE_IMAGES_URL}${escapeHtml(t.logo)}" alt="${escapeHtml(t.customer)} logo" height="36"/></a><br/><sub>${escapeHtml(t.customer)}</sub></td>`,
    );
    rows.push(`<tr>${cells.join("")}</tr>`);
  }
  return [
    ...(withExamples ? [`<!-- ${EXAMPLES_NOTE} -->`] : []),
    '<div class="trusted-by">',
    "<p><strong>Trusted by</strong></p>",
    "<table>",
    ...rows,
    "</table>",
    `<p><a href="${PAGE_URL}">See what they say about sfdx-hardis</a></p>`,
    "</div>",
  ].join("\n");
}

function writeMarkedBlock(file, block, writeFileIfChanged) {
  const content = fs.readFileSync(file, "utf-8");
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${file} must contain ${START_MARKER} then ${END_MARKER}`);
  }
  const inner = block ? `\n\n${block}\n\n` : "\n";
  const updated = content.substring(0, start + START_MARKER.length) + inner + content.substring(end);
  writeFileIfChanged(file, updated);
}

function writeCardsFile(testimonials, withExamples, writeFileIfChanged) {
  const cards = testimonials.map((t) => ({ featured: t.featured === true, html: renderCard(t) }));
  const data = withExamples ? { preview: EXAMPLES_NOTE, cards } : { cards };
  writeFileIfChanged(CARDS_FILE, JSON.stringify(data, null, 2) + "\n");
}

// The only place the markup of a card is written: the carousel and the Trusted by page both use it.
// off-glb keeps the glightbox plugin from wrapping the images in a link of its own, which would
// break the logo link on the Trusted by page.
function renderCard(t) {
  const photo = t.photo
    ? `<img class="tb-card__photo off-glb" src="${SITE_IMAGES_PATH}${escapeHtml(t.photo)}" alt="" loading="lazy"/>`
    : "";
  return [
    '<figure class="tb-card">',
    `<a class="tb-card__logo" href="${escapeHtml(t.website)}" target="_blank" rel="noopener"><img class="off-glb" src="${SITE_IMAGES_PATH}${escapeHtml(t.logo)}" alt="${escapeHtml(t.customer)} logo" loading="lazy"/></a>`,
    `<blockquote class="tb-card__quote"><p>${escapeHtml(t.quote.trim())}</p></blockquote>`,
    `<figcaption class="tb-card__person">${photo}<span class="tb-card__who"><strong>${escapeHtml(t.person)}</strong><span>${escapeHtml(t.role)}</span></span></figcaption>`,
    "</figure>",
  ].join("");
}

function writePage(testimonials, withExamples, writeFileIfChanged) {
  if (testimonials.length === 0) {
    if (fs.existsSync(PAGE_FILE)) {
      fs.unlinkSync(PAGE_FILE);
      console.log(`Removed ${PAGE_FILE}`);
    }
    return;
  }
  const md = [
    "---",
    'title: "Trusted by"',
    'description: "Teams that run their Salesforce CI/CD with sfdx-hardis, in their own words."',
    "---",
    "<!-- This file is generated by build.cjs from scripts/trusted-by/testimonials.yml. Do not edit it by hand. -->",
    ...(withExamples ? [`<!-- ${EXAMPLES_NOTE} -->`] : []),
    "",
    "# Trusted by",
    "",
    "Teams that run their Salesforce CI/CD with sfdx-hardis, in their own words.",
    "",
    '<ul class="tb-grid">',
    ...testimonials.map((t) => `<li>${renderCard(t)}</li>`),
    "</ul>",
    "",
    `Your team uses sfdx-hardis too? [Tell us about it](${CONTACT_URL}).`,
    "",
  ];
  writeFileIfChanged(PAGE_FILE, md.join("\n"));
}

// A text edit, not a YAML rewrite, so the comments of mkdocs.yml are kept
function syncNavEntry(show, withExamples, writeFileIfChanged) {
  const content = fs.readFileSync(MKDOCS_FILE, "utf-8");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const navIndex = lines.findIndex((line) => line === NAV_LINE || line.startsWith(`${NAV_LINE} #`));
  if (navIndex !== -1) {
    lines.splice(navIndex, 1);
  }
  if (show) {
    const anchorIndex = lines.indexOf(NAV_ANCHOR);
    if (anchorIndex === -1) {
      throw new Error(`${MKDOCS_FILE} must contain the line "${NAV_ANCHOR}": the Trusted by menu entry goes after it`);
    }
    lines.splice(anchorIndex + 1, 0, withExamples ? `${NAV_LINE} # ${EXAMPLES_NOTE}` : NAV_LINE);
  }
  writeFileIfChanged(MKDOCS_FILE, lines.join(eol));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = { buildTrustedBy, checkStagedTrustedByExamples };
