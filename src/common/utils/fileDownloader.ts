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
     conn?:any, 
     outputFile?: string,
      fetchOptions?: FetchOptions}) {
    this.conn = options.conn || null ;
    this.downloadUrl = downloadUrl;
    this.outputFile = options.outputFile || null ;
    // Build fetch options for HTTP calls to retrieve document files
    this.fetchOptions = options.fetchOptions || {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + this.conn.accessToken
      },
      retry: {
        retries: 20,
        factor: 3,
        randomize: true,
      },
    };
  }
  
  public async download(): Promise<{ success: boolean, outputFile: string, error?: any}> {
    // Initialize spinner
    const spinnerCustom = ora({
      text: `Downloading ${this.downloadUrl}...`,
      spinner: 'moon',
    }).start();
    // Define default Outputfile if not send as option
    if (this.outputFile == null) {
      const tempDir = await createTempDir();
      this.outputFile = path.join(tempDir, Math.random().toString(36).substring(7));
    }
    // Make the call
    try {
      this.fetchOptions.onRetry = (cause: unknown) => {
        spinnerCustom.text = `Retrying ${this.downloadUrl} (${cause})...`;
      }
      const fetchRes = await makeFetchHappen(this.downloadUrl, this.fetchOptions);
      if (fetchRes.ok !== true) {
        throw new SfError(`Fetch error - ${this.downloadUrl} - + ${JSON.stringify(fetchRes.body)}`);
      }
      // Wait for file to be written
      const stream = fs.createWriteStream(this.outputFile);
      fetchRes.body.pipe(stream);
      const totalSize = Number(fetchRes.headers.get('content-length'));
      // Track the number of bytes downloaded
      let downloadedSize = 0;
      // Listen to the data event to track progress
      fetchRes.body.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize) {
          const percentComplete = (downloadedSize / totalSize * 100).toFixed(2);
          spinnerCustom.text = `Downloaded ${downloadedSize} bytes of ${totalSize} bytes (${percentComplete}%) of ${this.downloadUrl}`;
        } else {
          spinnerCustom.text = `Downloaded ${downloadedSize} bytes of ${this.downloadUrl}`;
        }
      });
      // Handle end of download, or error
      await new Promise((resolve, reject) => {
        fetchRes.body.on("error", (error) => {
          reject(error);
        })
        fetchRes.body.on("end", (xxxx) => {
          resolve(xxxx);
        })
      });
      spinnerCustom.succeed(`Downloaded ${this.downloadUrl}`);
    } catch (err: any) {
      // Download failure
      spinnerCustom.fail(`Error while downloading ${this.downloadUrl}: ${err.message}`);
      return { success: false, outputFile: this.outputFile, error: err}
    }
    return { success: true, outputFile: this.outputFile};
  }

}