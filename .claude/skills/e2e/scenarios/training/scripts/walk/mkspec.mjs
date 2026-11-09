// usage: node mkspec.mjs <out.json> <labId> '<steps json>'   -> a one-lab spec file for the lab driver
import fs from "fs";
const [out, id, steps] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({ labs: [{ id, title: "e2e " + id, steps: JSON.parse(steps) }] }, null, 1));
