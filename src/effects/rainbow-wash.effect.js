// RAINBOW WASH -- a smooth rainbow washing over the whale from head to tail.
//
// Shows:    hue as a pure function of y (nose->tail) and time(), from
//           example 02's travelling wave.
// Looks:    the whole whale is one continuous, fully saturated rainbow laid
//           along its length. The colours flow steadily from the nose back
//           to the flukes in an endless loop, with no bands, gaps or dark
//           areas. Every part (ribs, spines, dorsal, pectorals) takes the
//           colour of where it sits along the body, so the fins match the
//           ribs beside them.
// Sync:     safe -- position + time() + controls only.
// Parts:    everything mapped. Kaleidoscope (EYE_1/EYE_2) default; TEST off.
// Safety:   no flashing; the colour change at any pixel is slow and smooth.

var speed = 0.6;     // slider 0..1 -> one full colour cycle every 20 s .. 2 s
var spread = 0.3;      // slider 0..1 -> 0.5 .. 3 rainbows along the body

export function sliderSpeed(v) { speed = v; }
export function sliderRainbowsAlongBody(v) { spread = v; }

var phase = 0;         // 0..1 sawtooth
var nRainbows = 1;
var Y_SCALE = 1;

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
  // Changing the interval makes the phase jump once: fine for a slider.
  phase = time(mix(20, 2, speed) / 65.536);
  nRainbows = mix(0.5, 3, spread);
  Y_SCALE = nRainbows / (Y_HI - Y_LO);
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }

  // Subtracting phase moves each colour toward higher y: nose -> tail.
  hsv((y - Y_LO) * Y_SCALE - phase, 1, 1);
}
