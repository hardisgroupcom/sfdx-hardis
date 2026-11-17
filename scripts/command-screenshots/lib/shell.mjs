/**
 * Running the Salesforce CLI and other programs from the runner, without a shell: arguments go
 * as they are, whatever they hold.
 */
import { execFileSync, spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

let sfRunJs = null;

/** bin/run.js of the global @salesforce/cli: `sf` without the .cmd wrapper and its shell. */
export function sfRunJsPath() {
  if (sfRunJs) {
    return sfRunJs;
  }
  const npmRoot = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  }).trim();
  const candidate = path.join(npmRoot, "@salesforce", "cli", "bin", "run.js");
  if (!fs.existsSync(candidate)) {
    throw new Error(`The Salesforce CLI is not installed globally with npm (no ${candidate})`);
  }
  sfRunJs = candidate;
  return sfRunJs;
}

/**
 * Runs `sf <args> --json` and returns its result. Throws with the CLI message on a failure,
 * unless `allowFailure`, which returns the whole answer instead.
 */
export function sfJson(args, { env = process.env, cwd = process.cwd(), allowFailure = false, timeoutMs = 1800000 } = {}) {
  const result = spawnSync(process.execPath, [sfRunJsPath(), ...args, "--json"], {
    env: { ...env, SF_DISABLE_TELEMETRY: "true", SF_AUTOUPDATE_DISABLE: "true", NO_COLOR: "1" },
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const text = result.stdout || "";
  let parsed = null;
  try {
    parsed = JSON.parse(text.slice(text.indexOf("{")));
  } catch {
    parsed = null;
  }
  if (allowFailure) {
    return parsed || { status: result.status ?? 1, message: (result.stderr || text).slice(0, 2000) };
  }
  if (!parsed || parsed.status !== 0) {
    const message = parsed?.message || (result.stderr || text).slice(0, 2000);
    throw new Error(`sf ${args.join(" ")} failed: ${message}`);
  }
  return parsed.result;
}

/** Runs a program, streaming its output, and resolves with its exit code. */
export function runStreaming(command, args, { env = process.env, cwd = process.cwd(), prefix = "", shell = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, cwd, shell, stdio: ["ignore", "pipe", "pipe"] });
    const forward = (stream, target) => {
      let buffer = "";
      stream.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        for (const line of lines) {
          target.write(`${prefix}${line}\n`);
        }
      });
      stream.on("end", () => {
        if (buffer) {
          target.write(`${prefix}${buffer}\n`);
        }
      });
    };
    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr);
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      process.stderr.write(`${prefix}${error.message}\n`);
      resolve(1);
    });
  });
}

/** Runs a program and returns its trimmed output, or "" when it fails. */
export function output(command, args, options = {}) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...options }).trim();
  } catch {
    return "";
  }
}

export function log(message) {
  const time = new Date().toISOString().slice(11, 19);
  process.stdout.write(`[shots ${time}] ${message}\n`);
}
