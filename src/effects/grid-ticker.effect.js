// GRID TICKER -- words and symbols stream tail to nose along the port flank,
// drawn on the grid where the spines cross the ribs, like an LCD.
//
// Shows:    treating the rib/spine lattice as a dot-matrix display. Each
//           crossing (rib R3..R10 x spine S1..S5 / S11..S7) is one "dot";
//           a lit dot glows where it sits, and two lit neighbours light
//           the rib or spine segment between them, so letters read as
//           strokes. Glyphs are 5 dots tall (bit 0 = S1/S11 at the bottom,
//           bit 4 = S5/S7 at the top).
// Looks:    "HELLO", "ORCA", hearts, a smiley, "I <3 ORCA" scroll from the
//           tail towards the head on the port side only, over a faint glow
//           of the unlit grid; the starboard side shows just that faint
//           grid. Seen from port the nose is on the left, so the text moves
//           right to left like a normal ticker. Front To Back reverses it
//           (nose to tail; the text then moves left to right and words
//           arrive last letter first). Steps snap from rib to rib with a
//           short crossfade (Smooth Scroll).
// Sync:     safe -- scroll position is a pure function of time() and controls.
// Parts:    ribs R3..R10 and the B spines are the display. Dorsal, pectorals,
//           S6C and anything else glow with the dim grid colour.
//           Kaleidoscope (EYE_1/EYE_2) default; TEST off.
// Safety:   speed is capped at 4 ribs per second and every step crossfades,
//           so no area flips faster than 3 Hz.
// Note:     the grid geometry below (rib planes and where each spine crosses
//           each rib, in map inches) is measured from the current maps. Ribs
//           R1, R2 and R11+ aren't part of the display yet; if a rib or spine
//           moves in the DXF, re-measure these tables.

// --- the display grid, in map inches (starboard and port mirror) ---
var NCOL = 8;                                    // R3 .. R10, nose to tail
var NROW = 5;                                    // S1..S5 (starboard) = S11..S7 (port)
var COL_RIBS = [R3, R4, R5, R6, R7, R8, R9, R10];
var ROW_SPINES_STBD = [S1B, S2B, S3B, S4B, S5B];   // bottom -> top
var ROW_SPINES_PORT = [S11B, S10B, S9B, S8B, S7B];
var RIB_Y_IN = [55, 79.4, 105.3, 129.3, 153.3, 177.3, 201.3, 220];   // R10 is tilted; 220 = mid-height
// Height (z) where each spine crosses each rib: 5 rows per rib, bottom first.
// R3 has no S1/S5 and R10 no S5; those entries are extrapolated.
var SPINE_Z_IN = [
  40,   56.7, 74.3, 85.0, 92,     // R3
  21.5, 40.3, 62.4, 78.5, 87.8,   // R4
  14.8, 34.4, 53.3, 74.0, 86.2,   // R5
  10.0, 30.4, 49.9, 71.0, 84.2,   // R6
  9.2,  28.6, 49.9, 69.7, 84.1,   // R7
  9.2,  29.8, 50.2, 69.8, 83.7,   // R8
  13.7, 31.9, 53.3, 70.4, 79.7,   // R9
  19.2, 37.4, 57.5, 71.7, 80      // R10
];
var RIB_Y = array(NCOL);
var SPINE_Z = array(NCOL * NROW);
for (var i = 0; i < NCOL; i++) RIB_Y[i] = nY(RIB_Y_IN[i]);
for (var i = 0; i < NCOL * NROW; i++) SPINE_Z[i] = nZ(SPINE_Z_IN[i]);

