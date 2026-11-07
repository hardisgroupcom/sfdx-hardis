import c from 'chalk';
import { SfError } from '@salesforce/core';
import { uxLog } from './index.js';
import { t } from './i18n.js';
import { prompts } from './prompts.js';
import { uxLogTableWithReport } from './filesUtils.js';
import { DevOrgPerson, DevOrgSummary, DevOrgsSummary, formatDevOrgPerson, parseDevOrgPerson } from './devOrgsRules.js';

/** "Jane <jane@x.com>, john@y.com": throws on an entry that has no email */
export function parseDevOrgPersonList(value: string | null | undefined): DevOrgPerson[] {
  // "Name <email>" (a name may hold a comma, like "Doe, Jane") or a bare email, separated by
  // commas, semicolons or new lines
  const text = value || '';
  const pattern = /[^\s,;<>]+@[^\s,;<>]+(?![^<]*>)|[^;\n<>]*<[^<>\n]+>/g;
  const entries: string[] = [];
  let leftover = '';
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    leftover += text.slice(last, match.index);
    entries.push(match[0].replace(/^[\s,]+/, '').trim());
    last = (match.index || 0) + match[0].length;
  }
  leftover += text.slice(last);
  const stray = leftover.replace(/[\s,;]+/g, ' ').trim();
  if (stray !== '') {
    throw new SfError(t('devOrgInvalidPerson', { value: stray }));
  }
  return entries.filter((entry) => entry !== '').map((entry) => {
    const person = parseDevOrgPerson(entry);
    if (!person) {
      throw new SfError(t('devOrgInvalidPerson', { value: entry }));
    }
    return person;
  });
}

/** One person, or null for an empty value. Throws when the value has no email. */
export function parseDevOrgPersonFlag(value: string | null | undefined): DevOrgPerson | null {
  if (!value || value.trim() === '') {
    return null;
  }
  const person = parseDevOrgPerson(value);
  if (!person) {
    throw new SfError(t('devOrgInvalidPerson', { value }));
  }
  return person;
}

export async function promptDevOrgOwner(initial: DevOrgPerson | null): Promise<DevOrgPerson | null> {
  const response = await prompts({
    type: 'text',
    name: 'owner',
    message: c.cyanBright(t('devOrgOwnerPrompt')),
    description: t('devOrgOwnerPromptDescription'),
    placeholder: 'Ex: Jane Doe <jane.doe@example.com>',
    initial: formatDevOrgPerson(initial),
  });
  return parseDevOrgPersonFlag(response.owner) || initial;
}

export async function promptDevOrgUsers(initial: DevOrgPerson[]): Promise<DevOrgPerson[]> {
  const response = await prompts({
    type: 'text',
    name: 'users',
    message: c.cyanBright(t('devOrgUsersPrompt')),
    description: t('devOrgUsersPromptDescription'),
    placeholder: 'Ex: Jane Doe <jane.doe@example.com>, john.smith@example.com',
    initial: initial.map((person) => formatDevOrgPerson(person)).join(', '),
  });
  return parseDevOrgPersonList(response.users);
}

export async function selectRegisteredDevOrg(orgs: DevOrgSummary[]): Promise<DevOrgSummary | null> {
  if (orgs.length === 0) {
    return null;
  }
  const response = await prompts({
    type: 'select',
    name: 'orgId',
    message: c.cyanBright(t('devOrgSelectToRemove')),
    description: t('devOrgSelectToRemoveDescription'),
    choices: orgs.map((org) => ({
      title: `${org.name} (${org.targetBranch})`,
      description: [org.owner?.name, org.instanceUrl].filter(Boolean).join(' - '),
      value: org.orgId,
    })),
  });
  return orgs.find((org) => org.orgId === response.orgId) || null;
}

export async function confirmDevOrgRemoval(org: DevOrgSummary): Promise<boolean> {
  const response = await prompts({
    type: 'confirm',
    name: 'value',
    message: c.cyanBright(t('devOrgConfirmRemove', { name: org.name })),
    description: t('devOrgConfirmRemoveDescription'),
    initial: false,
  });
  return response.value === true;
}

/** The orgs of the registry, as a table (with a report file when there are many) */
export async function logDevOrgsSummary(commandThis: any, summary: DevOrgsSummary, orgs: DevOrgSummary[]): Promise<void> {
  if (orgs.length > 0) {
    await uxLogTableWithReport(
      commandThis,
      orgs.map((org) => ({
        org: org.name,
        type: org.orgType,
        targetBranch: org.targetBranch,
        owner: org.owner?.name || '',
        users: org.users.map((user) => user.name).join(', '),
        behind: org.behind ? `${org.behind.count}${org.behind.cutOff ? '+' : ''}` : '?',
        lastBackpromote: org.lastBackpromote ? org.lastBackpromote.date.slice(0, 10) : '',
        lastActivity: org.lastActivityAt.slice(0, 10),
        stale: org.stale ? 'yes' : '',
      })),
      ['org', 'type', 'targetBranch', 'owner', 'users', 'behind', 'lastBackpromote', 'lastActivity', 'stale'],
      { fileNamePrefix: 'dev-orgs', fileTitle: 'Development orgs' }
    );
  }
  for (const org of orgs.filter((candidate) => (candidate.behind?.count || 0) > 0)) {
    uxLog("log", commandThis, c.grey(t('devOrgBehindSummary', { name: org.name, count: org.behind!.count, branch: org.targetBranch, date: org.startDate.slice(0, 10) })));
  }
  if (summary.dashboardUrl) {
    uxLog("log", commandThis, c.grey(t('devOrgsDashboardUrl', { url: summary.dashboardUrl })));
  }
}
