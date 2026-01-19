import { spawnSync } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);

if (!command) {
  // eslint-disable-next-line no-console
  console.error('Usage: node scripts/run-if-ci.mjs <command> [...args]');
  process.exit(2);
}

if (!process.env.CI) {
  // eslint-disable-next-line no-console
  console.log(`[wireit] Skipping in local environment (CI not set): ${[command, ...args].join(' ')}`);
  process.exit(0);
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
