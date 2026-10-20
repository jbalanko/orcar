/* =====================================================================
   ORCAR FEATURE MAP -- Orcar-specific helpers for Pixelblaze patterns
   =====================================================================

   WHAT THIS IS
   The Orcar's LEDs are driven by 6 Pixelblaze controllers (boards A-F,
   nodeId() 0-5), each with an output expander (channels 0-7). This code
   gives every pixel a GLOBAL index across all six boards and names every
   physical part of the sculpture (ribs, spines, fins, kaleidoscope, test strand), so a pattern
   can say "light up R4" or "only the head" without caring which board or
   channel the pixels are on. Paste this whole file into each pattern that
   needs it (Pixelblaze has no includes), then write the effect in
   beforeRender()/render3D() at the bottom.

   KEY CONCEPTS

   1. Local vs global index
      render3D(index, ...) receives a LOCAL index (0 at each board's first
      pixel). Global index = local + NODE_OFFSET. Board A's pixels come
      first, then B, ... then F. Within a board: channel 0 first, then 1..7.
      - Per-controller tables (TAGS, BB_POS) use the LOCAL index.
      - Features, groups, inFeature(), inGroup(), featurePos() use GLOBAL.

   2. Features
      Each physical part is a 4-element array: [count, start, end, reversed]
        f[F_COUNT]  pixel count (edit in the declarations)
        f[F_START]  global index of its pixel 0 (computed at load)
        f[F_END]    global index of its last pixel (computed at load)
        f[F_REV]    0 = wired in its default direction, 1 = opposite
      Pixels of a feature are always contiguous, so:
        k-th pixel of R4           = R4[F_START] + k
        position of index in R4    = index - R4[F_START]
      A count-0 (not yet installed) feature has end < start, so it never
      matches anything -- no special handling needed.

      Default directions ("reversed" is relative to these):
        Ribs:      CW as seen from in front of the nose -- starboard (low X)
                   up over the top to port (high X), low-high-low Z
        Spines:    front to back (increasing Y)
        Dorsal:    front to back (front base -> tip -> rear base)
        Pectorals: front to back (root front -> leading edge -> tip ->
                   trailing edge -> root rear)
        Fluke:     CW (it's angled, so CW from the front and from above
                   agree): (low X, low Y) -> (low X, high Y) ->
                   (high X, high Y) -> (high X, low Y)

   3. Groups
      Lists of features, prefixed GROUP_. Test with inGroup(GROUP_X, gi).
      Combined-channel groups (GROUP_R1_2 etc.) list features in chain
      order and also define the wiring. The kaleidoscope (EYE_1/EYE_2) and TEST strand are in
      NO group: they are not in the 3D map, so x/y/z are meaningless for
      them.

   4. Tags (fast group membership)
      On each controller, TAGS[localIndex] holds bit flags (TAG_RIB,
      TAG_HEAD, ...) for that pixel, built once on the first frame.
      Test with  if (tags & TAG_HEAD)  -- one array read, the cheapest
      check available. Prefer tags over inGroup() inside render3D().
      Unmapped pixels (kaleidoscope, TEST) have tags == 0.

   5. Backbone
      GROUP_BACKBONE = S6A -> S6B -> DORSAL -> S6C, head to tail.
      BB_POS[localIndex] gives 0 (head end) .. 1 (tail end) along the whole
      backbone, or -1 if the pixel isn't on it. Feature directions are
      already accounted for.

   6. 3D map (the x, y, z passed to render3D)
      Map frame (source JSON maps; units are inches, from the 3D model):
        +X = port (whale's left = viewer's right when facing the nose)
        +Y = aft  (nose is low Y, tail is high Y). "Forward" = -Y.
        +Z = up   (Z = 0 is the bottom of the rib arches)
        "CW" is always as seen from in front of the nose.
      One shared frame: every board's JSON map ends with the same two
      "ghost" entries at the corners of the whole-sculpture box
      (MAP_MIN_* / MAP_MAX_* below), and every controller's mapping mode is
      "Contain". So the same x/y/z means the same physical spot on all six
      controllers, and proportions are true (no stretching). Only the
      longest axis (Y) spans ~0..1; X and Z span less -- use X_LO..Z_HI
      for the actual normalized extents.
      Landmarks are written in inches in the 3D MAP section and converted
      to normalized constants at load. Use the constants; never hardcode
      normalized numbers -- if the ghost box ever changes (only when the
      DXF does; it already covers the whole sculpture) every normalized
      coordinate shifts.
      Unmapped pixels: the kaleidoscope (EYE_1/EYE_2, board F) and the TEST
      strand (board B) have PLACEHOLDER map entries (one point inside the
      body, 79.824, 140, 45). render3D() is NOT called for pixels past the
      end of a board's map (they freeze), so every pixel needs an entry.
      Their x/y/z mean nothing: check tags == 0 first. On every board the
      two ghost entries come after the last pixel.

   7. Feature vs. position (tags/groups are by FEATURE, not location)
      A pixel's tags say which physical part it belongs to, not where it
      is. The parts don't follow the head/body/tail boundaries exactly:
      several B spines start at R3 (Y = 55), so TAG_BODY includes spine
      pixels that are physically in the head region. Combine a feature
      test with a position test to get the part you mean:
        y < HEAD_BODY_Y                          everything ahead of R5
        (tags & TAG_SPINE) && y >= HEAD_BODY_Y   only the body section of
                                                 all spines (aft of R4)
        inFeature(S3B, index) && y >= HEAD_BODY_Y  same, for one spine
        (tags & TAG_RIB) && x > MID_X            port half of every rib
      Rule of thumb: tags/groups for "what part", x/y/z for "where".

   QUICK REFERENCE (inside render3D, after the first three lines)
     tags & TAG_HEAD                    pixel is in the head
     (tags & TAG_SPINE) && (tags & TAG_BODY)   body spines only
     tags == 0                          unmapped pixel: kaleidoscope or TEST (no real x/y/z)
     bb >= 0                            pixel is on the backbone; bb = 0..1
     inFeature(R4, index)               pixel is in one specific feature
     featurePos(R4, index)              0..1 along R4 in its default direction
     inGroup(GROUP_R1_2, index)         any group, without a tag (slower)
     y < HEAD_BODY_Y                    spatially in the head (ahead of R5)
     x > MID_X                          port side; abs(x - MID_X) = distance
                                        from the centerline (mirror effects)
     (y - Y_LO) / (Y_HI - Y_LO)         0 at the nose .. 1 at the tail
     (z - Z_LO) / (Z_HI - Z_LO)         0 at the base .. 1 at the dorsal tip
     hypot3(x - DORSAL_TIP[0], y - DORSAL_TIP[1], z - DORSAL_TIP[2])
                                        distance to a landmark (normalized)
     nLen(12)                           12 inches in normalized units

   GEOMETRY REFERENCE (map units, from the current JSON maps)
     Box (ghosts): X 0.977..158.672  Y -0.646..297.653  Z 0..135.772
       = the WHOLE sculpture in the DXF, counted or not (mapgen ghost_box
       "all", 2026-10-18): ~13.1 ft pectoral tip to tip, ~24.9 ft nose tip
       to fluke tips, ~11.3 ft tall (fluke tips are the highest point).
       It only changes if the DXF does.
     Symmetry plane: X = 79.824 (dorsal fin and S6C lie exactly on it)
     Rib planes (Y): R3 55.0  R4 79.4  R5 105.3  [R6 ~129.3]  R7 153.3
                     R8 177.3  R9 201.3  R10 214.5..225.3 (tilted)
       Arches stand on Z = 0; tops Z 81..94; widest is R7 (X 33.7..126.0)
     Spines, front view: intended order S1 .. S11 in an arc from starboard
       over the top to port, S6 on the centerline. Mirror pairs:
       Sn <-> S(12-n). S1/S11 lowest (Z ~9..21). B spines start at R3
       (Y 55) or R4 (Y 79.4) and converge toward the tail.
       The source DXF labels the even spines on the wrong side (S2/S4 on
       port, S8/S10 on starboard). maps/mapgen.json swaps S2<->S10 and
       S4<->S8 (A and B) when generating the maps, and mapgen's spine-side
       check enforces the S1..S11 starboard-to-port order.
     Dorsal: X 79.824, Y 142.8..190.3, tip at (79.8, 184.4, 131.3)
     Pectorals: roots at R4 (Y 79.4, Z 21.5), tips at (0.98 / 158.67,
       125.3, 9.5). LEFT = port, RIGHT = starboard; they mirror index for
       index (pixel k of LEFT mirrors pixel k of RIGHT).
     S6C: centerline, Y 189.3..272.5, starts where the dorsal fin ends.
     Not yet mapped: R1, R2, R6, R11..R14, all A spines, S6B, S7B, S8B,
       fluke, blowhole (a point; location TBD).

   HOW TO MAINTAIN
     - Count changes / newly installed part: edit the count in its
       feature(count, reversed) declaration. Everything else recomputes.
     - Direction known: set the second argument (0 = default, 1 = opposite).
     - Wiring change: edit the BOARD_A..BOARD_F lists only. Each list has
       one entry per channel 0..7; each entry lists that channel's features
       in chain order; [NONE] = unused channel. Every feature must appear
       exactly once (a feature left out keeps start = -1 and never matches).
     - Any count or wiring change also needs the maps regenerated:
       python3 tools/mapgen.py (docs/MAP_GENERATION.md). It reads this
       file's counts, wiring and directions plus the DXF, so code and maps
       agree pixel for pixel. Never hand-edit the map JSONs.
     - Every pixel needs a map entry (render3D() skips pixels past the end
       of the map; they freeze). Unmapped strands (kaleidoscope, TEST) get
       the placeholder point (79.824, 140, 45), one entry per pixel.
     - The ghost box covers every strand in the DXF, counted or not
       (mapgen ghost_box "all"), so counting a new strand never moves it.
       If the DXF itself changes the box, mapgen fails until you run it
       with --fix-template, which updates MAP_MIN_* / MAP_MAX_* here; then
       rebuild and re-paste every pattern and upload all six maps.
     - New landmark: add it in inches in the 3D MAP section via nX/nY/nZ
       or mapPoint().
     - New compound group: add a GROUP_ list, add a TAG_ bit (next free
       power of 2; max 16384, i.e. 15 tags), and a tagGroup() line in
       buildTags(). Never put EYE_1/EYE_2/TEST (unmapped) in a group.

   CHECKS AFTER ANY CHANGE (Var Watcher, on each controller)
     - BOARD_TOTAL[nodeId] must equal that controller's configured pixel
       count, or indices drift.
     - Every feature's start (2nd value) is not -1.

   GOTCHAS
     - Read TAGS/BB_POS with the LOCAL index before adding NODE_OFFSET.
     - Allocate arrays only at load time (top level), never in
       beforeRender/render3D: Pixelblaze never frees arrays.
     - Changing a count live via Var Watcher / API does NOT re-run
       placement; edit the code instead.
     - array(0) is illegal on Pixelblaze; that's why NONE / feature(0, ...)
       exist instead of empty lists.

   BUDGET (Pixelblaze 3, per pattern): 256 globals, 256 stack variables,
   10,240 array elements. On board B this file alone uses ~120 globals and
   ~2,000 array elements (including 2 x pixelCount for TAGS and BB_POS), as
   measured by tools/pbcheck.mjs, which prints the totals for any pattern.
   ===================================================================== */

