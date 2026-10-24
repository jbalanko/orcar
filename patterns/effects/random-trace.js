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
     Rib planes (Y): R3 55.0  R4 79.4  R5 105.3  R6 129.3  R7 153.3
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
     Not yet mapped: R1, R2, R11..R14, all A spines, S6B,
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
   ~3,300 array elements (including 2 x pixelCount for TAGS and BB_POS), as
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
export var R6  = feature(171, 0);
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
export var S7B  = feature(109, 0);
export var S8B  = feature(172, 0);
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
// EFFECT (built from src/effects/random-trace.effect.js -- edit that file, then rebuild with
// node tools/build.mjs; don't edit this file)
// =====================================================================
// RANDOM TRACE -- a small living spot of light that wanders the whale along
// its strands, resting here and there.
//
// Looks:    the whale glows a dim, slowly shimmering deep blue. A bright spot
//           (white by default) sits on it, breathing: it swells and shrinks a
//           little, more on one side than the other, with a lumpy, uneven
//           outline. After a while it sets off along the strand it's on, and
//           at each crossing of a rib and a spine it may turn, zig-zagging
//           across the whale (with the odd detour) to somewhere else, where
//           it settles again. It stretches into a short tail while it moves.
//           Where it goes and how long it stays are random; it never stays
//           put longer than about a minute (two "slots", see below).
// Sync:     safe -- every trip is planned from a slot number taken from
//           time(), with seeded prng() in beforeRender, over a fixed junction
//           table that's the same on every board. The spot's place along the
//           trip, its breathing and its lumpy outline are pure functions of
//           time(), control values and position.
// Try:      "Spot Colour" (white = saturation at 0); "Background" picker for
//           the whale's glow (brightness 0 turns it off); "Wander Speed" is
//           how fast it travels; "Spot Size" its radius; "Restlessness" how
//           often it moves on (at the lowest it can rest up to about a
//           minute, at the highest up to about 25 s).
//
// How it finds its way: JUNCTIONS (below) lists where strands cross, as
// positions along each strand (featurePos fractions, 0..1 in the default
// direction). Each controller only knows its own pixels' positions, so the
// crossings can't be found at run time; they were measured from the maps
// (pixel pairs on two strands within 4" of each other) on 2026-10-24. Count
// changes don't move them (they're fractions), but if the DXF changes they
// should be measured again. Strand ends with no crossing become dead ends.
// Strands that aren't in the table (R1, R2, R11-R14, the A spines, S6B,
// the fluke) just show the background until they're added.

var slotSecs = 30;    // slider: a trip happens once per slot; a stay is < 2 slots
var speed = 32;       // slider: pixels per second while travelling
var spotSize = 9;     // slider: spot radius, in pixels along the strands
var spotH = 0; var spotS = 0; var spotV = 1;      // picker: the spot (white)
var bgH = 0.62; var bgS = 1; var bgV = 0.22;      // picker: the background

export function sliderWanderSpeed(v) { speed = mix(10, 80, clamp(v, 0, 1)); }
export function sliderSpotSize(v) { spotSize = mix(4, 18, clamp(v, 0, 1)); }
export function sliderRestlessness(v) { slotSecs = mix(30, 12, clamp(v, 0, 1)); }
export function hsvPickerSpotColour(h, s, v) { spotH = h; spotS = s; spotV = v; }
export function hsvPickerBackground(h, s, v) { bgH = h; bgS = s; bgV = v * 0.5; }

