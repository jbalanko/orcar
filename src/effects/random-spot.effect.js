// RANDOM SPOT -- colour creeps out over the whale from a random spot.
//
// Looks:    the whale starts dark. A spot somewhere on its surface lights up
//           and slowly spreads in every direction. The creeping front is a
//           soft white edge with a slightly ragged, organic outline; behind
//           it the light turns to a colour, and the further it has travelled
//           the more that colour shifts, so the first-lit area ends up a
//           different shade from the last. Once the whole whale is covered it
//           holds for a moment, fades to black, and a new spot (and, by
//           default, a new colour) starts somewhere else.
// Sync:     safe -- the spot and colour come from prng() seeded with a slot
//           number from time() in beforeRender; the front is a pure function
//           of time() and position, and the ragged edge is perlin() in world
//           space.
// Try:      "Spread Time" is how long the colour takes to cover the whale;
//           "Hold Time" is how long it stays fully lit; "Colour Gradient" is
//           how far the hue drifts from the spot to the far end; turn on
//           "Fixed Colour" to use the picker's hue instead of a random one.

var growSecs = 20;    // slider: seconds for the front to cover the whale
var holdSecs = 4;     // slider: seconds fully covered before the fade
var hueSpread = 0.2;  // slider: hue drift from the spot to the far end
var fixedHue = 0;     // toggle: 1 = use pickHue every cycle
var pickHue = 0.52;   // picker hue

export function sliderSpreadTime(v) { growSecs = mix(8, 45, clamp(v, 0, 1)); }
export function sliderHoldTime(v) { holdSecs = mix(1, 12, clamp(v, 0, 1)); }
export function sliderColourGradient(v) { hueSpread = mix(0, 0.45, clamp(v, 0, 1)); }
export function toggleFixedColour(on) { fixedHue = on; }
export function hsvPickerColour(h, s, v) { pickHue = h; }

var FADE_SECS = 2.5;   // fade to black after the hold
var PAUSE_SECS = 1;    // dark gap before the next spot

// Where spots can land: on a rough arch around the body axis, the size of the
// mid-body ribs, between just behind the nose and the end of the body.
var ARCH_R = nLen(44);
var SPOT_Y_LO = mix(NOSE_TIP[1], BODY_TAIL_Y, 0.2);
var SPOT_Y_HI = BODY_TAIL_Y;

var SOFT = nLen(8);       // leading edge: fades in over 8 inches
var WHITE_W = nLen(18);   // white band behind the front
var WOBBLE = nLen(10);    // how ragged the front outline is
var NOISE_K = 7;          // ragged-edge noise scale (cells per world unit)

// time(10) loops every 655.36 s; the longest clock used here.
var CLOCK_SECONDS = 655.36;

var sx = 0; var sy = 0; var sz = 0;   // this cycle's spot
var reach = 1;        // distance from the spot to the farthest corner of the box
var radius = 0;       // current front distance from the spot
var baseHue = 0;      // this cycle's colour
var fade = 1;         // overall brightness this frame
var drift = 0;        // slow time offset for the ragged edge

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
  // Fit a whole number of cycles into the clock loop (as in example 05).
  var cycle = growSecs + holdSecs + FADE_SECS + PAUSE_SECS;
  var nSlots = floor(CLOCK_SECONDS / cycle);
  var cyc = time(10) * nSlots;
  var slot = floor(cyc);
  var age = (cyc - slot) * (CLOCK_SECONDS / nSlots);   // seconds into this cycle

  // Same seed, same draws, same order on every board.
  prngSeed(slot + 1);
  var u = prng(1);
  var a = mix(-0.2, 1.2, prng(1)) * PI;   // around the arch: starboard, over the top, to port
  var h = prng(1);
  sy = mix(SPOT_Y_LO, SPOT_Y_HI, u);
  sx = MID_X - cos(a) * ARCH_R;
  sz = max(Z_LO, BODY_AXIS_Z + sin(a) * ARCH_R);
  baseHue = fixedHue ? pickHue : h;

  // Farthest corner of the bounding box, so the front always covers everything.
  var fx = max(sx - X_LO, X_HI - sx);
  var fy = max(sy - Y_LO, Y_HI - sy);
  var fz = max(sz - Z_LO, Z_HI - sz);
  reach = hypot3(fx, fy, fz) + WOBBLE;

  // Front: slow start, steady creep, gentle arrival.
  var p = clamp(age / growSecs, 0, 1);
  p = 0.5 * p + 0.5 * smoothstep(0, 1, p);
  radius = -SOFT + p * (reach + SOFT);

  var fadeAge = age - growSecs - holdSecs;
  fade = fadeAge <= 0 ? 1 : max(0, 1 - fadeAge / FADE_SECS);
  drift = time(20 / 65.536) * 4;   // noise drifts slowly; loops every 20 s
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }

  var d = hypot3(x - sx, y - sy, z - sz);
  d = d + WOBBLE * perlin(x * NOISE_K, y * NOISE_K, z * NOISE_K + drift, 0);
  var behind = radius - d;              // how far the front has passed this pixel
  if (behind < -SOFT || fade <= 0) { hsv(0, 0, 0); return; }

  var v = smoothstep(-SOFT, 0, behind);           // soft leading edge
  var w = 1 - smoothstep(0, WHITE_W, behind);      // 1 = white at the front
  var hue = baseHue + hueSpread * clamp(d / reach, 0, 1);
  hsv(hue, 1 - w, v * (0.6 + 0.4 * w) * fade);
}
