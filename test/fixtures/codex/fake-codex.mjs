/* global process */
// Fake Codex CLI for the unit tests: reads the prompt on stdin, prints `codex exec --json` events.
// The prompt chooses the behavior: "fail" exits with an error, "turn-failed" reports a failed turn,
// anything else gets an answer that repeats the prompt and the arguments.
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const print = (event) => process.stdout.write(JSON.stringify(event) + "\n");
  if (input === "fail") {
    process.stderr.write("boom");
    process.exit(3);
  }
  print({ type: "thread.started", thread_id: "t1" });
  print({ type: "turn.started" });
  if (input === "turn-failed") {
    // Like the real CLI: retry notices, then the failed turn and exit code 1
    print({ type: "error", message: "Reconnecting... 1/5 (quota exceeded)" });
    print({ type: "turn.failed", error: { message: "quota exceeded" } });
    process.stderr.write("ERROR codex_api: noisy log line");
    process.exitCode = 1;
    return;
  }
  const answer = {
    prompt: input,
    args: process.argv.slice(2),
    apiKey: process.env.CODEX_API_KEY || null,
  };
  print({ type: "item.completed", item: { id: "i1", type: "agent_message", text: JSON.stringify(answer) } });
  print({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
});