// Positions inside a feature's [count, start, end, reversed] array
var F_COUNT = 0;   // f[F_COUNT]: pixel count (0 = not installed yet)
var F_START = 1;   // f[F_START]: global index of its first pixel
var F_END = 2;     // f[F_END]: global index of its last pixel
var F_REV = 3;     // f[F_REV]: 1 if wired opposite to its default direction

// start/end are placeholders until placed; end < start means "matches nothing"
function feature(count, reversed) { return [count, -1, -2, reversed]; }

// Filler for unused output channels
var NONE = feature(0, 0);

// ---- Ribs (default: CW, low X -> high X) ---------------------------
//                 feature(count, reversed)
export var R1  = feature(0, 0);    // Installed; needs count + map. Direction TBD.
export var R2  = feature(0, 0);    // Installed; needs count + map. CW.
export var R3  = feature(97, 0);
export var R4  = feature(138, 0);
export var R5  = feature(166, 0);
export var R6  = feature(0, 0);    // Installed; needs count + map
export var R7  = feature(171, 0);
export var R8  = feature(170, 0);
export var R9  = feature(163, 0);
export var R10 = feature(150, 0);
export var R11 = feature(0, 0);    // Needs installation. CW.
export var R12 = feature(0, 0);    // Needs installation. Direction TBD.
export var R13 = feature(0, 0);    // Needs installation. Direction TBD.
export var R14 = feature(0, 0);    // Needs installation. Direction TBD.

