// Value of a single argument: true for a boolean flag, an array for a flag repeated several times
export type SfCliArgValue = string | boolean | string[];

// Arguments of an underlying Salesforce CLI command, keyed by CLI flag (ex: { '--wait': '120' })
export type SfCliArgs = Record<string, SfCliArgValue>;

function addArg(args: SfCliArgs, cliFlag: string, value: SfCliArgValue): void {
  const previous = args[cliFlag];
  if (previous === undefined) {
    args[cliFlag] = value;
  } else {
    args[cliFlag] = ([] as SfCliArgValue[]).concat(previous, value).map((singleValue) => String(singleValue));
  }
}

/**
 * Convert the arguments that the sfdx-hardis command does not know into arguments for the underlying Salesforce CLI command.
 * The command must declare `static strict = false` and `static ['--'] = false` so that oclif collects them in argv.
 * Accepts "--flag value", "--flag=value", "--flag" and short flags.
 * aliases maps the short form of a flag to its long form (ex: { '-w': '--wait' }), so that a short flag
 * sent by the user overrides the default set by sfdx-hardis instead of being sent twice to the command.
 */
export function parseSfCliArgs(argv: any[], aliases: Record<string, string> = {}): SfCliArgs {
  const args: SfCliArgs = {};
  let position = 0;
  while (position < argv.length) {
    const rawToken = String(argv[position]);
    if (!rawToken.startsWith('-')) {
      // Value without a flag before it: the underlying command would not know what to do with it
      position++;
      continue;
    }
    const equalPos = rawToken.indexOf('=');
    if (equalPos > -1) {
      const flagName = rawToken.substring(0, equalPos);
      addArg(args, aliases[flagName] || flagName, rawToken.substring(equalPos + 1));
      position++;
      continue;
    }
    const token = aliases[rawToken] || rawToken;
    const nextToken = argv[position + 1] === undefined ? undefined : String(argv[position + 1]);
    if (nextToken !== undefined && !nextToken.startsWith('-')) {
      addArg(args, token, nextToken);
      position += 2;
    } else {
      addArg(args, token, true);
      position++;
    }
  }
  return args;
}

function quoteIfNecessary(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/**
 * Build the command line of an underlying Salesforce CLI command.
 * Argument maps are merged from left to right: the values sent by the user override the sfdx-hardis defaults.
 */
export function buildSfCommandLine(baseCommand: string, ...argsList: (SfCliArgs | undefined | null)[]): string {
  const mergedArgs: SfCliArgs = Object.assign({}, ...argsList.filter((args) => args));
  const commandParts = [baseCommand];
  for (const [cliFlag, value] of Object.entries(mergedArgs)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    if (value === true) {
      commandParts.push(cliFlag);
    } else if (Array.isArray(value)) {
      for (const singleValue of value) {
        commandParts.push(`${cliFlag} ${quoteIfNecessary(String(singleValue))}`);
      }
    } else {
      commandParts.push(`${cliFlag} ${quoteIfNecessary(String(value))}`);
    }
  }
  return commandParts.join(' ');
}
