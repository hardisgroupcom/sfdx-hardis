// The shot map of Pipeline Pinball, and its numbers against a real table.
//   node pinball-shots.mjs            what each flipper makes, flip by flip, and a tally
//   node pinball-shots.mjs --detail   the first things each flip hits
// A ball is cradled on a held flipper, let go, and flipped when it has rolled
// to k of the bat (0 the pivot, 1 the tip), for k from 0.2 to 1 in steps of
// 0.01, with the production gate open. Every main shot must be made by some
// flips of at least one flipper; the orbits and the ramps should each get a
// window of several flips (a few in eighty).
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TRAINING } from "./training-repo.mjs";

const dir = path.join(TRAINING, "site-theme", "javascripts", "guinea-run", "worlds", "pinball");
const { buildTable } = await import(pathToFileURL(path.join(dir, "layout.js")).href);
const detail = process.argv.includes("--detail");
const DT = 1 / 720;
// 1 table unit is 5 cm: the ball is 27 mm across
const M = 0.05;

function flipAt(name, k) {
  const table = buildTable();
  const p = table.physics;
  table.parts.productionGate.enabled = false;
  const f = table.parts.flippers[name];
  f.held = true;
  for (let t = 0; t < 0.2; t += DT) {
    p.advance(DT);
  }
  const s = f.shape;
  const ball = p.addBall(s.pivotX + f.side * 0.35, s.pivotY + 1.2, 0, 0, 0);
  for (let t = 0; t < 1.5; t += DT) {
    p.advance(DT);
  }
  p.readEvents(() => {});
  f.held = false;
  let flipped = false;
  let at = 0;
  let exit = 0;
  let made = null;
  const hits = [];
  for (let t = 0; t < 3 && !made; t += DT) {
    p.advance(DT);
    const ex = s.bx - s.pivotX;
    const ey = s.by - s.pivotY;
    const kk = ((ball.x - s.pivotX) * ex + (ball.y - s.pivotY) * ey) / (ex * ex + ey * ey);
    if (!flipped && kk >= k) {
      flipped = true;
      at = t;
      f.held = true;
    }
    if (flipped && t - at > 0.25) {
      f.held = false;
    }
    if (flipped && t - at < 0.08) {
      exit = Math.max(exit, Math.hypot(ball.vx, ball.vy));
    }
    p.readEvents((e) => {
      if (!flipped || made) {
        return;
      }
      if (e.type === "rampDone") {
        made = e.tag;
      } else if (e.type === "cross" && /orbit|spinner/.test(e.tag)) {
        made = e.tag === "spinner" ? "orbitLeft" : e.tag;
      } else if (e.type === "enter" && /scoop|hotfix|terminal/.test(e.tag)) {
        made = e.tag;
      } else if (e.type === "drain") {
        made = "drain";
      } else if (e.type === "hit" && e.tag && e.tag !== "flipper" && hits.length < 4) {
        hits.push(e.tag);
      }
    });
    if (!ball.active || ball.mode === "held") {
      break;
    }
  }
  return { made: made || "-", hits, exit: exit * M };
}

const tally = {};
let fastest = 0;
for (const name of ["left", "right"]) {
  for (let i = 20; i <= 100; i++) {
    const r = flipAt(name, i / 100);
    fastest = Math.max(fastest, r.exit);
    const key = name + " " + r.made;
    tally[key] = (tally[key] || 0) + 1;
    if (detail) {
      console.log(name, (i / 100).toFixed(2), r.made, r.hits.join(" > "), r.exit.toFixed(2) + " m/s");
    }
  }
}
console.log(Object.entries(tally).sort().map(([k, v]) => k + ": " + v).join("\n"));

// The flipper and the slope, against the numbers of a real table (VPX, nFozzy):
// a 52 degree stroke in 20 to 30 ms, back down in about 70 ms, a full shot
// leaving at 3 to 5 m/s, a ball let go at the top back at the flippers in about 1.5 s
const table = buildTable();
const f = table.parts.flippers.left;
let up = 0;
f.held = true;
while (f.angle < f.up - 1e-6 && up < 1) {
  table.physics.advance(DT);
  up += DT;
}
let down = 0;
f.held = false;
while (f.angle > f.rest + 1e-6 && down < 1) {
  table.physics.advance(DT);
  down += DT;
}
console.log(`flipper: ${Math.round(((f.up - f.rest) * 180) / Math.PI)} degrees, up in ${Math.round(up * 1000)} ms, down in ${Math.round(down * 1000)} ms; fastest shot ${fastest.toFixed(2)} m/s; slope ${(table.physics.gravity * M).toFixed(2)} m/s2`);