// ---- Spines (default: front to back; 1 = back to front) ------------
export var S2A  = feature(0, 1);   // Needs installation. B2F.
export var S4A  = feature(0, 0);   // Needs installation. F2B.
export var S6A  = feature(0, 1);   // Needs installation. B2F.
export var S8A  = feature(0, 0);   // Needs installation. Direction TBD.
export var S10A = feature(0, 0);   // Needs installation. Direction TBD.
export var S1B  = feature(108, 0);
export var S2B  = feature(172, 0);
export var S3B  = feature(128, 0);
export var S4B  = feature(172, 0);
export var S5B  = feature(107, 0);
export var S6B  = feature(0, 0);   // Installed; needs count + map
export var S6C  = feature(64, 0);
export var S7B  = feature(0, 0);   // Installed; needs count + map
export var S8B  = feature(0, 0);   // Installed; needs count + map
export var S9B  = feature(125, 0);
export var S10B = feature(173, 0);
export var S11B = feature(110, 0);

// ---- Fins ----------------------------------------------------------
export var FLUKE          = feature(0, 0);    // Installed; needs count + map. CW (default).
export var DORSAL         = feature(72, 0);   // F2B (front base -> tip -> rear base)
export var LEFT_PECTORAL  = feature(103, 0);  // Needs fix and count. F2B.
export var RIGHT_PECTORAL = feature(103, 0);  // Needs fix and count. F2B.

