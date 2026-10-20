# Orcar lights

LED effects, the 3D feature map, and tooling for the **Orcar**, a community-built orca art car (Create Makerspace Society, Squamish BC). Six Pixelblaze 3 controllers (boards A–F, synced, firmware v3.51) drive the ribs, spines and fins.

## Quick start

| I want to… | Do this |
|---|---|
| **See an effect without the truck** | Open **`simulator.html`** in Chrome or Edge (double-click it) and choose this folder. It runs any effect on the real LED map, live as you edit, with sound (a built-in beat, your own music or the microphone). See `docs/SIMULATOR.md`. |
| **Run a pattern on the Orcar** | Open a file in **`patterns/`**, copy all of it, paste it into a new pattern on the **leader (board A)**, and save. Sync runs it on all six boards. Start with `patterns/examples/00-map-check.js` and `00b-wiring-check.js` to check the truck. |
| **Write an effect with Claude** | Claude Code: open this repo and describe the effect; the `orcar-effects` skill loads automatically. claude.ai: install the skill first (see [Using it with AI](#using-it-with-ai)). |
| **Write an effect with another AI** | Give it `AGENTS.md`, `docs/ORCAR_CONTRACT.md`, `docs/PIXELBLAZE_REFERENCE.md` and the closest `src/examples/*.effect.js`. |
| **Write one by hand** | Copy an example from `src/examples/` into `src/effects/`, edit it (the simulator shows it as you go), then `npm run build` and `npm run check`. Your paste-ready file appears in `patterns/effects/`. |
| **Change counts or wiring, or update the maps** | See `docs/MAP_GENERATION.md`, or ask Claude (the `orcar-maps` skill). |
| **Let the public play with the Orcar** | Upload `web/play.html` to board A and open `http://<board-A>/play.html` on an iPad: big touch controls for the running pattern, nothing else. `patterns/effects/orca-playground.js` is a demo that uses every control type. See `docs/PUBLIC_UI.md`. |

After any template or map change, **re-paste your patterns**: each saved pattern carries its own copy of the wiring.

## Layout

```
simulator.html            OPEN THIS to preview effects in a browser (see docs/SIMULATOR.md)
patterns/                 READY TO PASTE onto board A (generated -- don't edit)
  examples/                 the examples, built
  effects/                  the team's effects, built
web/                      pages served from board A's flash (upload as-is, no build; docs/PUBLIC_UI.md)
  play.html                 the public control page (/play.html): touch controls for the running pattern
  test.html                 admin test page (/test.html): connection, patterns, raw controls, message log
src/                      what you edit; `npm run build` turns it into patterns/
  examples/                 annotated examples 00–08 (effect section only)
  effects/                  the team's effects (effect section only)
  drafts/                   the simulator's drafts: local work in progress, ignored by git
  template/                 the feature map: names, wiring, groups, landmarks
maps/                     per-board 3D maps to upload in each board's Mapper (generated)
  mapgen.json               map generator settings (hand-edited)
  MAPGEN_REPORT.md          what the last generation produced, with warnings
model/                    the 3D linework (DXF) the maps are generated from
docs/                     the effect rules (start here), simulator, public control page, map generation, Pixelblaze reference
sim/                      the simulator's code; sim/engine.js is the emulator, shared with the checker
tools/                    build, check, preview, map generation, skill packaging, simulator self-test,
                          web-check (the web/ pages), pbfind (find the boards on the network); see tools/README.md
.claude/skills/           Claude skills: orcar-effects, orcar-maps
AGENTS.md, CLAUDE.md      instructions AI assistants pick up automatically
```

Which file decides what: `docs/ORCAR_CONTRACT.md` sets the **rules**; `src/template/` and `model/` hold the **data** (counts, wiring, geometry); `docs/PIXELBLAZE_REFERENCE.md` covers **syntax**. Files marked "generated" are rebuilt by the tools and checked by CI, so never edit them by hand.

## Commands

Requires Node 18+ and Python 3. Map generation needs `pip install ezdxf`; the preview images need `pip install pillow`.

```sh
npm run build                                       # src/ -> patterns/
node tools/build.mjs src/effects/my.effect.js       # build one -> patterns/effects/my.js
npm run check                                       # check every pattern on all six boards
node tools/pbcheck.mjs patterns/effects/my.js --preview out/my.json && python3 tools/preview.py out/my.json out/my.png
npm run maps                                        # regenerate maps/ from model/ + the template
npm run skill                                       # build/skills/*.zip for claude.ai
npm run sim:test                                    # simulator self-test (its boards match the checker)
npm run sim:bundle                                  # build/sim-artifact/: the simulator + files, for hosting
npm run web:check                                   # the web/ pages, and every effect as the public page sees it
npm run ci                                          # everything CI runs
```

The simulator needs none of this: just a browser. `pbcheck` and the simulator share one emulator (`sim/engine.js`). It is an emulator, not the device. It uses floats instead of 16.16 fixed point, so it can't catch overflow in intermediate maths, and its `perlin()`, `random()` and sound levels are stand-ins. A pass means "worth trying on the truck", not "done".

## Finding the boards on the network

To paste a pattern, upload a map or change a setting, you need a board's address. Pixelblazes get their address from the router, so it can change. `tools/pbfind.py` finds every Pixelblaze on the network you're on, usually in under a second. It needs only Python 3.8+ (macOS or Linux; nothing to install).

```sh
python3 tools/pbfind.py        # list every Pixelblaze: http://192.168.1.42  (beacon)
python3 tools/pbfind.py -o     # ...and open the first one in the browser
python3 tools/pbfind.py -q     # bare addresses, for scripts
python3 tools/pbfind.py -h     # all the options
```

**To run it from anywhere as `pbfind`,** add an alias to `~/.zshrc` (macOS) or `~/.bashrc` (Linux), with the path to wherever your copy of this repository is (the folder can have any name), then open a new terminal:

```sh
alias pbfind='python3 ~/path/to/orcar-repository/tools/pbfind.py'
```

- **How it works:** it sends one Pixelblaze sync beacon on each network and listens for replies (UDP port 1889). Every board answers, followers included. If nothing answers (guest networks and some mesh routers block that), it checks each address on the local network for the Pixelblaze web ports (80 and 81). It never opens a connection to a board's editor, so it can't tie one up. A board it probed may list your computer as a sync peer for about a minute; that's harmless.
- **It lists addresses, not names.** Open each one to see which board it is (A–F).
- **It finds nothing but the board works in a browser:** on macOS, allow your terminal app under System Settings → Privacy & Security → Local Network, and allow incoming connections for Python if the firewall asks. If Firestorm is running, it may hold the port; pbfind then goes straight to checking addresses.
- **Better than finding them each time:** reserve each board's address in the router's DHCP settings (their names start with `ESP_` or `Espressif`).

More detail is at the top of `tools/pbfind.py`.

## Examples

| # | Pattern | Teaches | Sync |
|---|---|---|---|
| 00 | Map check | confirms map bounds and centring by lighting known parts by coordinates (`docs/img/`) | safe |
| 00b | Wiring check | colours every strand by what the template thinks it is (no coordinates); shows pixel count vs template vs map coverage | n/a |
| 01 | Feature colours | tags, backbone, the unmapped kaleidoscope and TEST strand | safe |
| 02 | Travelling wave | world coordinates, sliders, picker, toggles, mirror mode | safe |
| 03 | Rib chase | your own per-pixel tables, `featurePos()`; doubles as a direction test | safe |
| 04 | Deep sea | world-space noise, palettes, hash "random" twinkles | safe |
| 05 | Random rib flash | the sync-safe randomness recipe | safe |
| 06 | Landmark ripple | distances in inches from a landmark, time-based events | safe |
| 07 | Sound: rib equalizer | `frequencyData`, auto-gain, frame-rate-independent smoothing | mostly |
| 08 | Sound: beat ripple | onset detection, event timing on the synced clock | not fully (explained) |

## Effects

Team effects in `src/effects/` (built to `patterns/effects/`):

| Effect | What | Sync |
|---|---|---|
| `orca-playground` | Demo for the public control page: ocean glow, rolling waves, sparkle and a Splash ripple, with all eight control types (`docs/PUBLIC_UI.md`) | safe; Splash reaches all boards only if each press sends a new value, as the current public page does (contract §11) |

## The public control page

`web/play.html` is a touch page for the public: it shows the running pattern's controls (sliders, colour pickers, switches, buttons) and nothing else, and it's served by board A itself, so there's nothing to install. Upload it with:

```sh
curl -F "data=@web/play.html;filename=/play.html" http://<board-A>/edit     # upload or update
open "http://<board-A>/play.html"                                           # use it
open "http://<board-A>/delete?path=/play.html"                              # remove it
```

`web/test.html` (uploaded as `/test.html`) is the crew's version: connection checks, the pattern list, raw controls and a message log. iPad setup, writing effects for the page, how it works and troubleshooting are in **`docs/PUBLIC_UI.md`**.

## Changing wiring, counts or maps

The maps are generated from the DXF in `model/` plus the template; details in **`docs/MAP_GENERATION.md`**. In short:

1. Edit counts, wiring or directions in `src/template/orcar_3d_mapped.js`. Set the same channel lengths and totals on the controllers.
2. `python3 tools/mapgen.py --dry-run --compare` to preview, then `npm run maps` to write `maps/`.
3. `npm run build && npm run check`, upload the changed maps, re-paste the patterns from `patterns/`, and commit.

## Using it with AI

- **Claude Code** (on your computer, or on the web with this repo): nothing to install. `CLAUDE.md` and the skills in `.claude/skills/` load automatically.
- **claude.ai (web, desktop, mobile)**: uploaded files and connected repos don't install skills. Each person installs them once: run `npm run skill` (or download the `orcar-skills` artifact from the latest CI run), then Settings → Capabilities → Skills → Upload skill. Code execution must be on. On a Team or Enterprise plan, an owner can provision them for everyone.
- **Other assistants** (ChatGPT, Gemini, Cursor, Codex…): many read `AGENTS.md` automatically. Otherwise, attach the files listed in Quick start.
- **Seeing the result:** keep `simulator.html` open in Chrome or Edge while an assistant edits an effect file in the repo; it reloads on every save. In a claude.ai chat with this repo (or the skill), Claude can publish the simulator as an artifact and send effects straight to it (`docs/SIMULATOR.md`).

## Contributing

See `CONTRIBUTING.md`. CI (`.github/workflows/check.yml`) checks that the maps match the model and template and that `patterns/` was rebuilt and committed, runs every pattern on all six emulated boards, runs the simulator self-test, checks the `web/` pages, and packages both skills.

Project management (task list, on-truck tests, open questions) lives in the Orcar Claude project (`orcar-led-map-outstanding.md`), not in this repo. References like "test 5" point there.
