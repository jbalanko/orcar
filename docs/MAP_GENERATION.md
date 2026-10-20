# Generating the 3D maps

The six Pixelblaze maps (`maps/pixelblaze_A.json` … `_F.json`) are **generated**, never edited by hand. One command rebuilds them from two sources:

| Source | Provides | Owner |
|---|---|---|
| `model/Orcar_Oct-Linework.dxf` | where each strand runs (geometry), one named group per strand | whoever maintains the 3D model |
| `src/template/orcar_3d_mapped.js` | how many pixels each strand has, which board and channel it's on, in what order, and which way it's wired | lighting lead |

`maps/mapgen.json` holds the settings that tie them together: DXF names to feature names, the placeholder point, the ghost box and tolerances.

The same inputs always give byte-identical maps. CI fails if the committed maps don't match what the DXF and template produce.

## Setup (once)

- Node 18+ and Python 3.
- `pip install ezdxf` (on some Linux setups, add `--break-system-packages`).

## The everyday workflow

```sh
python3 tools/mapgen.py --dry-run --compare   # preview: report + what would move, writes nothing
python3 tools/mapgen.py                       # write maps/ (only if every check passes)
npm run build && npm run check                # rebuild patterns, check them against the new maps
```

Then upload each **changed** map in that board's Mapper tab (`python3 tools/pbfind.py` lists the boards' addresses), paste updated patterns from `patterns/` onto the leader, and commit everything. The simulator (`simulator.html`) reads `maps/` directly: reload it to see the new maps, and run `00b-wiring-check` there to spot a strand in the wrong place before you're at the truck. `maps/MAPGEN_REPORT.md` lists each strand's board, channel, pixel count, drawn length, pitch and where pixel 0 is, plus every warning. Read it every time.

### A strand gets its count (e.g. R6 is now 168 pixels)

1. In the template: `export var R6 = feature(168, 0);`. If its direction is known to be opposite to the default, set the second number to 1.
2. Set the same count for that channel in the board's **output expander settings**, and update the board's total pixel count.
3. `python3 tools/mapgen.py`. The report should show R6 with a pitch close to the others (about 1.37″). A "check count" warning means the count doesn't fit the drawn length.
4. Rebuild, check, upload the board's map, re-paste the patterns.

All three must agree: template count, expander channel length, and map. A mismatch is exactly what made S6C go dark (the fluke channel had 100 pixels on the board but 0 in the template).

### The DXF changes (a strand is redrawn, added or moved)

1. Put the new DXF in `model/`. Keep the file name, or update `dxf` in `maps/mapgen.json`.
2. `python3 tools/mapgen.py --dry-run --compare`. Check that only the strands you expected moved.
3. If the DXF change moves the ghost box, the run fails until you add `--fix-template` (see "Ghost box" below).
4. Write, rebuild, check, upload, commit.

## How a map is made

For each board, in the template's wiring order (channel 0 first, strands in chain order):

1. **Find the strand's geometry.** The DXF group whose `Skp_GroupInstanceName` matches the feature name, after the renames in `maps/mapgen.json`. A strand with pixels but no geometry is an error. A strand with geometry but count 0 is skipped (listed as "not counted").
2. **Chain its line segments into one path.** Breaks shorter than `gap_tolerance` (0.5″) are bridged and reported; bigger breaks and branches are errors.
3. **Orient it in its default direction**, so pixel 0 is at the start:

   | Strand | Pixel 0 at |
   |---|---|
   | Ribs (open arches) | starboard foot (clockwise from the front: starboard, over the top, to port) |
   | Ribs that are closed rings (R1, R12–R14) | the ring's lowest point, heading toward starboard first. **Confirm against the real wiring when installed**, and set `reversed` if it runs the other way |
   | Spines, dorsal, pectorals | the front (low Y) end |
   | Fluke | the starboard (low X) end |

   If the template marks the strand `reversed` (1), the order is flipped, so pixel 0 is wherever the wiring actually starts.
4. **Place its pixels** evenly along the path, both ends included (rings: evenly around the loop).
5. **Unmapped strands** (the kaleidoscope `EYE_1`/`EYE_2`, `TEST`) get one entry per pixel at the placeholder point **(79.824, 140, 45)**: centreline, mid-body between R6 and R7, about halfway up the arches. Every pixel needs an entry, because `render3D()` skips pixels past the end of a map and they freeze.
6. **Append the two ghost entries** (the ghost box's min and max corners) last, so all six boards normalize to one shared frame.

## Checks (the run fails, and writes nothing, if any error)

- Every counted strand has geometry, and every path is one unbranched line or ring.
- Each board's entry count equals its pixel count.
- **Spine sides:** S1–S5 must lie on starboard, S6 on the centreline, S7–S11 on port (A and B spines). This catches mislabelled strands in the DXF. It only checks strands that have counts, so the A-spine swaps get checked once those are counted.
- **Pectorals:** LEFT is port, RIGHT is starboard.
- **Ribs:** they run nose to tail in number order.
- The placeholder lies inside the ghost box.
- The template's `MAP_MIN_*`/`MAP_MAX_*` equal the ghost box used.
- Warnings, which don't fail the run: bridged gaps, pitch outliers ("check count"), a strand whose DXF layer letter differs from its template board, and DXF groups that match nothing.

## Known quirks of the current DXF

- **The even spines are labelled on the wrong side** (S2 and S4 on port, S8 and S10 on starboard, for both A and B). `maps/mapgen.json` swaps them (S2↔S10, S4↔S8). If someone fixes the labels in the model, delete those eight swap entries; the spine-side check will fail if you forget.
- The odd B spines are named S1, S3 … S11 without the "B"; they're renamed in `maps/mapgen.json`. So are `Tail` → FLUKE, `Dorsal`, and `Left/Right Pectoral`.
- **S6C** is on layer D in the DXF but wired to board E. This is reported as a warning; the template wins.
- **S4B** (drawn as "S8B" in the DXF, see the swap) has a 0.18″ break near the tail, which gets bridged.
- `R4` and `DORSAL` show "check count": their pitch (about 1.65″) is well above the others (about 1.37″). Either the counts or the drawn paths are a little off. Worth a look on the truck.
- Ignored groups: the unnamed outline (reference geometry) and "Ghost Points". "Nose" isn't a strand, but it's in `box_extra`, so it sets the front of the ghost box.

## Ghost box: the whole sculpture

The ghost box sets the shared frame all six boards normalize to. Since 2026-10-18 `ghost_box` is **`"all"`**: the bounding box of every strand in the DXF, counted or not, plus the non-strand `Nose` arc (`box_extra`). That's X 0.977..158.672, Y −0.646..297.653, Z 0..135.772 inches, from the nose tip to the fluke tips. The report says which strand sets each limit.

So **counting a new strand never moves the box**. It moves only if the DXF changes the outer shape. Then the run fails with a box mismatch. Run `python3 tools/mapgen.py --fix-template`, which updates `MAP_MIN_*`/`MAP_MAX_*` in the template, then rebuild and re-paste every pattern and upload **all six** maps. Effects keep working because they only use the template's constants.

## For AI assistants

Use the `orcar-maps` skill (`.claude/skills/orcar-maps/SKILL.md`). It follows this document.
