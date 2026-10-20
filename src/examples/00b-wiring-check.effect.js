// 00b WIRING CHECK -- does the template's idea of each board's pixels match
// the real strands? Run it on all six boards (it's a normal pattern; load it
// on the leader). It uses NO coordinates, so it works even if a map is wrong
// or missing.
//
// What you see on every board:
//   * Every feature gets its own solid colour, with its FIRST pixel white
//     and its LAST pixel black (so you can see where each strand starts and
//     ends, and which way it runs).
//   * RED, slowly blinking: pixels BEYOND what the template thinks this board
//     has (local index >= BOARD_TOTAL). The board's pixel count is bigger
//     than the template's -- usually a strand whose count is still 0 in the
//     template but which is installed and configured on the expander.
//   * MAGENTA, fast blinking: pixels drawn by render() instead of render3D().
//     If any appear, Pixelblaze falls back to render() for pixels the 3D map
//     doesn't cover.
//   * FROZEN (still showing the previous pattern): pixels this pattern never
//     draws at all. render3D() doesn't run for pixels past the end of the
//     board's map, so a too-short map freezes everything after its end.
//
// Numbers shown in the pattern's controls panel (per board):
//   Pixel Count      -- this board's configured pixel count
//   Template Total   -- what the template expects for this board (BOARD_TOTAL)
//   Map Pixels       -- how many pixels mapPixels() visited (should equal
//                       Pixel Count; less means the board's map is too short)
//   Last Drawn       -- highest local index render3D() was called with, +1
//
// Interpreting it:
//   Pixel Count > Template Total     -> fix counts in the template (and maps)
//   Map Pixels  < Pixel Count        -> the map loaded on this board is too
//                                       short: re-upload maps/pixelblaze_X.json
//   Colours sit on the wrong strand  -> wiring order or counts differ from the
//                                       template's BOARD_ lists
// Sync: n/a (diagnostic).

var ALL = [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14,
           S2A, S4A, S6A, S8A, S10A,
           S1B, S2B, S3B, S4B, S5B, S6B, S7B, S8B, S9B, S10B, S11B, S6C,
           FLUKE, DORSAL, LEFT_PECTORAL, RIGHT_PECTORAL, EYE_1, EYE_2, TEST];

var FEAT = array(pixelCount);     // local index -> position in ALL, or -1
var builtFor = -1;
var mapCount = 0;
var lastDrawn = 0;
var blinkSlow = 0;
var blinkFast = 0;

function countMapped(i, x, y, z) { mapCount = mapCount + 1; }
mapPixels(countMapped);

export function showNumberPixelCount() { return pixelCount; }
export function showNumberTemplateTotal() { return BOARD_TOTAL[nodeId()]; }
export function showNumberMapPixels() { return mapCount; }
export function showNumberLastDrawn() { return lastDrawn; }

function buildFeatureTable() {
  FEAT.mutate((v) => -1);
  var lo = NODE_OFFSET;
  var hi = NODE_OFFSET + pixelCount - 1;
  for (var k = 0; k < ALL.length; k++) {
    var f = ALL[k];
    for (var i = max(f[F_START], lo); i <= min(f[F_END], hi); i++) FEAT[i - lo] = k;
  }
}

export function beforeRender(delta) {
  // --- keep: builds this controller's tables once ---
  var id = nodeId();                      // A=0 ... F=5
  if (tagsBuiltFor != id) {
    NODE_OFFSET = BOARD_OFFSET[id];
    buildTags();
    tagsBuiltFor = id;
  }
  if (builtFor != id) { buildFeatureTable(); builtFor = id; }
  // --- your per-frame code ---
  blinkSlow = square(time(1.5 / 65.536), 0.5);    // 1.5 s cycle
  blinkFast = square(time(0.4 / 65.536), 0.5);    // 0.4 s cycle (< 3 Hz)
}

function drawFeature(local) {
  var k = FEAT[local];
  if (k < 0) {                                    // beyond the template's pixels
    hsv(0, 1, blinkSlow ? 1 : 0.15);
    return;
  }
  var f = ALL[k];
  var g = local + NODE_OFFSET;
  if (g == f[F_START]) { hsv(0, 0, 1); return; }  // first pixel: white
  if (g == f[F_END]) { hsv(0, 0, 0); return; }    // last pixel: black
  hsv(0.1 + 0.62 * frac(k * 0.6180339), 1, 0.6);  // distinct colour per feature (never red or magenta)
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  var local = index;
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (local + 1 > lastDrawn) lastDrawn = local + 1;
  drawFeature(local);
}

// Only used if Pixelblaze falls back to render() for some pixels
export function render(index) {
  hsv(0.83, 1, blinkFast ? 1 : 0.1);
}
