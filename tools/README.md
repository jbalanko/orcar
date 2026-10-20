# Tools

Command-line tools for building, checking and mapping Orcar patterns. Run them from the repository root. They need Node 18+ and Python 3; the extra Python packages are listed below. Each tool explains its options in the comment at the top of its file.

## What each one does

| Tool | Does | Reads | Writes |
|---|---|---|---|
| `build.mjs` | Joins the template and each effect section into a complete, paste-ready pattern (`npm run build`). | `src/template/`, `src/examples/`, `src/effects/` | `patterns/` (generated: commit it) |
| `pbcheck.mjs` | Checks one pattern on all six boards: lint, load and run, sync, controls; `--preview` writes data for `preview.py`. | a pattern, `maps/` | stdout; preview JSON |
| `check-all.mjs` | Runs `pbcheck` on every pattern in `patterns/` (`npm run check`). Fails on any `[error]`. | `patterns/` | stdout |
| `pbsim.mjs` | The emulator for Node: loads `sim/engine.js` and gives each board its own `vm` context. Used by the tools above; not run directly. | `sim/engine.js`, `maps/` | |
| `preview.py` | Draws a `pbcheck --preview` file as a PNG contact sheet (side, top and front views). Needs `pip install pillow`. | preview JSON | PNG |
| `mapgen.py` | Generates the six 3D maps from the DXF and the template (`npm run maps`); `--check` is what CI runs. Needs `pip install ezdxf`. See `docs/MAP_GENERATION.md`. | `model/`, `maps/mapgen.json`, the template | `maps/` (generated: commit it) |
| `wiring.mjs` | Prints the template's wiring as JSON, for `mapgen.py`. | the template | stdout |
| `sim-selftest.mjs` | The simulator's CI check (`npm run sim:test`). See "How it works" in `docs/SIMULATOR.md`. | `sim/`, `src/examples/`, `maps/`, `docs/PIXELBLAZE_REFERENCE.md` | stdout |
| `web-check.mjs` | Checks the pages in `web/` (`npm run web:check`): their scripts parse, they load nothing from the network, the public page's pure helpers work in Node, and every effect's controls as the public page will show them. See "Maintaining the pages" in `docs/PUBLIC_UI.md`. | `web/`, `src/effects/`, `src/examples/` | stdout |
| `sim-artifact.mjs` | Gathers the simulator and the files it reads, for a Claude artifact or (`--pages`) a static site (`npm run sim:bundle`). | `simulator.html`, `sim/`, `maps/`, `src/`, `docs/` | `build/sim-artifact/` or `build/sim-pages/` |
| `package_skill.py` | Packages the two Claude skills as zips for claude.ai (`npm run skill`). | `.claude/skills/`, and the files each skill lists | `build/skills/` |
| `pbfind.py` | Finds the Pixelblazes on the local network (README, "Finding the boards on the network"). Python standard library only. | the network | stdout |

`npm run ci` runs what CI runs: `mapgen.py --check`, `build.mjs`, a check that `patterns/` is committed as built, `check-all.mjs`, `sim-selftest.mjs` and `web-check.mjs`. CI also runs `package_skill.py`.

## How they fit together

- **One emulator.** `sim/engine.js` holds the Pixelblaze built-ins, map normalization, the lint rules and the template + effect glue. `pbsim.mjs` loads it for Node, and the browser simulator loads the same file. A change there changes `build`, `pbcheck` and the simulator together; `sim-selftest.mjs` requires the simulator and `pbsim` to draw identical colours.
- **One source of truth for wiring.** Counts, wiring order and directions are only in `src/template/orcar_3d_mapped.js`. `mapgen.py` gets them through `wiring.mjs`, which runs the template the way a controller would, so nothing is copied.
- **Generated files are committed.** `patterns/` and `maps/` are outputs. Never edit them by hand: change the inputs and rerun the tool. CI fails if they're stale.

## Adding or changing a tool

- Keep the dependencies to Node's and Python's standard libraries if you can. Anything else must be listed here and in the README's Commands section (as `ezdxf` and Pillow are).
- Start the file with a comment that says what it does and shows how to run it, like the others. Paths are relative to the repository root.
- Anything that reads the template, the maps or a pattern should use `pbsim.mjs` (and so `sim/engine.js`), not its own parser or emulator.
- A new check that should block a merge goes in `package.json`'s `ci` script and in `.github/workflows/check.yml`.
- Add it to the table above. If people run it directly, add it to the README's Commands section too.
- Both skill zips include every file in `tools/`. If a tool needs another file, add that file to the skill's list in `package_skill.py`, then check the packaged skill still works on its own (`npm run skill`, unzip it, run the tool from inside the unzipped folder).