// ---- Kaleidoscope (named EYE_1/EYE_2 for historical reasons): no real
//      position (placeholder map entries only), not in any group --------
export var EYE_1 = feature(112, 0);  // Needs count
export var EYE_2 = feature(112, 0);  // Needs count

// ---- Test strand: placeholder map entries only, not in any group ---
export var TEST = feature(300, 0);   // Box B ch 4 here (channel 5 counting from 1)

// ---- Combined channels (features in chain order) -------------------
var GROUP_R1_2    = [R2, R1];       // board A ch 0: R2 then R1
var GROUP_S2_4_6A = [S2A, S4A, S6A];   // board A ch 3
var GROUP_S8_10A  = [S8A, S10A];   // board A ch 4. Order TBD -- swap if S10A comes first
var GROUP_R11_12  = [R11, R12];    // board E ch 3
var GROUP_R13_14  = [R13, R14];    // board E ch 4

// =====================================================================
// WIRING -- the single source of truth for index order.
// One entry per output channel 0..7; [NONE] = unused channel.
// =====================================================================
//              ch0          ch1     ch2       ch3            ch4             ch5               ch6      ch7
var BOARD_A = [GROUP_R1_2, [R3],   [R4],     GROUP_S2_4_6A, GROUP_S8_10A,   [NONE],           [NONE],  [NONE]];
var BOARD_B = [[R5],       [R6],   [R7],     [R8],          [TEST],                  [NONE],           [NONE],  [NONE]];
var BOARD_C = [[S1B],      [S3B],  [NONE],   [S7B],         [S5B],          [NONE],           [S9B],   [S11B]];
var BOARD_D = [[NONE],     [NONE], [DORSAL], [S6B],         [S10B],         [S8B],            [S4B],   [S2B]];
var BOARD_E = [[R9],       [R10],  [FLUKE],  GROUP_R11_12,  GROUP_R13_14,   [S6C],            [NONE],  [NONE]];
var BOARD_F = [[NONE],     [NONE], [NONE],   [NONE],        [LEFT_PECTORAL],[RIGHT_PECTORAL], [EYE_1], [EYE_2]];

