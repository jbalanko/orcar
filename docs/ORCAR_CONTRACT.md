# Orcar effects contract

**Read this before writing or changing any Orcar LED pattern, whether you're a person or an AI.**

It lists the rules specific to the Orcar that general Pixelblaze knowledge won't tell you. This contract sets the **rules**; the template sets the **data** (feature counts, wiring, landmarks); `docs/PIXELBLAZE_REFERENCE.md` covers **syntax**; `src/examples/` has working code. Paths in this file are relative to the repository root.

Status: draft v0.6, 2026-10-19 (public control page, §12; trigger sync finding, §11). Firmware: Pixelblaze 3, v3.51. Feature counts and wiring change as strands get installed; the template (`src/template/orcar_3d_mapped.js`) is the source of truth for those, so this file never repeats numbers you'd have to keep in sync, except in the snapshot tables marked as such.

---

## 0. If you are an AI assistant

1. Write the **effect section only**: the code that goes below the template's `PATTERN` marker. Never rewrite, trim or "simplify" the feature-map template. Its counts, wiring and maps are maintained in one place.
2. Start from the closest file in `src/examples/` (00 is a calibration pattern, not a model effect). Keep its two "keep" blocks: don't change or remove their lines. You may *add* lines that build or read your own per-pixel tables, as examples 03, 05 and 07 do.
3. Follow every **MUST** below. If a request conflicts with one (say, "strobe the whole whale at 10 Hz"), say so and offer the nearest compliant version.
4. Use only functions listed in `PIXELBLAZE_REFERENCE.md`. It's a small language with no strings, objects, `let`/`const`, `Math.*`, closures or dynamic arrays.
5. Hand back: the effect source, one paragraph on what it looks like, its sync status (safe, mostly safe, or not), the controls it adds, and anything to check on the truck.
6. New effects go in `src/effects/<name>.effect.js`. If you or the person can run tools: `node tools/build.mjs src/effects/<name>.effect.js`, then `node tools/pbcheck.mjs patterns/effects/<name>.js`. Run them yourself when you have a shell.

---

## 1. The system in one paragraph

Six Pixelblaze 3 controllers, **boards A–F with Node IDs 0–5**, each with an output expander (8 channels, numbered 0–7 in code), drive 12 V addressable strips (WS2815, CS8812 and GS8208, all RGB) on the ribs, spines and fins of an orca sculpture on a truck, about 25 ft from nose to fluke tips. The boards run as one **sync group**: the leader's pattern code runs on every board, `time()` is synchronized, and each board renders **only its own pixels**. **Board A is the leader** and carries the sensor expansion board; its sound data is broadcast to the group. Every board has its own 3D map, and all six share one coordinate frame (§3). One pattern file therefore runs six times, once per board, with a different `nodeId()` and `pixelCount` each time.

Snapshot (2026-10-19; check the template for current values):

| Board | Node | Pixels | Global offset | Strands with counts |
|---|---|---|---|---|
| A | 0 | 235 | 0 | R3, R4 |
| B | 1 | 978 | 235 | R5, R6, R7, R8, TEST (unmapped) |
| C | 2 | 687 | 1213 | S1B, S3B, S7B, S5B, S9B, S11B |
| D | 3 | 761 | 1900 | DORSAL, S10B, S8B, S4B, S2B |
| E | 4 | 377 | 2661 | R9, R10, S6C |
| F | 5 | 430 | 3038 | LEFT/RIGHT_PECTORAL, EYE_1, EYE_2 (the kaleidoscope, unmapped) |

Board B has the most pixels, so it's the frame-rate bottleneck.

---

## 2. Anatomy of an Orcar pattern

```
[ feature-map template ]   names, wiring, groups, landmarks, tag tables  (never edit per pattern)
[ PATTERN marker ]
[ your effect ]            your globals, controls, beforeRender(), render3D()
```

Pixelblaze has no `#include`, so every pattern carries a full copy of the template. `tools/build.mjs` glues `src/template/orcar_3d_mapped.js` and each `*.effect.js` together into `patterns/`, so a template change means rebuilding rather than hand-editing every pattern.

**MUST: the two keep blocks.** Every effect's functions start like this:

