/* eslint-disable @typescript-eslint/no-unused-expressions */
// HIDDEN_PANEL_COMMANDS lets websocketClient send the initClient message
// without importing any sfdx-hardis command class (importing a heavy one used
// to delay the VS Code "Running" status by several seconds). This test keeps
// the set in sync with the `public static uiConfig = { hide: true }`
// declarations of the command classes.
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { HIDDEN_PANEL_COMMANDS } from '../../src/common/websocketClient.js';

function listCommandFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listCommandFiles(fullPath);
    }
    return entry.name.endsWith('.ts') ? [fullPath] : [];
  });
}

describe('websocketClient HIDDEN_PANEL_COMMANDS', () => {
  it('matches the command classes declaring uiConfig with hide: true', () => {
    const commandsDir = path.join(process.cwd(), 'src', 'commands');
    const hiddenFromSources = new Set<string>();
    for (const file of listCommandFiles(commandsDir)) {
      const source = fs.readFileSync(file, 'utf8');
      const uiConfigMatch = source.match(/static\s+uiConfig\s*=\s*(\{[^}]*\})/);
      if (uiConfigMatch && /hide\s*:\s*true/.test(uiConfigMatch[1])) {
        const commandId = path
          .relative(commandsDir, file)
          .replace(/\.ts$/, '')
          .split(path.sep)
          .join(':');
        hiddenFromSources.add(commandId);
      }
    }
    expect([...hiddenFromSources].sort()).to.deep.equal([...HIDDEN_PANEL_COMMANDS].sort());
  });
});