var BOARDS = [BOARD_A, BOARD_B, BOARD_C, BOARD_D, BOARD_E, BOARD_F];   // index = nodeId()

// ---- Placement: computes every feature's start/end and board offsets
export var BOARD_TOTAL  = array(6);  // pixels per board; must match each controller's pixel count
export var BOARD_OFFSET = array(6);  // global index of each board's pixel 0

var _cursor = 0;
// Gives feature f its global start/end (runs once, at load)
function place(f) {
  f[F_START] = _cursor;
  f[F_END] = _cursor + f[F_COUNT] - 1;   // count 0 -> end < start -> matches nothing
  _cursor += f[F_COUNT];
}

for (var _b = 0; _b < 6; _b++) {
  BOARD_OFFSET[_b] = _cursor;
  var _board = BOARDS[_b];
  for (var _c = 0; _c < _board.length; _c++) {
    var _chain = _board[_c];
    for (var _k = 0; _k < _chain.length; _k++) place(_chain[_k]);
  }
  BOARD_TOTAL[_b] = _cursor - BOARD_OFFSET[_b];
}
export var TOTAL_COUNT = _cursor;   // pixels on all six boards together

// =====================================================================
// GROUPS (lists of features). Never include EYE_1 / EYE_2 / TEST.
// =====================================================================
// Membership tests: inGroup(GROUP_X, index) loops over the list, so inside
// render3D() prefer the matching tag (tags & TAG_X), which is one array read.
var GROUP_ALL_RIBS = [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14];   // every rib, nose to tail (tag: TAG_RIB)
var GROUP_ALL_SPINES = [   // every spine, A, B and S6C (tag: TAG_SPINE)
  S2A, S4A, S6A, S8A, S10A,
  S1B, S2B, S3B, S4B, S5B, S6B, S7B, S8B, S9B, S10B, S11B,
  S6C
];
var GROUP_HEAD = [S2A, S4A, S6A, S8A, S10A, R1, R2, R3, R4];   // A spines + R1-R4 (tag: TAG_HEAD)
var GROUP_BODY = [   // B spines, S6C, R5-R10, dorsal, pectorals (tag: TAG_BODY). Some B spines start in the head region.
  S1B, S2B, S3B, S4B, S5B, S6B, S7B, S8B, S9B, S10B, S11B, S6C,
  R5, R6, R7, R8, R9, R10,
  DORSAL, LEFT_PECTORAL, RIGHT_PECTORAL
];
var GROUP_TAIL = [R11, R12, R13, R14, FLUKE];   // R11-R14 + fluke (tag: TAG_TAIL)
var GROUP_BACKBONE = [S6A, S6B, DORSAL, S6C];   // ordered head -> tail (tag: TAG_BACKBONE; position along it: BB_POS / bb)

// =====================================================================
// 3D MAP -- shared frame and landmarks (see header section 6)
// =====================================================================
// Ghost-pixel box, in map units. Must match the two ghost entries at the
// end of every board's JSON map: [MIN_X, MIN_Y, MIN_Z], [MAX_X, MAX_Y, MAX_Z].
var MAP_MIN_X = 0.977;
var MAP_MIN_Y = -0.646;
var MAP_MIN_Z = 0;
var MAP_MAX_X = 158.672;
var MAP_MAX_Y = 297.653;
var MAP_MAX_Z = 135.772;

