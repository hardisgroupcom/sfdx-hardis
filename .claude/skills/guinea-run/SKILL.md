---
name: guinea-run
description: Maintain Guinea Run, the 3D easter-egg game hidden in the sfdx-hardis training site (sibling repository sfdx-hardis-training, site-theme/javascripts/guinea-run/) - its ten worlds, its story and texts, the Blender models and the guinea pig's shape, the pictures and the cartoon portraits of the cast and bosses, the check that plays every world, and the playable preview published as a claude.ai Artifact. Load it for any change to the game, when the user says "Guinea Run", "the game", "the easter egg", "the guinea pig", names one of its worlds, or sends feedback from playing it; and when a lab change may break a world (a quoted string, a lab link).
---

# Guinea Run

A 3D game hidden in the course site. The Konami code (arrows, WASD or ZQSD) or
five taps on the guinea pig at the end of the footer opens it. The player is
the guinea pig carrying **US-014**, a change at the company **Cloudity**,
through the pipeline: ten worlds on a map, unlocked in order, from a laptop
with nothing installed to production, then the watch over production. English
and French, keyboard and phone, Google Analytics events, progress in the
browser. Badges at worlds 3, 5 and 8 (the course's three levels), the credits
after the last world.

The author's line for it: **educational but fun**. Every change keeps both.

## Where things are

All paths in the sibling `../sfdx-hardis-training`.

| What | Where |
|---|---|
| The way in (Konami code, footer taps, lazy import) | `site-theme/javascripts/easter-egg.js`, the footer button in `site-overrides/partials/footer.html`, its style in `site-theme/stylesheets/extra.css` |
| The shell: map, cards, HUD, input, renderer | `site-theme/javascripts/guinea-run/game.js`, `hud.js`, `guinea-run.css`, `core/engine.js`, `core/input.js`, `core/quality.js` |
| The worlds list (module, style, glyph, lab links, badge) | `core/story.js` `WORLDS`, and `DEPLOYMENT_ACTIONS` shared by worlds 3, 6, 7, 8 |
| Shell texts (map names, pitches, rules) | `texts.js`, EN and FR side by side |
| One world | `worlds/world-N-*.js`: `MODELS`, `TEXTS`, `QUOTES`, `PADS`, `createWorld(ctx)`; shared engines `worlds/runner.js` (0, 7) and `worlds/musical.js` (6, 8) |
| Sounds, music | `core/sound.js` (real guinea pig recordings in `sounds/`), `core/themes.js` (one theme per world), `core/music.js` (the player) |
| The guinea pig | `guinea-pig.js` (loads `models/guinea-pig.glb`; a code-built fallback shows until it loads or if it cannot) |
| 3D models | `models/*.glb`, built by `scripts/blender/*.py` (`guinea-pig.py`, `salesforce-items.py`, `vegetables.py`, `kenney-packs.py`); credits in `models/CREDITS.txt` |
| Three.js | jsDelivr, pinned by `THREE_VERSION` in `game.js`; the add-ons in `vendor/`, refreshed by `node scripts/build/vendor-three.mjs` |
| Pictures | `site-theme/images/guinea-pig.webp` (cards, launcher), `guinea-pig-small.webp` (footer), `mariia.svg`, `bosses/boss-1..9.svg`, `bosses/final-boss.svg` |
| The check | `scripts/verify/check-easter-egg.mjs`, also run by `.github/workflows/pages.yml` |

The world contract is the comment above `makeContext` in `game.js`: a world
gets `ctx` (THREE, engine, scene, camera, pig, fx, models, t, lang, sound,
random, hud, params...) and calls `ctx.collect`, `ctx.loseAttempt`,
`ctx.foundNote` while it plays, then `ctx.finish()` or `ctx.fail(tip)`.

## The worlds

| # | Module | Style | What it teaches | Labs |
|---|---|---|---|---|
| 0 | world-0-setup | runner | Install the tools until the Setup panel is green | 1.1 |
| 1 | world-1-org | platformer | Start US-014 on its branch, build the field, layout, permission sets in Setup; a mushroom makes the guinea pig giant | 1.3, 1.4 |
| 2 | world-2-commit | sorting | Recent Changes lists everything you touched: commit only what US-014 needs | 1.5, 2.8 |
| 3 | world-3-pull-request | puzzle | Pick the base branch, fix the deployment check, declare the deployment actions | 1.6, 2.2, 2.3, 2.4 |
| 4 | world-4-checks | defense | Code quality gate, coverage, reviewing a teammate's Pull Request | 2.5, 3.2 |
| 5 | world-5-conflict | merge | Merge your work with Mariia's (a permission set, a Lightning page) | 2.7, 3.4 |
| 6 | world-6-integration | musical | The deployment to the integration org and its actions | 3.3 |
| 7 | world-7-promotion | runner | Promote to uat and preprod, promotion branches, a cherry-pick | 3.5, 3.10 |
| 8 | world-8-production | musical | Release to production, DORA metrics | 3.6 |
| 9 | world-9-monitoring | shooter | Admins change production by hand ("But it's faster!"), the monitoring catches it, the Sales Manager boss | 3.8 |

## Rules the game keeps

These are the author's decisions. A change that breaks one is a regression.

- **The story is generic.** Nothing from the course data (no Helios, no
  Installation__c): Cloudity, Account, Contact, Opportunity, Case, so someone
  who never took the course follows it. Names, stories and deployment actions
  are in [reference/story.md](reference/story.md).
- **Nothing missed blocks the end of a world.** A miss gives fewer points and a
  "Good to know" line on the end card. Five attempts, mercy after failures.
- **Always clear what to do:** a goal line, coach lines, a tip after each
  mistake that says why, "The rule" on the end card, "Learn it for real" links
  to the labs.
- **On a phone, a text box never hides what is coming.** Pads at the bottom, no
  sideways scroll, 60 fps.
- **A three-way choice in a runner gets about 10 seconds,** with nothing else
  on the track meanwhile (the pace eases during the window).
- **Bonuses that are not Salesforce items are vegetables** (the `vegetables`
  pack). Salesforce items that mean something in the story stay.
- **Words:** say "repository", never "fork"; always say whether a name is a git
  branch or an org ("the integration branch", "the uat org").
- **EN and FR side by side,** `labs/en` is the reference. French keeps the
  developer terms in English (flag, repository, merge, commit, branch, Flow,
  org, Pull Request, sandbox, admin). No em-dashes, no AI-tell words, no
  competitor or customer names.
- **QUOTES:** a world quotes only product words (button and panel names, real
  generic error texts), and each must appear word for word in its lab, in
  English and in French. The check fails otherwise.
- **Performance:** instanced meshes, no allocation per frame, WebGPU with a
  WebGL2 fallback, quality tiers.
- **Real people** (Mariia, Romain Panda, Victor Squeeker in the chats; the
  world 9 bosses) appear only with their consent, which the author confirmed
  for the current set. Never guess or write a name the author did not give.

## Speed

- Three.js's `WebGPURenderer` draws with WebGPU where the browser has it and
  with WebGL 2 elsewhere (`core/engine.js`): one renderer, the fallback costs
  nothing where WebGPU works, and without it Safari before 26 and many Android
  phones would get no game at all. Keep it.
- `core/quality.js` picks a tier (low, medium, high: pixel ratio, shadows,
  bloom, fur shells) from the device, skips the first 3 seconds of a world
  (shaders compiling), and drops a tier after two slow 2-second samples in a row
  (an average over 19 ms, about 52 fps), at most twice.
- The pause card says how this device draws: "Drawn with WebGPU, 60 frames per
  second, high quality". Ask the author to read it when they report lag.
- To measure on this workstation, use a real Chrome window, not headless:
  headless throttles and compiles slowly, and a hidden window drops to 1 fps.

## The guinea pig

Measured on photos of short-haired guinea pigs (Wikimedia Commons side views
were the reference): a long loaf, the back a round dome highest over the
middle, a round rump dropping to the floor, a flat belly; the forehead a long,
almost straight slope from the crown down to a longer, broad, rounded nose well
ahead of the eyes, the chin tucked under it; the eye about 15% of the body
length behind the nose, the ear just behind and above it, petal ears hanging
from the top corners of the head; an agouti coat with a lighter muzzle.

The shape lives in two places that must stay in step:

- `scripts/blender/guinea-pig.py`: `TOP`, `BOTTOM`, `HALF` (heights and half
  widths along the body), `middle()`, `cap()` (the rounding of the rump and the
  nose) and `shape()`.
- `guinea-pig.js`: the same curves and `shapePoint()`, for the fallback.

Rebuild and look at it (Blender portable on this workstation:
`%LOCALAPPDATA%/Programs/blender-portable/blender-5.2.2-windows-x64/blender.exe`):

```bash
# the model, with a studio preview; GUINEA_CAMERA moves the camera (side view: 3.6,0,0.5; front: 0.3,-3.2,0.6)
GUINEA_CAMERA="3.6,0,0.5" blender --background --factory-startup --python scripts/blender/guinea-pig.py -- \
  site-theme/javascripts/guinea-run/models/guinea-pig.glb side.png
# the picture of the cards and the footer: transparent, seen from the guinea pig's height
GUINEA_PORTRAIT=1 GUINEA_CAMERA="-3.3,-1.5,0.55" blender --background --factory-startup --python scripts/blender/guinea-pig.py -- \
  /tmp/unused.glb portrait.png
python .claude/skills/guinea-run/scripts/portrait-webp.py portrait.png \
  site-theme/images/guinea-pig.webp site-theme/images/guinea-pig-small.webp
```

- Compare with a photo side by side before calling a shape done. A camera
  above the guinea pig flattens its back: judge from its height.
- "exported ..." then `EXCEPTION_ACCESS_VIOLATION` while Blender quits is
  harmless: the files are written.
- The preview mutes the animation tracks, so it shows the rest pose.
- An ear is an ellipsoid: its centre sits one half-length from its root, or
  half of it pokes out of the head. The left ear is on +X (the model faces -Y),
  like the `ear.L` bone it follows.
- On a world done, the card's picture popcorns (`.gr-logo--happy` in
  `guinea-run.css`); a failed world shows it tilted and grey.

