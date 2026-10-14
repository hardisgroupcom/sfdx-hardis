// Preload that stops @oclif/core from auto-transpiling the linked sfdx-hardis
// plugin with tsx on every command run.
//
// When sfdx-hardis is linked (`sf plugins link`), oclif runs the plugin from
// src/*.ts, transpiled at each launch: about 3 extra seconds per command, and
// the transpilation starves the event loop, delaying the WebSocket exchanges
// with the VS Code extension. With `tsc --watch` keeping lib/ fresh (the
// documented development flow), that work is redundant: this preload makes
// every command run from the compiled lib/ instead, like an installed plugin.
//
// Usage (adapt the path, keep the file:// scheme):
//   NODE_OPTIONS="--import file:///C:/git/sfdx-hardis/scripts/disable-auto-transpile.mjs"
// exported in your shell profile or in the VS Code terminal environment.
// Remove the variable to get live-TypeScript runs back (no rebuild needed).
globalThis.oclif = { enableAutoTranspile: false };
