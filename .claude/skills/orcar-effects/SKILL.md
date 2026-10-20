---
name: orcar-effects
description: Write, modify, review or debug LED effect patterns for the Orcar (the orca art car lit by six synced Pixelblaze 3 controllers). Use for any request about Orcar lighting effects, Pixelblaze pattern code for the Orcar, sound-reactive Orcar effects, or checking a pattern before it goes on the truck.
---

# Orcar effects

You're writing Pixelblaze 3 pattern code for the Orcar, an orca sculpture on a truck, about 25 ft from nose to fluke tips. Its ribs, spines and fins are lit by six synced controllers (boards A–F). Pixelblaze looks like JavaScript but isn't: it uses 16.16 fixed point, and it has no strings, objects, `let`/`const`, closures or dynamic arrays. On top of that, the six boards each render only their own pixels. Getting either of those wrong produces code that looks fine and breaks on the truck.

## Where things are

Paths are relative to the **repository root** when you're working in the repo, or to **this skill's folder** when it's installed on its own (the packaged skill has the same layout).

| Path | What |
|---|---|
| `docs/ORCAR_CONTRACT.md` | **Read it fully before writing any code.** The rules: coordinates, features, sync, sound, performance, show safety. Its MUSTs are hard requirements. |
| `docs/PIXELBLAZE_REFERENCE.md` | The language and built-ins (firmware v3.51). Use only what's listed there. |
| `src/template/orcar_3d_mapped.js` | The feature map: feature names, wiring, groups, tags, landmarks. Read it to learn the names you can use. **Never edit it as part of an effect.** |
| `src/examples/*.effect.js` | Annotated examples 00–08. Pick the closest one as your starting point. |
| `src/effects/` | Where new effects go, as `<name>.effect.js`. |
| `src/drafts/` | The simulator's drafts (gitignored). If the person points you at a draft, edit it there; when they want to keep it, move it to `src/effects/`, then build and check. |
| `tools/build.mjs`, `tools/pbcheck.mjs`, `tools/preview.py` | Build, check and preview (Node 18+; the preview also needs Python with Pillow). |
| `tools/pbfind.py` | Finds the Pixelblazes on the local network (their addresses). Point people to it, or offer to set up the `pbfind` alias, when they need to paste a pattern onto board A and don't know its address. How it works and its troubleshooting tips are at the top of the file; `-h` lists the options. |
| `simulator.html`, `docs/SIMULATOR.md` | The browser simulator people use to watch an effect on the real map. It runs the same emulator as `pbcheck`. |
| `docs/PUBLIC_UI.md`, `web/play.html` | The public control page: a touch page on board A that shows the running pattern's UI controls to the public. If the person wants an effect the public can play with, follow contract §12 and run `node tools/web-check.mjs`. `src/effects/orca-playground.effect.js` is the worked example. |

## Workflow

1. Read `docs/ORCAR_CONTRACT.md`, then skim the template's header comment and the closest example.
2. If the request is vague, settle these with the person: what moves, which parts of the whale, colours, speed, sound reaction, which controls they want, and what the kaleidoscope (`EYE_1`/`EYE_2`) should do. If the person is away, make sensible choices and state them.
3. Write **only the effect section** (what goes below the template's PATTERN marker) to `src/effects/<name>.effect.js`. Keep both "keep" blocks intact.
4. If you have a shell, run the tools yourself and fix every `[error]`:
   ```sh
   node tools/build.mjs src/effects/<name>.effect.js
   node tools/pbcheck.mjs patterns/effects/<name>.js --preview out/<name>.json
   python3 tools/preview.py out/<name>.json out/<name>.png     # then look at the PNG
   ```
   Explain or fix every `[warn]`. Looking at the preview catches wrong directions and wrong parts of the body.

   For the person, point them at the simulator: open `simulator.html`, choose the repo folder, pick the effect (it reloads each time you save the file). For a sound effect, suggest they try its **Sound** choices: the synthetic beat, their own music, **Level** at both ends and **No sensor board**. In a claude.ai chat where you have the Artifact tool, you can instead publish the simulator as an artifact and send the effect to it; follow "For Claude: publishing the simulator as an artifact" in `docs/SIMULATOR.md`.
5. Hand back:
   - the effect file (and the built `patterns/effects/<name>.js` if you built it; that's the file people paste into the leader, board A);
   - one paragraph on what it looks like;
   - its sync status (safe, mostly safe, or not fully safe, per contract §5) and the controls it adds;
   - what to check on the truck (contract §9 step 7).

When the skill is installed on its own (for example on claude.ai), its folder may be read-only. Copy it to a working directory before building: `cp -r <skill folder> ./orcar && cd orcar && mkdir -p effects`. Without a shell, still follow the contract to the letter, and tell the person to run step 4's commands.

## The rules that matter most (details in the contract)

- Use `time()` for all shared motion. Never accumulate `delta` for anything that has to line up across boards. Random decisions that affect several boards use `prngSeed(slot from time())` and then `prng()`, in `beforeRender`.
- Positions come only from the template's constants (`nX`/`nY`/`nZ`/`nLen`, `X_LO`…`Z_HI`, `MID_X`, landmarks). Never hardcode normalized numbers or global indices.
- Frame: **+x port, +y aft (nose→tail), +z up**. Clockwise is as seen from in front of the nose.
- Handle `tags == 0` first: that's the kaleidoscope and the TEST strand, which have no coordinates.
- Features with count 0 aren't installed yet. Skip them; never assume a fixed number of ribs.
- Allocate arrays only at the top level. Keep `render3D` cheap; board B must stay at 30 FPS or better.
- No large-area flashing faster than 3 Hz. Sound effects need auto-gain and sensor-variable defaults.
- Effects for the public control page: public knobs are UI controls, not exported variables; crew-only and strobe controls end in `_Admin`; every control at every extreme stays safe (contract §12).
- Refuse to break a MUST quietly. If a request conflicts with one, say so and offer the nearest compliant version.