// 0 if "Contain" anchors the box at 0 on every axis; 1 if it centers the
// shorter axes in the unit cube.
// RESOLVED 2026-10-18 from the v3.51 Mapper page source (normalizeMap):
// Contain does  e = (v - min)/range;  e = e*n + (1 - n)/2,  n = range/longest
// i.e. the shorter axes are CENTERED. Confirm on the truck with pattern
// src/examples/00-map-check (it lights known parts by coordinates). Also:
// Board A, pixel 0 = first pixel of R3, map point (43.203, 54.987, 56.82):
//   anchored -> x ~0.142, z ~0.190     centered -> x ~0.377, z ~0.463
// Physical check: light  abs(z - nZ(57)) < nLen(2).  With the correct
// setting you see a horizontal band ~57" up (mid-body); with the wrong
// one the band lands somewhere else.
var MAP_CENTERED = 1;

// "Contain" scales every axis by the longest dimension
var MAP_SPAN = max(MAP_MAX_X - MAP_MIN_X, max(MAP_MAX_Y - MAP_MIN_Y, MAP_MAX_Z - MAP_MIN_Z));

// Padding "Contain" adds on each side of a shorter axis (when MAP_CENTERED)
function mapPad(lo, hi) { return MAP_CENTERED ? (MAP_SPAN - (hi - lo)) / 2 : 0; }

// Map units -> the normalized coordinates render3D receives (use at load time)
function nX(v) { return (v - MAP_MIN_X + mapPad(MAP_MIN_X, MAP_MAX_X)) / MAP_SPAN; }
function nY(v) { return (v - MAP_MIN_Y + mapPad(MAP_MIN_Y, MAP_MAX_Y)) / MAP_SPAN; }
function nZ(v) { return (v - MAP_MIN_Z + mapPad(MAP_MIN_Z, MAP_MAX_Z)) / MAP_SPAN; }
function nLen(d) { return d / MAP_SPAN; }   // a distance (e.g. inches) -> normalized

// [x, y, z] landmark point in normalized coordinates
function mapPoint(x, y, z) {
  var p = array(3);
  p[0] = nX(x);
  p[1] = nY(y);
  p[2] = nZ(z);
  return p;
}

// Normalized extents of the whole sculpture (the ghost box)
var X_LO = nX(MAP_MIN_X);
var X_HI = nX(MAP_MAX_X);
var Y_LO = nY(MAP_MIN_Y);
var Y_HI = nY(MAP_MAX_Y);
var Z_LO = nZ(MAP_MIN_Z);
var Z_HI = nZ(MAP_MAX_Z);

// Planes and axes
var MID_X       = nX(79.824);   // symmetry plane (dorsal, S6). x > MID_X = port
var HEAD_BODY_Y = nY(92.37);    // midway between R4 (head, 79.43) and R5 (body, 105.31)
var BODY_TAIL_Y = nY(226.98);   // midway between R10 (aft-most 225.35) and R11 (front-most 228.61), from the DXF
var BODY_AXIS_Z = nZ(45);       // approx mid-height of the rib arches; with MID_X, a
                                // fore-aft axis for radial/cylindrical effects

// Points [x, y, z]
var DORSAL_TIP    = mapPoint(79.824, 184.394, 131.332);
var LEFT_PEC_TIP  = mapPoint(158.67, 125.275, 9.475);    // port
var RIGHT_PEC_TIP = mapPoint(0.979, 125.275, 9.475);     // starboard
var TAIL_END      = mapPoint(79.824, 272.526, 102.383);  // aft end of the backbone (S6C), centreline
var NOSE_TIP      = mapPoint(79.824, -0.646, 61.952);    // front-most point of the sculpture (DXF "Nose")
var FLUKE_TIP_LEFT  = mapPoint(123.837, 297.649, 135.766); // port fluke tip (aft-most / highest)
var FLUKE_TIP_RIGHT = mapPoint(35.812, 297.653, 135.772);  // starboard fluke tip
// var BLOWHOLE   = mapPoint(?, ?, ?);                   // TBD

