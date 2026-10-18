// Secret values read by sfdx-hardis (replacement rules) must never appear in any output.
// Each value is registered here: the CI masks it in its own logs, and redactSecrets() removes it
// from everything sfdx-hardis prints, writes or posts (uxLog, command outputs, PR comments, notifications).

const registeredSecrets = new Set<string>();
// Shorter values would turn the redaction of ordinary words into noise. They are still registered
// with the CI masking, which is the provider's decision to make.
const MIN_REDACTED_LENGTH = 3;
const REDACTED = '***';

/**
 * Register a secret value: masked by the CI from now on, and removed from sfdx-hardis outputs.
 * The CI masking command is written straight to stdout, never through uxLog (which would redact it).
 */
export function registerSecretValue(value: string | null | undefined): void {
  if (value == null) {
    return;
  }
  const secret = String(value);
  if (secret.trim() === '' || registeredSecrets.has(secret)) {
    return;
  }
  registeredSecrets.add(secret);
  // A multi-line value is masked line by line: the CI commands take a single line
  const lines = secret.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  for (const line of lines) {
    if (line !== secret) {
      registeredSecrets.add(line);
    }
    writeCiMaskCommand(line);
  }
}

/** Replace every registered secret value with *** */
export function redactSecrets(text: string): string {
  if (registeredSecrets.size === 0 || typeof text !== 'string' || text === '') {
    return text;
  }
  let result = text;
  // Longest first, so a secret containing another one is replaced whole
  const secrets = [...registeredSecrets].filter((secret) => secret.length >= MIN_REDACTED_LENGTH).sort((a, b) => b.length - a.length);
  for (const secret of secrets) {
    if (result.includes(secret)) {
      result = result.split(secret).join(REDACTED);
    }
  }
  return result;
}

/** Redact every string of a JSON-like value, without changing its shape */
export function redactSecretsDeep<T>(value: T): T {
  if (registeredSecrets.size === 0) {
    return value;
  }
  if (typeof value === 'string') {
    return redactSecrets(value) as any;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretsDeep(item)) as any;
  }
  if (value && typeof value === 'object') {
    const copy: any = {};
    for (const [key, item] of Object.entries(value)) {
      copy[key] = redactSecretsDeep(item);
    }
    return copy;
  }
  return value;
}

export function hasRegisteredSecrets(): boolean {
  return registeredSecrets.size > 0;
}

/** For tests only */
export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

function writeCiMaskCommand(line: string): void {
  try {
    if (process.env.GITHUB_ACTIONS === 'true') {
      // Workflow command data escaping: the runner decodes it before registering the mask
      process.stdout.write(`::add-mask::${line.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}\n`);
    } else if (process.env.TF_BUILD) {
      // Azure Pipelines: masks the value in the rest of the job log
      // (message data escaping of azure-pipelines-task-lib, decoded by the agent)
      process.stdout.write(`##vso[task.setsecret]${line.replace(/%/g, '%AZP25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}\n`);
    }
    // GitLab, Bitbucket and Jenkins mask their own masked / secured variables:
    // the documentation requires the variable to be declared masked there
  } catch {
    // stdout can be closed when the process exits: the in-process redaction still applies
  }
}
