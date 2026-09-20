import { spawn } from 'child_process';
import c from 'chalk';
import { ActionsProvider, ActionResult, PrePostCommand } from './actionsProvider.js';
import { uxLog } from '../utils/index.js';
import fs from '../utils/fsUtils.js';
import { getEnvVar } from '../../config/index.js';
import { t } from '../utils/i18n.js';
import {
  CustomFunctionDefinition,
  DEFAULT_CUSTOM_FUNCTION_TIMEOUT_SECONDS,
  buildInputEnvVarName,
  getCustomFunctionById,
  parseCustomFunctionOutputs,
  resolveRuntimeInterpreter,
} from '../utils/customFunctionUtils.js';
import { pipelineContextToEnvVars } from '../utils/pipelineContextUtils.js';

/**
 * Runs a project custom function: a node, python or bash script declared in customFunctions,
 * receiving the pipeline context and the action parameters as environment variables, and
 * returning its declared outputs as a JSON object on the last line of stdout.
 *
 * The pipeline context is attached to the command by prePostCommandUtils before the action runs
 * (see PrePostCommand.pipelineContext), because building it needs the git provider and the org
 * connection, which belong to the execution loop rather than to a provider.
 */
export class CustomFunctionAction extends ActionsProvider {
  public getLabel(): string {
    return 'CustomFunctionAction';
  }

  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    const definition = await getCustomFunctionById(cmd.type);
    if (!definition) {
      const reason = t('customFunctionNotFound', { id: cmd.type });
      uxLog('error', this, c.red(`[DeploymentActions] ${reason} (action [${cmd.id}]: ${cmd.label})`));
      return { statusCode: 'failed', skippedReason: reason };
    }

    if (!definition.script || !fs.existsSync(definition.script)) {
      const reason = t('customFunctionScriptNotFound', { id: definition.id, path: definition.script || '' });
      uxLog('error', this, c.red(`[DeploymentActions] ${reason}`));
      return { statusCode: 'failed', skippedReason: reason };
    }

    // A missing interpreter fails the action rather than skipping it: a step the project asked for
    // must not silently not happen. Projects that can live without it set allowFailure.
    const runtime = resolveRuntimeInterpreter(definition.runtime);
    if (!runtime) {
      const candidates = definition.runtime === 'python' ? 'python3, python' : definition.runtime;
      const reason = t('customFunctionRuntimeNotFound', { runtime: definition.runtime, tried: candidates });
      uxLog('error', this, c.red(`[DeploymentActions] ${reason} (action [${cmd.id}]: ${cmd.label})`));
      return { statusCode: 'failed', skippedReason: reason };
    }

    const missingInputs = (definition.inputs || [])
      .filter((input) => input.required === true)
      .filter((input) => {
        const value = cmd.parameters?.[input.name] ?? input.default;
        return value === undefined || value === null || String(value).trim() === '';
      })
      .map((input) => input.name);
    if (missingInputs.length > 0) {
      const reason = t('customFunctionMissingRequiredInputs', { names: missingInputs.join(', ') });
      uxLog('error', this, c.red(`[DeploymentActions] ${reason} (action [${cmd.id}]: ${cmd.label})`));
      return { statusCode: 'failed', skippedReason: reason };
    }

    // A secret input stores the NAME of a CI/CD variable, never its value: resolve it now so a
    // missing variable is reported before the script starts.
    for (const input of definition.inputs || []) {
      if (input.type !== 'secret') {
        continue;
      }
      const variableName = String(cmd.parameters?.[input.name] ?? input.default ?? '').trim();
      if (!variableName) {
        continue;
      }
      if (!getEnvVar(variableName)) {
        const reason = t('customFunctionSecretVariableNotDefined', { name: input.name, variable: variableName });
        uxLog('error', this, c.red(`[DeploymentActions] ${reason} (action [${cmd.id}]: ${cmd.label})`));
        return { statusCode: 'failed', skippedReason: reason };
      }
    }

