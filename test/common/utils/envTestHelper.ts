// Puts the environment variables back to a snapshot taken with { ...process.env }, key by key.
// Never assign process.env itself: the plain object that replaces it is not the real environment
// anymore, so a variable set later on it is not seen by a child process started without an `env`
// option (Node 26 on Windows gives such a child the real environment of the process).
export function restoreProcessEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== undefined && process.env[key] !== value) {
      process.env[key] = value;
    }
  }
}
