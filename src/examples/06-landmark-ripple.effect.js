// 06 LANDMARK RIPPLE -- rings of light expand from a point on the body
// (dorsal tip, nose, either pectoral or fluke tip, or the tail end of the
// backbone) like sonar pings.
//
// Shows:    distance in real inches from a landmark (hypot3 + nLen),
//           animating with time() instead of accumulating delta, and a
//           "pick from a list" slider.
// Looks:    bright rings spread over the whole sculpture, crossing board
//           boundaries without a seam.
// Sync:     safe -- ring radius is a function of time() only.
// Try:      add a BLOWHOLE landmark to the template and ping from it.

var SOURCES = [DORSAL_TIP, NOSE_TIP, LEFT_PEC_TIP, RIGHT_PEC_TIP, TAIL_END, FLUKE_TIP_LEFT, FLUKE_TIP_RIGHT];
var srcSel = 0;
export function sliderSource(v) { srcSel = min(SOURCES.length - 1, floor(v * SOURCES.length)); }

var speedIn = 90;                   // ring speed, inches per second
export function sliderSpeed(v) { speedIn = mix(30, 240, v); }

var hue = 0.52;
export function hsvPickerColour(h, s, v) { hue = h; }

var PERIOD = 3.2;                   // seconds between pings
var RING = nLen(14);                // ring thickness: 14 inches
var radius = 0;                     // current ring radius (normalized)
var fade = 1;
var sx = 0; var sy = 0; var sz = 0; // current source point

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
  var age = time(PERIOD / 65.536) * PERIOD;      // seconds since the last ping
  radius = nLen(age * speedIn);
  fade = 1 - age / PERIOD;
  var p = SOURCES[srcSel];
  sx = p[0]; sy = p[1]; sz = p[2];
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }

  var d = hypot3(x - sx, y - sy, z - sz);        // normalized distance to the source
  var off = abs(d - radius) / RING;              // 0 on the ring, 1 at its edge
  var v = off < 1 ? (1 - off) * (1 - off) * fade : 0;
  hsv(hue + d * 0.3, 1 - v * 0.5, max(v, 0.02)); // whitens at the crest; faint base glow
}
