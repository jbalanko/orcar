// SWIMMING -- pale turquoise pulses glide nose to tail over the spines and fins.
//
// Looks:    ribs dark. The spines, dorsal, pectorals and fluke sit in deep
//           ocean blues and teals that shimmer slowly. Every few seconds a
//           white-turquoise pulse rolls from the nose to the tail: a soft
//           leading edge with a long fading wake behind it, so it reads as
//           water streaming past the whale. Because it follows y, it crosses
//           each fin from its leading (front) edge to its trailing (back) edge.
// Sync:     safe -- position + time() only. Controls replicate to followers.
// Parts:    spines + fins (dorsal, pectorals, fluke). Ribs off.
//           Kaleidoscope: ocean hues drifting along each strand. TEST off.

var speed = 0.4;       // slider 0..1 -> one pulse every 6 s .. 1.5 s
var pulses = 0;        // slider 0..1 -> 1..3 pulses on the body at once
var wake = 0.5;        // slider 0..1 -> length of the fading wake

export function sliderSpeed(v) { speed = v; }
export function sliderPulses(v) { pulses = v; }
export function sliderWake(v) { wake = v; }

var phase = 0;         // 0..1 sawtooth, per frame
var nPulses = 1;
var attack = 0.03;     // fraction of the cycle for the soft leading edge
var tailLen = 0.3;     // fraction of the cycle for the wake
var shimmerT = 0;      // slow drift for the base water colour

var PULSE_HUE = 0.48;  // turquoise
var BASE_HUE = 0.6;    // ocean blue

// Kaleidoscope (EYE_1/EYE_2, unmapped): ocean hues drifting along each strand. TEST off.
function kaleidoscope(index) {
  var f = inFeature(EYE_1, index) ? EYE_1 : EYE_2;
  if (!inFeature(f, index)) { hsv(0, 0, 0); return; }
  var w = wave(featurePos(f, index) + time(8 / 65.536));
  hsv(0.47 + 0.18 * w, 1 - 0.4 * w * w, 0.35 + 0.45 * w);
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
  // Changing the interval makes the phase jump once; fine for a slider.
  phase = time(mix(6, 1.5, speed) / 65.536);
  nPulses = 1 + floor(pulses * 2.99);
  tailLen = mix(0.12, 0.6, wake) / nPulses;
  attack = 0.03 / nPulses;
  shimmerT = time(20 / 65.536);
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }
  if (tags & TAG_RIB) { hsv(0, 0, 0); return; }   // ribs off

  var u = (y - Y_LO) / (Y_HI - Y_LO);            // 0 at the nose .. 1 at the tail
  var h = (z - Z_LO) / (Z_HI - Z_LO);            // 0 at the base .. 1 at the top

  // Base water: deep blue to teal, slow shimmer drifting tail-ward
  var s = wave(u * 2 + h - shimmerT);
  var baseHue = BASE_HUE - 0.1 * s;
  var baseV = 0.35 + 0.2 * s;

  // Pulse: d = 0 as the front reaches this pixel, growing afterwards.
  // Larger u is reached later, so the pulse travels nose -> tail.
  var d = mod((phase - u) * nPulses, 1) / nPulses;   // mod, not frac: frac keeps the sign
  var b = 0;
  if (d < attack) b = d / attack;                // soft leading edge
  else if (d < attack + tailLen) {
    b = 1 - (d - attack) / tailLen;              // fading wake
    b = b * b;
  }

  hsv(mix(baseHue, PULSE_HUE, b), mix(1, 0.3, b), mix(baseV, 1, b));
}
