import { Connection, SfError } from "@salesforce/core";
import fs from 'fs-extra';
import ora from "ora";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createTempDir } from "./index.js";

// Retry tuning, replicating the make-fetch-happen options historically used here
const DOWNLOAD_MAX_RETRIES = 20;
const DOWNLOAD_RETRY_FACTOR = 3;
const DOWNLOAD_RETRY_MIN_TIMEOUT_MS = 1000;
const DOWNLOAD_RETRY_MAX_TIMEOUT_MS = 60000;

export type FetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  onRetry?: (cause: unknown) => void;
  retry?: {
    retries?: number;
    factor?: number;
    randomize?: boolean;
  };
};

export class FileDownloader {

  conn: Connection;
  downloadUrl: string;
  outputFile: string | null = null;
  fetchOptions: FetchOptions = {};
  label: string;

  constructor(downloadUrl: string, options: {
    conn?: any,
    outputFile?: string,
    fetchOptions?: FetchOptions
    label?: 'url' | 'file' | 'both'
  }) {
    this.conn = options.conn || null;
    this.downloadUrl = downloadUrl;
    this.outputFile = options.outputFile || null;
    this.label = options?.label === 'file'
      ? (path.relative(process.cwd(), this.outputFile || "")) || this.downloadUrl
      : options?.label === 'both'
        ? `${this.outputFile} from ${this.downloadUrl}`
        : this.downloadUrl;
    // Build fetch options for HTTP calls to retrieve document files
    this.fetchOptions = options.fetchOptions || {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + this.conn.accessToken,
        'Content-Type': 'blob',
        // "X-PrettyPrint": '1'
      },
      retry: {
        retries: DOWNLOAD_MAX_RETRIES,
        factor: DOWNLOAD_RETRY_FACTOR,
        randomize: true,
      },
    };
  }

  // Fetch with retry on network errors and retryable HTTP statuses (5xx / 408 / 429),
  // with exponential backoff, mimicking the historical make-fetch-happen behavior.
  private async fetchWithRetry(): Promise<Response> {
    const retries = this.fetchOptions.retry?.retries ?? DOWNLOAD_MAX_RETRIES;
    const factor = this.fetchOptions.retry?.factor ?? DOWNLOAD_RETRY_FACTOR;
    const randomize = this.fetchOptions.retry?.randomize ?? true;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let cause: unknown;
      try {
        const res = await fetch(this.downloadUrl, {
          method: this.fetchOptions.method || 'GET',
          headers: this.fetchOptions.headers || {},
        });
        if (res.ok || !this.isRetryableStatus(res.status)) {
          return res;
        }
        cause = new SfError(`HTTP ${res.status} on ${this.downloadUrl}`);
      } catch (e) {
        cause = e;
      }
      attempt++;
      if (attempt > retries) {
        throw cause;
      }
      this.fetchOptions.onRetry?.(cause);
      const backoffMs = Math.min(
        DOWNLOAD_RETRY_MIN_TIMEOUT_MS * Math.pow(factor, attempt - 1),
        DOWNLOAD_RETRY_MAX_TIMEOUT_MS
      ) * (randomize ? (1 + Math.random()) : 1);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  private isRetryableStatus(status: number): boolean {
    return status >= 500 || status === 408 || status === 429;
  }

  public async download(): Promise<{ success: boolean, outputFile: string, error?: any }> {
    const spinnerCustom = ora({
      text: `Downloading ${this.label}...`,
      spinner: 'moon',
    }).start();

    if (this.outputFile == null) {
      const tempDir = await createTempDir();
      this.outputFile = path.join(tempDir, Math.random().toString(36).substring(7));
    }

    try {
      this.fetchOptions.onRetry = (cause: unknown) => {
        spinnerCustom.text = `Retrying ${this.label} (${cause})...`;
      };

      const fetchRes = await this.fetchWithRetry();
      if (!fetchRes.ok) {
        throw new SfError(`Fetch error: HTTP ${fetchRes.status} ${await fetchRes.text().catch(() => '')}`);
      }
      if (!fetchRes.body) {
        throw new SfError(`Fetch error: empty response body for ${this.downloadUrl}`);
      }

      const totalSize = Number(fetchRes.headers.get('content-length'));
      let downloadedSize = 0;

      const bodyStream = Readable.fromWeb(fetchRes.body as any);
      bodyStream.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const percentComplete = totalSize ? (downloadedSize / totalSize * 100).toFixed(2) : null;
        spinnerCustom.text = totalSize
          ? `Downloaded ${downloadedSize} bytes of ${totalSize} bytes (${percentComplete}%) of ${this.label}`
          : `Downloaded ${downloadedSize} bytes of ${this.label}`;
      });

      await pipeline(bodyStream, fs.createWriteStream(this.outputFile));

      const fileExists = await fs.exists(this.outputFile);
      if (!fileExists) {
        throw new SfError(`Download error: Download stream ok but no created file at ${this.outputFile}`);
      }

      spinnerCustom.succeed(`Downloaded ${this.label}`);

    } catch (err: any) {
      spinnerCustom.fail(`Error while downloading ${this.downloadUrl}: ${err.message}`);
      return { success: false, outputFile: this.outputFile, error: err };
    }

    return { success: true, outputFile: this.outputFile };
  }
}