## Cartoon portraits

The chat avatar of Mariia (`mariia.svg`, set by `.gr-avatar--mariia`) and the
world 9 bosses are hand-written SVGs: `viewBox="0 0 100 100"`, a circle clip of
radius 50, a light background distinct per person, flat fills, no text or
logos, under 8 KB, readable at 40 px. Every `id` is prefixed with the file name
(`boss3-hair`), so two inlined portraits never share a gradient. Likeness is the
point: draw from the photo the author gives, then compare with
`node .claude/skills/guinea-run/scripts/compare-portrait.mjs <photo> <svg> <out.png>`
and iterate until someone who knows the person would recognise them.

## The working loop

1. **Edit `site-theme/` and `scripts/` only.** `site/` is the build output.
2. **Fast loop:** keep the built site served (`serveSite(port)` from
   `scripts/lib/site-server.mjs`), copy each changed file into `site/theme/...`
   at the same relative path, and look at it:
   `node .claude/skills/guinea-run/scripts/harness.mjs <world> <outDir> [query] [steps-json]`
   (`GPU=1` for WebGPU, `MOBILE=1` for a phone, `LANG_PAGE=fr`). Steps:
   `{"key"}`, `{"keys"}`, `{"click"}`, `{"eval"}`, `{"wait"}`, `{"shot"}`.
