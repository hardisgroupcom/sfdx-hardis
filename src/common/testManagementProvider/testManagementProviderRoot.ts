import { SfError } from '@salesforce/core';
import { NormalizedTestCase } from '../utils/testNotebookTypes.js';

/** What a provider returns for a test case that exists on its side. */
export interface ProviderRef {
  id: string;
  url: string;
}

/**
 * Abstract root of the test management providers, modeled on `TicketProviderRoot`.
 *
 * A provider turns itself on in its own constructor by reading its environment variables and
 * setting `isActive`. No command ever names a provider, and there is no `--provider` flag to
 * keep in sync: adding a provider means adding it to `allTestManagementProviders` and
 * nothing else. This is also what makes authentication live in exactly one place per
 * provider, which was the whole point of moving this code here.
 */
export abstract class TestManagementProviderRoot {
  /** True when every environment variable this provider needs is set. */
  public isActive = false;

  public getLabel(): string {
    throw new SfError('getLabel should be implemented on this call');
  }

  /**
   * Names of the environment variables this provider needs, so a command whose providers are
   * all inactive can tell the user exactly what to set instead of just failing.
   */
  public getRequiredEnvVars(): string[] {
    return [];
  }

  /** Probe the target before any write. Must throw with an actionable reason. */
  public async checkPrerequisites(): Promise<void> {
    throw new SfError(`checkPrerequisites is not implemented on ${this.getLabel()}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async findByKey(_key: string): Promise<ProviderRef | null> {
    throw new SfError(`findByKey is not implemented on ${this.getLabel()}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async create(_testCase: NormalizedTestCase): Promise<ProviderRef> {
    throw new SfError(`create is not implemented on ${this.getLabel()}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async update(_ref: ProviderRef, _testCase: NormalizedTestCase): Promise<ProviderRef> {
    throw new SfError(`update is not implemented on ${this.getLabel()}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async linkToStory(_ref: ProviderRef, _storyId: string): Promise<void> {
    throw new SfError(`linkToStory is not implemented on ${this.getLabel()}`);
  }
}
