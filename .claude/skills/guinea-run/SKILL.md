---
name: guinea-run
description: Maintain Guinea Run, the 3D easter-egg game hidden in the sfdx-hardis training site (sibling repository sfdx-hardis-training, site-theme/javascripts/guinea-run/) - its ten worlds, its story and texts, the Blender models and the guinea pig's shape, the pictures and the cartoon portraits of the cast and bosses, the Hall of Fame (the boards, signed scores, speed bonus, the hall-of-fame workflow and site page), Pipeline Pinball (the bonus pinball table opened by finishing every world), the check that plays every world, and the playable preview published as a claude.ai Artifact. Load it for any change to the game, when the user says "Guinea Run", "the game", "the easter egg", "the Hall of Fame", "the pinball", "the bonus level", "the guinea pig", names one of its worlds, or sends feedback from playing it; and when a lab change may break a world (a quoted string, a lab link).
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

| What                                                     | Where                                                                                                                                                                                                                                                          |
|----------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| The way in (Konami code, footer taps, lazy import)       | `site-theme/javascripts/easter-egg.js`, the footer button in `site-overrides/partials/footer.html`, its style in `site-theme/stylesheets/extra.css`                                                                                                            |
| The shell: map, cards, HUD, input, renderer              | `site-theme/javascripts/guinea-run/game.js`, `hud.js`, `guinea-run.css`, `core/engine.js`, `core/input.js`, `core/quality.js`                                                                                                                                  |
| The worlds list (module, style, glyph, lab links, badge) | `core/story.js` `WORLDS`, and `DEPLOYMENT_ACTIONS` shared by worlds 3, 6, 7, 8                                                                                                                                                                                 |
| Shell texts (map names, pitches, rules)                  | `texts.js`, EN and FR side by side                                                                                                                                                                                                                             |
| One world                                                | `worlds/world-N-*.js`: `MODELS`, `TEXTS`, `QUOTES`, `PADS`, `createWorld(ctx)`; shared engines `worlds/runner.js` (0, 7) and `worlds/musical.js` (6, 8)                                                                                                        |
| Sounds, music                                            | `core/sound.js` (real guinea pig recordings in `sounds/`, public domain or CC0 only, each source in `sounds/CREDITS.txt`; a jump picks one of the 13 `WHEEKS`, never the last one heard), `core/themes.js` (one theme per world), `core/music.js` (the player) |
| The guinea pig                                           | `guinea-pig.js` (loads `models/guinea-pig.glb`; a code-built fallback shows until it loads or if it cannot)                                                                                                                                                    |
| 3D models                                                | `models/*.glb`, built by `scripts/blender/*.py` (`guinea-pig.py`, `salesforce-items.py`, `vegetables.py`, `kenney-packs.py`, `data-cloud.py` for the world 8 rabbit); credits in `models/CREDITS.txt`                                                          |
| Three.js                                                 | jsDelivr, pinned by `THREE_VERSION` in `game.js`; the add-ons in `vendor/`, refreshed by `node scripts/build/vendor-three.mjs`                                                                                                                                 |
| Pictures                                                 | `site-theme/images/guinea-pig.webp` (cards, launcher), `guinea-pig-small.webp` (footer), `mariia.svg`, `romain.svg`, `bosses/boss-1..21.svg`, `bosses/final-boss.svg`                                                                                          |
| The admins' faces                                        | `core/faces.js`: `pickAdmins(world, random, count)` and `adminFaceUrl(n)`                                                                                                                                                                                      |
| Reading time                                             | `readingMs(text, kind)` and `lineKeeper()` in `hud.js`                                                                                                                                                                                                         |
| The check                                                | `scripts/verify/check-easter-egg.mjs`, also run by `.github/workflows/pages.yml`                                                                                                                                                                               |
| The Hall of Fame                                         | see [The Hall of Fame](#the-hall-of-fame) below                                                                                                                                                                                                                |
| The bonus table                                          | see [Pipeline Pinball](#pipeline-pinball-the-bonus-table) below                                                                                                                                                                                                |

The world contract is the comment above `makeContext` in `game.js`: a world
gets `ctx` (THREE, engine, scene, camera, pig, fx, models, t, lang, sound,
random, hud, params...) and calls `ctx.collect`, `ctx.loseAttempt`,
`ctx.foundNote` while it plays, then `ctx.finish()` or `ctx.fail(tip)`. A boss
calls `ctx.bossStarted()` when the fight itself starts (after its opening
lines, whose length depends on the language) and `ctx.bossBeaten()` when it is
down: with a `par` in `WORLDS`, a fast fight earns a speed bonus.

## The worlds

| # | Module               | Style                      | What it teaches                                                                                                      | Boss                                                                                                                                                                                         | Labs               |
|---|----------------------|----------------------------|----------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------|
| 0 | world-0-setup        | runner                     | Install the tools until the Setup panel is green                                                                     | "Why install anything?": an admin holds the track and throws blocks across the lanes; the guinea pig brings tools to his laptop until he installs VS Code himself                            | 1.1                |
| 1 | world-1-org          | platformer                 | Start US-014 on its branch, build the field, layout, permission sets in Setup; a mushroom makes the guinea pig giant | A castle bridge: the admin wants one monster Flow, the guinea pig wants simple Apex and LWC (agentic engineering). Get past him, touch the axe, he falls into the lava screaming about Flows | 1.3, 1.4           |
| 2 | world-2-commit       | sorting                    | Recent Changes lists everything you touched: commit only what US-014 needs                                           | The "git add ." admin throws whole Profiles and other people's work onto the commit, already ticked                                                                                          | 1.5, 2.8           |
| 3 | world-3-pull-request | puzzle                     | Pick the base branch, fix the deployment check, declare the deployment actions                                       | The "I'll do it by hand after" admin pulls the declared actions out and switches the base to main                                                                                            | 1.6, 2.2, 2.3, 2.4 |
| 4 | world-4-checks       | defense                    | Code quality gate, coverage, reviewing a teammate's Pull Request                                                     | A dev pads his test class with i++ (an empty catch, a query in a loop, a hardcoded Id among them): stop them, hit him when his lane is clear                                                 | 2.5, 3.2           |
| 5 | world-5-conflict     | merge                      | Merge your work with Mariia's (a permission set, a Lightning page)                                                   | A dev in a hurry clicks Accept Current Change everywhere (a lost line costs a heart), then his git push --force meets branch protection                                                      | 2.7, 3.4           |
| 6 | world-6-integration  | musical                    | The deployment to the integration org and its actions                                                                | The dev "works on my sandbox" throws his uncommitted components on the beat; Pull Requests make the pipeline fire back                                                                       | 3.3                |
| 7 | world-7-promotion    | runner                     | Promote to uat and preprod, promotion branches, a cherry-pick                                                        | Two testers at the end of uat: vegetables make the first validate US-062 in the uat org, the second leaves on sick leave, hence the promotion branch                                         | 3.5, 3.10          |
| 8 | world-8-production   | musical                    | Release to production, DORA metrics                                                                                  | The Data Cloud, a giant rabbit that throws its errors on the beat; golden carrots make the guinea pig fire back                                                                              | 3.6                |
| 9 | world-9-monitoring   | whack-a-mole, then shooter | Admins change production by hand ("But it's faster!"), the monitoring catches it                                     | A whack-a-mole of admins with change sets and Setup edits (one that gets away needs "Retrofit via PR"), the invaders, then the Sales Manager                                                 | 3.8                |

**Every boss but the Sales Manager wears a different face at each play**
(an admin, or a dev in worlds 4, 5 and 6):
`pickAdmins` draws from the twenty-one portraits, never the face that world
showed last time (remembered in the browser), with the world's seeded random
so a check replays the same draw. World 7 draws two.

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
- **A three-way choice in a runner gets 10 to 14 seconds** (`decideTime` in
  `runner.js`, from the length of the question and its doors), with nothing
  else on the track meanwhile (the pace eases during the window).
- **Every text gets the time to be read, and the play stays fluid.**
  `readingMs(text)` is 1.6 s + 60 ms a character for a line, 1.2 s + 45 ms
  for a short call (`"call"`). The HUD's coach, toast, tip, chat and notes
  last at least that long, counted once painted. A newer line waits for the
  one being read (the newest only), a quip at a hit is dropped rather than
  cutting it, a third chat bubble waits for the oldest. A world's own speech
  bubble does the same (`lineKeeper()`, or a pending line on the game clock),
  and a talk or an ending lasts as long as its lines (world 1's talk, the
  world 8 rabbit sinking). Long lessons go in calm moments; cards wait for a
  button. A phone shows only the newest chat bubble, so there a new one waits
  for the one on screen (`chatWait` in `hud.js`). Measure with an audit that
  polls the text boxes; under GPU load its polls are far apart, so count gaps
  up to 1.5 s or it undercounts.
- **Phones:** a world with a single jump pad (the musical runs) jumps at the
  touch on the canvas, not at the release (`tapOnDown` in `core/input.js`):
  there is no swipe to tell apart. A phone suspends the audio on a
  notification or a dimmed screen and never resumes it: `core/sound.js`
  resumes it at the next touch, key or return to the page, and the music is
  scheduled 0.3 s ahead on touch screens (`LOOKAHEAD_S` in `core/music.js`).
- **The end credits** roll after world 9, then the final card. The Special
  thanks names in `credits.js` are the "Special Thanks" of the sfdx-hardis
  README, in its order: when a name is added there, add it here. The roll ends
  on the Cloudity contact link (setup and support), `CONTACT_URLS`.
- **Bonuses that are not Salesforce items are vegetables** (the `vegetables`
  pack). Salesforce items that mean something in the story stay.
- **Words:** say "repository", never "fork"; always say whether a name is a git
  branch or an org ("the integration branch", "the uat org").
- **EN and FR side by side,** `labs/en` is the reference. French keeps the
  developer terms in English (flag, repository, merge, commit, branch, Flow,
  org, Pull Request, sandbox, admin, dev). No em-dashes, no AI-tell words, no
  competitor or customer names.
- **QUOTES:** a world quotes only product words (button and panel names, real
  generic error texts), and each must appear word for word in its lab, in
  English and in French. The check fails otherwise.
- **Performance:** instanced meshes, no allocation per frame, WebGPU with a
  WebGL2 fallback, quality tiers.
- **Real people** (Mariia and Romain Panda in the chats; the world 9 bosses) appear only with their consent, which the author confirmed
  for the current set. Never guess or write a name the author did not give.

## The Hall of Fame

A general board (the best score of each world, added up) and one board per
world, with the GitHub handle, avatar and badge of each player. Decided with
the author on 2026-10-22: GitHub only, no server.

| What                                        | Where (in `../sfdx-hardis-training`)                                                             |
|---------------------------------------------|--------------------------------------------------------------------------------------------------|
| Rankings, loading the board, the issue link | `site-theme/javascripts/guinea-run/core/hof.js` (also imported by the scripts and the site page) |
| Signing a result and a submission           | `core/tally.js`                                                                                  |
| The card in the game                        | `hud.js` `hallOfFame()`, `game.js` `showHallOfFame()`                                            |
| The issue form, the workflow                | `.github/ISSUE_TEMPLATE/guinea-run-score.yml`, `.github/workflows/hall-of-fame.yml`              |
| Checking and merging a submission, tests    | `scripts/guinea-run/verify-submission.mjs`, `hall-of-fame.mjs`, `*.test.mjs`                     |
| The board                                   | `hall-of-fame/hall-of-fame.json` (written by the workflow and by `claim.yml` for badges)         |
| The site page                               | `hallOfFamePage` in `scripts/lib/pages.mjs`, `hallOfFamePages()` in `scripts/build/site.mjs`     |

- **How a score gets in**: a won world keeps a signed result of its best run.
  "Send my scores" on the Hall of Fame card opens a prefilled GitHub issue; the
  workflow checks the signatures, that the handle is the issue author, the hour,
  and the limits, then merges (each world keeps the higher score), commits to
  `main`, asks for the site build, comments the ranks and closes the issue.
- **The invitation to send** (asked by the author on 2026-10-23): a score
  that would enter the top 5 of its world, of the total (pinball excluded) or of
  the Pinball board gets a box on the end card (`topInvites()` in `hof.js`,
  `inviteFor()` in `game.js`, `invite()` in `hud.js`), with a link straight to
  the issue once the handle is known. A tie with the fifth does not count (the
  first one keeps the place); fewer than five others, any score counts. Never a
  score already on the board or already sent (`progress.sent`), never after a
  failed world. The map marks the Hall of Fame button while one waits, and the
  pinball display flashes TOP 5 once per game past the fifth
  (`pinballTarget()`). The board is read only when there is something new to
  send. In a check, `window.__guineaRun.board(board)` stands in for GitHub.
- **Secrets**: `GUINEA_RUN_KEYS` (the signing keys by id) and
  `GUINEA_RUN_LIMITS` (score caps, minimum boss times, rate limit). The limits
  are secret on purpose: never write them in the repository or a comment.
- **The key** is rotated with a script kept on the author's machine only (not
  committed, see `.gitignore`). Never describe where the game keeps its key in
  a public file, this one included. A `key-check` job fails when the game and
  the secret disagree.
- **A test link never signs**: `guinea-test`, `guinea-seed`, `guinea-at` and
  `guinea-unlock` runs are kept out of submissions.
- **Moderation**: `node scripts/guinea-run/hall-of-fame.mjs remove <handle>` or
  `ban <handle>`, then commit.
- **End bonuses** (`succeedWorld` in `game.js`, one line each on the end card):
  +250 for no mistake, 50 less per attempt lost, never below 0; +200 for
  Victor's note; up to +300 for a boss beaten at its par time. Decided with the
  author on 2026-10-22.
- **Modes** (`MODES` in `core/story.js`, picked on the map, remembered):
  Easy (the course pace), Normal (1.5 times faster, points x1.5), Hard (twice
  as fast, points x2). The shell runs a world's time faster; a world exporting
  `OWN_SPEED` (the musical runs, whose physics count in beats) takes
  `ctx.speed` as the tempo of its song instead. Everything speeds up, texts
  included: the author's choice. The boss clock counts game time, so a par is
  the same in every mode. A signed result carries its mode, and the world
  boards tag it.
- **Par times** (`par` in `WORLDS`) are 1.3 times the median boss time of the
  world's autoplay. A change to a boss changes its par: measure it again.
- The `guinea-run-score` label must exist in the repository, or submissions
  get no answer.

## Pipeline Pinball, the bonus table

A 3D pinball table, hidden until every world has a star, made for the best
players to last an hour. The guinea pig, rolled into a ball, plays the
pipeline. Decided with the author on 2026-10-22.

| What                                           | Where (in `site-theme/javascripts/guinea-run/`)                                                  |
|------------------------------------------------|--------------------------------------------------------------------------------------------------|
| Its entry, outside `WORLDS`                    | `core/story.js` `BONUS`                                                                          |
| Ball physics (no Three.js, tested in Node)     | `worlds/pinball/physics.js`                                                                      |
| The table as data: walls, ramps, lights        | `worlds/pinball/layout.js`                                                                       |
| Points, balls, locks, levels; the ten missions | `worlds/pinball/rules.js`, `missions.js`                                                         |
| The look, the rolled guinea pig, the camera    | `worlds/pinball/view.js`, `ball.js`                                                              |
| The module, its texts, the bot of the check    | `worlds/pinball/index.js`, `autoplay.js`                                                         |
| The saved game, signed                         | `core/checkpoint.js`                                                                             |
| Held keys and screen halves                    | `core/input.js` (`hold`, `onHold`)                                                               |
| Cards: map, teaser, intro, end                 | `hud.js` `bonusCard`, `teaser`, `bonusIntro`, `bonusResult`; `game.js` `startBonus`, `bonusOver` |
| Tests                                          | `scripts/guinea-run/pinball.test.mjs`                                                            |

- **It is not a world of `WORLDS`**: the world count, the credits, the map
  numbering and the Hall of Fame total must not move. It is loaded like a
  world (`KIND = "bonus"`, `PADS = "flippers"`) and opened with
  `guinea-world=pinball`.
- **The table** (portrait, table units): ramps integration
  (left), uat (right), production (centre, closed until integration, uat and
  the left orbit, preprod, are shot in that order); the Pull Request scoop
  starts a mission, picked with the flippers while the ball waits; Recent
  Changes drop targets light the lock, three locks start Deploy to all orgs
  (three balls, jackpots, a super jackpot at production); the Production floor
  on top with the Data Cloud rabbit and the Sales Manager; top lanes for the
  skill shot (a middle pull of the plunger, a full pull loops the orbit);
  Rollback kickback, Sandbox refresh ball save, tilt on the third close nudge.
- **Arcade proportions**, asked by the author, measured on real tables (1
  table unit is 5 cm, the ball 27 mm across, `BALL_RADIUS` 0.27): flippers
  1.65 long (3 in with rubber), pivots 4.1 apart (7 in), 31 degrees down at
  rest and 21 up, the tips under two balls apart; ramp mouths 1.2 wide (2.25
  to 2.5 in); a playfield a little over twice as long as wide. The layout is
  built at its design size, then stretched by `sy()` (everything above the
  banks moves up), which opens a middle band; shapes made after the stretch
  are in final coordinates. The pop bumpers sit under the three top lanes.
- **A fan layout**: from left to right the left orbit (preprod, the
  spinner), the integration ramp, the scoop, the production ramp, the uat
  ramp, the right orbit, each with a clear lane from the flippers. Toys stand
  between the shots or above them, never in front: Validate between the
  production and uat shots, the monster Flow by the terminal, Backups and
  Code quality on the side walls under the orbit mouths. The orbits open
  level with the ramp mouths, where a shot from the far flipper meets the
  side wall. **Check every layout change with
  `scripts/pinball-shots.mjs`**: it flips a cradled ball from every point of
  each flipper and counts what each one makes. Every main shot must be made
  by several flips of at least one flipper; ramps and orbits a few in eighty
  each.
- **Physics as measured on real tables** (VPX source and the nFozzy tables):
  a rolling ball on a 6.5 degree slope (`GRAVITY` 16, 0.79 m/s2); flippers
  that speed up through their stroke (about 30 ms up, 70 ms back down on
  their spring); bounces that soften as the impact gets harder (`falloff`);
  slingshots that kick hardest in the middle of their band
  (`kickProfile`); small hops off rubbers and targets (`hop`); saucers in the
  open playfield that a fast ball rattles over (`maxSpeed`); a missed ramp
  that rolls back towards the middle, not the drain. Shots leave the flippers
  at 3 to 5 m/s, most of the play is under 1.5 m/s. Measure a change in the
  browser with `scripts/pinball-video.mjs` (frames and ball positions while
  the bot plays) and `scripts/pinball-video.py` (a GIF, a contact sheet, the
  speeds in m/s).
- **Surprises**, asked by the author to make it entertaining and teach a
  little: the sf hardis terminal (a saucer that types a real command on the
  display and applies its effect; check a command still exists before
  adding it to `COMMANDS` in `rules.js`), an admin in production now and then
  (hit him, or the promotion is lost until it is retrofitted at the scoop),
  the monster Flow (a spinning disc, `physics.disc`, refactored into Apex
  after three passes), Validate then Quick deploy (score x2).
- **Classic behaviours**: rollovers count both ways, a tilt kills flippers,
  bumpers and slingshots, Shoot again lights for a waiting extra ball, replay
  scores and the match at game over give one more ball, the scoop kicks onto
  a flipper.
- **Modern rules**, from the best recent tables: each round of Deploy to all
  orgs jackpots is worth a step more and changes colour (blue, green, yellow,
  orange, red), the super jackpot pays the round back; orbits one after the
  other are loops worth more each time (the sixth lights the extra ball);
  integration, uat, preprod and production in a few seconds each is the
  Pipeline combo; back from production, a Hotfix hurry-up loses value every
  second; a soft plunge into the terminal is the secret skill shot; Release
  day ends on a Code freeze that counts flips, not seconds.
- **Ten missions, one per world**, each showing that world's `wN_rule`; all ten
  open Release day (four balls), then the next level (shorter ball save,
  points x1.5, x2...). **The table keeps one speed for the whole game**: the
  author's decision. A missed mission stays to do. Easy, Normal and Hard do
  not apply.
- **The look**: a dot-matrix display (`dmd.js`), printed inserts with bezels
  painted under them (`art.js`, `shapePoints` shared with the lit inserts,
  which add their light over the print), plastic ramps up to their crest then
  wire rails, ramp flags, toys, dome lights, an arcade cabinet. It must not
  look like a toy: a dim room reflected in stainless guides and chrome posts,
  black rubbers, printed sling plastics, warm lamps over a glossy playfield,
  no glass (it hazes the view). **The integration and uat ramps have open
  mouths**: no wall, rail or painted frame round them, the plastic starts flat
  on the playfield (the author asked twice). Only the production ramp keeps
  its rails and its gate.
- **Physics**: a fixed step of 1/720 s, capsules and circles only, a grid for
  the static shapes; nothing is allocated while it plays. Any layout change
  goes through `pinball.test.mjs`: the random play test finds a ball wedged
  between two shapes (gaps under the ball's diameter) or leaving the table. A
  slow ball resting exactly on top of a round shape stays there in a
  deterministic simulation: keep round shapes off the centre line.
- **Saved game**: every 5 s of play, on pause and when the page hides, signed;
  a saved game changed by hand is dropped. A resume serves the ball again from
  the plunger.
- **Hall of Fame**: the best game is signed (its own text prefix) and travels
  in the same submission as the worlds, on its own board (`rankPinball`), never
  in the total. The workflow also checks a cap and a ceiling of points per
  minute of play (limits in the secret, fallbacks in `parseLimits`).
- **Look at it** with the harness: `harness.mjs pinball <outDir>`, then the
  steps `{"click":"[data-action=bonus-new]"}` and
  `{"eval":"window.__guineaRun.pinball.autoplay(true)"}`;
  `window.__guineaRun.pinball.jump(n)` reaches 1 multiball, 2 a mission
  (`guinea-seed` picks which), 3 the Production floor, 4 Release day, 5 level 3.

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

The chat avatars of Mariia and Romain (`mariia.svg`, `romain.svg`, set by
`.gr-avatar--<name>` for a CAST entry with `face: true` in `hud.js`) and the 21
world 9 bosses (one face per admin of a wave, at most 21; the same twenty-one
play the bosses of the other worlds) are hand-written SVGs: `viewBox="0 0 100 100"`, a circle clip of
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
   starts M metres in; elsewhere a step of the world),
   `guinea-test=1`, then `window.__guineaRun.finish()`, `.fail()`, `.action(name)`.
   Straight to a boss: world 0 `guinea-at=860`, world 1 `169` (the castle
   door), world 2 `1`, worlds 3 and 5 `4`, world 4 `6`, world 6 `196`, world 7 `285`, world 8 `164`,
   world 9 `1` (the moles) to `4` (the Sales Manager). A world with a boss has
   its own autoplay, `window.__guineaRun.wN.autoplay(true)`, which the check
   uses.
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