// =====================================================================
// LOOKUPS BY GLOBAL INDEX
// =====================================================================

// 1 if global index i is in feature f
function inFeature(f, i) {
  return i >= f[F_START] && i <= f[F_END];
}

// 1 if global index i is in any feature of group g (loops; prefer tags in render3D)
function inGroup(g, i) {
  for (var k = 0; k < g.length; k++) {
    if (inFeature(g[k], i)) return 1;
  }
  return 0;
}

// 0..1 along feature f in its DEFAULT direction (reversal applied).
// Only meaningful when inFeature(f, i) is true.
function featurePos(f, i) {
  var p = (i - f[F_START]) / max(1, f[F_COUNT] - 1);
  return f[F_REV] ? 1 - p : p;
}

// =====================================================================
// PER-CONTROLLER TABLES (indexed by LOCAL index, built on first frame)
// =====================================================================
// Tag bits: next free is 64. Max 16384 (15 tags). Test with (tags & TAG_X).
var TAG_RIB      = 1;    // on any rib (GROUP_ALL_RIBS)
var TAG_SPINE    = 2;    // on any spine (GROUP_ALL_SPINES)
var TAG_HEAD     = 4;    // A spines, R1-R4 (GROUP_HEAD)
var TAG_BODY     = 8;    // B spines, S6C, R5-R10, dorsal, pectorals (GROUP_BODY)
var TAG_TAIL     = 16;   // R11-R14, fluke (GROUP_TAIL)
var TAG_BACKBONE = 32;   // S6A, S6B, dorsal, S6C (GROUP_BACKBONE)

var TAGS   = array(pixelCount);   // bit flags per local pixel; 0 = unmapped (kaleidoscope / TEST)
var BB_POS = array(pixelCount);   // 0 (head) .. 1 (tail) along backbone, or -1
var NODE_OFFSET = 0;              // global index of this controller's pixel 0
var tagsBuiltFor = -1;            // which board the tables were built for (the keep block)

// Sets `bit` in TAGS for every pixel of group g that lives on this controller
function tagGroup(g, bit) {
  var lo = NODE_OFFSET;
  var hi = NODE_OFFSET + pixelCount - 1;
  for (var k = 0; k < g.length; k++) {
    var f = g[k];
    var a = max(f[F_START], lo);
    var b = min(f[F_END], hi);
    for (var i = a; i <= b; i++) TAGS[i - lo] = TAGS[i - lo] | bit;
  }
}

// Fills BB_POS for backbone pixels on this controller
function buildBackbonePos() {
  var total = 0;
  for (var t = 0; t < GROUP_BACKBONE.length; t++) total += GROUP_BACKBONE[t][F_COUNT];
  var lo = NODE_OFFSET;
  var hi = NODE_OFFSET + pixelCount - 1;
  var before = 0;
  for (var s = 0; s < GROUP_BACKBONE.length; s++) {
    var f = GROUP_BACKBONE[s];
    var n = f[F_COUNT];
    var a = max(f[F_START], lo);
    var b = min(f[F_END], hi);
    for (var i = a; i <= b; i++) {
      var k = i - f[F_START];
      if (f[F_REV]) k = n - 1 - k;
      BB_POS[i - lo] = (before + k) / max(1, total - 1);
    }
    before += n;
  }
}

// Builds this controller's TAGS and BB_POS tables. The keep block in
// beforeRender() calls it once per board; don't call it yourself.
function buildTags() {
  TAGS.mutate((v) => 0);
  BB_POS.mutate((v) => -1);
  tagGroup(GROUP_ALL_RIBS, TAG_RIB);
  tagGroup(GROUP_ALL_SPINES, TAG_SPINE);
  tagGroup(GROUP_HEAD, TAG_HEAD);
  tagGroup(GROUP_BODY, TAG_BODY);
  tagGroup(GROUP_TAIL, TAG_TAIL);
  tagGroup(GROUP_BACKBONE, TAG_BACKBONE);
  buildBackbonePos();
}

