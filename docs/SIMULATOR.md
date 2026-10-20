# Orcar simulator

`simulator.html` shows an effect running on the Orcar's real LED map, so you can see what it looks like without being at the truck. It's for designing effects: wrong direction, wrong part of the body, seams between boards, controls that misbehave, colours you don't like. It runs the same emulator as `npm run check`, so the two agree on what a pattern draws. (The simulator's frame timing and sound are its own; `npm run check` tests those separately.)

It is not the truck. It can't tell you the real frame rate, it uses ordinary floating point rather than Pixelblaze's 16.16 fixed point (so it can't catch overflow), and its sound levels are a stand-in for the real sensor board's (see [Sound](#sound)). Before a show, an effect still needs `npm run check` and a run on the truck (`docs/ORCAR_CONTRACT.md` §9).

## Open it

1. Get a copy of the repo (clone it, or download and unzip it).
2. Double-click `simulator.html`. It opens in your browser. There's nothing to install and no server to run.
3. Click **Choose the repository folder** and pick your copy of the repository (the folder with `README.md`, `maps/` and `src/`; its name doesn't matter), or drag the folder onto the page.

The page reads the maps, the template and the effects directly from that folder, so it always shows the current version. Browsers don't let a page opened from disk read other files by itself, so it has to ask you for the folder.

**Use Chrome or Edge if you can.** They remember the folder (next time it's one **Reconnect** click), notice when files change on disk, and can save into the folder. Safari and Firefox work too, but they read the folder once: pick it again, or click **Re-read**, after files change.

## Using it

| Part | What it does |
|---|---|
| **Effect menu** (top bar) | Opens your drafts, anything in `src/effects/` (the team's effects) or `src/examples/`. **Open file…** opens a `.js` or `.effect.js` file from anywhere. You can also drop a file on the page. |
| **New** | Starts a new effect as a draft: either a starter effect that runs straight away (keep blocks, kaleidoscope default, a colour gradient) or a copy of the open effect. See [Drafts](#drafts). |
| **Code** | The editor. An `.effect.js` file holds only the effect section; the simulator adds the template in front when it runs, as `npm run build` does. A complete pattern (template included, such as a file from `patterns/`) also works. With **Auto-run** on, it re-runs a moment after you stop typing (or press Ctrl/Cmd+Enter). If the code has a syntax error, the whale keeps showing the last version that worked, as the Pixelblaze does. With **Suggestions** on, typing the first two characters of a name (`hs`, `S6`, `R1`) offers the template's names (features, groups, tags, landmarks, helpers) and the Pixelblaze built-ins the contract allows, each with a one-line note; Enter or Tab picks one, and Enter after a name you've typed in full (`R1`, with `R10`… listed) just starts a new line. Ctrl+Space asks any time. Hover over a name for what it is (this works with Suggestions off too); Cmd-click it on a Mac (Ctrl-click elsewhere) to open it in the Reference tab (template names) or the Docs tab (Pixelblaze built-ins). |
| **Checks** | Problems found in this run, with line numbers in your file. Click one to jump to the line. See [What the checks mean](#what-the-checks-mean). |
| **Reference** | What the template gives an effect, read from the template itself so it's always current: helpers (`inFeature()`, `featurePos()`, `nX()`…), every feature with its board, channel, pixel count, direction and global indices (or "not installed"), groups, tags, landmarks and planes (inches and normalized), and the template's own notes ("About the template" has its key concepts and quick reference). Search by name, note or kind ("landmark", "tag", "helper"); click a name to insert it at the cursor. **Show** lights up where a feature, group, tag or board is on the whale and dims the rest, or marks a landmark or plane; click it again, the ✕ on the view, or Esc to stop. **Contract §** opens the section of the effects contract that explains that kind of name. The descriptions are the comments in `src/template/orcar_3d_mapped.js`, so improving a comment there improves the Reference tab. |
| **Docs** | The repo's own docs, read from the folder you opened: the effects contract, the Pixelblaze reference and this page. Find searches the open doc (Enter for the next match, Shift+Enter for the previous). Links to other docs open here; links to an effect open it in the editor (asking first about unsaved changes). |
| **The whale** | Drag to orbit, Shift-drag or right-drag to pan, scroll or pinch to zoom, double-click to reset. The buttons pick a view (keys 1–5). Hover over an LED to see its board, index, feature, tags, position and colour. **Show unlit** draws LEDs that are currently off as faint dots, so you can see the whole structure even when an effect lights only part of it. **Boards** rings each LED in its board's colour, to show where the seams are. **Bright** is the operator's global brightness: effects should look right from 20% to 100%. |
| **Strips** (bottom of the view) | The kaleidoscope (`EYE_1`, `EYE_2`) and the `TEST` strand have no map positions, so they're drawn as flat strips in pixel order. |
| **Transport** | Pause/play (Space), step one frame while paused (→), restart, speed. **Sync stress** is explained below. |
| **Sound** (under the transport) | What the sensor board hears, for effects that read `frequencyData`, `energyAverage` or `maxFrequency`. See [Sound](#sound). |
| **Controls** | The pattern's sliders, toggles, colour pickers and readouts, shared by all six boards as sync does. A slider starts at the pattern's default when its function just stores the value (`export function sliderSpeed(v) { speed = v }`); otherwise it says "pattern default" until you move it. Values are remembered per effect; **Reset controls** goes back to the pattern's defaults. |
| **Copy for Pixelblaze** | Copies the complete pattern (template + effect, exactly what `npm run build` writes to `patterns/`). Paste it into a new pattern on the leader, board A. |
| **Save** (Ctrl/Cmd+S) | A team effect saves into its file (Chrome and Edge). Editing an example saves a new effect in `src/effects/` instead of changing the example. Where the page can't write to the repo (Safari or Firefox, a hosted copy, the artifact), Save keeps your version as a draft. After saving into `src/effects/`, run `npm run build` (or ask Claude) to refresh `patterns/`, then commit both. Drafts save themselves. |

**Unsaved changes are never dropped silently.** Switching effects, pressing New or opening a file while a repo effect has unsaved edits asks: **Save** (team effects), **Keep as draft**, **Discard changes** or **Cancel**. Closing or reloading the tab brings up the browser's "Leave site?" warning. As a safety net, unsaved edits are also kept in your browser and offered back when you reopen that effect (with a warning if the file has changed on disk since). Save checks the file first: if it changed on disk since you opened it, you choose whether to replace it. Save-as never overwrites an existing effect.

### Drafts

A draft is work that isn't a repo file yet: a new effect, a copy, your version of an example, or an effect the Claude chat sent. Drafts appear at the top of the effect menu and **save automatically** a moment after you stop typing (the bar above the code says "Saving…" then "Saved"). The bar also has **Rename**, **Delete** and **Save to repo**. If a draft can't be saved (no permission to write, browser storage full, a draft file changed on disk while you were typing), the bar says **Not saved** and why; the next edit tries again, and switching away or closing the tab asks first. A draft file changed on disk while you were editing it asks whether to load the file or keep yours.

| Where | Drafts are kept | Save to repo |
|---|---|---|
| Chrome / Edge, folder chosen | As files in `src/drafts/<name>.effect.js`. The folder is ignored by git (except its README), so drafts never get committed by accident. The browser asks once for permission to edit files. Any editor or AI can work on them, and the simulator reloads a draft when its file changes. | Moves the file to `src/effects/`. Then `npm run build` and commit. |
| Safari / Firefox, or writing not allowed | In this browser only. Clearing the site's data loses them. | Downloads the file for you to put in `src/effects/`. |
| The Claude artifact | In the artifact, shared with anyone you share it with, and readable and writable by the chat. | The page can't write to the repo: ask Claude, in a chat that has the repo, to add the draft to `src/effects/`. |

`npm run build`, `npm run check` and CI ignore `src/drafts/`. To check one by hand: `node tools/build.mjs src/drafts/<name>.effect.js && node tools/pbcheck.mjs src/drafts/<name>.js`.

## With an AI assistant

- **Claude Code, or any assistant that edits files in the repo:** open the effect in the simulator (Chrome or Edge) and leave it open. Each time the assistant saves the file, the simulator reloads and re-runs it. If you've edited it in the simulator too, it asks which version to keep. This works for drafts too: ask the assistant to work on `src/drafts/<name>.effect.js`, and new draft files it creates appear in the menu within a few seconds.
- **claude.ai, or a chat without file access:** paste the assistant's effect into the editor, or save it into `src/effects/` and open it from the menu. In a Claude chat that has this repo, you can also ask Claude to publish the simulator as an artifact (below), so the chat and the page share the code directly.

## What the checks mean

| Check | Means |
|---|---|
| Syntax error | The code doesn't parse. The whale keeps showing the last version that worked. |
| Lint (`let`/`const`, `Math.*`, strings, arrays made per frame, `random()` in `beforeRender`, hard-coded indices, …) | The same rules as `npm run check`: things Pixelblaze rejects or that break on the truck. |
| While rendering / while loading | A runtime error (an undefined name, a bad call), with its line and which boards hit it. |
| Bad colour values | `hsv()`/`rgb()` got NaN or a non-number; the device shows black. |
| Stopped responding | A board didn't finish a frame in 2.5 s, so the simulator stopped all six. Almost always an endless loop. Fix it and press **Run again**. |
| Flashing about N times a second | Large areas (a whole board, or the whole whale) flash more than 3 times a second, the show-safety limit in contract §8. It follows each LED's brightest channel, so red and blue strobes count as much as white. Measured from the pattern's output as it runs; a strobe faster than half a board's frame rate reads lower than it really is, but is still flagged. Treat it as a guide: the contract's rule is what matters. |
| Pixel budget, globals, array elements | Over (or near) the Pixelblaze limits of 256 globals and 10,240 array elements. |
| Template/map count mismatch | The template's pixel count for a board differs from `maps/boards.json`. Regenerate the maps (`npm run maps`). |

**Not checked here:** 16.16 fixed-point overflow, the real frame rate (board B must stay at 30 FPS or better), and the real sensor board's sound levels.

### Sound

The sensor board is on board A and broadcasts what it hears to all six boards. The **Sound** menu picks what it hears:

| Sound | What |
|---|---|
| **No sensor board** | The sensor variables keep their defaults, as on the truck with no sensor board connected. An effect must still look acceptable this way (contract §6). |
| **Synthetic beat** | A 31-second dance loop made in your browser (no audio file in the repo): 8 bars of groove with a four-on-the-floor kick, a 4-bar breakdown with no kick (does the effect calm down?), a 2-bar build and a 2-bar drop. Tempo 90–150 BPM. This is the default. |
| **Audio file…** | Any mp3, wav, m4a or similar your browser can play, up to 20 minutes (250 MB). It loops. **Choose…** picks another file. It stays on your computer: it's kept in this browser so it's there next time, and never uploaded. |
| **Microphone** | Live input from your computer's microphone. Never played back, so it can't feed back. The browser asks for permission each time you choose it. Not available in the Claude artifact. |

- **Play** sends the beat or file to your speakers in step with the whale. Pause, step and Restart move the music with it, and editing the code doesn't restart the music. At speeds other than 1× the sound is muted, but the whale still follows the music at that speed. Browsers only play sound after you click or press a key on the page, so the note says "Click anywhere to hear it" until you do.
- **Level** is how loud the room is, from ¼× (quiet) to 4× (very loud). Effects should auto-gain: try both ends.
- **The meter** shows the 32 `frequencyData` buckets the boards are getting right now (hover for a bucket's frequencies and value), with `energyAverage` at the right. Kicks sit in buckets 1–3, vocals around 10–20, cymbals 25 and up.
- **Sync stress** also drops about 5% of board B's sound packets and (for the beat or a file) gives it the sound 15 ms late, as `npm run check` does.
- If the page stalls for a moment, the whale catches up with the music rather than the music jumping.

**How close is it?** The simulator analyses the sound the way the sensor board's open-source firmware does: 20 kHz audio, a packet every 512 samples (about 39 a second), the same 32 uneven buckets, `energyAverage` as the mean level, `maxFrequency` from the strongest 39 Hz bin. What isn't known yet is the absolute scale. The real values depend on the board's microphone, the room and the firmware's fixed-point maths, and haven't been measured on the truck. The simulator's scale puts loud music's kick buckets around 0.05–0.1. Treat thresholds tuned here as a starting point and check them on the truck (watch `frequencyData` in the Pixelblaze's Var Watcher with music playing). Once real values are known, `SCALE` in `sim/sound.js` is the one number to change.

### Sync stress

On the truck, the six boards boot at different times and render at different frame rates. Anything that has to line up across boards must therefore depend only on position, `time()`, controls and sensor data, never on how many frames have run (contract §5). **Sync stress** recreates those conditions: each board starts as if it had been running for a different length of time (0–47 s) and renders at its own frame rate (A 45, E 40, F 33, C 29, D 24, B 17 fps, in simulated time). The rates are chosen, not measured: all different, and ordered by pixel count, so board B (807 pixels) is slowest. They'll be replaced with the truck's measured FPS. The boot time is simulated history: before the run starts, each board quietly renders the frames it would have rendered since its boot, then all six start showing together. Without sync stress, all six boards boot together and render at 40 fps.

- If neighbouring boards stop matching at the seams with sync stress on, the pattern depends on frame history, and it will do the same on the truck. Turn on **Boards** to see where the seams are.
- If everything still lines up, that's a good sign but not proof. `npm run check` measures it more precisely, and the truck has the final say.

The slowest board's frames are a little older than the others', so fast motion can look one frame behind on board B. That's real: board B is the slowest board on the truck too.

## Hosting it (optional)

A copy of the simulator on a web server loads the repo files from the server, with nothing to choose. `node tools/sim-artifact.mjs` gathers the page and the files it reads into one folder, with a `sim/manifest.json` listing the effects (a web server can't list folders).

- **Claude artifact:** see the next section.
- **GitHub Pages (not set up yet):** `node tools/sim-artifact.mjs --pages` writes `build/sim-pages/`, a plain static site. Publishing it from CI on every merge to main would keep it current with no manual uploads. Pages is free for public repositories; private ones need a paid GitHub plan, and the site is public either way unless you're on GitHub Enterprise Cloud.

### For Claude: publishing the simulator as an artifact

When someone in a claude.ai chat (with this repo) wants to see an effect, publish the simulator as an artifact:

1. `node tools/sim-artifact.mjs` writes `build/sim-artifact/`: `simulator.html` without its `<html>`/`<head>`/`<body>` wrapper (the Artifact tool adds its own), and `files.json` listing every file it needs.
2. Publish `build/sim-artifact/simulator.html` with `root` set to `build/sim-artifact`, `files` set to the paths in `files.json` (each published at the same path), and `capabilities: {db: {}}`.
3. In the artifact, drafts live in its database, collection `drafts`: one document per draft, the document id is the draft's name (lowercase, hyphens), with fields `name` (same as the id), `code` (an effect section or a complete pattern), `by` (`"claude"` or `"page"`), `rev` (any unique string, new on every write) and `updatedAt`.
   - **To show the person an effect:** write (`set`) `drafts/<name>` with `by: "claude"` and a new `rev`. If the page isn't busy with unsaved work, it opens the draft and runs it; otherwise it offers to. Sending to a draft that's already open updates it in place, or asks first if the person is typing in it. To change an existing draft, read it first and pass its `version` with the write, so you don't overwrite an edit the person just made. Changes usually arrive within a few seconds (up to about 30 if the live connection isn't available).
   - **To see the person's work:** list or read the `drafts` collection (their edits have `by: "page"`). Document `sim/current` (collection `sim`, id `current`) always holds what's open right now, written a moment after each change: `code`, `name`, `path` (for a repo file) or `draft` (a draft's id), `mode`.
4. The artifact is a preview, not the repo. To keep an effect, read its draft, write it to `src/effects/<name>.effect.js` in the repo, rebuild `patterns/` and commit, as usual.

If the page can't reach the database (for example a copy opened from disk), it simply works without the link.

## How it works (for maintainers)

| File | What |
|---|---|
| `simulator.html` | The page: layout and styles. Loads the scripts below with plain `<script src>`, which works from disk. |
| `sim/engine.js` | The emulator: built-ins, map normalization, lint rules, template + effect glue. **Shared with `tools/pbsim.mjs`**, so `pbcheck`, `build.mjs` and the simulator use one copy. |
| `sim/boards.js` | Runs the six boards. Each runs in its own Web Worker, built from the engine's source, so each board has its own globals as on the real controllers, and a watchdog can stop a stuck one. Each board renders on its own fixed schedule of simulated time, independent of the screen's refresh rate. If a browser refuses workers, each board runs in a sandboxed hidden iframe instead: its own globals and no access to the page, but no watchdog, and globals named like window properties (`top`, `name`, `location`, `status`) misbehave there. |
| `sim/repo.js` | Reads the repo: folder handles (Chrome/Edge, remembered in IndexedDB), a picked or dropped folder (any browser), or http(s) with `sim/manifest.json`. |
| `sim/view.js` | The 3D view: a 2D canvas, no libraries. |
| `sim/reference.js` | The Reference tab. Parses the template's section banners, definitions and comments; values come from the running boards. |
| `sim/symbols.js` | The editor's suggestions and hover hints: template names (from the Reference tab's model), Pixelblaze built-ins (parsed from `docs/PIXELBLAZE_REFERENCE.md`, so keep its bullet and table format) and the effect's own names. |
| `sim/docs.js` | The Docs tab: renders the repo's markdown with marked, strips anything that could run, and links repo paths. |
| `sim/drafts.js` | The three draft stores: `src/drafts/` files, browser storage, the artifact's database. |
| `sim/sound.js` | Sound: the sensor-board analysis (tested in Node by the self-test), the synthetic beat, audio files, the microphone, playback. The boards read a beat or file at their own clock time from a table of packets made in advance; microphone packets are sent to them live. |
| `sim/app.js` | The rest of the page: editor, effects and drafts, unsaved-changes handling, controls, checks, flash meter, file watching, saving, the Claude artifact link. |
| `sim/vendor/` | CodeMirror 5 (the editor and its suggestion list), acorn (syntax-error lines) and marked (the Docs tab), copied from npm. See `sim/vendor/README.md`. |
| `tools/sim-selftest.mjs` | CI check (`npm run sim:test`): the page's scripts parse and exist; the worker code, built as the page builds it, draws every example on every board exactly as `pbsim` does; runtime errors report the effect's line; the editor's Pixelblaze names can still be read from `docs/PIXELBLAZE_REFERENCE.md`; test tones land in the right sensor buckets; and a board fed a sound clip draws what `pbsim` draws with the same clip. |
| `tools/sim-artifact.mjs` | Gathers the files for hosting (above). |

After changing anything in `sim/`, run `npm run ci` (it includes the self-test) and open the page to look.

## Maintaining the simulator (for people and AIs)

Read this before changing `simulator.html` or anything in `sim/`.

### Rules that keep it working

- **It must run from a file on disk, with nothing to install.** So every script is a plain `<script src>` that defines one global (`orcarEngine`, `OrcarBoards`, `OrcarRepo`, `OrcarView`, `OrcarReference`, `OrcarSymbols`, `OrcarDocs`, `OrcarDrafts`, `OrcarSound`), loaded in dependency order in `simulator.html`, with `sim/app.js` last. Don't use ES modules, a bundler, `fetch()` of repo files (only the hosted copy fetches, through `sim/repo.js`) or anything from the network. The web fonts are the one exception, and the page works without them. Third-party code goes in `sim/vendor/`, pinned and copied unchanged (`sim/vendor/README.md`).
- **The worker code is built from source text.** `boards.js` turns `orcarEngine` and `boardMain` into a worker (or sandboxed iframe) with `Function.prototype.toString()`. Those two functions must be self-contained: no references to anything outside them, not even other helpers in the same file. The self-test builds the worker the same way, so a stray reference fails CI.
- **`sim/engine.js` is also the checker.** `tools/pbsim.mjs`, `pbcheck` and `build.mjs` use it. A change to a built-in or to the lint rules changes `npm run check` too. The self-test requires the simulator's boards and `pbsim` to draw identical colours.
- **Pattern code never runs on the page.** It runs only in a board's worker or sandboxed iframe, and the page talks to boards only by messages (below). Keep it that way: no `eval` of pattern code in `app.js`.
- **Nothing replaces the open effect without asking.** Anything that opens another effect (the menu, New, Open file, a dropped file, a link in the Docs tab, the Claude chat) must go through `leaveDoc()` in `app.js`, which saves or asks about unsaved changes.
- **The Docs tab treats markdown as untrusted.** `sim/docs.js` parses it into an inert document and keeps only an allowlist of plain elements and attributes. Extend the allowlist only with elements that can't run code or load anything.
- **Writing for the page:** short labels, plain words, sentence case. Messages say what happened and what to do. The page has light and dark themes (tokens at the top of `simulator.html`, the 3D view is always dark) and must work at phone width without horizontal scrolling.

### What comes from other repo files

Several parts of the page read other files, so editing those files changes the page:

| Source | Feeds | Keep in mind |
|---|---|---|
| `src/template/orcar_3d_mapped.js` (its section banners, definitions and comments) | The Reference tab, editor suggestions and hover hints, Show on whale | The comment beside or above a definition is its description. |
| `docs/PIXELBLAZE_REFERENCE.md` | The Pixelblaze names the editor suggests, and their notes | Keep its "- `name(args)`: what it does" bullets, its tables and its "Constants:" line in the same shape. The self-test fails if too few names can be read. |
| `docs/ORCAR_CONTRACT.md`, `docs/PIXELBLAZE_REFERENCE.md`, `docs/SIMULATOR.md` | The Docs tab (its list is `DOCS` in `sim/docs.js`); Reference entries link to contract section headings | Renaming a contract heading can break a "Contract §" link (`docHeading()` in `sim/symbols.js`). |
| `docs/PIXELBLAZE_REFERENCE.md` §8 bucket table | `LOW_MAP`/`HIGH_MAP` in `sim/sound.js` | Change both together. |
| `maps/*.json` | The boards' pixel positions | Generated; reload the page after `npm run maps`. |

### Numbers that are placeholders

These are chosen, not measured. Replace them with measurements from the truck when there are some:

| Number | Where | Also in |
|---|---|---|
| Sync stress frame rates and boot offsets | `STRESS` in `sim/boards.js` | `pbcheck`'s sync check uses its own (17 FPS, 47 s) |
| Board B's sound delay and packet loss (15 ms, 5%) | `Sim._sensorFor` in `sim/boards.js` | `tools/pbcheck.mjs` |
| The sound scale | `SCALE` in `sim/sound.js` | The beat's loudness (`renderBeat`) |

### How the boards run

- **Messages.** The page sends a board `load` (`src`, `pixelCount`, `nodeId`, `mapPoints`, `startMs`, `controlValues`, `sensor`), then `frame` (`steps`: simulated milliseconds per frame to render), `control` (a slider or toggle moved) and `sensor` (`level`, `offsetMs` or a live `live` packet). A board answers `ready`, `loaded` (controls, defaults, sensor variables used, globals), `frame` (the last frame's colours, a brightness level per frame rendered for the flash meter, stats, readouts and, once, `describe`: the template's values, feature ranges and tags as the board computed them) or `fatal`.
- **Clock.** Every run starts at simulated time `T0` = 60 s. Each board renders on its own fixed schedule (40 fps, or its sync-stress rate), several frames per message when the page is behind (`MAX_STEPS`). The shared clock starts only once all six have loaded and, with sync stress, fast-forwarded through their boot history. A watchdog stops all boards if one doesn't answer (2.5 s per message, longer while loading or fast-forwarding).
- **Sound.** A beat or file is analysed in advance into one packet per 25.6 ms. Each board gets the whole table with `load` and reads it at its own clock time: the clip position is `offsetMs + (board clock - T0)`, wrapped. A re-run keeps the music's place by passing a new `offsetMs`. While the music plays, it is the clock: if the page stalls, the whale catches up with it. The microphone is analysed on the page, and each packet is sent to every board.

### State the page keeps

- Browser storage (`localStorage`, prefix `orcar-sim:`): `drafts` (drafts in Safari/Firefox), `backup:<path>` (unsaved edits to repo files), `controls:<effect>` (control values), `last` (the open effect), `tab`, `hints`, `sound`.
- IndexedDB: `orcar-simulator` (the remembered folder, Chrome/Edge) and `orcar-sim-audio` (the last audio file).
- On disk: `src/drafts/*.effect.js` (drafts in Chrome/Edge).
- In the artifact: its database (`drafts`, `sim/current`), described above.

### Testing a change

1. `npm run ci`. It must pass; it includes the self-test above.
2. Open the page and try what you changed, in light and dark, and at phone width (about 390 px). Then, quickly: switch effects with unsaved edits (it should ask); run an example with an error in it (the line should be marked); Sync stress; a sound example (08) on the beat and on "No sensor board"; the Reference, Docs and Checks tabs.
3. For changes to the hosted copy or the artifact link, serve `build/sim-pages/` (`node tools/sim-artifact.mjs --pages`, then any static server) and check it loads without choosing a folder.

For scripted checks, Playwright with Chromium works. Open `simulator.html` from disk, connect the repo with `page.setInputFiles('#folderInput', '<repo path>')`, and wait for `window.orcarSim.S.boardInfo.filter(Boolean).length === 6`. `window.orcarSim` exposes the page's state, the editor (CodeMirror), the boards, the view, the Reference and Docs models, and `sound()` (where the boards and the speakers are in the music). It's for debugging and tests, not an API: it can change. For sound, launch Chromium with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` (a fake microphone) and, to hear audio without clicking first, `--autoplay-policy=no-user-gesture-required`.

### Publishing a change to the artifact

Run `node tools/sim-artifact.mjs` and publish again to the same artifact (see "For Claude" above): `files.json` lists every file, including new ones in `sim/`. A file the page reads from outside `sim/`, `maps/`, `src/` and the three docs has to be added to `tools/sim-artifact.mjs`. The artifact can't use the microphone or save to the repo; the page shows this itself.

## Troubleshooting

| Problem | Fix |
|---|---|
| "doesn't look like the Orcar repository" | You picked a folder above or inside the repo. Pick the one that contains `maps/` and `src/`. |
| The page didn't pick up a change on disk | In Safari or Firefox, click **Re-read** in the top bar (or reload and pick the folder again). In Chrome/Edge it checks every second; make sure the file you changed is the one open. |
| Changed the maps (`npm run maps`) | Reload the page. The template is watched; maps aren't. |
| A note says the boards run "on the page itself" | That browser refused background workers from a file opened from disk. Everything works, but an endless loop would freeze the tab (your edits are kept for when you reload), and a pattern variable named `top`, `name`, `location` or `status` misbehaves. Chrome and Edge use workers. |
| My drafts disappeared | In Safari or Firefox, drafts live in that browser: another browser, a private window or clearing site data won't have them. In Chrome or Edge they're files in `src/drafts/`; check you chose the same folder. |
| Fonts look plain | The page uses web fonts when you're online and falls back to your system fonts offline. Nothing else needs the network. |
| No sound | Click anywhere on the page first (browsers only play sound after a click or key press). Check **Play** is ticked, the speed is 1× and the volume is up. The effect has to read the sensor board: other effects show "This effect doesn't react to sound." |
| Microphone isn't offered, or is refused | It's not available in the Claude artifact. From disk, the browser asks for permission; if you said no, allow it in the site settings (the icon at the left of the address bar) and choose Microphone again. |
| The music file came back as the beat after reloading | The file is kept in this browser's storage; a private window, clearing site data or a full disk loses it. Choose it again. |