    return null;
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;

    const definition = await getCustomFunctionById(cmd.type);
    if (!definition) {
      // checkParameters already rejected this, kept so the type narrows
      return { statusCode: 'failed', skippedReason: t('customFunctionNotFound', { id: cmd.type }) };
    }
    const runtime = resolveRuntimeInterpreter(definition.runtime);
    if (!runtime) {
      return {
        statusCode: 'failed',
        skippedReason: t('customFunctionRuntimeNotFound', { runtime: definition.runtime, tried: definition.runtime }),
      };
    }

    const { env, secretValues } = this.buildEnvironment(definition, cmd);
    const timeoutSeconds = Number(definition.timeout) > 0 ? Number(definition.timeout) : DEFAULT_CUSTOM_FUNCTION_TIMEOUT_SECONDS;

    uxLog(
      'log',
      this,
      c.grey(
        `[DeploymentActions] ${t('customFunctionRunning', {
          id: definition.id,
          runtime: definition.runtime,
          script: definition.script,
        })}`
      )
    );

    const execution = await this.runScript(runtime.interpreter, definition.script, env, timeoutSeconds, secretValues);

    if (execution.timedOut) {
      return {
        statusCode: 'failed',
        output: maskSecrets(execution.stdout + execution.stderr, secretValues),
        skippedReason: t('customFunctionTimedOut', { id: definition.id, timeout: timeoutSeconds }),
      };
    }

    const combinedLog = [execution.stdout, execution.stderr].filter((part) => part.trim() !== '').join('\n');
    if (execution.exitCode !== 0) {
      return {
        statusCode: 'failed',
        output: maskSecrets(combinedLog, secretValues),
        skippedReason: t('customFunctionExitedWithCode', { id: definition.id, code: execution.exitCode }),
      };
    }

    const parsed = parseCustomFunctionOutputs(execution.stdout, definition.outputs || []);
    const logParts = [parsed.logOutput, execution.stderr].filter((part) => (part || '').trim() !== '');
    const output = maskSecrets(logParts.join('\n'), secretValues);
    if (parsed.error) {
      return { statusCode: 'failed', output, skippedReason: parsed.error };
    }

