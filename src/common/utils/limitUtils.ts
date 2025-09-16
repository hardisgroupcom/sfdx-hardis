// External Libraries and Node.js Modules
import c from 'chalk';

// Salesforce Specific Libraries
import { Connection, SfError } from '@salesforce/core';

// Project Specific Utilities
import { uxLog } from './index.js';

// Optimized API Limits Management System
export class ApiLimitsManager {
  private conn: Connection;
  private commandThis: any;

  // Caching system
  private cachedLimits: any = null;
  private lastRefreshTime: number = 0;
  private cacheDuration: number = 5 * 60 * 1000; // 5 minutes

  // Local tracking counters
  private localRestApiCalls: number = 0;
  private localBulkApiCalls: number = 0;

  // Base limits from Salesforce
  private baseRestApiUsed: number = 0;
  private baseRestApiLimit: number = 0;
  private baseBulkApiUsed: number = 0;
  private baseBulkApiLimit: number = 0;

  // Thresholds for API management
  private readonly WARNING_THRESHOLD = 70; // Force refresh at 70%
  private readonly DANGER_THRESHOLD = 80;  // Stop operations at 80%

  constructor(conn: Connection, commandThis: any) {
    this.conn = conn;
    this.commandThis = commandThis;
  }

  // Initialize the limits manager with initial API limits data
  async initialize(): Promise<void> {
    await this.refreshLimits(true); // Force initial refresh
  }

  // Intelligent refresh logic - only refresh when needed
  private async refreshLimits(forceRefresh: boolean = false): Promise<void> {
    const now = Date.now();
    const cacheAge = now - this.lastRefreshTime;

    // Use cache if it's fresh and not forced refresh
    if (!forceRefresh && this.cachedLimits && cacheAge < this.cacheDuration) {
      uxLog("log", this.commandThis, c.grey(`Using cached API limits (${Math.round(cacheAge / 1000)}s old)`));
      return;
    }

    try {
      uxLog("log", this.commandThis, c.grey(`Refreshing API limits from Salesforce...`));

      // Fetch fresh limits from Salesforce
      this.cachedLimits = await this.conn.limits();

      if (!this.cachedLimits) {
        throw new SfError("Unable to retrieve API limit information from Salesforce org.");
      }

      // Extract REST API limits
      if (!this.cachedLimits.DailyApiRequests) {
        throw new SfError("DailyApiRequests limit not available from Salesforce org.");
      }

      this.baseRestApiUsed = this.cachedLimits.DailyApiRequests.Max - this.cachedLimits.DailyApiRequests.Remaining;
      this.baseRestApiLimit = this.cachedLimits.DailyApiRequests.Max;

      // Extract Bulk API v2 limits
      if (!this.cachedLimits.DailyBulkV2QueryJobs) {
        throw new SfError("DailyBulkV2QueryJobs limit not available from Salesforce org.");
      }

      this.baseBulkApiUsed = this.cachedLimits.DailyBulkV2QueryJobs.Max - this.cachedLimits.DailyBulkV2QueryJobs.Remaining;
      this.baseBulkApiLimit = this.cachedLimits.DailyBulkV2QueryJobs.Max;

      // Reset local counters on fresh data
      this.localRestApiCalls = 0;
      this.localBulkApiCalls = 0;
      this.lastRefreshTime = now;

      uxLog("success", this.commandThis,
        `API Limits refreshed - REST: ${this.baseRestApiUsed}/${this.baseRestApiLimit}, Bulk: ${this.baseBulkApiUsed}/${this.baseBulkApiLimit}`
      );

    } catch (error: any) {
      if (error instanceof SfError) throw error;
      throw new SfError(`Failed to refresh API limits: ${error?.message || 'Unknown error'}`);
    }
  }

  // Track API call and check if we need to wait or refresh
  async trackApiCall(apiType: 'REST' | 'BULK'): Promise<void> {
    // Increment local counter
    if (apiType === 'REST') {
      this.localRestApiCalls++;
    } else {
      this.localBulkApiCalls++;
    }

    // Calculate current usage
    const currentRestUsage = this.baseRestApiUsed + this.localRestApiCalls;
    const currentBulkUsage = this.baseBulkApiUsed + this.localBulkApiCalls;

    const restPercent = (currentRestUsage / this.baseRestApiLimit) * 100;
    const bulkPercent = (currentBulkUsage / this.baseBulkApiLimit) * 100;

    // Check if we need to refresh limits due to approaching thresholds
    const needsRefresh = (
      (apiType === 'REST' && restPercent >= this.WARNING_THRESHOLD) ||
      (apiType === 'BULK' && bulkPercent >= this.WARNING_THRESHOLD)
    );

    if (needsRefresh) {
      await this.refreshLimits(true); // Force refresh for accurate counts

      // Recalculate with fresh data
      const freshRestUsage = this.baseRestApiUsed + this.localRestApiCalls;
      const freshBulkUsage = this.baseBulkApiUsed + this.localBulkApiCalls;
      const freshRestPercent = (freshRestUsage / this.baseRestApiLimit) * 100;
      const freshBulkPercent = (freshBulkUsage / this.baseBulkApiLimit) * 100;

      // Check if we need to wait
      if (apiType === 'REST' && freshRestPercent >= this.DANGER_THRESHOLD) {
        await this.waitForLimitReset('REST', freshRestPercent);
      }

      if (apiType === 'BULK' && freshBulkPercent >= this.DANGER_THRESHOLD) {
        await this.waitForLimitReset('BULK', freshBulkPercent);
      }
    }
  }