// Where strands cross: [feature, position, feature, position, ...] per point.
var JUNCTIONS = [
  [R3, 0.000, S2B, 0.000],
  [R3, 0.167, S3B, 0.000],
  [R3, 0.292, S4B, 0.000],
  [R3, 0.708, S8B, 0.000],
  [R3, 0.833, S9B, 0.000],
  [R3, 1.000, S10B, 0.000],
  [R4, 0.102, S1B, 0.000, RIGHT_PECTORAL, 0.000],
  [R4, 0.190, S2B, 0.123],
  [R4, 0.285, S3B, 0.165],
  [R4, 0.372, S4B, 0.105],
  [R4, 0.445, S5B, 0.000],
  [R4, 0.555, S7B, 0.000],
  [R4, 0.628, S8B, 0.105],
  [R4, 0.715, S9B, 0.161],
  [R4, 0.810, S10B, 0.128],
  [R4, 0.898, S11B, 0.000, LEFT_PECTORAL, 0.000],
  [R5, 0.073, S1B, 0.178],
  [R5, 0.164, S2B, 0.240],
  [R5, 0.242, S3B, 0.323],
  [R5, 0.345, S4B, 0.216],
  [R5, 0.430, S5B, 0.189],
  [R5, 0.570, S7B, 0.194],
  [R5, 0.655, S8B, 0.216],
  [R5, 0.758, S9B, 0.323],
  [R5, 0.836, S10B, 0.238],
  [R5, 0.927, S11B, 0.183],
  [R6, 0.047, S1B, 0.346],
  [R6, 0.141, S2B, 0.345],
  [R6, 0.224, S3B, 0.465],
  [R6, 0.329, S4B, 0.322],
  [R6, 0.418, S5B, 0.368],
  [R6, 0.582, S7B, 0.370],
  [R6, 0.671, S8B, 0.322],
  [R6, 0.776, S9B, 0.468],
  [R6, 0.865, S10B, 0.349],
  [R6, 0.953, S11B, 0.349],
  [R7, 0.041, S1B, 0.505],
  [R7, 0.129, S2B, 0.450],
  [R7, 0.224, S3B, 0.606],
  [R7, 0.324, S4B, 0.421],
  [R7, 0.418, S5B, 0.547],
  [R7, 0.582, S7B, 0.546],
  [R7, 0.676, S8B, 0.421],
  [R7, 0.776, S9B, 0.605],
  [R7, 0.871, S10B, 0.448],
  [R7, 0.959, S11B, 0.505],
  [R8, 0.047, S1B, 0.664],
  [R8, 0.142, S2B, 0.556],
  [R8, 0.231, S3B, 0.748],
  [R8, 0.331, S4B, 0.520],
  [R8, 0.426, S5B, 0.717],
  [R8, 0.574, S7B, 0.722],
  [R8, 0.669, S8B, 0.520],
  [R8, 0.769, S9B, 0.750],
  [R8, 0.858, S10B, 0.552],
  [R8, 0.953, S11B, 0.670],
  [R9, 0.074, S1B, 0.832],
  [R9, 0.160, S2B, 0.661],
  [R9, 0.259, S3B, 0.898],
  [R9, 0.358, S4B, 0.626],
  [R9, 0.438, S5B, 0.906],
  [R9, 0.494, S6C, 0.143],
  [R9, 0.549, S7B, 0.898],
  [R9, 0.636, S8B, 0.620],
  [R9, 0.735, S9B, 0.887],
  [R9, 0.840, S10B, 0.657],
  [R9, 0.926, S11B, 0.835],
  [R10, 0.101, S1B, 1.000],
  [R10, 0.188, S2B, 0.749],
  [R10, 0.289, S3B, 1.000],
  [R10, 0.376, S4B, 0.684],
  [R10, 0.456, S5B, 1.000],
  [R10, 0.497, S6C, 0.286],
  [R10, 0.544, S7B, 1.000],
  [R10, 0.624, S8B, 0.684],
  [R10, 0.711, S9B, 1.000],
  [R10, 0.812, S10B, 0.750],
  [R10, 0.899, S11B, 1.000],
  [S1B, 0.056, RIGHT_PECTORAL, 1.000],
  [S11B, 0.055, LEFT_PECTORAL, 1.000],
  [S6C, 0.000, DORSAL, 1.000],
  [S6C, 1.000, S4B, 1.000, S8B, 1.000],   // tail end: within ~7" of each other
  [DORSAL, 0.535],                        // resting places part way along a strand:
  [LEFT_PECTORAL, 0.510],                 // the dorsal tip and the pectoral tips
  [RIGHT_PECTORAL, 0.510]
];

// Every strand with a position (all but the kaleidoscope and TEST).
var FEATS = [
  R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14,
  S2A, S4A, S6A, S8A, S10A,
  S1B, S2B, S3B, S4B, S5B, S6B, S7B, S8B, S9B, S10B, S11B, S6C,
  FLUKE, DORSAL, LEFT_PECTORAL, RIGHT_PECTORAL
];
var N_FEATS = FEATS.length;

