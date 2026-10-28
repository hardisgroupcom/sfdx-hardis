// Built-in rule builtin-agent-running-user: a service agent runs as a user of its org (botUser of the
// AiAgentDefinition, default_agent_user of the Agent Script of its authoring bundles). The username of
// the org the agent was retrieved from exists nowhere else, so each org gets a user of its own, created
// with "sf org create agent-user" the first time the agent is deployed there, and found again by its
// username at the next deployments: <agent>.<unique id>@<org id>.ext.
// A deployment check or a preview never creates a user: the files keep the username of git.

import c from 'chalk';
import { glob } from 'glob';
import * as path from 'path';
import { Org } from '@salesforce/core';
import fs from '../utils/fsUtils.js';
import { execSfdxJson, uxLog } from '../utils/index.js';
import { soqlQuery } from '../utils/apiUtils.js';
import { t } from '../utils/i18n.js';
import { parsePackageXmlFile } from '../utils/xmlUtils.js';
import { readIssueRules } from './config/issueRulesStore.js';
import { readAllBranchReplacementRules, readProjectReplacementRules } from './config/ruleConfig.js';
import { ReplacementRulePrepareOptions, ReplacementRuleRoot, ReplacementTextOutcome } from './replacementRuleRoot.js';

const BOT_USER_REGEX = /(<botUser>\s*)([^<]+?)(\s*<\/botUser>)/g;
const DEFAULT_AGENT_USER_REGEX = /(default_agent_user:\s*")([^"]+)(")/g;
const AGENT_FILES_IGNORE = ['**/node_modules/**', '**/.sfdx/**', '**/.sf/**'];

export class AgentRunningUserBuiltInRule extends ReplacementRuleRoot {
  public readonly scope = 'text' as const;
  // Lowercase username of git -> username of the target org
  private readonly usernames = new Map<string, string>();

  public async prepare(options: ReplacementRulePrepareOptions): Promise<void> {
    this.usernames.clear();
    if (!this.rule.enabled) {
      return;
    }
    const agents = await listAgentsWithRunningUser(options.packageXmlFiles);
    if (agents.length === 0) {
      return;
    }
    // A rule of the project writes the user: no user is created for nothing
    if (await hasOwnRunningUserRule()) {
      uxLog('log', options.commandThis, c.grey(t('agentRunningUserOwnRule')));
      return;
    }
    const conn = await resolveConnection(options);
    if (!conn) {
      uxLog('log', options.commandThis, c.grey(t('agentRunningUserOrgUnreachable')));
      return;
    }
    const orgId = String(conn.getAuthInfoFields?.().orgId || (await conn.identity()).organization_id || '').toLowerCase();
    const existingUsers = await findExistingUsers(conn, agents.flatMap((agent) => agent.usernames));
    for (const agent of agents) {
      // A user of git that the org has (the org it was retrieved from, or a sandbox copy of it) stays
      if (agent.usernames.every((username) => existingUsers.has(username.toLowerCase()))) {
        continue;
      }
      let targetUsername = await findAgentUser(conn, agent.agentName, orgId);
      if (!targetUsername) {
        if (options.write === false || options.checkOnly) {
          uxLog('action', options.commandThis, c.cyan(t('agentRunningUserWillBeCreated', { agentName: agent.agentName })));
          continue;
        }
        targetUsername = await createAgentUser(agent.agentName, orgId, options);
        if (!targetUsername) {
          continue;
        }
      }
      uxLog('action', options.commandThis, c.cyan(t('agentRunningUserUsed', { agentName: agent.agentName, username: targetUsername })));
      for (const username of agent.usernames) {
        this.usernames.set(username.toLowerCase(), targetUsername);
      }
    }
  }

  public applyToText(content: string): ReplacementTextOutcome {
    let found = 0;
    let changed = 0;
    const replaceUser = (match: string, before: string, username: string, after: string) => {
      found++;
      const targetUsername = this.usernames.get(username.toLowerCase());
      if (!targetUsername || targetUsername === username) {
        return match;
      }
      changed++;
      return `${before}${targetUsername}${after}`;
    };
    const updated = content.replace(BOT_USER_REGEX, replaceUser).replace(DEFAULT_AGENT_USER_REGEX, replaceUser);
    if (found === 0) {
      return { content, found: 0, changed: 0, status: 'not-found' };
    }
    if (changed === 0) {
      return { content, found, changed: 0, status: 'unchanged' };
    }
    return { content: updated, found, changed, status: 'changed', detail: t('agentRunningUserReplaced', { count: changed }) };
  }
}

/** Agents of the deployment that run as a user, with every username their files hold */
export async function listAgentsWithRunningUser(packageXmlFiles?: string[], projectRoot: string = process.cwd()): Promise<Array<{ agentName: string; usernames: string[] }>> {
  const deployed = await listDeployedAgentNames(packageXmlFiles);
  const files = await glob(['**/aiAgents/*.aiAgentDefinition-meta.xml', '**/aiAuthoringBundles/*/*.agent'], { cwd: projectRoot, ignore: AGENT_FILES_IGNORE });
  const byAgent = new Map<string, { agentName: string; usernames: Set<string> }>();
  for (const file of files.sort()) {
    const agentName = agentNameOfFile(file);
    if (!agentName || (deployed && !deployed.has(agentName.toLowerCase()))) {
      continue;
    }
    const content = await fs.readFile(path.join(projectRoot, file), 'utf8');
    const regex = file.endsWith('.agent') ? DEFAULT_AGENT_USER_REGEX : BOT_USER_REGEX;
    for (const match of content.matchAll(new RegExp(regex.source, 'g'))) {
      const entry = byAgent.get(agentName.toLowerCase()) || { agentName, usernames: new Set<string>() };
      entry.usernames.add(match[2].trim());
      byAgent.set(agentName.toLowerCase(), entry);
    }
  }
  return [...byAgent.values()].map((entry) => ({ agentName: entry.agentName, usernames: [...entry.usernames] }));
}

/** True when a rule of the project (config, a branch file or the issue) writes botUser or default_agent_user. */
export async function hasOwnRunningUserRule(): Promise<boolean> {
  const rules: any[] = [...(await readProjectReplacementRules())];
  for (const branch of await readAllBranchReplacementRules()) {
    rules.push(...branch.rules);
  }
  rules.push(...((await readIssueRules({ useCache: true })).rules || []));
  return rules.some((rule) => rule?.enabled !== false && !rule?.builtIn && /botUser|default_agent_user/.test(`${rule?.xmlPath || ''} ${rule?.find || ''}`));
}

/** Base username given to "sf org create agent-user", which adds a unique id before the @ */
export function buildAgentUserBaseUsername(agentName: string, orgId: string): string {
  const localPart = agentName.toLowerCase().replace(/[^a-z0-9.-]/g, '-');
  return `${localPart}@${orgId.toLowerCase()}.ext`;
}

// Agents of the package.xml files (AiAgentDefinition, or the agent of an AiAgentDefinitionVersion or an
// AiAuthoringBundle). null: no package.xml, every agent of the project.
async function listDeployedAgentNames(packageXmlFiles?: string[]): Promise<Set<string> | null> {
  if (!packageXmlFiles || packageXmlFiles.length === 0) {
    return null;
  }
  const names = new Set<string>();
  for (const packageXmlFile of packageXmlFiles) {
    if (!packageXmlFile || !fs.existsSync(packageXmlFile)) {
      continue;
    }
    const content = await parsePackageXmlFile(packageXmlFile);
    for (const member of content['AiAgentDefinition'] || []) {
      names.add(String(member).toLowerCase());
    }
    for (const member of content['AiAgentDefinitionVersion'] || []) {
      names.add(String(member).split('#')[0].toLowerCase());
    }
    for (const member of content['AiAuthoringBundle'] || []) {
      names.add(String(member).replace(/_\d+$/, '').toLowerCase());
    }
  }
  names.delete('*');
  return names;
}

// aiAgents/My_Agent.aiAgentDefinition-meta.xml and aiAuthoringBundles/My_Agent_2/My_Agent_2.agent -> My_Agent
function agentNameOfFile(file: string): string | null {
  const base = path.basename(file);
  if (base.endsWith('.aiAgentDefinition-meta.xml')) {
    return base.replace(/\.aiAgentDefinition-meta\.xml$/, '');
  }
  if (base.endsWith('.agent')) {
    return base.replace(/\.agent$/, '').replace(/_\d+$/, '');
  }
  return null;
}

async function resolveConnection(options: ReplacementRulePrepareOptions): Promise<any | null> {
  try {
    if (options.conn) {
      return options.conn;
    }
    if (options.targetUsername) {
      return (await Org.create({ aliasOrUsername: options.targetUsername })).getConnection();
    }
  } catch {
    // Org not reachable: the files keep the usernames of git
  }
  return null;
}

async function findExistingUsers(conn: any, usernames: string[]): Promise<Set<string>> {
  const unique = [...new Set(usernames.map((username) => username.toLowerCase()))];
  if (unique.length === 0) {
    return new Set();
  }
  const result = await soqlQuery(`SELECT Username FROM User WHERE Username IN (${unique.map(soqlString).join(',')})`, conn);
  return new Set((result.records || []).map((record: any) => String(record.Username).toLowerCase()));
}

// The active agent user created by this rule for the agent at a previous deployment
async function findAgentUser(conn: any, agentName: string, orgId: string): Promise<string | null> {
  // The base username holds no "_" nor "%", the wildcards of LIKE
  const [localPart, domain] = buildAgentUserBaseUsername(agentName, orgId).split('@');
  const pattern = `${localPart}.%@${domain}`;
  const result = await soqlQuery(
    `SELECT Username FROM User WHERE Username LIKE ${soqlString(pattern)} AND IsActive = true AND Profile.Name = 'Einstein Agent User' ORDER BY CreatedDate ASC LIMIT 1`,
    conn
  );
  return result.records?.[0]?.Username || null;
}

async function createAgentUser(agentName: string, orgId: string, options: ReplacementRulePrepareOptions): Promise<string | null> {
  const targetUsername = options.targetUsername || options.conn?.getUsername?.();
  const command =
    'sf org create agent-user' +
    ` --base-username ${buildAgentUserBaseUsername(agentName, orgId)}` +
    ' --first-name Agent' +
    ` --last-name ${agentName}` +
    ` --target-org ${targetUsername}` +
    ' --json';
  uxLog('action', options.commandThis, c.cyan(t('agentRunningUserCreating', { agentName })));
  const res = await execSfdxJson(command, options.commandThis, { fail: false, output: false });
  const username = res?.result?.username || res?.result?.user?.username || res?.result?.Username || null;
  if (res?.status !== 0 || !username) {
    uxLog('warning', options.commandThis, c.yellow(t('agentRunningUserCreationFailed', { agentName, message: res?.message || JSON.stringify(res?.result || {}) })));
    return null;
  }
  return username;
}

function soqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