// --- the font tape: one 5-bit column per entry (bit 4 = top row) ---
// Messages, each followed by 3 blank columns:
//   0 HELLO   1 ORCA   2 three hearts   3 HI + smiley   4 I <3 ORCA
// Font (top row first):  H X.X X.X XXX X.X X.X   E XXX X.. XXX X.. XXX
//   L X.. X.. X.. X.. XXX   O XXX X.X X.X X.X XXX   R XXX X.X XXX XX. X.X
//   C XXX X.. X.. X.. XXX   A XXX X.X XXX X.X X.X   I XXX .X. .X. .X. XXX
//   heart .X.X. XXXXX XXXXX .XXX. ..X..   smiley .X.X. .X.X. ..... X...X XXXXX
var TAPE = [31,4,31,0,31,21,21,0,31,1,1,0,31,1,1,0,31,17,31,0,0,0,0,
  31,17,31,0,31,22,29,0,31,17,17,0,31,20,31,0,0,0,0,
  12,30,15,30,12,0,0,12,30,15,30,12,0,0,12,30,15,30,12,0,0,0,0,
  31,4,31,0,17,31,17,0,0,3,25,1,25,3,0,0,0,0,
  17,31,17,0,0,12,30,15,30,12,0,0,31,17,31,0,31,22,29,0,31,17,17,0,31,20,31,0,0,0,0];
var MSG_START = [0, 23, 42, 65, 83];
var MSG_LEN = [23, 19, 23, 18, 31];
var NMSG = 5;

// --- controls ---
var msgPick = 4;       // slider 0..1 -> which message (when not cycling)
var cycle = 1;         // toggle: play every message in turn
var speed = 2;         // slider 0..1 -> 1 .. 4 ribs per second
var textH = 0.5; var textS = 0.8; var textV = 1;   // picker: text colour (aqua)
var rainbow = 0;       // toggle: letters shift through the rainbow
var smooth = 0.4;      // slider 0..1 -> crossfade length, a hard step .. a continuous fade
var gridGlow = 0.12;   // slider 0..1 -> brightness of the unlit grid
var frontToBack = 0;   // toggle: scroll nose -> tail instead of tail -> nose

export function sliderMessage(v) { msgPick = clamp(floor(v * NMSG), 0, NMSG - 1); }
export function toggleCycleMessages(on) { cycle = on; }
export function sliderScrollSpeed(v) { speed = 1 + 3 * clamp(v, 0, 1); }
export function hsvPickerTextColour(h, s, v) { textH = h; textS = s; textV = v; }
export function toggleRainbow(on) { rainbow = on; }
export function sliderSmoothScroll(v) { smooth = clamp(v, 0, 1); }
export function sliderGridGlow(v) { gridGlow = clamp(v, 0, 1); }
export function toggleFrontToBack(on) { frontToBack = on; }

// --- per-pixel tables (LOCAL index) ---
// KIND: 0..7 = on rib column c; 10..14 = on spine row r (side from x); -1 = not on the grid
// GRID: continuous grid coordinate along the strand -- row (v) for ribs, column (u)
//       for spines -- computed from x/y/z on the first render (NOT_YET until then)
var KIND = array(pixelCount);
var GRID = array(pixelCount);
var NOT_YET = -99;
var builtFor = -1;

function markFeature(f, k, lo, hi) {
  if (f[F_COUNT] == 0) return;                   // not installed
  for (var i = max(f[F_START], lo); i <= min(f[F_END], hi); i++) KIND[i - lo] = k;
}

function buildGridTables() {
  KIND.mutate((v) => -1);
  GRID.mutate((v) => NOT_YET);
  var lo = NODE_OFFSET;
  var hi = NODE_OFFSET + pixelCount - 1;
  for (var c = 0; c < NCOL; c++) markFeature(COL_RIBS[c], c, lo, hi);
  for (var r = 0; r < NROW; r++) {
    markFeature(ROW_SPINES_STBD[r], 10 + r, lo, hi);
    markFeature(ROW_SPINES_PORT[r], 10 + r, lo, hi);
  }
}

// Rib pixel at height z on column c -> row coordinate (0 at S1 .. 4 at S5).
function ribRow(c, z) {
  var b = c * NROW;
  if (z < SPINE_Z[b]) return (z - SPINE_Z[b]) / (SPINE_Z[b + 1] - SPINE_Z[b]);
  for (var r = 0; r < NROW - 1; r++) {
    if (z < SPINE_Z[b + r + 1]) return r + (z - SPINE_Z[b + r]) / (SPINE_Z[b + r + 1] - SPINE_Z[b + r]);
  }
  return NROW - 1 + (z - SPINE_Z[b + NROW - 1]) / (SPINE_Z[b + NROW - 1] - SPINE_Z[b + NROW - 2]);
}

