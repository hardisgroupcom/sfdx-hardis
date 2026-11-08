// Reads the Agentforce agents of the project from their files: authoring bundles, definitions and
// their running users. Imports no other sfdx-hardis module, so the replacement rules and agentUtils
// can both use it without an import cycle.

import { glob } from 'glob';
import * as path from 'path';
import fs from './fsUtils.js';

export const AGENT_FILES_IGNORE = ['**/node_modules/**', '**/.sfdx/**', '**/.sf/**'];
export const BOT_USER_REGEX = /(<botUser>\s*)([^<]+?)(\s*<\/botUser>)/g;
export const DEFAULT_AGENT_USER_REGEX = /(default_agent_user:\s*")([^"]+)(")/g;

/** A running user written in a file of an agent. */
export interface AgentRunningUserEntry {
  agentName: string;
  username: string;
  // Relative to the project root, with forward slashes
  file: string;
}

/**
 * Authoring bundles of the project, keyed by lowercase folder name: the agent each one belongs to,
 * and whether it is the bundle of a version (<Agent>_<n>, retrieved by "sf project retrieve") rather
 * than the bundle of an agent.
 */
export async function readBundleIndex(projectRoot: string = process.cwd()): Promise<Map<string, { agentName: string; isVersion: boolean }>> {
  const files = await glob('**/aiAuthoringBundles/*/*.{agent,bundle-meta.xml}', { cwd: projectRoot, ignore: AGENT_FILES_IGNORE });
  const folders = new Map<string, string>();
  for (const file of files) {
    const folder = path.dirname(file);
    folders.set(path.basename(folder).toLowerCase(), folder);
  }
  const index = new Map<string, { agentName: string; isVersion: boolean }>();
  for (const [key, folder] of folders) {
    const bundleName = path.basename(folder);
    index.set(key, await describeBundleFolder(path.join(projectRoot, folder), bundleName, (name) => folders.has(name.toLowerCase())));
  }
  return index;
}

/**
 * Agent of an authoring bundle folder, and whether it is the bundle of a version. The meta file of a
 * version bundle (My_Agent_3) names the version of another bundle (<target>My_Agent.v3</target>); the
 * bundle of an agent names none, or a version of itself. A
 * folder with no meta file is a version bundle when its name is <Agent>_<n> and the bundle of <Agent>
 * is there too: an agent may itself be named Support_Agent_2.
 */
export async function describeBundleFolder(
  bundleFolder: string,
  bundleName: string = path.basename(bundleFolder),
  bundleExists: (name: string) => boolean = (name) => fs.existsSync(path.join(path.dirname(bundleFolder), name))
): Promise<{ agentName: string; isVersion: boolean }> {
  const metaFile = path.join(bundleFolder, `${bundleName}.bundle-meta.xml`);
  if (fs.existsSync(metaFile)) {
    const target = /<target>\s*([^<]*?)\s*<\/target>/.exec(await fs.readFile(metaFile, 'utf8'))?.[1];
    const agentName = target?.replace(/\.v\d+$/i, '');
    // The sf agent commands may write <target>My_Agent.v3</target> in the bundle of My_Agent itself
    if (!agentName || agentName.toLowerCase() === bundleName.toLowerCase()) {
      return { agentName: bundleName, isVersion: false };
    }
    return { agentName, isVersion: true };
  }
  const baseName = bundleName.replace(/_\d+$/, '');
  if (baseName !== bundleName && bundleExists(baseName)) {
    return { agentName: baseName, isVersion: true };
  }
  return { agentName: bundleName, isVersion: false };
}

/**
 * Every running user written in the files of the agents of the project: botUser of the definitions
 * (aiAgents), default_agent_user of the Agent Script of the authoring bundles, version bundles
 * included (named after their agent). A service agent runs as a user of its org. bundleIndex: the
 * result of readBundleIndex when the caller already has it.
 */
export async function readAgentRunningUsers(
  projectRoot: string = process.cwd(),
  bundleIndex?: Map<string, { agentName: string; isVersion: boolean }>
): Promise<AgentRunningUserEntry[]> {
  const files = await glob(['**/aiAgents/*.aiAgentDefinition-meta.xml', '**/aiAuthoringBundles/*/*.agent'], { cwd: projectRoot, ignore: AGENT_FILES_IGNORE });
  const bundles = bundleIndex || (await readBundleIndex(projectRoot));
  const entries: AgentRunningUserEntry[] = [];
  for (const file of files.sort()) {
    const agentName = agentNameOfFile(file, bundles);
    if (!agentName) {
      continue;
    }
    const content = await fs.readFile(path.join(projectRoot, file), 'utf8');
    const regex = file.endsWith('.agent') ? DEFAULT_AGENT_USER_REGEX : BOT_USER_REGEX;
    for (const match of content.matchAll(new RegExp(regex.source, 'g'))) {
      entries.push({ agentName, username: match[2].trim(), file: file.replace(/\\/g, '/') });
    }
  }
  return entries;
}

/** Agent of a file of the project: aiAgents/My_Agent.aiAgentDefinition-meta.xml, aiAuthoringBundles/<bundle>/<bundle>.agent */
export function agentNameOfFile(file: string, bundles: Map<string, { agentName: string; isVersion: boolean }>): string | null {
  const base = path.basename(file);
  if (base.endsWith('.aiAgentDefinition-meta.xml')) {
    return base.replace(/\.aiAgentDefinition-meta\.xml$/, '');
  }
  if (base.endsWith('.agent')) {
    const bundleName = base.replace(/\.agent$/, '');
    return bundles.get(bundleName.toLowerCase())?.agentName || bundleName;
  }
  return null;
}
