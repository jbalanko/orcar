// RANDOM SPOT -- colour creeps out over the whale from a random spot, again
// and again, each new colour spreading over the last.
//
// Looks:    a spot somewhere on the whale's surface lights up white and
//           slowly spreads in every direction. The creeping front is a soft
//           white edge with a slightly ragged, organic outline; behind it the
//           light turns to a new colour, and the further it has travelled the
//           more that colour shifts, so the first-lit area ends up a
//           different shade from the last. Ahead of the front the whale still
//           shows the previous colour. Once the whole whale is covered it
//           holds for a moment, then the next spot starts somewhere else, in
//           another colour, without going dark.
// Sync:     safe -- each spot's place and colour are a function of a slot
//           number from time() (computed in beforeRender, jittered with a
//           seeded prng()); the front is a pure function of time() and
//           position, and the ragged edge is perlin() in world space.
// Try:      "Spread Time" is how long the colour takes to cover the whale;
//           "Hold Time" is how long it stays fully covered before the next
//           spot; "Colour Gradient" is how far the hue drifts from the spot
//           to the far end; turn on "Fixed Colour" to use the picker's hue
//           instead of a new colour each time (then only the white front and
//           the gradient move).

var growSecs = 20;    // slider: seconds for the front to cover the whale
var holdSecs = 2;     // slider: seconds fully covered before the next spot
var hueSpread = 0.2;  // slider: hue drift from the spot to the far end
var fixedHue = 0;     // toggle: 1 = use pickHue every cycle
var pickHue = 0.52;   // picker hue

export function sliderSpreadTime(v) { growSecs = mix(8, 45, clamp(v, 0, 1)); }
export function sliderHoldTime(v) { holdSecs = mix(0, 10, clamp(v, 0, 1)); }
export function sliderColourGradient(v) { hueSpread = mix(0, 0.45, clamp(v, 0, 1)); }
export function toggleFixedColour(on) { fixedHue = on; }
export function hsvPickerColour(h, s, v) { pickHue = h; }

// Where spots can land: on a rough arch around the body axis, the size of the
// mid-body ribs, between just behind the nose and the end of the body, from
// the starboard side over the top to the port side.
var ARCH_R = nLen(44);
var SPOT_Y_LO = mix(NOSE_TIP[1], BODY_TAIL_Y, 0.2);
var SPOT_Y_HI = BODY_TAIL_Y;

var SOFT = nLen(10);      // leading edge: whitens over 10 inches
var WHITE_W = nLen(18);   // white band behind the front
var WOBBLE = nLen(10);    // how ragged the front outline is
var NOISE_K = 7;          // ragged-edge noise scale (cells per world unit)
var BASE_V = 0.6;         // brightness of a settled colour; the front is 1

// time(10) loops every 655.36 s; the longest clock used here.
var CLOCK_SECONDS = 655.36;

// Output of pickSpot()
var tx = 0; var ty = 0; var tz = 0; var tHue = 0; var tReach = 1;

var sx = 0; var sy = 0; var sz = 0;      // the spreading spot
var baseHue = 0; var reach = 1;
var psx = 0; var psy = 0; var psz = 0;   // the previous spot (fully spread)
var pHue = 0; var pReach = 1;
var radius = 0;       // current front distance from the spot
var drift = 0;        // slow time offset for the ragged edge

// Kaleidoscope (EYE_1/EYE_2, unmapped) default; TEST strand off. See contract s3.3.
function kaleidoscope(index) {
  var f = inFeature(EYE_1, index) ? EYE_1 : EYE_2;
  if (!inFeature(f, index)) { hsv(0, 0, 0); return; }
  hsv(featurePos(f, index) + time(8 / 65.536), 1, 0.8);
}

// Spot number s: place and colour. Positions and hues step through
// low-discrepancy sequences, so consecutive spots land well apart and differ
// in colour, plus a little seeded jitter. The first few prng() draws after a
// seed track the seed closely, so they're thrown away.
function pickSpot(s) {
  prngSeed(s + 1);
  prng(1); prng(1); prng(1); prng(1);
  var u = frac(s * 0.7548777 + prng(0.2));    // along the body
  var a = frac(s * 0.5698403 + prng(0.2));    // around the arch
  var h = frac(s * 0.618034 + prng(0.12));
  ty = mix(SPOT_Y_LO, SPOT_Y_HI, u);
  a = mix(-0.2, 1.2, a) * PI;                  // starboard, over the top, to port
  tx = MID_X - cos(a) * ARCH_R;
  tz = max(Z_LO, BODY_AXIS_Z + sin(a) * ARCH_R);
  tHue = fixedHue ? pickHue : h;
  // Farthest corner of the bounding box, so the front always covers everything.
  tReach = hypot3(max(tx - X_LO, X_HI - tx), max(ty - Y_LO, Y_HI - ty), max(tz - Z_LO, Z_HI - tz)) + WOBBLE;
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
  var cycle = growSecs + holdSecs;
  var nSlots = floor(CLOCK_SECONDS / cycle);
  var cyc = time(10) * nSlots;
  var slot = floor(cyc);
  var age = (cyc - slot) * (CLOCK_SECONDS / nSlots);   // seconds into this cycle

  pickSpot(mod(slot - 1, nSlots));        // wraps with the clock, so no jump
  psx = tx; psy = ty; psz = tz; pHue = tHue; pReach = tReach;
  pickSpot(slot);
  sx = tx; sy = ty; sz = tz; baseHue = tHue; reach = tReach;

  // Front: slow start, steady creep, gentle arrival.
  var p = clamp(age / growSecs, 0, 1);
  p = 0.5 * p + 0.5 * smoothstep(0, 1, p);
  radius = -SOFT + p * (reach + SOFT);

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
  var behind = radius - d - WOBBLE * perlin(x * NOISE_K, y * NOISE_K, z * NOISE_K + drift, 0);
  if (behind >= 0) {
    // Inside the new colour: white just behind the front, then the colour.
    var w = 1 - smoothstep(0, WHITE_W, behind);
    hsv(baseHue + hueSpread * clamp(d / reach, 0, 1), 1 - w, BASE_V + (1 - BASE_V) * w);
    return;
  }
  // Ahead of the front: the previous colour, whitening as the front arrives.
  var pd = hypot3(x - psx, y - psy, z - psz);
  var e = smoothstep(-SOFT, 0, behind);
  hsv(pHue + hueSpread * clamp(pd / pReach, 0, 1), 1 - e, BASE_V + (1 - BASE_V) * e);
}
