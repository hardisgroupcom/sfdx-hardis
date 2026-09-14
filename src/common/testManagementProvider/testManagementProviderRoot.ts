import { SfError } from '@salesforce/core';
import { NormalizedTestCase } from '../utils/testNotebookUtils.js';
import { tEn } from '../utils/i18n.js';

/** What a provider returns for a test case that exists on its side. */
export interface ProviderRef {
  id: string;
  url: string;
}

/**
 * Abstract root of the test management providers, modeled on `TicketProviderRoot`.
 *
 * A provider reads its settings in its constructor and sets `isActive`. Being active only means
 * it could be used: the upsert command sends the cases to the one provider named by --provider or
 * by the `testCasesProvider` configuration.
 */
export abstract class TestManagementProviderRoot {
  /** True when every setting this provider needs is available. */
  public isActive = false;

  public getLabel(): string {
    throw new SfError('getLabel should be implemented on this class');
  }

  /** Settings this provider needs, so the command can say exactly what to set. */
  public getRequiredEnvVars(): string[] {
    return [];
  }

  /** Probe the target before any write. Must throw with an actionable reason. */
  public async checkPrerequisites(): Promise<void> {
    throw new SfError(`checkPrerequisites is not implemented on ${this.getLabel()}`);
  }

  /**
   * Check what the cases need on the tracker side before anything is written, dry run included.
   * Throwing here refuses the whole run for this provider.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async prepare(_cases: NormalizedTestCase[]): Promise<void> {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async findByKey(_key: string): Promise<ProviderRef | null> {
    throw new SfError(`findByKey is not implemented on ${this.getLabel()}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async create(_testCase: NormalizedTestCase): Promise<ProviderRef> {
    throw new SfError(`create is not implemented on ${this.getLabel()}`);
  }

  /**
   * Update an existing case. Only fields the notebook carries are sent (an `undefined` field is
   * left as the tracker has it), and fields owned by the tracker (assignee, iteration, labels
   * added by hand) are never overwritten.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async update(_ref: ProviderRef, _testCase: NormalizedTestCase): Promise<ProviderRef> {
    throw new SfError(`update is not implemented on ${this.getLabel()}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async linkToStory(_ref: ProviderRef, _storyId: string): Promise<void> {
    throw new SfError(`linkToStory is not implemented on ${this.getLabel()}`);
  }

  /**
   * Plain text description shared by the trackers whose description field cannot render markup.
   * Written in English whatever the locale: the tracker is shared, and a run in another language
   * must not rewrite every description.
   */
  public static buildPlainDescription(testCase: NormalizedTestCase): string {
    const linksToUrls = (text: unknown): string => String(text ?? '').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$2');
    const lines: string[] = [];
    if (testCase.module) {
      lines.push(`${tEn('testCaseModule')} ${testCase.module}`);
    }
    if (testCase.target) {
      lines.push(`${tEn('testCaseTarget')} ${testCase.target}`);
    }
    if (testCase.preconditions) {
      lines.push(`${tEn('testCasePreconditions')} ${linksToUrls(testCase.preconditions)}`);
    }
    if (testCase.expected) {
      lines.push(`${tEn('testCaseOverallExpectedResult')} ${linksToUrls(testCase.expected)}`);
    }
    if (testCase.soql) {
      lines.push(`${tEn('testCaseSoqlQuery')} ${testCase.soql}`);
    }
    return lines.join('\n');
  }

  /**
   * Message of a failed HTTP call, with what the server answered: "Request failed with status
   * code 400" alone does not say which field Jira or ServiceNow refused.
   */
  public static describeHttpError(e: any): string {
    const data = e?.response?.data;
    const details: string[] = [];
    if (data && typeof data === 'object') {
      if (Array.isArray(data.errorMessages)) {
        details.push(...data.errorMessages);
      }
      if (data.errors && typeof data.errors === 'object' && !Array.isArray(data.errors)) {
        details.push(...Object.entries(data.errors).map(([field, message]) => `${field}: ${message}`));
      }
      if (Array.isArray(data.errors)) {
        details.push(...data.errors.map((error: any) => error?.message ?? String(error)));
      }
      if (typeof data.error === 'string') {
        details.push(data.error);
      }
      if (data.error?.message) {
        details.push([data.error.message, data.error.detail].filter(Boolean).join(' - '));
      }
      if (typeof data.message === 'string') {
        details.push(data.message);
      }
    } else if (typeof data === 'string' && data.trim()) {
      details.push(data.trim().slice(0, 300));
    }
    const message = e?.message ?? String(e);
    return details.length > 0 ? `${message}: ${details.join('; ')}` : message;
  }
}