var MAX_STOPS = 224;
var MAX_NODES = 128;
var MAX_PATH = 64;
var MIN_HOPS = 5;       // even a trip back to the same place goes somewhere first
var DETOURS = 4;        // random turns allowed that lead away from the target
var MIN_REST = 1.5;     // seconds: shortest stay at the start of a slot
var END_PAD = 1;        // seconds: a trip ends at least this long before its slot does
var LUMP = 0.35;        // how uneven the spot's outline is
var NOISE_K = 22;       // lumpiness / shimmer noise scale (cells per world unit)
var CLOCK_SECONDS = 655.36;   // time(10) loops every 655.36 s

// The graph: a stop is one strand's place at a node; a node is a point where
// one or more strands meet. A node's stops are contiguous.
var STOP_F = array(MAX_STOPS);     // FEATS index
var STOP_P = array(MAX_STOPS);     // 0..1 along the strand, default direction
var STOP_N = array(MAX_STOPS);     // node
var STOP_RANK = array(MAX_STOPS);  // place among its strand's stops, by position
var ORDER = array(MAX_STOPS);      // stops grouped by strand, sorted by position
var NODE_FIRST = array(MAX_NODES);
var NODE_CNT = array(MAX_NODES);
var DIST = array(MAX_NODES);       // hops to the target (bfs)
var QUEUE = array(MAX_NODES);
var MAIN = array(MAX_NODES);       // nodes of the largest connected part
var FEAT_FIRST = array(N_FEATS);   // where each strand's stops start in ORDER
var FEAT_NS = array(N_FEATS);
var FEAT_LEN = array(N_FEATS);     // pixels from end to end (count - 1)
var ENTRY_D = array(N_FEATS);      // per frame: pixels from the spot to the entry point
var ENTRY_P = array(N_FEATS);      // per frame: entry point, pixels along the strand
var PATH_A = array(MAX_PATH);      // trip segment i runs from stop PATH_A[i]...
var PATH_B = array(MAX_PATH);      // ...along one strand to stop PATH_B[i]
var PATH_CUM = array(MAX_PATH);    // pixels travelled by the end of segment i
var nStops = 0; var nNodes = 0; var nMain = 0; var nPath = 0;

// Per-pixel tables (local index), built on the first frame
var FID = array(pixelCount);       // FEATS index, or -1
var PPX = array(pixelCount);       // pixels along its strand, default direction
var pixBuiltFor = -1;

// FEATS index of feature f, or -1 if it isn't installed
function featIndex(f) {
  if (f[F_COUNT] <= 0) return -1;
  for (var i = 0; i < N_FEATS; i++) {
    if (FEATS[i][F_COUNT] > 0 && FEATS[i][F_START] == f[F_START]) return i;
  }
  return -1;
}

function addNodeStart() { NODE_FIRST[nNodes] = nStops; }
function addStop(fi, p) {
  STOP_F[nStops] = fi; STOP_P[nStops] = p; STOP_N[nStops] = nNodes; nStops++;
}
function addNodeEnd() {
  NODE_CNT[nNodes] = nStops - NODE_FIRST[nNodes];
  if (NODE_CNT[nNodes] > 0) nNodes++;
}

// 1 if strand fi already has a stop within 0.02 of position p
function hasStopNear(fi, p) {
  for (var s = 0; s < nStops; s++) {
    if (STOP_F[s] == fi && abs(STOP_P[s] - p) < 0.02) return 1;
  }
  return 0;
}

// The stop next to stop s along its strand (side -1 or +1), or -1 at an end
function neighbour(s, side) {
  var fi = STOP_F[s];
  var r = STOP_RANK[s] + side;
  if (r < 0 || r >= FEAT_NS[fi]) return -1;
  return ORDER[FEAT_FIRST[fi] + r];
}

// DIST[n] = hops from node src (999 = unreachable)
function bfs(src) {
  for (var i = 0; i < nNodes; i++) DIST[i] = 999;
  DIST[src] = 0;
  QUEUE[0] = src;
  var qh = 0; var qt = 1;
  while (qh < qt) {
    var n = QUEUE[qh]; qh++;
    for (var s = NODE_FIRST[n]; s < NODE_FIRST[n] + NODE_CNT[n]; s++) {
      for (var side = -1; side <= 1; side += 2) {
        var t = neighbour(s, side);
        if (t >= 0 && DIST[STOP_N[t]] == 999) {
          DIST[STOP_N[t]] = DIST[n] + 1;
          QUEUE[qt] = STOP_N[t]; qt++;
        }
      }
    }
  }
}

