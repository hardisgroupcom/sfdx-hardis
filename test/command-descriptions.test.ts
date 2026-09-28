import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

/**
 * A command description ends up verbatim in oclif.manifest.json, and oclif runs its own
 * template interpolation over the descriptions it reads back from that manifest. A
 * description whose rendered text contains `${something}` therefore makes oclif evaluate
 * `something` as a variable, and `sf commands` crashes for every user with:
 *
 *   ReferenceError: <something> is not defined
 *
 * It shipped once, in the Grafana dashboards command, where the description documented the
 * `${DS_PROMETHEUS}` placeholders of the alert pack. Writing them without the braces reads
 * just as well and cannot be mistaken for an interpolation.
 *
 * This walks the compiled sources rather than the TypeScript, because what matters is the
 * rendered string, not how it was escaped.
 */
describe('command descriptions', () => {
  const libDir = path.join(process.cwd(), 'lib', 'commands');

  function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) {
      return out;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, out);
      } else if (entry.name.endsWith('.js')) {
        out.push(full);
      }
    }
    return out;
  }

  it('never contain a ${...} that oclif would try to evaluate', async function () {
    const files = walk(libDir);
    if (files.length === 0) {
      // Nothing compiled: the build test suite covers it, this one has nothing to say
      this.skip();
      return;
    }

    const offenders: string[] = [];
    for (const file of files) {
      const commandModule = await import(`file://${file.split(path.sep).join('/')}`);
      for (const exported of Object.values(commandModule) as any[]) {
        if (!exported || typeof exported !== 'function') {
          continue;
        }
        for (const key of ['description', 'summary']) {
          const value = exported[key];
          if (typeof value !== 'string') {
            continue;
          }
          const match = value.match(/\$\{[^}]+\}/);
          if (match) {
            offenders.push(`${path.relative(process.cwd(), file)} (${key}): ${match[0]}`);
          }
        }
      }
    }

    expect(offenders, `These descriptions would break "sf commands":\n  ${offenders.join('\n  ')}`).to.deep.equal([]);
  });
});
