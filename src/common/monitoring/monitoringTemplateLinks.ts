// Links to the exact lines of the default monitoring pipelines that keep the full git history, which the
// Flow history documentation needs. GitHub anchors are line numbers: a test checks that each line
// still holds what its link promises, so an edit of a template cannot silently break them.

export interface MonitoringTemplateLink {
  platform: string;
  label: string;
  file: string;
  line: number;
  // Text the line must contain
  expected: string;
}

export const MONITORING_TEMPLATE_LINKS: MonitoringTemplateLink[] = [
  { platform: 'Gitlab', label: 'Env variable [`GIT_FETCH_EXTRA_FLAGS: --depth 10000`]', file: 'defaults/monitoring/.gitlab-ci.yml', line: 17, expected: 'GIT_FETCH_EXTRA_FLAGS: --depth 10000' },
  { platform: 'GitHub', label: '[`fetch-depth: 0`]', file: 'defaults/monitoring/.github/workflows/org-monitoring.yml', line: 69, expected: 'fetch-depth: 0' },
  { platform: 'Azure', label: '[`fetchDepth: "0"`]', file: 'defaults/monitoring/azure-pipelines.yml', line: 52, expected: 'fetchDepth: "0"' },
  { platform: 'Bitbucket', label: '[`step: clone: depth: full`]', file: 'defaults/monitoring/bitbucket-pipelines.yml', line: 29, expected: 'depth: full' },
];

/** Markdown list of the four links, as written in the command descriptions */
export function getMonitoringFetchDepthLinksMarkdown(): string {
  return MONITORING_TEMPLATE_LINKS.map(
    (link) => `- on ${link.platform}: ${link.label}(https://github.com/hardisgroupcom/sfdx-hardis/blob/main/${link.file}#L${link.line})`
  ).join('\n');
}
