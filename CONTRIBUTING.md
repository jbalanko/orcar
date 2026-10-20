# Contributing

Most changes are one of three kinds. AI assistants follow the same steps (see `AGENTS.md` and the skills in `.claude/skills/`).

## Add or change an effect

1. Copy the closest `src/examples/*.effect.js` to `src/effects/<name>.effect.js` (lowercase, hyphens), or edit an existing effect. In the simulator, **New** does this as a draft (`src/drafts/`), and **Save to repo** moves it to `src/effects/` when it's ready.
2. Follow `docs/ORCAR_CONTRACT.md`. Its MUSTs are hard requirements.
3. Watch it in the simulator while you work: open `simulator.html`, choose the repo folder and pick your effect (`docs/SIMULATOR.md`). Try **Sync stress** and every control at its extremes. For a sound effect, also try the synthetic beat, your own music, **Level** at both ends and **No sensor board**.
4. `node tools/build.mjs src/effects/<name>.effect.js`, then `node tools/pbcheck.mjs patterns/effects/<name>.js`. Fix every `[error]` and read every `[warn]`.
5. Try it on the truck: paste `patterns/effects/<name>.js` onto board A and check seams, board B's frame rate and the controls. `python3 tools/pbfind.py` (or the `pbfind` alias) finds the boards' addresses (README, "Finding the boards on the network").
6. Commit both the `.effect.js` source and the built `patterns/effects/<name>.js`.

## Change strand counts, wiring or the 3D model

Follow `docs/MAP_GENERATION.md`. In short: edit the template (or replace the DXF in `model/`), run `npm run maps`, then `npm run build && npm run check`. Commit the template, `maps/` and `patterns/` together, and on the truck upload the changed maps and re-paste the patterns.

## Change the public control page or the test page

The pages in `web/` are uploaded to board A as they are; there's no build. Read "Maintaining the pages" in `docs/PUBLIC_UI.md` first (one self-contained file, offline, never save to flash). Then:

1. `npm run web:check`.
2. Open the page from disk with `?host=<spare board>` and go through "Testing a change" in `docs/PUBLIC_UI.md`, on the spare Pixelblaze rather than the truck.
3. Update `docs/PUBLIC_UI.md` if you changed a setting, a message it sends, or how something looks.
4. Commit, then upload to board A (`curl -F "data=@web/play.html;filename=/play.html" http://<board-A>/edit`) and reload the iPad.

## Add or change an example

Examples in `src/examples/` are teaching code: each shows one technique, and people and AIs copy them.

1. Number it after the last one (`09-<name>.effect.js`). `00` and `00b` are calibration patterns, not models to copy.
2. Start it with the same header block as the others: the number, the name and a one-line description, then `Shows:` (the technique it teaches), `Looks:`, `Sync:` (safe, mostly safe or not fully safe, as in contract §5, with the reason), and `Try:` (a change to experiment with). Add `Needs:` if it depends on something, such as the sensor board.
3. Keep the template's two "keep" blocks, and follow every MUST in the contract. An example breaking a rule teaches the wrong thing.
4. `npm run build && npm run check`, and `npm run web:check` (it reads every effect the way the public control page will). The simulator and its self-test pick up new examples by themselves.
5. Add it to the Examples table in `README.md`, and update "examples 00–08" in `README.md` and `.claude/skills/orcar-effects/SKILL.md`. If it's the best reference for a rule, point to it from that section of the contract.

## Change a skill

The skills in `.claude/skills/` are what Claude reads for effects (`orcar-effects`) and maps (`orcar-maps`). In this repo they load automatically; on claude.ai they're installed from the zips.

- Each `SKILL.md` refers to repo paths. `tools/package_skill.py` lists the files each zip carries, in the same layout, so the paths work in both places. If a skill starts to refer to another file, add it to that list.
- After changing a skill, or a file a skill carries, run `npm run skill` and re-upload the zip on claude.ai (Settings → Capabilities → Skills) for everyone who has it installed.
- Keep `AGENTS.md` and the skills consistent: `AGENTS.md` is the short version for any AI, and the skills give the full steps.

## When the Pixelblaze firmware changes

1. Re-check `docs/PIXELBLAZE_REFERENCE.md` against the device's Edit page (its "Functions" section, controls and sensor variables), and update the firmware line at the top of it and of `docs/ORCAR_CONTRACT.md`.
2. Bring `sim/engine.js` in line: built-ins, and lint rules for anything the firmware now accepts or rejects. Keep the reference's bullet and table format: the simulator's editor suggestions are read from it.
3. Re-test anything the docs mark as observed on the device, such as `render3D()` not being called past the end of the map.
4. Re-test the public control page on the spare board ("Testing a change" in `docs/PUBLIC_UI.md`): it uses WebSocket messages that aren't all officially documented, so a firmware update can change them.
5. `npm run ci`, then run the examples on the truck.

## Change the tools or docs

Run `npm run ci` before committing. It's what CI runs, including the simulator self-test. After changing `sim/` or `simulator.html`, also open the page and look: the self-test covers the boards, not the page. Read "Maintaining the simulator" in `docs/SIMULATOR.md` first: it has the rules that keep the page working from disk, what it reads from other files, and a test checklist. For the command-line tools, see `tools/README.md`.

When you change how something works, update the doc that describes it in the same change. Where things are documented:

| Topic | Doc |
|---|---|
| Rules for effects | `docs/ORCAR_CONTRACT.md` |
| Pixelblaze language and built-ins | `docs/PIXELBLAZE_REFERENCE.md` |
| Maps, the DXF, counts and wiring | `docs/MAP_GENERATION.md`, the template's own comments |
| The simulator (using and maintaining it) | `docs/SIMULATOR.md` |
| The public control page and the test page (using, uploading, maintaining) | `docs/PUBLIC_UI.md` |
| The command-line tools | `tools/README.md`, and the comment at the top of each tool |
| Folders | the `README.md` in `src/`, `src/drafts/`, `patterns/`, `model/`, `web/`, `sim/vendor/`, `tools/` |
| AI assistants | `AGENTS.md` (short) and the skills in `.claude/skills/` (full steps) |

Write docs the way the existing ones are written: plain words, short sentences, the reader's task first, and no numbers that are kept elsewhere (link to the template instead of repeating a count).

Some docs also have copies in the Orcar Claude project, for chats that don't have the repo: the contract, the Pixelblaze reference, map generation, the simulator help, the public control page guide, the template and `pbfind.py`. The repo is the source of truth. After changing one of them, update the project's copy too, or ask whoever maintains the project to.

## Before you open a pull request

- `npm run ci` passes.
- Generated files (`patterns/`, `maps/*.json`, `maps/MAPGEN_REPORT.md`) were rebuilt with the tools, not edited by hand.
- For on-truck changes: say what you checked on the truck, or that you haven't yet.

Keep project management (tasks, open questions) in the Orcar Claude project, not in the repo.
