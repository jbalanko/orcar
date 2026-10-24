// SUBMERGE -- the whale slowly sinks into the ocean, then fades away.
//
// Looks:    the whale starts dark. A rippling water surface rises from the
//           bottom of the rib arches to the top of the sculpture; everything
//           below it is ocean blue (cyan near the surface, deeper blue lower
//           down) with slow caustic shimmer, and a bright foamy line marks the
//           waterline. Once the whale is fully under, it holds for a moment,
//           fades slowly to black, pauses in the dark, and starts again.
// Sync:     safe -- the water level, ripples and fade are pure functions of
//           time() and position; the shimmer is perlin() in world space.
// Try:      "Cycle Length" sets the whole loop (about 30 s .. 3 min);
//           "Ripples" sets how tall the surface waves are; "Water Angle"
//           tilts the water nose-to-tail (middle = level, left = the nose
//           goes under first, right = the tail goes under first).

var cycleSecs = 60;   // slider: seconds for rise + hold + fade + pause
var rippleAmt = 0.5;  // slider: surface wave height

export function sliderCycleLength(v) { cycleSecs = mix(30, 180, v); }
export function sliderRipples(v) { rippleAmt = v; }
// Tilt of the water plane, up to 50 degrees either way; 0.5 is level.
export function sliderWaterAngle(v) { slope = tan((clamp(v, 0, 1) - 0.5) * 2 * MAX_TILT); }

// Fractions of the cycle (they add up to 1)
var RISE = 0.72;      // water climbs from the bottom to over the top
var HOLD = 0.06;      // fully submerged
var FADE = 0.14;      // slow fade to black
// the rest (0.08) is a dark pause

var FOAM_W = nLen(8);           // thickness of the pale waterline band
var SOFT = nLen(18);            // feathered glow fading out above the surface
var Z_SPAN = Z_HI - Z_LO;
var Y_MID = (Y_LO + Y_HI) / 2;
var MAX_TILT = 50 * PI / 180;   // steepest water angle (radians)
var slope = 0;        // rise of the surface per unit of y (tail-ward); 0 = level
var tiltReach = 0;    // how far the tilt lifts/drops the surface at the ends

var level = 0;        // water surface height (world z) this frame
var fade = 1;         // overall brightness 0..1 this frame
var amp = 0;          // ripple height (world units)
var ph1 = 0;          // ripple phases
var ph2 = 0;
var ph3 = 0;
var flowA = 0;        // caustic drift
var flowB = 0;

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
  var t = time(cycleSecs / 65.536);               // 0..1 through the loop
  amp = nLen(mix(0.5, 8, rippleAmt));

  // Water level (at mid-body): from just below the base to clear over the
  // top, eased. A tilted surface needs to start lower and finish higher so
  // its low end clears the top and its high end starts below the base.
  tiltReach = abs(slope) * (Y_HI - Y_LO) / 2;
  var lo = Z_LO - tiltReach - amp - SOFT;
  var hi = Z_HI + tiltReach + amp + FOAM_W;
  if (t < RISE) {
    level = mix(lo, hi, smoothstep(0, 1, t / RISE));
    fade = 1;
  } else if (t < RISE + HOLD) {
    level = hi;
    fade = 1;
  } else if (t < RISE + HOLD + FADE) {
    level = hi;
    var f = 1 - (t - RISE - HOLD) / FADE;
    fade = f * f;                                 // eases out to black
  } else {
    level = lo;                                   // dark pause, ready to restart
    fade = 0;
  }

  // Ripples: a few crossing waves on whole-number laps, so they never jump.
  ph1 = time(3.1 / 65.536);
  ph2 = time(4.7 / 65.536);
  ph3 = time(6.3 / 65.536);

  // Caustic shimmer drifting through the water (wrap-safe, as in example 04).
  setPerlinWrap(256, 16, 16);
  flowA = time(40 / 65.536) * 16;
  flowB = time(67 / 65.536) * 16;
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }
  if (fade <= 0) { hsv(0, 0, 0); return; }

  // Rippling surface height at this pixel's spot
  var r = wave(x * 9 + ph1) + wave(y * 7 - ph2) + wave((x + y) * 5 + ph3);
  var surf = level + (y - Y_MID) * slope + (r / 1.5 - 1) * amp;   // r/1.5 - 1 is about -1..1
  var d = surf - z;                               // depth below the surface

  if (d < -SOFT) { hsv(0, 0, 0); return; }        // still above the water

  var dn = clamp(d / Z_SPAN, 0, 1);               // 0 at the surface .. 1 deep
  var foam = 1 - smoothstep(0, FOAM_W, abs(d));   // bright band at the waterline

  // Water body: cyan near the surface, deep blue lower down, with shimmer
  var c = perlin(x * 6, y * 6 - flowA, z * 6 + flowB, 0);   // about -1..1
  var shimmer = clamp(0.75 + c * 0.45, 0.3, 1.2);
  var h = mix(0.50, 0.65, dn);
  var v = mix(0.85, 0.35, dn) * shimmer;

  // Blend in the foam: brighter and paler at the surface line
  v = mix(v, 1, foam * 0.7);
  var s = 1 - foam * 0.45;

  // Feathered leading edge: fade out gently over SOFT above the surface,
  // easing in at both ends so there's no visible start or stop.
  if (d < 0) {
    var e = smoothstep(-SOFT, 0, d);
    v = v * e * e;
  }
  hsv(h, s, clamp(v, 0, 1) * fade);
}
