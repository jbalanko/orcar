// 04 DEEP SEA -- slow bioluminescent currents with twinkling plankton.
//
// Shows:    3D noise in WORLD space (so the pattern flows continuously
//           across all six boards), palettes, and sync-safe "random"
//           twinkles made from a hash of the global index.
// Looks:    deep blue water, teal-green glows drifting tail-ward, sparse
//           pinpricks of light flickering on and off.
// Sync:     safe -- perlin() of position + time(); twinkles are a fixed
//           function of (global index, time), not random().
// Try:      change the palette; raise "Scale" for finer currents.

var drift = 0.4;      // slider: current speed
var detail = 0.4;     // slider: noise scale
var sparkle = 0.5;    // slider: plankton amount

export function sliderSpeed(v) { drift = v; }
export function sliderScale(v) { detail = v; }
export function sliderPlankton(v) { sparkle = v; }

// position, r, g, b -- deep water to glow
var OCEAN = [
  0.0,  0.00, 0.01, 0.04,
  0.45, 0.00, 0.05, 0.20,
  0.75, 0.00, 0.35, 0.45,
  1.0,  0.30, 1.00, 0.70
];
setPalette(OCEAN);

var flowY = 0;        // noise offset along the body (tail-ward drift)
var flowZ = 0;        // slow evolution
var freq = 4;
var twT = 0;          // twinkle clock (0..1 sawtooth)
var twGate = 0.98;

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
  // time() wraps, so make the noise wrap with it: setPerlinWrap + an integer
  // number of noise cells per lap keeps the motion seamless at the wrap.
  setPerlinWrap(256, 16, 16);
  var lap = mix(600, 120, drift);                 // seconds per full noise lap
  flowY = time(lap / 65.536) * 16;                // 0..16 cells, wraps seamlessly
  flowZ = time(lap * 1.7 / 65.536) * 16;
  freq = mix(2, 8, detail);
  twT = time(4 / 65.536);                         // each plankton blinks on a 4 s cycle
  twGate = 1 - sparkle * 0.08;                    // fraction of the cycle a plankton is dark
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }

  // Currents: noise sampled in world space, drifting toward the tail
  var n = perlin(x * freq, y * freq - flowY, z * freq + flowZ, 0);  // about -1..1
  var c = clamp(n * 0.9 + 0.45, 0, 1);
  var h = (z - Z_LO) / (Z_HI - Z_LO);             // brighter higher up, like light from the surface
  c = c * (0.55 + 0.45 * h);

  // Plankton: each pixel gets a fixed pseudo-random phase from its GLOBAL index
  var ph = frac(index * 0.6180339);               // golden-ratio hash, same on every board
  var tw = frac(twT + ph);
  if (tw > twGate) {
    var k = (tw - twGate) / (1 - twGate);         // 0..1 over the blink
    c = max(c, triangle(k));                      // quick rise and fall
  }
  paint(c * 0.999, 1);
}
