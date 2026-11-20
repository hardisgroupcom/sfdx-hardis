import { ActionsProvider } from '../actionsProvider.js';
import type { BrowserforceApplyOptions, BrowserforceApplyOutcome } from './browserforceRunner.js';

/** The action types that apply a Browserforce setting: browser and user-access-policy. */
export abstract class BrowserforceActionsProvider extends ActionsProvider {
  // Overridden by the tests, which cannot start a browser
  protected async applyWithBrowserforce(options: BrowserforceApplyOptions): Promise<BrowserforceApplyOutcome> {
    const { runBrowserforceApply } = await import('./browserforceRunner.js');
    return runBrowserforceApply(options);
  }
}