// Spine pixel at y -> column coordinate (0 at R3 .. 7 at R10).
function spineCol(y) {
  if (y < RIB_Y[0]) return (y - RIB_Y[0]) / (RIB_Y[1] - RIB_Y[0]);
  for (var c = 0; c < NCOL - 1; c++) {
    if (y < RIB_Y[c + 1]) return c + (y - RIB_Y[c]) / (RIB_Y[c + 1] - RIB_Y[c]);
  }
  return NCOL - 1 + (y - RIB_Y[NCOL - 1]) / (RIB_Y[NCOL - 1] - RIB_Y[NCOL - 2]);
}

// --- per-frame dot brightness ---
// DOT[side * 70 + (c + 1) * 7 + (r + 1)] = 0..1, with a blank border of one
// column and one row all round so segment lookups never leave the array.
var DOT = array(140);
var tapeStart = 0; var tapeLen = 1;
var hueShift = 0;

function tapeBit(p, side, c, r) {
  var m;
  if (side && !frontToBack) m = mod(p - (NCOL - 1 - c), tapeLen);   // port, tail -> nose
  else {
    m = mod(p - c, tapeLen);                     // tape column now at rib c
    if (side) m = tapeLen - 1 - m;               // port: mirrored so letters aren't backwards
  }
  return (TAPE[tapeStart + m] >> r) & 1;
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
  if (builtFor != id) { buildGridTables(); builtFor = id; }
  // --- your per-frame code ---
  if (cycle) { tapeStart = 0; tapeLen = TAPE.length; }
  else { tapeStart = MSG_START[msgPick]; tapeLen = MSG_LEN[msgPick]; }

  // One loop of the tape takes tapeLen / speed seconds, the same on every board.
  var p = time(tapeLen / speed / 65.536) * tapeLen;
  var step = floor(p);
  var fr = p - step;
  var fade = smooth <= 0 ? (fr > 0.5) : clamp((fr - (1 - smooth)) / smooth, 0, 1);
  fade = fade * fade * (3 - 2 * fade);          // ease in and out

  for (var s = 1; s < 2; s++) {                 // port only; starboard dots stay 0
    for (var c = 0; c < NCOL; c++) {
      for (var r = 0; r < NROW; r++) {
        DOT[s * 70 + (c + 1) * 7 + r + 1] =
          mix(tapeBit(step, s, c, r), tapeBit(step + 1, s, c, r), fade);
      }
    }
  }
  hueShift = time(20 / 65.536);
}

var W = 0.35;    // how far along a segment a lone lit dot glows (fraction of a segment)

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  var kind = KIND[index];            // our own tables: LOCAL index too
  var g = GRID[index];
  if (kind >= 0 && g == NOT_YET) {
    g = kind < 10 ? ribRow(kind, z) : spineCol(y);
    GRID[index] = g;
  }
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }

  var lit = 0;
  if (kind >= 0) {
    var side = x > MID_X ? 70 : 0;
    var a; var b; var step;          // dot indices at each end of this segment
    if (kind < 10) {                 // rib: segment between rows
      g = clamp(g, -1, NROW - 0.001);
      step = floor(g);
      a = side + (kind + 1) * 7 + step + 1;
      b = a + 1;
    } else {                         // spine: segment between columns
      g = clamp(g, -1, NCOL - 0.001);
      step = floor(g);
      a = side + (step + 1) * 7 + kind - 9;
      b = a + 7;
    }
    var f = g - step;
    var da = DOT[a]; var db = DOT[b];
    lit = max(min(da, db), max(da * clamp(1 - f / W, 0, 1), db * clamp(1 - (1 - f) / W, 0, 1)));
  }

  var h = textH + rainbow * (y * 2 + hueShift);
  // Unlit grid: a faint tint of the text colour, like unlit LCD segments.
  hsv(h, textS, mix(gridGlow * 0.35, textV, lit));
}
