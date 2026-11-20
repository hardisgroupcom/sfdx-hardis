/**
 * Screenshots of the command pages (docs/hardis/**): the reports a command declares, and the
 * manifest of the images that scripts/command-screenshots/run.mjs writes for each command.
 */
import fs from 'fs';
import path from 'path';

/**
 * A report file a command writes (a CSV and its XLSX copy). Declared on the command class as
 * `public static reports: CommandReport[]`, it is listed on the command page with an image of
 * the XLSX opened in Excel.
 */
export interface CommandReport {
  /** Name prefix the command gives generateReportPath() / generateCsvFile(), e.g. "unused-users" */
  file: string;
  /** Short title, e.g. "Unused users" */
  title: string;
  /** What a row of the report is, and what the report helps to do */
  description: string;
}

/** A numbered pill drawn on a screenshot, in percent of the image, with its legend. */
export interface CommandShotPill {
  n: number;
  x: number;
  y: number;
  w: number;
  h: number;
  legend: string;
}

/** One screenshot of a command running in VS Code. */
export interface CommandShot {
  /** Path relative to the docs folder, e.g. "assets/images/commands/org/diagnose/licenses.webp" */
  image: string;
  caption?: string;
  pills?: CommandShotPill[];
}

/** The images of one command, or why it has none. */
export interface CommandScreenshotsEntry {
  shots?: CommandShot[];
  /** Image of each declared report, by report file prefix */
  reports?: Record<string, { image: string }>;
  /** Reason why the command has no screenshot on purpose */
  skip?: string;
}

export interface CommandScreenshotsManifest {
  commands: Record<string, CommandScreenshotsEntry>;
}

/** Where the manifest lives, relative to the docs folder. */
export const COMMAND_SCREENSHOTS_MANIFEST = 'assets/command-screenshots.json';

/** Reads docs/assets/command-screenshots.json, or returns null when the project has none. */
export function readCommandScreenshotsManifest(docsRoot: string): CommandScreenshotsManifest | null {
  const file = path.join(docsRoot, ...COMMAND_SCREENSHOTS_MANIFEST.split('/'));
  if (!fs.existsSync(file)) {
    return null;
  }
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { commands: manifest.commands || {} };
}

/**
 * The commands with no screenshot (nor a reason to have none), and the declared reports with no
 * image: what the documentation still misses. An image listed in the manifest but missing on
 * disk counts as missing.
 */
/**
 * The entry of a command in the manifest. An alias (hardis:deploy:start) has no entry of its own:
 * its page shows the screenshots of the command it stands for (hardis:project:deploy:start).
 */
export function findCommandScreenshotsEntry(
  manifest: CommandScreenshotsManifest | null,
  commandId: string,
  commands: { id: string; aliases?: string[] }[]
): CommandScreenshotsEntry | null {
  if (!manifest) {
    return null;
  }
  if (manifest.commands[commandId]) {
    return manifest.commands[commandId];
  }
  const target = commands.find((command) => command.id !== commandId && (command.aliases || []).includes(commandId));
  return target ? manifest.commands[target.id] || null : null;
}

export function listMissingCommandScreenshots(
  docsRoot: string,
  manifest: CommandScreenshotsManifest,
  commands: { id: string; reports?: CommandReport[] }[],
  // Every command of the plugin, to find the command an alias stands for
  allCommands: { id: string; aliases?: string[] }[] = commands
): { commands: string[]; reports: string[] } {
  const missingCommands: string[] = [];
  const missingReports: string[] = [];
  const exists = (image: string) => fs.existsSync(path.join(docsRoot, ...image.split('/')));
  for (const command of commands) {
    const entry = findCommandScreenshotsEntry(manifest, command.id, allCommands);
    if (entry?.skip) {
      continue;
    }
    const shots = (entry?.shots || []).filter((shot) => exists(shot.image));
    if (shots.length === 0) {
      missingCommands.push(command.id);
    }
    for (const report of command.reports || []) {
      const image = entry?.reports?.[report.file]?.image;
      if (!image || !exists(image)) {
        missingReports.push(`${command.id} (${report.file})`);
      }
    }
  }
  return { commands: missingCommands, reports: missingReports };
}

/** Relative path from a page of the docs folder to a file of the docs folder. */
export function docsRelativeLink(pageRelativePath: string, target: string): string {
  const depth = pageRelativePath.split('/').length - 1;
  return '../'.repeat(depth) + target;
}
