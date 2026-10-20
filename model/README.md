# Source geometry

`Orcar_Oct-Linework.dxf`: SketchUp linework export of the LED paths (inches, Pixelblaze map frame: +X port, +Y aft, +Z up). Each strand is a block whose `Skp_GroupInstanceName` attribute names the feature (R1–R14, S1–S11 / S2A… / S2B…, S6C, Dorsal, Left/Right Pectoral, Tail, Nose, Ghost Points). The block layer (A–F) is the controller board.

**Known labelling issue:** in this file the even spines are labelled on the opposite side from the Orcar convention (S1 → S11 runs starboard to port). S2/S4 (A and B) sit on port, and S8/S10 sit on starboard. `tools/mapgen.py` swaps them (S2↔S10, S4↔S8) through `maps/mapgen.json`; see `docs/MAP_GENERATION.md`.

**Wrong layer:** S6C is on layer D here, but it's physically wired to board E, ch 5 (confirmed). The template is right; mapgen only warns.

**Generate maps with `python3 tools/mapgen.py`** (see `docs/MAP_GENERATION.md`). The rules it applies:
- Every pixel needs an entry: `render3D()` doesn't draw pixels past the end of a map, and they freeze.
- Strands with no geometry (the kaleidoscope `EYE_1`/`EYE_2` on F, TEST on B) get one placeholder entry per pixel at **(79.824, 140, 45)**: on the centreline, mid-body between R6 and R7, about halfway up the rib arches, inside the ghost box.
- The two ghost entries come last on every board: currently `[0.977, -0.646, 0]` and `[158.672, 297.653, 135.772]`, the whole sculpture (nose tip to fluke tips). They change only if the DXF's outer shape does.

It also contains geometry for strands not yet in the maps (R1, R2, R11–R14, A spines, S6B, Tail/fluke). "Nose" isn't a strand, but it's used to set the front of the ghost box, ready for when their counts are known.
