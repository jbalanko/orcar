// FLASHING STARS -- random little stars strobe on all over the whale and fade.
//
// Looks:    mostly dark. Small spots pop on at random everywhere -- ribs,
//           spines, dorsal, pectorals, fluke -- each with a bright white-hot
//           flash that then fades away, like stars glinting or camera flashes
//           in a crowd. "Colour" runs from all-white stars (0) to every star
//           its own random hue (1); in between the colours are pastel. The
//           flash core always starts whiter and settles into its colour as it
//           fades.
// Sync:     safe -- each star is a fixed hash of (global index, time slot),
//           so every board agrees without any shared state.
// Parts:    everything mapped. Kaleidoscope (EYE_1/EYE_2) twinkles with the
//           same stars (they use only the index, never x/y/z). TEST off.
// Safety:   each flash is one small spot, at random times, so the whale never
//           flashes as a whole; density is capped so it stays mostly dark.

var density = 0.4;     // slider 0..1 -> share of spots that flash each cycle
var fade = 0.4;        // slider 0..1 -> fade time 0.2 s .. 1.5 s
var colour = 0;        // slider 0..1 -> white .. random colours
var spot = 0.3;        // slider 0..1 -> 1 .. 4 pixels per star

export function sliderStars(v) { density = v; }
export function sliderFade(v) { fade = v; }
export function sliderColour(v) { colour = v; }
export function sliderStarSize(v) { spot = v; }

// Each star gets one chance to flash per slot. The clock loops every
// 65.536 s and holds a whole number of slots, so the loop is seamless.
var SLOTS = 32;        // 2.048 s per slot
var SLOT_SECS = 2.048;
var HOLD = 0.06;       // seconds at full brightness before the fade

var clockT = 0;        // 0..SLOTS, per frame
var chance = 0.1;
var fadeSecs = 0.5;
var spotLen = 1;

export function beforeRender(delta) {
  // --- keep: builds this controller's tables once ---
  var id = nodeId();                      // A=0 ... F=5
  if (tagsBuiltFor != id) {
    NODE_OFFSET = BOARD_OFFSET[id];
    buildTags();
    tagsBuiltFor = id;
  }
  // --- your per-frame code ---
  clockT = time(1) * SLOTS;
  chance = mix(0.03, 0.3, clamp(density, 0, 1));
  fadeSecs = mix(0.2, 1.5, clamp(fade, 0, 1));
  spotLen = 1 + floor(clamp(spot, 0, 1) * 3.99);
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  // TEST strand and anything unassigned stay off; the kaleidoscope joins in
  // using only its index.
  if (tags == 0 && !inFeature(EYE_1, index) && !inFeature(EYE_2, index)) {
    hsv(0, 0, 0); return;
  }

  // A star is a run of spotLen neighbouring pixels. Each star has its own
  // offset into the slot so they don't all fire at the slot boundary.
  var g = floor(index / spotLen);
  var u = clockT + frac(g * 0.6180339);
  var slot = floor(u);
  var age = frac(u) * SLOT_SECS;                  // seconds since this slot began
  if (age > HOLD + fadeSecs) { hsv(0, 0, 0); return; }

  // Hash of (star, slot): does it flash this time, and in what colour?
  var a = frac(g * 0.7548777) + frac(slot * 0.5698403) * 1.37;
  var r = mod(sin(a * 43.98) * 437.585, 1);       // mod, not frac: frac keeps the sign
  if (r >= chance) { hsv(0, 0, 0); return; }
  r = r / chance;                                  // 0..1 among the stars that fire

  var k = clamp((age - HOLD) / fadeSecs, 0, 1);    // 0 during the flash .. 1 faded out
  var v = 1 - k;
  v = v * v * v;                                   // quick fall, long dim tail
  v = v * (0.55 + 0.45 * frac(r * 3.17));          // some stars brighter than others
  var s = colour * clamp(0.25 + k * 3, 0, 1);      // white-hot core settles into colour
  hsv(frac(r * 7.31), s, v);
}