    return {
      statusCode: 'success',
      output,
      outputs: parsed.outputs,
      outputsForDisplay: maskOutputValues(parsed.outputs, secretValues),
    };
  }

  /**
   * Environment of the script: the current environment, the pipeline variables, and one
   * SFDX_HARDIS_IN_<NAME> per declared input. Secret inputs carry the VALUE of the CI/CD variable
   * they name, and those values are collected so they can be masked in everything we report.
   */
  private buildEnvironment(
    definition: CustomFunctionDefinition,
    cmd: PrePostCommand
  ): { env: NodeJS.ProcessEnv; secretValues: string[] } {
    const pipelineContext = cmd.pipelineContext;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(pipelineContext ? pipelineContextToEnvVars(pipelineContext) : {}),
    };
    const secretValues: string[] = [];

    for (const input of definition.inputs || []) {
      const rawValue = cmd.parameters?.[input.name] ?? input.default;
      const envVarName = buildInputEnvVarName(input.name);
      if (input.type === 'secret') {
        const variableName = String(rawValue ?? '').trim();
        const secretValue = variableName ? getEnvVar(variableName) : null;
        env[envVarName] = secretValue || '';
        if (secretValue) {
          secretValues.push(secretValue);
        }
        continue;
      }
      env[envVarName] = serializeInputValue(rawValue);
    }

    // The org the deployment targets, so a script calling the sf CLI hits the right org
    if (this.customUsernameToUse) {
      env.SFDX_HARDIS_ORG_USERNAME = this.customUsernameToUse;
    }
    return { env, secretValues };
  }

  /**
   * Spawn the script and capture its streams.
   *
   * stdin is closed ('ignore') so a script waiting for input fails fast instead of hanging until
   * the timeout, and the script runs from the repository root so relative paths behave the same
   * way they do everywhere else in sfdx-hardis.
   */
  private runScript(
    interpreter: string,
    scriptPath: string,
    env: NodeJS.ProcessEnv,
    timeoutSeconds: number,
    secretValues: string[]
  ): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      const child = spawn(interpreter, [scriptPath], {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        // No shell: the script path is passed as an argument, so a space or a quote in it is not
        // reinterpreted by a shell and nothing from the config reaches a command line.
        shell: false,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutSeconds * 1000);

      // The job log is written as the script runs, so it must be masked on the way out too:
      // masking only the stored result would still print a secret in the pipeline console.
      const logLine = (line: string) => uxLog('other', this, c.grey(maskSecrets(line, secretValues)));
      const stdoutStreamer = createMaskedLineStreamer(logLine);
      const stderrStreamer = createMaskedLineStreamer(logLine);

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        stdoutStreamer.push(text);
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        stderrStreamer.push(text);
      });

      child.on('error', (error) => {
        clearTimeout(timeoutHandle);
        stdoutStreamer.flush();
        stderrStreamer.flush();
        resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${error.message}`.trim(), timedOut });
      });
      child.on('close', (code) => {
        clearTimeout(timeoutHandle);
        stdoutStreamer.flush();
        stderrStreamer.flush();
        resolve({ exitCode: code === null ? 1 : code, stdout, stderr, timedOut });
      });
    });
  }
}

/**
 * Emit a stream chunk by chunk as complete LINES.
 *
 * Masking has to happen before anything is printed, and a chunk boundary can fall anywhere,
 * including in the middle of a secret. Holding back the last incomplete line until its newline
 * arrives means a secret is only ever masked as a whole, on a line it fully belongs to.
 */
export function createMaskedLineStreamer(emit: (line: string) => void): {
  push: (text: string) => void;
  flush: () => void;
} {
  let pending = '';
  return {
    push(text: string): void {
      pending += text;
      const lines = pending.split('\n');
      // The last entry is either an incomplete line or an empty string after a trailing newline
      pending = lines.pop() ?? '';
      for (const line of lines) {
        emit(line.replace(/\r$/, ''));
      }
    },
    flush(): void {
      if (pending !== '') {
        emit(pending.replace(/\r$/, ''));
        pending = '';
      }
    },
  };
}

/** Env vars are strings: objects and arrays are JSON-encoded, booleans become true/false. */
function serializeInputValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Replace every occurrence of a resolved secret value by a mask.
 * Applied to everything that leaves the action: the job log, the action output stored in the
 * Deployment Actions state, the Pull Request comment and the deployment notification.
 */
/**
 * Mask the resolved secrets inside every output value.
 *
 * A script is free to return a value built from a secret (a signed URL, a token echoed back), and
 * the outputs are rendered in the Pull Request comment and the deployment notification. The raw
 * map stays available in memory for interpolation; this copy is the one that is reported.
 */
export function maskOutputValues(
  outputs: Record<string, any>,
  secretValues: string[]
): Record<string, any> {
  const masked: Record<string, any> = {};
  for (const [name, value] of Object.entries(outputs || {})) {
    if (typeof value === 'string') {
      masked[name] = maskSecrets(value, secretValues);
    } else if (value !== null && typeof value === 'object') {
      // Nested structures are JSON-encoded before being displayed anyway, so mask the encoding
      masked[name] = JSON.parse(maskSecrets(JSON.stringify(value), secretValues));
    } else {
      masked[name] = value;
    }
  }
  return masked;
}

export function maskSecrets(text: string, secretValues: string[]): string {
  let maskedText = String(text || '');
  for (const secretValue of secretValues) {
    // A very short value would mask unrelated text, and is not a credential worth protecting
    if (!secretValue || secretValue.length < 4) {
      continue;
    }
    maskedText = maskedText.split(secretValue).join('****');
  }
  return maskedText;
}
