// File system helpers replacing the fs-extra package.
// The default export mirrors the subset of the fs-extra API used in sfdx-hardis:
// every node:fs function (promise-based versions of the async ones, like fs-extra)
// plus the usual extras (ensureDir, remove, copy, move, pathExists, readJson, writeJson...).
import * as nodeFs from 'node:fs';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';

export interface CopyOptions {
  /** Overwrite existing files. Default true. */
  overwrite?: boolean;
  /** Throw when the destination exists and overwrite is false. Default false. */
  errorOnExist?: boolean;
  /** Return false to skip a file or directory. */
  filter?: (src: string, dest: string) => boolean | Promise<boolean>;
  dereference?: boolean;
  preserveTimestamps?: boolean;
}

export interface MoveOptions {
  /** Overwrite the destination when it exists. Default false. */
  overwrite?: boolean;
}

export interface ReadJsonOptions {
  encoding?: BufferEncoding;
  /** Return null instead of throwing on invalid JSON. Default true. */
  throws?: boolean;
}

export interface WriteJsonOptions {
  spaces?: number | string;
  EOL?: string;
  replacer?: (key: string, value: any) => any;
  encoding?: BufferEncoding;
}

export async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

export function ensureDirSync(dir: string): void {
  nodeFs.mkdirSync(dir, { recursive: true });
}

export async function ensureFile(file: string): Promise<void> {
  if (await pathExists(file)) {
    return;
  }
  await ensureDir(path.dirname(file));
  await fsp.writeFile(file, '');
}

// Windows keeps a lock on a directory that is (or has just been) the working directory of a
// process, or that a scanner still has open, so a removal right after a child command can fail
// with EBUSY / EPERM / ENOTEMPTY. Node's recursive removal retries those codes, but only when
// maxRetries is set: without it there is zero tolerance for a transient lock.
const REMOVE_RETRY_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };

export async function remove(target: string): Promise<void> {
  await fsp.rm(target, REMOVE_RETRY_OPTIONS);
}

export function removeSync(target: string): void {
  nodeFs.rmSync(target, REMOVE_RETRY_OPTIONS);
}

export async function emptyDir(dir: string): Promise<void> {
  await ensureDir(dir);
  for (const entry of await fsp.readdir(dir)) {
    await remove(path.join(dir, entry));
  }
}

export function emptyDirSync(dir: string): void {
  ensureDirSync(dir);
  for (const entry of nodeFs.readdirSync(dir)) {
    removeSync(path.join(dir, entry));
  }
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

export function pathExistsSync(target: string): boolean {
  return nodeFs.existsSync(target);
}

function toCpOptions(options: CopyOptions): nodeFs.CopyOptions {
  // node:fs rejects undefined option values: only set the keys that are provided
  const cpOptions: nodeFs.CopyOptions = {
    recursive: true,
    force: options.overwrite !== false,
    errorOnExist: options.errorOnExist === true,
  };
  if (options.filter) {
    cpOptions.filter = options.filter;
  }
  if (options.dereference !== undefined) {
    cpOptions.dereference = options.dereference;
  }
  if (options.preserveTimestamps !== undefined) {
    cpOptions.preserveTimestamps = options.preserveTimestamps;
  }
  return cpOptions;
}

export async function copy(src: string, dest: string, options: CopyOptions = {}): Promise<void> {
  await fsp.cp(src, dest, toCpOptions(options));
}

export function copySync(src: string, dest: string, options: CopyOptions = {}): void {
  const cpOptions = toCpOptions(options);
  if (options.filter) {
    cpOptions.filter = (source: string, destination: string) => {
      const result = options.filter!(source, destination);
      if (typeof result !== 'boolean') {
        throw new Error('copySync does not support an async filter');
      }
      return result;
    };
  }
  nodeFs.cpSync(src, dest, cpOptions as nodeFs.CopySyncOptions);
}

export async function move(src: string, dest: string, options: MoveOptions = {}): Promise<void> {
  const overwrite = options.overwrite === true;
  if (await pathExists(dest)) {
    if (!overwrite) {
      throw new Error('dest already exists.');
    }
    await remove(dest);
  }
  await ensureDir(path.dirname(dest));
  try {
    await fsp.rename(src, dest);
  } catch (error: any) {
    // rename cannot cross devices: fall back to copy then delete
    if (error?.code !== 'EXDEV') {
      throw error;
    }
    await copy(src, dest, { overwrite: true });
    await remove(src);
  }
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function parseJson(file: string, content: string, options: ReadJsonOptions): any {
  try {
    return JSON.parse(stripBom(content));
  } catch (error: any) {
    if (options.throws === false) {
      return null;
    }
    error.message = `${file}: ${error.message}`;
    throw error;
  }
}

function toReadJsonOptions(options: ReadJsonOptions | BufferEncoding | undefined): ReadJsonOptions {
  return typeof options === 'string' ? { encoding: options } : options || {};
}

export async function readJson(file: string, options?: ReadJsonOptions | BufferEncoding): Promise<any> {
  const readOptions = toReadJsonOptions(options);
  const content = await fsp.readFile(file, { encoding: readOptions.encoding || 'utf8' });
  return parseJson(file, content, readOptions);
}

export function readJsonSync(file: string, options?: ReadJsonOptions | BufferEncoding): any {
  const readOptions = toReadJsonOptions(options);
  const content = nodeFs.readFileSync(file, { encoding: readOptions.encoding || 'utf8' });
  return parseJson(file, content, readOptions);
}

function stringifyJson(value: any, options: WriteJsonOptions): string {
  const eol = options.EOL || '\n';
  const text = options.replacer
    ? JSON.stringify(value, options.replacer, options.spaces)
    : JSON.stringify(value, null, options.spaces);
  return text.replace(/\n/g, eol) + eol;
}

export async function writeJson(file: string, value: any, options: WriteJsonOptions = {}): Promise<void> {
  await fsp.writeFile(file, stringifyJson(value, options), { encoding: options.encoding || 'utf8' });
}

export function writeJsonSync(file: string, value: any, options: WriteJsonOptions = {}): void {
  nodeFs.writeFileSync(file, stringifyJson(value, options), { encoding: options.encoding || 'utf8' });
}

export async function outputFile(file: string, data: string | NodeJS.ArrayBufferView, options?: nodeFs.WriteFileOptions): Promise<void> {
  await ensureDir(path.dirname(file));
  await fsp.writeFile(file, data, options as any);
}

export async function outputJson(file: string, value: any, options: WriteJsonOptions = {}): Promise<void> {
  await ensureDir(path.dirname(file));
  await writeJson(file, value, options);
}

const extras = {
  ensureDir,
  ensureDirSync,
  mkdirp: ensureDir,
  mkdirs: ensureDir,
  ensureFile,
  remove,
  removeSync,
  emptyDir,
  emptyDirSync,
  pathExists,
  pathExistsSync,
  exists: pathExists,
  copy,
  copySync,
  move,
  readJson,
  readJSON: readJson,
  readJsonSync,
  writeJson,
  writeJSON: writeJson,
  writeJsonSync,
  outputFile,
  outputJson,
};

type NodeFsWithoutOverrides = Omit<typeof nodeFs, keyof typeof fsp | keyof typeof extras>;
export type FsExtraLike = NodeFsWithoutOverrides & typeof fsp & typeof extras;

const fs: FsExtraLike = { ...nodeFs, ...fsp, ...extras } as FsExtraLike;

export default fs;
