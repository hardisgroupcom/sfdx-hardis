#!/usr/bin/env node
/**
 * A headless stand-in for the VS Code sfdx-hardis panel, for walking the training
 * labs without clicking.
 *
 *   node panel.mjs --cwd <repo> --answers '<json rules>' -- hardis:work:new
 *
 * It starts the WebSocket server the extension would start, runs the sf command
 * with --websocket pointing at it, and answers every prompt from the rules:
 *   [{ "q": "regex on the question", "choice": "regex on a choice title" }, ...]
 *   [{ "q": "...", "value": <raw value> }]   for text prompts or exact values
 *   [{ "q": "...", "value": "__INITIAL__" }] accepts what the panel pre-fills
 *   [{ "q": "...", "choice": "...", "optional": true }] a rule that may not fire
 *
 * Each rule is used once, in order of appearance. A prompt no rule matches stops
 * the command: an unexpected question is a finding, never something to guess.
 * That is the whole point of this file. A learner reading the lab would be stuck
 * on the same question, so the run must stop there too.
 *
 * Exit codes: the command's own, or 2 when a prompt went unanswered.
 *
 * `ws` comes from the sfdx-hardis working copy this skill lives in, found from
 * this file's own path. Nothing here is hardcoded to one machine.
 */
import { createRequire } from "module";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARDIS = process.env.SFDX_HARDIS_DIR || path.resolve(HERE, "..", "..", "..", "..");
const require = createRequire(path.join(HARDIS, "package.json").replace(/\\/g, "/"));
const { WebSocketServer } = require("ws");

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const opts = {};
for (let i = 0; i < (sep === -1 ? argv.length : sep); i += 2) {
  opts[argv[i].replace(/^--/, "")] = argv[i + 1];
}
const command = sep === -1 ? [] : argv.slice(sep + 1);
const rules = JSON.parse(opts.answers || "[]").map((r) => ({ ...r, used: false }));
const port = Number(opts.port || 27020 + Math.floor(Math.random() * 500));
const strip = (s) => String(s ?? "").replace(/\u001b\[[0-9;]*m/g, "");

const wss = new WebSocketServer({ port });
let failed = null;

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    const data = JSON.parse(raw.toString());
    const send = (msg) => ws.send(JSON.stringify(msg));
    switch (data.event) {
      case "initClient":
        send({ event: "userInput", userInput: "ui-lwc" });
        break;
      case "prompts": {
        for (const prompt of data.prompts) {
          const message = strip(prompt.message);
          console.log(`\n[PROMPT] ${message}  (${prompt.type})`);
          for (const ch of prompt.choices || []) {
            console.log(`   - ${strip(ch.title)}${ch.description ? `  -- ${strip(ch.description)}` : ""}  [${JSON.stringify(ch.value)}]`);
          }
          const rule = rules.find((r) => !r.used && new RegExp(r.q, "i").test(message));
          if (!rule) {
            failed = `No answer for: ${message}`;
            console.log(`[PANEL] ${failed}`);
            child.kill();
            return;
          }
          rule.used = true;
          let value;
          if (rule.choice !== undefined) {
            const pattern = new RegExp(rule.choice, "i");
            const matches = (prompt.choices || []).filter((ch) => pattern.test(strip(ch.title)));
            if (prompt.type === "multiselect") {
              value = matches.map((ch) => ch.value);
            } else if (matches.length > 0) {
              value = matches[0].value;
            } else {
              failed = `No choice matching /${rule.choice}/ for: ${message}`;
              console.log(`[PANEL] ${failed}`);
              child.kill();
              return;
            }
          } else if (rule.value === "__INITIAL__") {
            // What the panel shows pre-filled: accepting it is pressing Validate
            value = prompt.initial;
          } else {
            value = rule.value;
          }
          console.log(`[ANSWER] ${JSON.stringify(value)}`);
          send({ event: "promptsResponse", promptsResponse: [{ [prompt.name || "value"]: value }] });
        }
        break;
      }
      case "reportFile":
        console.log(`[REPORT] ${strip(data.title || "")} -> ${data.file || ""}`);
        break;
      case "getExtensionVersion":
        send({ event: "extensionVersionResponse", extensionVersion: "headless" });
        break;
      default:
        break;
    }
  });
});

const isWin = process.platform === "win32";
const args = [...command, "--websocket", `localhost:${port}`];
const child = spawn(isWin ? `sf ${args.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ")}` : "sf", isWin ? [] : args, {
  cwd: opts.cwd || process.cwd(),
  shell: isWin,
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }
});
child.on("exit", (code) => {
  const unused = rules.filter((r) => !r.used && !r.optional);
  if (unused.length > 0) {
    console.log(`[PANEL] Rules never asked: ${unused.map((r) => r.q).join(" | ")}`);
  }
  console.log(`[PANEL] exit ${failed ? "stopped" : code}`);
  wss.close();
  process.exit(failed ? 2 : code ?? 1);
});
