#!/usr/bin/env node
/*
 * Aggregate Docker pull counts for all sfdx-hardis images and refresh the badge.
 *
 * sfdx-hardis ships several Docker images to two registries (Docker Hub and
 * ghcr.io, now the primary source). The historical shields.io "docker/pulls"
 * badge only counts one image on Docker Hub, so the displayed number is way too
 * low. This script sums the pull counts of every image on both registries and
 * rewrites the badge in README.md and docs/index.md with the aggregated total.
 *
 * Approach mirrors MegaLinter's .automation/docker_stats.py, ported to JS:
 *   - Docker Hub: GET https://hub.docker.com/v2/repositories/<owner>/<image>/ -> pull_count
 *   - ghcr.io:    scrape the "Total downloads" figure from the public package page.
 *
 * Note: GitHub removed the CONTAINER package type from the GraphQL packages API,
 * and there is no REST field exposing container download totals, so scraping the
 * package page is the only working way to read ghcr.io download counts. No token
 * is required (public package pages are viewable anonymously).
 *
 * Usage:
 *   node scripts/update-docker-pulls.mjs           # fetch, sum, rewrite badges
 *   node scripts/update-docker-pulls.mjs --dry-run  # print the total, touch nothing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const DOCKER_HUB_OWNER = 'hardisgroupcom';
const GHCR_OWNER = 'hardisgroupcom';
// Repo hosting the GHCR container packages, used to build the package HTML url.
const GHCR_REPO = 'sfdx-hardis';

// Every image family published by .github/workflows/deploy.yml, present on both
// docker.io/hardisgroupcom/* and ghcr.io/hardisgroupcom/*.
const IMAGES = [
  'sfdx-hardis',
  'sfdx-hardis-ubuntu',
  'sfdx-hardis-with-agents',
  'sfdx-hardis-ubuntu-with-agents',
];

const DOCKER_HUB_API = 'https://hub.docker.com/v2/repositories';
const GITHUB_PACKAGES_HTML_URL = `https://github.com/${GHCR_OWNER}/${GHCR_REPO}/pkgs/container`;

const BADGE_LINK = 'https://hub.docker.com/r/hardisgroupcom/sfdx-hardis/tags';

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * fetch() with a small retry/backoff, matching the resiliency of the Python
 * script's requests Session (retry on 5xx, transient network errors).
 */
async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, options);
      if (resp.status >= 500 && attempt < retries) {
        throw new Error(`HTTP ${resp.status}`);
      }
      return resp;
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        const delayMs = 500 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

/** Docker Hub pull_count for a single repository. */
async function getDockerHubPulls(image) {
  const url = `${DOCKER_HUB_API}/${DOCKER_HUB_OWNER}/${image}/`;
  try {
    const resp = await fetchWithRetry(url);
    if (!resp.ok) {
      console.warn(`Docker Hub: ${image} -> HTTP ${resp.status}, counting 0`);
      return 0;
    }
    const data = await resp.json();
    return typeof data.pull_count === 'number' ? data.pull_count : 0;
  } catch (e) {
    console.warn(`Docker Hub: ${image} -> ${e.message}, counting 0`);
    return 0;
  }
}

/** GHCR download count: scrape "Total downloads" from the public package page. */
async function getGhcrDownloads(image) {
  const url = `${GITHUB_PACKAGES_HTML_URL}/${image}`;
  try {
    const resp = await fetchWithRetry(url);
    if (!resp.ok) {
      console.warn(`GHCR: ${image} -> HTTP ${resp.status}, counting 0`);
      return 0;
    }
    const html = await resp.text();
    const match = html.match(/Total downloads<\/span>\s*<h3[^>]*title="([\d,]+)"/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''), 10);
    }
    console.warn(`GHCR: ${image} -> "Total downloads" not found, counting 0`);
    return 0;
  } catch (e) {
    console.warn(`GHCR: ${image} -> ${e.message}, counting 0`);
    return 0;
  }
}

/** Human-readable formatting: 1234567 -> "1.2M" (ported from number_human_format). */
function numberHumanFormat(num, roundTo = 1) {
  const suffixes = ['', 'k', 'M', 'G', 'T', 'P'];
  let magnitude = 0;
  let value = num;
  while (Math.abs(value) >= 1000 && magnitude < suffixes.length - 1) {
    magnitude += 1;
    value = value / 1000.0;
  }
  return `${value.toFixed(roundTo)}${suffixes[magnitude]}`;
}

function buildBadgeLine(humanTotal) {
  const message = encodeURIComponent(humanTotal).replace(/-/g, '--');
  const badgeUrl = `https://img.shields.io/badge/Docker%20Pulls-${message}-blue`;
  return `[![Docker Pulls](${badgeUrl})](${BADGE_LINK})`;
}

/**
 * Replace the Docker Pulls badge line in a file. Matches both the historical
 * dynamic shields badge and the static badge this script produces, so it is
 * idempotent across runs.
 */
function updateBadgeInFile(relPath, humanTotal) {
  const filePath = path.join(repoRoot, relPath);
  if (!fs.existsSync(filePath)) {
    console.warn(`Skipping ${relPath}: file not found`);
    return false;
  }
  const original = fs.readFileSync(filePath, 'utf8');
  const badgeRegex = /\[!\[Docker Pulls\]\(https:\/\/img\.shields\.io\/[^)]*\)\]\([^)]*\)/;
  if (!badgeRegex.test(original)) {
    console.warn(`Skipping ${relPath}: Docker Pulls badge not found`);
    return false;
  }
  const updated = original.replace(badgeRegex, buildBadgeLine(humanTotal));
  if (updated === original) {
    console.log(`${relPath}: badge already up to date`);
    return false;
  }
  if (!DRY_RUN) {
    fs.writeFileSync(filePath, updated);
  }
  console.log(`${relPath}: badge updated`);
  return true;
}

async function main() {
  let total = 0;
  console.log('Fetching Docker pull counts...\n');
  for (const image of IMAGES) {
    const [dockerHub, ghcr] = await Promise.all([
      getDockerHubPulls(image),
      getGhcrDownloads(image),
    ]);
    const imageTotal = dockerHub + ghcr;
    total += imageTotal;
    console.log(
      `${image}: Docker Hub ${dockerHub.toLocaleString('en-US')} + ghcr.io ${ghcr.toLocaleString('en-US')} = ${imageTotal.toLocaleString('en-US')}`,
    );
  }

  const humanTotal = numberHumanFormat(total);
  console.log(`\nTotal pulls across all images and registries: ${total.toLocaleString('en-US')} (${humanTotal})`);

  if (total === 0) {
    console.error('Total is 0 - refusing to overwrite the badge. Check network access and tokens.');
    process.exit(1);
  }

  const changedReadme = updateBadgeInFile('README.md', humanTotal);
  const changedIndex = updateBadgeInFile(path.join('docs', 'index.md'), humanTotal);

  if (DRY_RUN) {
    console.log('\nDry run - no files were written.');
  } else if (!changedReadme && !changedIndex) {
    console.log('\nNo badge changes needed.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
