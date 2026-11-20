/*
Files published by a CI job as artifacts, brought next to the sources: the reports of a validation,
a deployment or a MegaLinter analysis are downloaded from the git provider and extracted under
hardis-report/job-artifacts/<job>, so they can be opened like any local file.

The job is identified by the URL written in the Pull Request comment that reports it. A job run
again keeps its URL and replaces its artifacts: a small manifest kept in the folder tells whether
the local copy is still the one the provider holds.
*/
import AdmZip from 'adm-zip';
import * as path from 'path';
import fs from './fsUtils.js';
import { getReportDirectory } from '../../config/index.js';
import { GitProvider } from '../gitProvider/index.js';
import { JobArtifact, JobArtifactsListing, JobArtifactsStatus } from '../gitProvider/gitProviderRoot.js';
import { t } from './i18n.js';

export interface JobArtifactFile {
  // Relative to the folder, with forward slashes
  path: string;
  sizeBytes: number;
}

export interface JobArtifactsResult {
  status: JobArtifactsStatus;
  jobUrl: string;
  // Absolute path of the folder holding the files, empty when there is none
  folder: string;
  artifacts: JobArtifact[];
  files: JobArtifactFile[];
  message: string;
}

const JOB_ARTIFACTS_FOLDER = 'job-artifacts';
const MANIFEST_FILE = '.job-artifacts.json';

/**
 * Downloads and extracts the artifacts of a job, unless the local copy is already the current one,
 * and lists the files. Never throws for an expected situation (expired, none, provider without an
 * API): the status says it. Throws when the URL is not a job of this repository.
 */
export async function downloadJobArtifacts(jobUrl: string): Promise<JobArtifactsResult> {
  const gitProvider = await GitProvider.getInstance();
  if (gitProvider == null || !gitProvider.supportsJobArtifacts()) {
    const provider = gitProvider == null ? 'git' : gitProvider.getLabel().replace(/^sfdx-hardis /, '').replace(/ connector$/, '');
    return { status: 'unsupported', jobUrl, folder: '', artifacts: [], files: [], message: t('jobArtifactsUnsupported', { provider }) };
  }
  const listing = await gitProvider.listJobArtifacts(jobUrl);
  const folder = path.join(await getReportDirectory(), JOB_ARTIFACTS_FOLDER, listing.jobKey);
  const available = listing.artifacts.filter((artifact) => !artifact.expired);
  if (listing.status !== 'success' || available.length === 0) {
    return await buildResultWithoutDownload(listing, jobUrl, folder);
  }
  if (await isLocalCopyCurrent(folder, available)) {
    return { status: 'success', jobUrl, folder, artifacts: listing.artifacts, files: await listExtractedFiles(folder), message: t('jobArtifactsAlreadyDownloaded', { folder }) };
  }
  // Everything is downloaded before the previous copy is touched: a failed download keeps it
  const downloadFolder = `${folder}.download`;
  await fs.remove(downloadFolder);
  const zipFiles: string[] = [];
  try {
    for (const artifact of available) {
      const zipFile = path.join(downloadFolder, `${toSafeFolderName(artifact.id)}.zip`);
      await gitProvider.downloadJobArtifact(jobUrl, artifact, zipFile);
      zipFiles.push(zipFile);
    }
    await fs.remove(folder);
    await fs.ensureDir(folder);
    available.forEach((artifact, index) => {
      // Several artifacts can hold files of the same name: each one gets its own folder
      const target = available.length > 1 ? path.join(folder, toSafeFolderName(artifact.name)) : folder;
      extractZipSafely(zipFiles[index], target);
    });
  } finally {
    await fs.remove(downloadFolder);
  }
  await fs.writeFile(path.join(folder, MANIFEST_FILE), JSON.stringify({ jobUrl, artifacts: available }, null, 2), 'utf8');
  const files = await listExtractedFiles(folder);
  return { status: 'success', jobUrl, folder, artifacts: listing.artifacts, files, message: t('jobArtifactsDownloaded', { count: files.length, folder }) };
}

/**
 * Extracts a zip into a folder. An entry whose path leaves the folder (../ or an absolute path) is
 * skipped: the archive comes from a CI job that ran contributed code.
 */
export function extractZipSafely(zipFile: string, targetFolder: string): string[] {
  const root = path.resolve(targetFolder);
  const written: string[] = [];
  for (const entry of new AdmZip(zipFile).getEntries()) {
    if (entry.isDirectory) {
      continue;
    }
    const destination = path.resolve(root, entry.entryName);
    if (destination !== root && !destination.startsWith(root + path.sep)) {
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.getData());
    written.push(destination);
  }
  return written;
}

/** Files of a folder and of its sub-folders, sorted, without the manifest */
export async function listExtractedFiles(folder: string): Promise<JobArtifactFile[]> {
  const files: JobArtifactFile[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && !(current === folder && entry.name === MANIFEST_FILE)) {
        files.push({ path: path.relative(folder, fullPath).split(path.sep).join('/'), sizeBytes: (await fs.promises.stat(fullPath)).size });
      }
    }
  };
  if (fs.existsSync(folder)) {
    await walk(folder);
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** True when the manifest of the folder describes the same artifacts as the provider does now */
export async function isLocalCopyCurrent(folder: string, artifacts: JobArtifact[]): Promise<boolean> {
  const known = await readManifestArtifacts(folder);
  if (known == null || known.length !== artifacts.length) {
    return false;
  }
  const signature = (list: JobArtifact[]) => list.map((artifact) => `${artifact.id}|${artifact.name}|${artifact.sizeBytes}|${artifact.updatedAt}`).sort().join('\n');
  return signature(known) === signature(artifacts);
}

/** A name that is safe as a single folder name on every operating system */
export function toSafeFolderName(name: string): string {
  const safe = (name || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return safe || 'artifact';
}

// Nothing to download. Files extracted while the artifacts still existed are kept and returned:
// the provider deleting its copy is no reason to hide ours.
async function buildResultWithoutDownload(listing: JobArtifactsListing, jobUrl: string, folder: string): Promise<JobArtifactsResult> {
  const expired = listing.status === 'expired' || listing.artifacts.some((artifact) => artifact.expired);
  if (expired && (await readManifestArtifacts(folder)) != null) {
    return { status: 'success', jobUrl, folder, artifacts: listing.artifacts, files: await listExtractedFiles(folder), message: t('jobArtifactsAlreadyDownloaded', { folder }) };
  }
  const status: JobArtifactsStatus = expired ? 'expired' : 'none';
  return { status, jobUrl, folder: '', artifacts: listing.artifacts, files: [], message: t(expired ? 'jobArtifactsExpired' : 'jobArtifactsNone') };
}

async function readManifestArtifacts(folder: string): Promise<JobArtifact[] | null> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(folder, MANIFEST_FILE), 'utf8'));
    return Array.isArray(manifest?.artifacts) ? manifest.artifacts : null;
  } catch {
    return null;
  }
}
