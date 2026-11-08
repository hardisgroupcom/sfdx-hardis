// Loaded by mocha before any test (.mocharc.json "require").
// No test may open a report, a file or a browser on the desktop of the person running it.
import process from 'node:process';

process.env.NO_OPEN = 'true';
