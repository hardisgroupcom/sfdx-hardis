import { Connection, SfError } from "@salesforce/core";
import fs from 'fs-extra';
import ora from "ora";
import * as path from "path";
import { createTempDir } from "./index.js";
import makeFetchHappen, { FetchOptions } from 'make-fetch-happen';

export class FileDownloader {

  conn: Connection;
  downloadUrl: string;
  outputFile: string | null = null;
  fetchOptions: any = {};

  constructor(downloadUrl: string, options: {
    conn?: any,
    outputFile?: string,
    fetchOptions?: FetchOptions
  }) {
    this.conn = options.conn || null;
    this.downloadUrl = downloadUrl;
    this.outputFile = options.outputFile || null;
    // Build fetch options for HTTP calls to retrieve document files
    this.fetchOptions = options.fetchOptions || {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + this.conn.accessToken,
        'Content-Type': 'blob',
        "X-PrettyPrint": '1'
      },
      retry: {
        retries: 20,
        factor: 3,
        randomize: true,
      },
    };
  }

  public async download(): Promise<{ success: boolean, outputFile: string, error?: any }> {
    const spinnerCustom = ora({
      text: `Downloading ${this.downloadUrl}...`,
      spinner: 'moon',
    }).start();

    if (this.outputFile == null) {
      const tempDir = await createTempDir();
      this.outputFile = path.join(tempDir, Math.random().toString(36).substring(7));
    }

    try {
      this.fetchOptions.onRetry = (cause: unknown) => {
        spinnerCustom.text = `Retrying ${this.downloadUrl} (${cause})...`;
      };

      const fetchRes = await makeFetchHappen(this.downloadUrl, this.fetchOptions);
      if (!fetchRes.ok) {
        throw new SfError(`Fetch error: ${JSON.stringify(fetchRes.body)}`);
      }

      const stream = fs.createWriteStream(this.outputFile);
      const totalSize = Number(fetchRes.headers.get('content-length'));

      let downloadedSize = 0;

      // Set up piping first
      fetchRes.body.pipe(stream);

      fetchRes.body.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const percentComplete = totalSize ? (downloadedSize / totalSize * 100).toFixed(2) : null;
        spinnerCustom.text = totalSize
          ? `Downloaded ${downloadedSize} bytes of ${totalSize} bytes (${percentComplete}%) of ${this.downloadUrl}`
          : `Downloaded ${downloadedSize} bytes of ${this.downloadUrl}`;
      });

      // Handle end of download, or error
      await new Promise((resolve, reject) => {
        fetchRes.body.on("error", reject);
        stream.on("error", reject);
        stream.on("finish", resolve);
      });

      const fileExists = await fs.exists(this.outputFile);
      if (!fileExists) {
        throw new SfError(`Download error: Download stream ok but no created file at ${this.outputFile}`);
      }

      spinnerCustom.succeed(`Downloaded ${this.downloadUrl}`);
      stream.destroy();

    } catch (err: any) {
      spinnerCustom.fail(`Error while downloading ${this.downloadUrl}: ${err.message}`);
      return { success: false, outputFile: this.outputFile, error: err };
    }

    return { success: true, outputFile: this.outputFile };
  }
}