```js
export function beforeRender(delta) {
  // --- keep: builds this controller's tables once ---
  var id = nodeId();
  if (tagsBuiltFor != id) {
    NODE_OFFSET = BOARD_OFFSET[id];
    buildTags();
    tagsBuiltFor = id;
  }
  // --- your per-frame code ---
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];        // read per-board tables with the LOCAL index...
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;   // ...then index becomes GLOBAL for the rest
  // --- your per-pixel code ---
}
```

If you add your own per-pixel tables, build them on the first frame (the same `builtFor != id` pattern as in `src/examples/03-rib-chase.effect.js`) and read them with the local index **before** the `index = index + NODE_OFFSET` line.

---

## 3. Coordinates

### 3.1 The frame

`render3D(index, x, y, z)` receives the **Pixelblaze map frame**:

| Axis | Positive direction | Plain words |
|---|---|---|
| **+x** | **port** (the whale's left; your right when you face the nose) | `x > MID_X` = port half |
| **+y** | **aft** (nose is low y, tail is high y) | "nose to tail" = increasing y |
| **+z** | **up** (z = 0 is the bottom of the rib arches) | "rising" = increasing z |

"Clockwise" (CW) always means as seen **from in front of the nose**: starboard, up over the top, to port.

⚠️ The retired concept-design simulator and the early geometry scripts use a **different** frame (X forward, Y up, Z starboard, in feet). Never copy coordinates or directions from them without converting. The Orcar simulator (`simulator.html`) uses this Pixelblaze frame and the real maps.

### 3.2 Normalization: use the constants, never literal numbers

The maps are in inches. Each controller's Mapper uses **Contain** mode, so the longest axis (y, nose to tail) spans 0..1 and x and z are scaled by the same factor and **centred**. The current normalized extents (snapshot) are:

| | Low | High | Template constants |
|---|---|---|---|
| x | 0.236 | 0.764 | `X_LO`, `X_HI`, centreline `MID_X` = 0.5 |
| y | 0 | 1 | `Y_LO`, `Y_HI`, `HEAD_BODY_Y`, `BODY_TAIL_Y` |
| z | 0.272 | 0.728 | `Z_LO`, `Z_HI`, `BODY_AXIS_Z` |

1 inch ≈ 0.0034 world units. Use `nLen(inches)`.

**MUST:** write positions with the template's constants and converters: `nX()`, `nY()`, `nZ()` for inches to world units, `nLen()` for distances, `mapPoint()` for landmarks, and `X_LO … Z_HI` for extents. **Never hardcode a normalized number.** The box now covers the whole sculpture, nose tip to fluke tips, whether strands are counted or not. It only changes if the DXF does, and when it does, code written with the constants keeps working while code with literal numbers breaks.

Handy expressions:

```js
(y - Y_LO) / (Y_HI - Y_LO)       // 0 at the nose .. 1 at the tail
(z - Z_LO) / (Z_HI - Z_LO)       // 0 at the base .. 1 at the dorsal tip
abs(x - MID_X)                   // distance from the centreline (mirror effects)
hypot3(x - DORSAL_TIP[0], y - DORSAL_TIP[1], z - DORSAL_TIP[2])   // distance to a landmark
```

Landmarks: `NOSE_TIP`, `DORSAL_TIP`, `LEFT_PEC_TIP` (port), `RIGHT_PEC_TIP` (starboard), `TAIL_END` (aft end of the backbone), `FLUKE_TIP_LEFT` (port), `FLUKE_TIP_RIGHT` (starboard). `BLOWHOLE` is still to be decided.

### 3.3 Unmapped pixels: the kaleidoscope and TEST

`EYE_1` and `EYE_2` (board F) are **not eyes**. They're the lights of the **kaleidoscope**, an art installation inside the Orcar. They're called "eyes" in code for historical reasons. Along with the `TEST` strand (board B), they have **no real map coordinates**: `tags == 0`, and x/y/z mean nothing for them. The maps give every one of their pixels the same placeholder point inside the body: on the centreline, mid-body between R6 and R7, about halfway up the rib arches (map inches 79.824, 140, 45). It's there only so that `render3D()` gets called for them (it skips pixels beyond the end of a map). An effect that wrongly used their x/y/z would see the whole kaleidoscope as one dot at that spot.

**MUST:** handle `tags == 0` first in `render3D`, and never base these pixels' colour on x/y/z. Use this default unless the effect deliberately does something else with the kaleidoscope:

```js
// Kaleidoscope default: colourful hues drifting along each strand. TEST off.
function kaleidoscope(index) {
  var f = inFeature(EYE_1, index) ? EYE_1 : EYE_2;
  if (!inFeature(f, index)) { hsv(0, 0, 0); return; }   // TEST strand or unassigned
  hsv(featurePos(f, index) + time(8 / 65.536), 1, 0.8);
}
// in render3D:   if (tags == 0) { kaleidoscope(index); return; }
```

(This placeholder will be swapped for a proven built-in pattern. Mapping the kaleidoscope into the 3D frame is a possible future step.)

---

## 4. Features, groups and tags

**Feature** = one physical strand, such as `R4` or `S3B`, stored as `[count, start, end, reversed]` with **global** indices.

- `inFeature(F, index)`: is this pixel on feature F?
- `featurePos(F, index)`: 0..1 along F in its **default** direction (the wiring direction is already accounted for).
- A feature with count 0 (not installed yet) matches nothing. **MUST:** effects must keep working as features appear. Skip features with `f[F_COUNT] == 0`, never divide by a count without `max(1, …)`, and never assume a fixed number of ribs or spines (count the installed ones, as examples 03, 05 and 07 do).
- **MUST NOT** hardcode global indices (`if (index > 235)`). Indices shift whenever an earlier strand gets its count. R1 and R2 haven't been added yet, and they'll shift everything on board A.

**Default directions** (`featurePos` = 0 → 1):

| Feature | 0 → 1 |
|---|---|
| Ribs R1–R14 | CW from the front: starboard foot, over the top, to the port foot |
| Spines S1–S11 (A, B, C) | front to back |
| Dorsal | front base → tip → rear base |
| Pectorals | root front → leading edge → tip → trailing edge → root rear. LEFT = port, RIGHT = starboard, and they mirror pixel for pixel. |
| Fluke | CW: (low x, low y) → (low x, high y) → (high x, high y) → (high x, low y) |

**Order conventions:** ribs R1 → R14 run nose to tail. Spines S1 → S11 arc from starboard over the top to port, with S6 on the centreline. Mirror pairs are Sn ↔ S(12−n).

**Tags** are the fast way to ask "what part is this pixel?". It costs one array read per pixel:

| Tag | Contains |
|---|---|
| `TAG_RIB` | all ribs |
| `TAG_SPINE` | all spines (A, B, C) |
| `TAG_HEAD` | A spines, R1–R4 |
| `TAG_BODY` | B spines, S6C, R5–R10, dorsal, pectorals |
| `TAG_TAIL` | R11–R14, fluke |
| `TAG_BACKBONE` | S6A → S6B → DORSAL → S6C, also exposed as `bb` = 0 (head) … 1 (tail), or −1 if the pixel isn't on it |

**SHOULD:** use tags in `render3D`, not `inGroup()` (which loops).

**Feature ≠ position.** Tags say what part a pixel belongs to, not where it is. Several "body" spines start up in the head region. To get "the part of the spines behind the head", combine the two: `(tags & TAG_SPINE) && y >= HEAD_BODY_Y`. The rule of thumb is tags for *what*, x/y/z for *where*.

**Not yet counted:** R1, R2, R11–R14, the A spines, S6B and the fluke are wired but still have count 0, so they match nothing yet. Effects that follow the rules above need no changes as they get counted.

---

## 5. Sync: making six boards look like one whale

This is the rule most often broken, and on the truck it shows up as **seams**: a wave that jumps, or a flash that only half the whale shows, at the boundary between two boards.

### What the sync group shares

| Shared | Not shared |
|---|---|
| Pattern code and pattern switching, including live edits on the leader¹ | **Exported variables** (each board has its own)² |
| `time()`: one synchronized clock | **Frame timing.** Each board runs as fast as it can, so `delta` differs per board. |
| UI control values (sliders, toggles, pickers) | `random()`: different on every board |
| Global brightness | Anything accumulated frame by frame |
| Sensor board data (broadcast, best effort) | The 3D map (stored per board, but all six share one frame) |

¹ ElectroMage's sync release notes ([forum](https://forum.electromage.com/t/significant-feature-release-sync-multiple-pixelblazes/2891)): the leader can "launch patterns, run playlists, set global brightness", "live code patterns and have them update on all group members in real-time"; `time()` stays in step. ² The developer, in the same thread: "Controls are replicated, but exported vars are not." Re-verify on the truck after any firmware update.

### The rules

- **MUST (the golden rule):** anything that has to line up across boards must be a pure function of **(position, global index, `time()`, control values, sensor data)**. Never make it depend on how many frames have run or on a per-board random roll.
- **MUST:** measure time with `time()`. Don't accumulate `delta` for anything shared. Per-board counters drift, and in fixed point they overflow after about 33 seconds. For an event's age, store the `time()` value when it happened and compute `mod(now − then, 1) × period`, and **expire the event before one full loop of that clock**. Otherwise the age wraps back to 0 and the event replays (example 08).
- **MUST:** for **random decisions that affect more than one board** (which rib flashes, what colour the whole body turns, where a meteor lands), derive a slot number from `time()`, `prngSeed(slot + 1)`, then draw with `prng()` **in `beforeRender`**, the same number of draws in the same order on every board (example 05). Use `random()` only where each answer affects one pixel and doesn't need to match anything else (independent sparkle). Even then, a deterministic hash of the global index is usually nicer: `frac(index * 0.6180339)` (example 04).
- **SHOULD:** smooth with frame-rate-independent maths. Use `cur += (target − cur) × (1 − pow(0.5, delta / halfLifeMs))` (examples 07 and 08), never `cur *= 0.95` per frame. Even so, smoothed values can differ slightly between boards; that's fine for gentle level-following.
- **SHOULD:** treat `nodeId()` as plumbing (the keep block uses it). Branch on it in effect code only for a deliberate, documented reason.
- **Check:** `pbcheck` renders every board twice. The second run boots 47 s earlier, runs at 17 FPS instead of 40, and receives sound 15 ms late with ~5% of packets dropped. It then compares the two runs at the same clock times. Read its "visible" percentage (pixels that differ by more than 15% brightness):

  | Visible | Meaning | Label to use |
  |---|---|---|
  | 0% | Identical on every board, whatever happens | **safe** |
  | up to ~3% | Small differences from smoothing sound data; hard to see | **mostly safe** |
  | more | Boards will visibly disagree at times. For a sound effect that may be acceptable (say so, as example 08 does); for anything else it's a sync bug. | **not fully safe** |

### `time()` cheat sheet

`time(interval)` loops every 65.536 × interval seconds, so to loop every S seconds write `time(S / 65.536)`. Its output has 16-bit resolution, so loops longer than about 10 minutes (`time(10)`) start to step visibly. Changing a loop's interval makes the animation jump once (harmless when a slider moves; bad if you modulate it every frame).

---

## 6. Sound across six boards

The sensor board is on **board A, the leader**. Followers B–F must have Settings → Expansion Data Source → Sound set to **remote**. Its data is broadcast over UDP, so packets can occasionally drop.

- **Level-following effects are fine.** Brightness or fill from `energyAverage`, or bands from `frequencyData`, stay close across boards (example 07).
- **Beat and onset detection run separately on every board** and can disagree now and then: one board sees a kick that another missed. This is a known Pixelblaze limitation. The developer: "there's no way to have exactly the same number of render cycles for every sensor data sample" ([forum](https://forum.electromage.com/t/syncing-beat-detection-algorithm-to-multiple-pixelblazes/3233)). Mark such effects "Sync: not fully safe" and design them so an occasional missed beat doesn't stand out. Ripples that cross the whole body are the most exposed (example 08).
- **Robust fix (future):** detect beats in **one** place and distribute them as a signal every board reads identically. On the forum this was done by having the leader drive GPIO into the followers' analog inputs; on the Orcar a Teensy could inject beat data into the sensor stream. That needs hardware and firmware work, not an effect change. Talk to the electronics lead.
- **MUST:** use automatic gain. Raw `frequencyData` values are small and swing hugely between a quiet workshop and a festival stage. Track a slowly decaying running peak and divide by it (example 07). Keep a floor so silence stays dark instead of amplifying noise.
- **MUST:** give sensor variables defaults (`export var frequencyData = array(32)`, `export var energyAverage = 0`). Without a sensor board the firmware never fills them in, and the effect must still look acceptable, for example dim and calm. `pbcheck` runs a no-sensor pass to check this.

`frequencyData` has 32 buckets from about 37 Hz (bucket 0) to 10 kHz (bucket 31). They're **not** evenly spaced: kick drums are buckets 1–3 (50–100 Hz), and the full table is in `PIXELBLAZE_REFERENCE.md` §8.

---

## 7. Performance

Limits per pattern (Pixelblaze 3): **256 globals, 256 stack variables, 10,240 array elements**. The template alone uses about 120 globals and about 3,300 array elements on board B, as measured by `pbcheck`; its two tag tables are 2 × `pixelCount`. `pbcheck` prints the totals for your pattern.

- **SHOULD:** do per-frame work in `beforeRender` and keep `render3D` tiny. It runs ~1,000 times per frame on board B.
- **SHOULD:** prefer tags and your own first-frame lookup tables over loops in `render3D`. Each extra per-pixel table costs `pixelCount` elements (978 on B), so leave room: no more than about 6 extra tables in total.
- The expensive per-pixel calls are `perlin*` (fractal ones cost per octave), `sqrt`/`hypot3`, `atan2`, `pow`, `exp`/`log`, and any loop. One or two per pixel is fine; check the FPS.
- **MUST:** keep **30 FPS or better** on **board B** (the busiest) with the pattern running. Check the FPS readout in the top bar. `pbcheck`'s "per-pixel calls" column tells you where the cost is.
- **MUST NOT** allocate arrays outside the top level (they're never freed).
- **Fixed point:** keep intermediate values between −32,768 and +32,767. Work in world units (≤ 1) rather than inches; `index * index` and inches squared overflow.

---

## 8. Show safety and taste

The Orcar drives through crowds at night, including parades with children.

- **MUST:** no large-area flashing faster than **3 flashes per second**. For beat effects, that means a refractory gap of at least ~0.34 s. That's the widely used photosensitive-seizure limit (as in WCAG 2.3.1), and saturated red flashing is the worst case. Strobes belong behind an explicit toggle named so it's obvious (`toggleStrobe_FastFlash`) and **default off**.
- **MUST:** brightness is set by the operator (global brightness and the "Limit Brightness" setting). Don't add your own master brightness or assume full brightness. Design effects to look right from about 20% to 100%.
- **SHOULD:** give every effect a calm default: open with sensible slider defaults, with no control touched.
- **SHOULD:** fades and flashes last at least ~100 ms; single-frame events read as glitches.
- Power is managed at the system level. Patterns don't need power-limiting code unless the electronics lead says otherwise.

---

## 9. How to make a new effect

1. **Describe it** in a sentence or two: what moves, which parts, which colours, how fast, and whether it reacts to sound. A prompt template is below.
2. **Copy the nearest example** from `src/examples/` to `src/effects/my-effect.effect.js`.
3. **Write or change the effect** (with an AI or by hand), following the MUSTs.
4. **Build:** `node tools/build.mjs src/effects/my-effect.effect.js` gives you `patterns/effects/my-effect.js`, ready to paste.
5. **Look:** open `simulator.html` (`docs/SIMULATOR.md`) and watch the effect on the real map as you edit: direction, which parts light, colours, every control, and **Sync stress** for seams. For a sound effect, also try its **Sound** choices: the synthetic beat (including its breakdown with no kick), your own music, **Level** at both ends, and **No sensor board**.
6. **Check:** `node tools/pbcheck.mjs patterns/effects/my-effect.js --preview out/p.json`, then `python3 tools/preview.py out/p.json out/p.png` to see side, top and front views at four moments. Fix every `[error]`; read every `[warn]`.
7. **On the truck:** paste into the **leader's** editor (per the sync release notes, edits go live on the whole group immediately; `tools/pbfind.py` finds the boards' addresses), then check:
   - no seams at board boundaries,
   - board B's FPS,
   - every control at its extremes,
   - the kaleidoscope doing something sensible and the TEST strand off,
   - with sound: silence, a quiet room and loud music.
8. **Commit** the `.effect.js` source *and* the rebuilt `patterns/` file (CI checks they match), and save the pattern on the leader with the same name.

**Prompt template** (paste it with this file, `PIXELBLAZE_REFERENCE.md` and the closest example):

> Write an Orcar effect section (`.effect.js`) following docs/ORCAR_CONTRACT.md.
> Effect: *[what moves, where on the whale, colours, speed]*.
> Parts: *[e.g. ribs only / everything / backbone + fins]*. Kaleidoscope (EYE_1/EYE_2): *[default / off / match the body]*.
> Sound: *[none / follows volume / reacts to kicks]*.
> Controls I want: *[e.g. speed slider, colour picker]*.
> Start from: *[example file]*. Tell me its sync status and what to check on the truck.

---

## 10. Pre-flight checklist

- [ ] Starts from an example; both keep blocks are intact; the template is untouched.
- [ ] Watched in the simulator, including **Sync stress** and every control at its extremes (and, for sound, the beat, low and high **Level** and **No sensor board**); no flashing warning.
- [ ] `pbcheck`: no `[error]`. Every `[warn]` understood and either accepted or fixed.
- [ ] No hardcoded normalized coordinates or global indices.
- [ ] `tags == 0` (kaleidoscope, TEST) handled first.
- [ ] Shared motion uses `time()`; shared random choices use seeded `prng()` in `beforeRender`.
- [ ] Missing features (count 0) don't break it.
- [ ] Sound: auto-gain, a floor for silence, and sensible behaviour with no sensor board.
- [ ] No large-area flashing above 3 Hz (unless behind a default-off, clearly named toggle).
- [ ] Looks right at 20% brightness.
- [ ] On the truck: no seams, board B at or above the FPS minimum, controls tested at their extremes.
- [ ] For the public control page: §12 (controls not variables, `_Admin` for crew-only, safe at every extreme).

---

## 11. Not yet verified (author with care)

- **Trigger buttons** (`trigger…()`): sync copies a control to the followers only when its **value changes**. On the truck (19 Oct 2026), a trigger sent from the public control page with the same value every time reached boards B–F on the first press only; after that it fired on board A alone. The page now sends a new value with each press (`docs/PUBLIC_UI.md`, "Triggers and sync"), which still needs confirming on the truck, and it isn't known what the Pixelblaze UI's own trigger buttons send. So a trigger handler must ignore its value, and until both are confirmed, an effect shouldn't depend on a trigger reaching every board: prefer automatic or time-based events for anything essential. `src/effects/orca-playground.effect.js` is the test.
- **Sound thresholds** in examples 07 and 08 were tuned on synthetic audio. Re-tune them on the real sensor board.

---

## 12. Effects for the public control page

The public control page (`web/play.html`, served from board A as `/play.html`; see `docs/PUBLIC_UI.md`) shows the running pattern's UI controls as big touch controls for anyone to use. An effect meant for it:

- **MUST:** make every public knob a UI control (`slider…`, `toggle…`, `hsvPicker…`, `rgbPicker…`, `inputNumber…`, `trigger…`), never an exported variable. Control values reach all six boards; exported variables reach only board A (§5).
- **MUST:** stay within §8 with every public control at every extreme, in any combination. The public will find the extremes.
- **MUST:** hide crew-only controls, and any strobe toggle (§8), by ending the name with `_Admin` (`toggleStrobe_FastFlash_Admin`). The page never shows those.
- **MUST:** enforce limits in the pattern itself: clamp numbers, and give triggers their own minimum gap (the demo ignores presses within 1 s). The page's limits are a convenience, and the Pixelblaze UI doesn't apply them.
- **SHOULD:** name controls in plain words, since the name is the label (`sliderWaveSpeed` → "Wave Speed"), and order them by how much fun they are: the page shows them in source order.
- **SHOULD:** give each `inputNumber…` a range hint on its line, `// range 1..8`.
- **SHOULD:** mirror each `showNumber…`/`gauge…` readout in an exported variable named after it (`showNumberSplashes` → `export var splashes`), so the page can show it live.
- **SHOULD:** keep to about nine public controls.

`npm run web:check` reads every effect the way the page does and warns about missing readout variables, missing range hints and visible strobe controls. `src/effects/orca-playground.effect.js` follows all of this and uses every control type.

Project tasks and open questions live in the project's task list (`orcar-led-map-outstanding.md`), not here.
