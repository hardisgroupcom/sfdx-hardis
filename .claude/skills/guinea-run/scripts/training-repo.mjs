// Where the sibling sfdx-hardis-training clone is, and its Playwright.
// GUINEA_TRAINING overrides the default ../sfdx-hardis-training.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const TRAINING = process.env.GUINEA_TRAINING || path.resolve(here, "..", "..", "..", "..", "..", "sfdx-hardis-training");

export async function playwright() {
  return import(pathToFileURL(path.join(TRAINING, "node_modules", "playwright-core", "index.mjs")).href);
}
