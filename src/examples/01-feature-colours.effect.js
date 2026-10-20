// 01 FEATURE COLOURS -- the "hello world" for the Orcar.
//
// Shows:    tags (what part a pixel is), the backbone, unmapped pixels
//           (kaleidoscope, TEST) handled by feature index instead of x/y/z.
// Looks:    ribs teal, spines deep blue, head ribs brighter, backbone a
//           white-to-blue gradient, pectorals and dorsal violet, the
//           kaleidoscope (EYE_1/EYE_2) breathing amber. Everything breathes
//           slowly together.
// Sync:     safe -- every colour is a function of the pixel and time().
// Try:      change the hues in the PALETTE block; add a toggle that hides
//           everything except one feature.

// ---- PALETTE (hue 0..1: 0 red, 0.08 amber, 0.33 green, 0.5 cyan, 0.66 blue, 0.8 violet)
var HUE_RIB    = 0.48;
var HUE_SPINE  = 0.62;
var HUE_FIN    = 0.78;
var HUE_EYE    = 0.08;   // the kaleidoscope (EYE_1/EYE_2 in code)

var breathe = 1;   // 0..1, set once per frame

export function beforeRender(delta) {
  // --- keep: builds this controller's tables once ---
  var id = nodeId();                      // A=0 ... F=5
  if (tagsBuiltFor != id) {
    NODE_OFFSET = BOARD_OFFSET[id];
    buildTags();
    tagsBuiltFor = id;
  }
  // --- your per-frame code ---
  // 0.6..1.0 breathing, one cycle every ~6 s (time() period = 65.536 * interval s)
  breathe = 0.6 + 0.4 * wave(time(6 / 65.536));
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---

  // Unmapped pixels first: x/y/z mean nothing for them, so use the index.
  if (tags == 0) {
    if (inFeature(EYE_1, index) || inFeature(EYE_2, index)) {
      hsv(HUE_EYE, 1, breathe);
    } else {
      hsv(0, 0, 0);                         // TEST strand (and anything unassigned): off
    }
    return;
  }

  if (bb >= 0) {
    hsv(0.62, bb, breathe);                 // backbone: white at the head -> blue at the tail
  } else if (tags & TAG_RIB) {
    var v = (tags & TAG_HEAD) ? 1 : 0.7;    // head ribs a little brighter
    hsv(HUE_RIB, 1, v * breathe);
  } else if (tags & TAG_SPINE) {
    hsv(HUE_SPINE, 1, 0.8 * breathe);
  } else {
    hsv(HUE_FIN, 0.8, breathe);             // dorsal, pectorals, (fluke when mapped)
  }
}