// ---- Build the graph once, at load (the same on every board) ----
// (In a function so its loop variables don't use up globals.)
function buildGraph() {
  for (var j = 0; j < JUNCTIONS.length; j++) {
    var jn = JUNCTIONS[j];
    if (nNodes >= MAX_NODES) break;
    addNodeStart();
    for (var k = 0; k < jn.length; k += 2) {
      var fi = featIndex(jn[k]);
      if (fi >= 0 && nStops < MAX_STOPS) addStop(fi, jn[k + 1]);
    }
    addNodeEnd();
  }
  for (var f = 0; f < N_FEATS; f++) {
    FEAT_LEN[f] = max(1, FEATS[f][F_COUNT] - 1);
    if (FEATS[f][F_COUNT] <= 0) continue;
    for (var e = 0; e <= 1; e++) {        // strand ends become dead ends
      if (!hasStopNear(f, e) && nNodes < MAX_NODES && nStops < MAX_STOPS) {
        addNodeStart(); addStop(f, e); addNodeEnd();
      }
    }
  }
  // Sort each strand's stops by position.
  var o = 0;
  for (var g = 0; g < N_FEATS; g++) {
    FEAT_FIRST[g] = o;
    for (var s = 0; s < nStops; s++) {
      if (STOP_F[s] != g) continue;
      var i = o;
      while (i > FEAT_FIRST[g] && STOP_P[ORDER[i - 1]] > STOP_P[s]) {
        ORDER[i] = ORDER[i - 1]; i--;
      }
      ORDER[i] = s; o++;
    }
    FEAT_NS[g] = o - FEAT_FIRST[g];
    for (var r = 0; r < FEAT_NS[g]; r++) STOP_RANK[ORDER[FEAT_FIRST[g] + r]] = r;
  }
  // Destinations come from the largest connected part, so a trip can always
  // get there (a newly counted strand with no crossings yet is its own part).
  var bestSize = 0; var bestSrc = 0;
  for (var n = 0; n < nNodes; n++) {
    bfs(n);
    var size = 0;
    for (var m = 0; m < nNodes; m++) if (DIST[m] < 999) size++;
    if (size > bestSize) { bestSize = size; bestSrc = n; }
  }
  bfs(bestSrc);
  for (var q = 0; q < nNodes; q++) {
    if (DIST[q] < 999) { MAIN[nMain] = q; nMain++; }
  }
}
buildGraph();

// ---- Trip planning (per slot; the same on every board) ----
var plannedSlot = -1; var plannedN = -1;
var fromNode = 0; var departFrac = 0;

// Where the spot rests after slot j's trip
function destOf(j) {
  prngSeed(j + 1);
  prng(1); prng(1); prng(1); prng(1);   // early draws track the seed; skip them
  return MAIN[floor(prng(nMain))];
}

// Picks a neighbour of node cur at random. wander = any neighbour (except the
// one we came from, unless it's the only way); otherwise only neighbours
// closer to the target. Fills PATH_A/PATH_B for segment nPath; returns the
// next node, or -1 if there's no choice.
function step(cur, prevNode, wander) {
  var count = 0;
  for (var pass = 0; pass < 2; pass++) {
    var pick = pass ? floor(prng(count)) : -1;
    var c = 0;
    for (var s = NODE_FIRST[cur]; s < NODE_FIRST[cur] + NODE_CNT[cur]; s++) {
      for (var side = -1; side <= 1; side += 2) {
        var t = neighbour(s, side);
        if (t < 0) continue;
        var m = STOP_N[t];
        var ok = wander ? m != prevNode : DIST[m] < DIST[cur];
        if (!ok) continue;
        if (pass && c == pick) { PATH_A[nPath] = s; PATH_B[nPath] = t; return m; }
        c++;
      }
    }
    count = c;
    if (count == 0) {
      if (!wander) return -1;
      // Dead end: turning back is the only way.
      for (var s2 = NODE_FIRST[cur]; s2 < NODE_FIRST[cur] + NODE_CNT[cur]; s2++) {
        for (var side2 = -1; side2 <= 1; side2 += 2) {
          var t2 = neighbour(s2, side2);
          if (t2 >= 0) { PATH_A[nPath] = s2; PATH_B[nPath] = t2; return STOP_N[t2]; }
        }
      }
      return -1;
    }
  }
  return -1;
}