// =====================================================================
// EFFECT (built from src/examples/00-map-check.effect.js -- edit that file, then rebuild with
// node tools/build.mjs; don't edit this file)
// =====================================================================
// 00 MAP CHECK -- confirms the 3D map, its bounds and the normalization
// (MAP_CENTERED) by lighting known parts of the whale by COORDINATES only.
//
// How to read it: the feature each probe SHOULD hit is drawn dim white (by
// feature index, which doesn't depend on the map). The probe lights pixels
// in colour purely from x/y/z. PASS = the colour sits exactly on the dim
// white feature. Colour somewhere else, or white with no colour, means the
// map, the ghost box or MAP_CENTERED is wrong.
//
// Probes (slider "Probe": 0 = all at once, 1..5 = one at a time):
//   1 RIB PLANE   y within 1" of R7's plane (Y 153.31")  -> all of R7, cyan
//                 (plus single pixels where spines cross it). Tests y.
//   2 CENTRELINE  x within 1" of the symmetry plane (X 79.824") -> the
//                 dorsal fin and S6C, magenta (plus the top pixel of each
//                 rib). Tests x CENTRING -- this is the MAP_CENTERED test.
//   3 PORT TIP    x beyond 150" -> only the tip of LEFT_PECTORAL (port),
//                 yellow. Tests the x bounds and scale.
//   4 TOP         z above 120" -> only the top of the dorsal fin, green
//                 (and the fluke tips, once the fluke is counted).
//                 Tests z CENTRING and scale.
//   5 GROUND      z below 1" -> the feet of the ribs that reach the ground
//                 (R4, R5, R7-R10), orange. Tests the z bounds.
// If the template's MAP_CENTERED disagreed with the Mapper (e.g. set to 0
// while Contain centres, which is the mistake this check was built for),
// probes 2 and 4 land far from their white targets: 2 out near the
// starboard pectoral tip, 4 lighting everything above ~39". Pictures of
// pass and fail: docs/img/.
//
// Sync: safe (static). Unmapped strands (kaleidoscope, TEST) are off.

var probe = 0;
export function sliderProbe(v) { probe = floor(v * 5.99); }

var R7_Y   = nY(153.31);
var MID    = nX(79.824);
var PORT_X = nX(150);
var TOP_Z  = nZ(120);
var LOW_Z  = nZ(1);
var TOL    = nLen(1);

export function beforeRender(delta) {
  // --- keep: builds this controller's tables once ---
  var id = nodeId();                      // A=0 ... F=5
  if (tagsBuiltFor != id) {
    NODE_OFFSET = BOARD_OFFSET[id];
    buildTags();
    tagsBuiltFor = id;
  }
  // --- your per-frame code ---
}

function on(p) { return probe == 0 || probe == p; }

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { hsv(0, 0, 0); return; }

  // Probes by coordinates (bright colour). Later probes win where they overlap.
  var hue = -1;
  if (on(1) && abs(y - R7_Y) < TOL) hue = 0.5;     // cyan
  if (on(5) && z < LOW_Z) hue = 0.07;              // orange
  if (on(2) && abs(x - MID) < TOL) hue = 0.83;     // magenta
  if (on(3) && x > PORT_X) hue = 0.16;             // yellow
  if (on(4) && z > TOP_Z) hue = 0.33;              // green
  if (hue >= 0) { hsv(hue, 1, 1); return; }

  // Targets by feature (dim white): where the probes SHOULD land
  var target = 0;
  if (on(1) && inFeature(R7, index)) target = 1;
  if (on(2) && (inFeature(DORSAL, index) || inFeature(S6C, index))) target = 1;
  if (on(3) && inFeature(LEFT_PECTORAL, index)) target = 1;
  if (on(4) && inFeature(DORSAL, index)) target = 1;
  if (on(5) && (tags & TAG_RIB)) target = 1;
  hsv(0, 0, target ? 0.12 : 0);
}
