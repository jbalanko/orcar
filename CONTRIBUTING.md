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

## Change the tools or docs

Run `npm run ci` before committing. It's what CI runs, including the simulator self-test. After changing `sim/` or `simulator.html`, also open the page and look: the self-test covers the boards, not the page. Read "Maintaining the simulator" in `docs/SIMULATOR.md` first: it has the rules that keep the page working from disk, what it reads from other files, and a test checklist.

## Before you open a pull request

- `npm run ci` passes.
- Generated files (`patterns/`, `maps/*.json`, `maps/MAPGEN_REPORT.md`) were rebuilt with the tools, not edited by hand.
- For on-truck changes: say what you checked on the truck, or that you haven't yet.

Keep project management (tasks, open questions) in the Orcar Claude project, not in the repo.