function planTrip(slot, nSlots) {
  fromNode = destOf(mod(slot - 1, nSlots));   // wraps with the clock, so no jump
  var to = destOf(slot);
  prngSeed(slot + 5001);
  prng(1); prng(1); prng(1); prng(1);
  departFrac = prng(1);
  nPath = 0;
  if (nMain < 2) return;
  bfs(to);
  var cur = fromNode; var prevNode = -1; var detours = DETOURS; var cum = 0;
  while (nPath < MAX_PATH && (cur != to || nPath < MIN_HOPS)) {
    var roll = prng(1);     // always drawn, so every board draws the same sequence
    var wander = cur == to || (detours > 0 && roll < 0.3);
    var next = step(cur, prevNode, wander);
    if (next < 0) break;
    if (DIST[next] >= DIST[cur] && cur != to) detours--;
    var s = PATH_A[nPath]; var t = PATH_B[nPath];
    cum += abs(STOP_P[t] - STOP_P[s]) * FEAT_LEN[STOP_F[s]];
    PATH_CUM[nPath] = cum;
    nPath++;
    prevNode = cur; cur = next;
  }
}

// ---- Per-frame state ----
var spotF = 0; var spotPx = 0; var spotDir = 1;
var rAhead = 1; var rBehind = 1; var spotBright = 1;
var drift = 0;
var bgR = 0; var bgG = 0; var bgB = 0;       // background colour at brightness 1
var spR = 1; var spG = 1; var spB = 1;       // spot colour
var cR = 0; var cG = 0; var cB = 0;          // output of hsvToRgb()

function hsvToRgb(h, s, v) {
  h = frac(h) * 6;
  var i = floor(h); var f = h - i;
  var p = v * (1 - s); var q = v * (1 - s * f); var t = v * (1 - s * (1 - f));
  if (i == 0) { cR = v; cG = t; cB = p; }
  else if (i == 1) { cR = q; cG = v; cB = p; }
  else if (i == 2) { cR = p; cG = v; cB = t; }
  else if (i == 3) { cR = p; cG = q; cB = v; }
  else if (i == 4) { cR = t; cG = p; cB = v; }
  else { cR = v; cG = p; cB = q; }
}

// Kaleidoscope (EYE_1/EYE_2, unmapped) default; TEST strand off. See contract s3.3.
function kaleidoscope(index) {
  var f = inFeature(EYE_1, index) ? EYE_1 : EYE_2;
  if (!inFeature(f, index)) { hsv(0, 0, 0); return; }
  hsv(featurePos(f, index) + time(8 / 65.536), 1, 0.8);
}