3. **URL settings for checks:** `guinea-unlock=all` (every world, nothing
   saved), `guinea-world=N` (opens it), `guinea-seed=N`, `guinea-at=M` (a runner
   starts M metres in; world 9: 2 or 3 opens that wave, 4 the boss),
   `guinea-test=1`, then `window.__guineaRun.finish()`, `.fail()`, `.action(name)`.
4. **A template changed** (`site-overrides/`): `node scripts/build/site.mjs`,
   then build into a scratch folder inside the repository (Zensical refuses a
   `site_dir` outside it) with a copy of `course-site.yml` ending in
   `site_dir: site-check`, run `python -m zensical build -f <that copy>`, look,
   delete both. Never rebuild `site/` while something copies files into it.
5. **The check, alone:** `node scripts/verify/check-easter-egg.mjs` (several
   minutes, needs the network for Three.js). Nothing else may drive a browser at
   the same time: under load, timing probes fail on a different world each run.
   Rerun alone before chasing such a failure. A new world goes into
   `WORLD_PROBES` with a probe proving its controls react.
6. **Ship:** one line for the game in the training `CHANGELOG.md`, under the
   `## YYYY-MM-DD` heading of the day. Conventional commits
   (`feat(guinea-run): ...`), no AI attribution, one training PR at a time.

## The playable preview (claude.ai Artifact)

The author plays work in progress, on a phone and in Chrome, through an Artifact.

1. `node .claude/skills/guinea-run/scripts/build-preview.mjs <outDir>` copies the
   game, its pictures and the badge banners, renames the `.glb` models `.wasm`
   (an Artifact serves standard web types only; the loader reads the bytes the
   same) and points `game.js` and `core/models.js` at them, adds the launcher
   (`scripts/preview/index.html`, whose `TRY_WORLD` constant adds a "Try world N
   now" button for a world in progress: set it in the built copy), copies the
   `labs.js` the site build wrote (the lab links of the cards), and writes
   `<outDir>/files.json`.
2. `node .claude/skills/guinea-run/scripts/preview-test.mjs <outDir>` serves it
   and plays: the map opens, world 0 plays, and the "Try world" button when set.
3. Publish with the Artifact tool: `file_path` `<outDir>/index.html`, `root`
   `<outDir>`, `files` from `files.json`, and the `url` of the author's existing
   preview (find it with `action: "list"`, title "Guinea Run"; read it first if
   this conversation did not publish it). Files left out of an update are kept.

## Windows traps

- Git checks the working copy out with CRLF. A patch script reads with
  `open(path, encoding="utf-8", newline="")`, normalises to `\n`, and writes the
  original endings back; git then shows no spurious diff.
- Long bash heredocs mangle backslashes: write files with the Write tool.
- Pillow is in the user site-packages: do not run those scripts with `python -I`.
- Parallel agents share one machine: one headless browser at a time each, and
  give each agent its own files to edit.
