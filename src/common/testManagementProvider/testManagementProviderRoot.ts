import { SfError } from '@salesforce/core';
import { NormalizedTestCase } from '../utils/testNotebookUtils.js';
import { tEn } from '../utils/i18n.js';
// Type-only: the ticket providers never import the test management ones
import type { TicketProviderKey } from '../ticketProvider/index.js';

/** What a provider returns for a test case that exists on its side. */
export interface ProviderRef {
  id: string;
  url: string;
}

/** Ticket a summary of the test cases is posted on, with the ticketing connector to post it with. */
export interface CarrierTicketRef {
  ticketId: string;
  /** Unset: the connector is deduced from the shape of the identifier */
  ticketProviderKey?: TicketProviderKey;
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

  /**
   * The ticket the cases of `ticket` are linked to, as the ticketing connectors know it. Each tool
   * names its tracker, so a PROJ-123 carrier of an Azure DevOps project never goes to JIRA.
   */
  public carrierTicketRef(ticket: string): CarrierTicketRef {
    return { ticketId: ticket };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async linkToStory(_ref: ProviderRef, _storyId: string): Promise<void> {
    throw new SfError(`linkToStory is not implemented on ${this.getLabel()}`);
  }

  /**
   * Plain text description shared by the trackers whose description field cannot render markup.
   * Written in English whatever the locale: the tracker is shared, and a run in another language
   * must not rewrite every description.
   *
   * A field the notebook does not define keeps the block `existing` already holds, as the Azure
   * DevOps HTML description does. A field defined but empty drops its block.
   */
  public static buildPlainDescription(testCase: NormalizedTestCase, existing: unknown = ''): string {
    const linksToUrls = (text: string): string => text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$2');
    const kept = _plainBlocks(existing);
    const blocks: string[] = [];
    const add = (labelKey: string, value: string | undefined, render: (text: string) => string = (text) => text): void => {
      const label = tEn(labelKey);
      if (value === undefined) {
        const block = kept.get(label);
        if (block) {
          blocks.push(block);
        }
      } else if (value) {
        blocks.push(`${label} ${render(value)}`);
      }
    };
    add('testCaseModule', testCase.module);
    add('testCaseTarget', testCase.target);
    add('testCasePreconditions', testCase.preconditions, linksToUrls);
    add('testCaseOverallExpectedResult', testCase.expected, linksToUrls);
    add('testCaseSoqlQuery', testCase.soql);
    return blocks.join('\n');
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

/** Labels of the plain description blocks, in the order they are written. */
const PLAIN_BLOCK_LABEL_KEYS = ['testCaseModule', 'testCaseTarget', 'testCasePreconditions', 'testCaseOverallExpectedResult', 'testCaseSoqlQuery'];

/**
 * The blocks of a plain description, keyed by their label. A block starts on a line opening with
 * a label and runs until the next one, so a multi-line precondition stays whole.
 */
function _plainBlocks(text: unknown): Map<string, string> {
  const labels = PLAIN_BLOCK_LABEL_KEYS.map((key) => tEn(key));
  const blocks = new Map<string, string>();
  let current: { label: string; lines: string[] } | null = null;
  const flush = (): void => {
    if (current) {
      blocks.set(current.label, current.lines.join('\n'));
    }
  };
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const label = labels.find((candidate) => line.startsWith(`${candidate} `) || line === candidate);
    if (label) {
      flush();
      current = { label, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return blocks;
}
