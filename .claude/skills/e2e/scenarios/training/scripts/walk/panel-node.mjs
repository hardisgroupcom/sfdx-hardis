#!/usr/bin/env node
/**
 * The variant of ../panel.mjs for the Training menu: it runs `node`, not `sf`.
 *
 *   node panel-node.mjs --cwd <repo> --answers '<json rules>' -- scripts/training.mjs simulate
 *
 * The Command Runner of the extension runs `node scripts/training.mjs <verb>` with the address
 * of its WebSocket server in SFDX_HARDIS_WEBSOCKET, and the questions of Simulate my teammates,
 * Create my lab records or Publish my pipeline configuration arrive in the panel. This does the
 * same headless. Give the script with its path: `-- simulate` alone fails on "Cannot find module".
 *
 * Rules, exit codes and everything else are the ones of ../panel.mjs, which this file runs.
 */
globalThis.PANEL_RUNNER = "node";
await import("../panel.mjs");
