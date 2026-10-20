// 02 TRAVELLING WAVE -- bands of light rolling nose to tail.
//
// Shows:    world coordinates (y = nose->tail), UI controls (sliders, a
//           colour picker, toggles), mirror-symmetric mode using MID_X.
// Looks:    soft bands of colour sweep along the body. "Outward" mode sends
//           them from the centreline out to port and starboard together.
// Sync:     safe -- position + time() only. Controls replicate to followers.
// Try:      swap y for z to make the bands rise from the ground.

var speed = 0.5;       // slider 0..1
var bands = 0.3;       // slider 0..1 -> 1..8 bands along the body
var hue = 0.55;        // colour picker
var sat = 1;
var outward = 0;       // toggle: 0 = nose->tail, 1 = centreline -> sides
var reverse = 0;       // toggle: run the other way

export function sliderSpeed(v) { speed = v; }
export function sliderBands(v) { bands = v; }
export function hsvPickerColour(h, s, v) { hue = h; sat = s; }
export function toggleOutward(on) { outward = on; }
export function toggleReverse(on) { reverse = on; }

var phase = 0;         // 0..1 sawtooth, per frame
var nBands = 1;
var U_SCALE = 1;       // so that "outward" spans 0..1 from centreline to pectoral tip

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
  // One band passes a point every 0.5 s (fast) .. 6 s (slow).
  // NOTE: changing the interval of time() makes the phase jump once --
  // fine for a slider, but don't modulate it every frame.
  var seconds = mix(6, 0.5, speed);
  phase = time(seconds / 65.536);
  if (reverse) phase = -phase;
  nBands = 1 + floor(bands * 7);
  U_SCALE = 1 / (X_HI - MID_X);
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }

  var u;
  if (outward) u = abs(x - MID_X) * U_SCALE;     // 0 on the centreline .. 1 at the pectoral tips
  else u = (y - Y_LO) / (Y_HI - Y_LO);           // 0 at the nose .. 1 at the tail

  var w = wave(u * nBands - phase);              // 0..1, moves as phase grows
  w = w * w * w;                                 // sharpen the bands (cheaper than pow)
  hsv(hue + u * 0.08, sat, w);
}