export function beforeRender(delta) {
  // --- keep: builds this controller's tables once ---
  var id = nodeId();                      // A=0 ... F=5
  if (tagsBuiltFor != id) {
    NODE_OFFSET = BOARD_OFFSET[id];
    buildTags();
    tagsBuiltFor = id;
  }
  // --- your per-frame code ---
  if (pixBuiltFor != id) {                // which strand each pixel is on, and where
    FID.mutate((v) => -1);
    for (var fi = 0; fi < N_FEATS; fi++) {
      var f = FEATS[fi];
      var a = max(f[F_START], NODE_OFFSET);
      var b = min(f[F_END], NODE_OFFSET + pixelCount - 1);
      for (var i = a; i <= b; i++) {
        FID[i - NODE_OFFSET] = fi;
        PPX[i - NODE_OFFSET] = featurePos(f, i) * FEAT_LEN[fi];
      }
    }
    pixBuiltFor = id;
  }

  // Slots: a whole number of them per loop of the clock (as in example 05).
  var nSlots = max(1, floor(CLOCK_SECONDS / slotSecs));
  var slotLen = CLOCK_SECONDS / nSlots;
  var cyc = time(10) * nSlots;
  var slot = floor(cyc);
  var age = (cyc - slot) * slotLen;
  if (slot != plannedSlot || nSlots != plannedN) {
    planTrip(slot, nSlots);
    plannedSlot = slot; plannedN = nSlots;
  }

  // Where along the trip: rest, travel (eased at both ends), rest.
  var total = nPath > 0 ? PATH_CUM[nPath - 1] : 0;
  var travel = max(0.1, min(total / speed, slotLen - MIN_REST - END_PAD));
  var depart = MIN_REST + departFrac * max(0, slotLen - MIN_REST - END_PAD - travel);
  var u = clamp((age - depart) / travel, 0, 1);
  var moving = smoothstep(0, 0.08, u) * (1 - smoothstep(0.92, 1, u));
  var stopA = NODE_FIRST[fromNode]; var stopB = stopA; var w = 0;
  if (nPath > 0) {
    var dist = (0.35 * u + 0.65 * smoothstep(0, 1, u)) * total;
    var seg = 0;
    while (seg < nPath - 1 && PATH_CUM[seg] < dist) seg++;
    var segStart = seg > 0 ? PATH_CUM[seg - 1] : 0;
    stopA = PATH_A[seg]; stopB = PATH_B[seg];
    w = clamp((dist - segStart) / max(0.01, PATH_CUM[seg] - segStart), 0, 1);
  }
  spotF = STOP_F[stopA];
  var len = FEAT_LEN[spotF];
  spotPx = mix(STOP_P[stopA], STOP_P[stopB], w) * len;
  if (nPath > 0) spotDir = STOP_P[stopB] >= STOP_P[stopA] ? 1 : -1;
  // A little fidget along the strand, mostly while resting.
  spotPx = clamp(spotPx + (1 - moving) * 1.5 * (wave(time(3.7 / 65.536)) * 2 - 1), 0, len);

  // Breathing: two sides on their own rhythms, so it's never symmetrical;
  // a trailing tail while it travels.
  var b1 = wave(time(4.3 / 65.536));
  var b2 = wave(time(6.1 / 65.536));
  var b3 = wave(time(2.9 / 65.536));
  rAhead = spotSize * (0.75 + 0.35 * b1 + 0.1 * b3) * (1 - 0.15 * moving);
  rBehind = spotSize * (0.75 + 0.35 * b2 + 0.1 * (1 - b3)) * (1 + 0.8 * moving);
  spotBright = spotV * (0.85 + 0.15 * b1);

  // How far the spot is from where it enters each strand: its own strand,
  // plus any strand that crosses it within reach.
  for (var g = 0; g < N_FEATS; g++) ENTRY_D[g] = 999;
  ENTRY_D[spotF] = 0; ENTRY_P[spotF] = spotPx;
  var reach = max(rAhead, rBehind) * (1 + LUMP);
  for (var r = 0; r < FEAT_NS[spotF]; r++) {
    var s = ORDER[FEAT_FIRST[spotF] + r];
    var dn = abs(STOP_P[s] * len - spotPx);
    if (dn >= reach) continue;
    var n = STOP_N[s];
    for (var t = NODE_FIRST[n]; t < NODE_FIRST[n] + NODE_CNT[n]; t++) {
      var tg = STOP_F[t];
      if (tg != spotF && dn < ENTRY_D[tg]) { ENTRY_D[tg] = dn; ENTRY_P[tg] = STOP_P[t] * FEAT_LEN[tg]; }
    }
  }

  hsvToRgb(bgH, bgS, 1); bgR = cR; bgG = cG; bgB = cB;
  hsvToRgb(spotH, spotS, 1); spR = cR; spG = cG; spB = cB;
  drift = time(10) * 40;   // noise drifts slowly; one jump every 11 minutes
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  var fi = FID[index];
  var px = PPX[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }

  var nz = perlin(x * NOISE_K, y * NOISE_K, z * NOISE_K + drift, 0);
  var bv = bgV * (0.7 + 0.3 * nz);
  var k = 0;
  if (fi >= 0 && ENTRY_D[fi] < 999) {
    var off = px - ENTRY_P[fi];
    var r = (off * spotDir >= 0 ? rAhead : rBehind) * (1 + LUMP * nz);
    var d = ENTRY_D[fi] + abs(off);
    if (d < r) k = smoothstep(0, 1, 1 - d / r);
  }
  if (k <= 0) { rgb(bgR * bv, bgG * bv, bgB * bv); return; }
  var hot = k * k * k * 0.5;               // the centre runs hotter, towards white
  var sv = spotBright * k;
  var rr = mix(spR, 1, hot) * sv;
  var gg = mix(spG, 1, hot) * sv;
  var bl = mix(spB, 1, hot) * sv;
  var keep = (1 - k) * bv;                 // background fades out under the spot
  rgb(rr + bgR * keep, gg + bgG * keep, bl + bgB * keep);
}