  // Wait for API limits to reset
  private async waitForLimitReset(apiType: 'REST' | 'BULK', currentPercent: number): Promise<void> {
    const WAIT_INTERVAL = 300; // 5 minutes
    const MAX_CYCLES = 12; // 1 hour max

    uxLog("warning", this.commandThis,
      c.yellow(`${apiType} API at ${currentPercent.toFixed(1)}%. Waiting for limits to reset...`)
    );

    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      uxLog("action", this.commandThis,
        c.cyan(`Waiting ${WAIT_INTERVAL}s for ${apiType} API reset (${cycle + 1}/${MAX_CYCLES})...`)
      );

      // Wait in 1-second intervals
      for (let i = 0; i < WAIT_INTERVAL; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Check if limits have reset
      await this.refreshLimits(true);

      const currentUsage = apiType === 'REST'
        ? this.baseRestApiUsed + this.localRestApiCalls
        : this.baseBulkApiUsed + this.localBulkApiCalls;
      const limit = apiType === 'REST' ? this.baseRestApiLimit : this.baseBulkApiLimit;
      const percent = (currentUsage / limit) * 100;

      if (percent < this.WARNING_THRESHOLD) {
        uxLog("success", this.commandThis,
          c.green(`${apiType} API usage dropped to ${percent.toFixed(1)}%. Resuming operations.`)
        );
        return;
      }
    }

    throw new SfError(`${apiType} API limits did not reset after ${MAX_CYCLES * WAIT_INTERVAL / 60} minutes.`);
  }

  // Get current API usage status for display
  getUsageStatus(): { rest: number; bulk: number; message: string } {
    const currentRestUsage = this.baseRestApiUsed + this.localRestApiCalls;
    const currentBulkUsage = this.baseBulkApiUsed + this.localBulkApiCalls;

    const restPercent = (currentRestUsage / this.baseRestApiLimit) * 100;
    const bulkPercent = (currentBulkUsage / this.baseBulkApiLimit) * 100;

    return {
      rest: restPercent,
      bulk: bulkPercent,
      message: `[REST: ${restPercent.toFixed(1)}% | Bulk: ${bulkPercent.toFixed(1)}%]`
    };
  }

  // Get current usage for API consumption estimation
  getCurrentUsage(): {
    restUsed: number;
    restLimit: number;
    bulkUsed: number;
    bulkLimit: number;
    restRemaining: number;
    bulkRemaining: number;
  } {
    const currentRestUsage = this.baseRestApiUsed + this.localRestApiCalls;
    const currentBulkUsage = this.baseBulkApiUsed + this.localBulkApiCalls;

    return {
      restUsed: currentRestUsage,
      restLimit: this.baseRestApiLimit,
      bulkUsed: currentBulkUsage,
      bulkLimit: this.baseBulkApiLimit,
      restRemaining: this.baseRestApiLimit - currentRestUsage,
      bulkRemaining: this.baseBulkApiLimit - currentBulkUsage
    };
  }

  // Get final usage for reporting (forces a fresh refresh)
  async getFinalUsage(): Promise<{
    restUsed: number;
    restLimit: number;
    restRemaining: number;
    bulkUsed: number;
    bulkLimit: number;
    bulkRemaining: number;
  }> {
    try {
      const currentLimits = await this.conn.limits();
      if (currentLimits && currentLimits.DailyApiRequests && currentLimits.DailyBulkV2QueryJobs) {
        const restUsed = currentLimits.DailyApiRequests.Max - currentLimits.DailyApiRequests.Remaining;
        const bulkUsed = currentLimits.DailyBulkV2QueryJobs.Max - currentLimits.DailyBulkV2QueryJobs.Remaining;

        return {
          restUsed: restUsed,
          restLimit: currentLimits.DailyApiRequests.Max,
          restRemaining: currentLimits.DailyApiRequests.Remaining,
          bulkUsed: bulkUsed,
          bulkLimit: currentLimits.DailyBulkV2QueryJobs.Max,
          bulkRemaining: currentLimits.DailyBulkV2QueryJobs.Remaining
        };
      }
    } catch (error) {
      // Fallback to cached values if fresh fetch fails
    }

    return {
      restUsed: this.baseRestApiUsed + this.localRestApiCalls,
      restLimit: this.baseRestApiLimit,
      restRemaining: this.baseRestApiLimit - (this.baseRestApiUsed + this.localRestApiCalls),
      bulkUsed: this.baseBulkApiUsed + this.localBulkApiCalls,
      bulkLimit: this.baseBulkApiLimit,
      bulkRemaining: this.baseBulkApiLimit - (this.baseBulkApiUsed + this.localBulkApiCalls)
    };
  }
}