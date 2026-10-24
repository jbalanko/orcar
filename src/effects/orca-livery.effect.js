// ORCA LIVERY -- the whale painted like a real orca: bright white where an
// orca is white, deep blue where an orca is black.
//
// Shows:    a static "paint job" defined in inches with the template's
//           converters, so the markings stay put if the map box changes.
// Looks:    white chin and throat running back along the belly, a white eye
//           patch on each side of the head, the white flank patch sweeping
//           up behind the dorsal fin, and a pale grey-blue saddle patch
//           behind the dorsal. Everything else (back, dorsal, pectorals,
//           tail) is deep blue, with an optional slow shimmer drifting aft.
// Sync:     safe -- a fixed function of position, time() and controls.
// Try:      raise "Shimmer" for water rippling over the skin; turn the
//           saddle patch off for a pure two-colour whale.

var shimmer = 0.25;   // slider: depth of the moving ripple on the blue
var blueGlow = 0.5;   // slider: how vivid the blue is (navy .. bright blue)
var saddle = 1;       // toggle: grey-blue saddle patch behind the dorsal

export function sliderShimmer(v) { shimmer = v; }
export function sliderBlueGlow(v) { blueGlow = v; }
export function toggleSaddlePatch(on) { saddle = on; }

// Markings, in map inches (+y aft, +z up from the rib feet), converted once.
// Belly line: white below this height, as a function of y.
var BL_Y0 = nY(40);   var BL_Z0 = nZ(32);   // chin / throat
var BL_Y1 = nY(95);   var BL_Z1 = nZ(20);   // belly behind the head
var BL_Y2 = nY(165);  var BL_Z2 = nZ(20);   // flank patch starts rising
var BL_Y3 = nY(205);  var BL_Z3 = nZ(56);   // flank patch peak
var BL_Y4 = nY(240);  var BL_Z4 = nZ(-10);  // back down: no white on the tail
// Eye patch: an ellipse in (y, z) on each side of the head.
var EYE_Y = nY(68);   var EYE_RY = nLen(18);
var EYE_Z = nZ(64);   var EYE_RZ = nLen(10);
var EYE_SIDE = nLen(18);                    // only this far off the centreline
// Saddle patch: on top, behind the dorsal fin.
var SAD_Y = nY(212);  var SAD_RY = nLen(22);
var SAD_Z = nZ(84);   var SAD_RZ = nLen(14);
var EDGE = nLen(3);                         // softness of every border

var blueR = 0; var blueG = 0.03; var blueB = 0.5;
var rippleT = 0;

// Kaleidoscope (EYE_1/EYE_2, unmapped) default; TEST strand off. See contract s3.3.
function kaleidoscope(index) {
  var f = inFeature(EYE_1, index) ? EYE_1 : EYE_2;
  if (!inFeature(f, index)) { hsv(0, 0, 0); return; }
  hsv(featurePos(f, index) + time(8 / 65.536), 1, 0.8);
}

// Height of the white belly line at y (piecewise linear between the points).
function bellyZ(y) {
  if (y < BL_Y0) return BL_Z0;
  if (y < BL_Y1) return mix(BL_Z0, BL_Z1, (y - BL_Y0) / (BL_Y1 - BL_Y0));
  if (y < BL_Y2) return mix(BL_Z1, BL_Z2, (y - BL_Y1) / (BL_Y2 - BL_Y1));
  if (y < BL_Y3) return mix(BL_Z2, BL_Z3, (y - BL_Y2) / (BL_Y3 - BL_Y2));
  if (y < BL_Y4) return mix(BL_Z3, BL_Z4, (y - BL_Y3) / (BL_Y4 - BL_Y3));
  return BL_Z4;
}

// 1 inside an ellipse, 0 outside, soft over about EDGE at the border.
function blob(dy, dz, ry, rz) {
  var d = hypot(dy / ry, dz / rz);          // 1 on the ellipse
  return clamp((1 - d) * ry / EDGE + 0.5, 0, 1);
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
  blueG = mix(0.0, 0.12, blueGlow);
  blueB = mix(0.25, 0.9, blueGlow);
  rippleT = time(9 / 65.536);             // ripple loops every 9 s
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }

  // Whiteness: belly, then eye patch. Pectorals and dorsal stay blue.
  var w = clamp((bellyZ(y) - z) / EDGE + 0.5, 0, 1);
  if (abs(x - MID_X) > EYE_SIDE) w = max(w, blob(y - EYE_Y, z - EYE_Z, EYE_RY, EYE_RZ));
  if (w > 0 && (inFeature(LEFT_PECTORAL, index) || inFeature(RIGHT_PECTORAL, index) || inFeature(DORSAL, index))) w = 0;

  // Deep blue skin, with a gentle ripple drifting nose to tail.
  var k = 1 - shimmer * 0.5 * (1 - wave(y * 3 - rippleT + z));
  var r = blueR * k; var g = blueG * k; var b = blueB * k;

  // Saddle patch: pale grey-blue behind the dorsal.
  if (saddle) {
    var s = blob(y - SAD_Y, z - SAD_Z, SAD_RY, SAD_RZ) * 0.8;
    r = mix(r, 0.35, s); g = mix(g, 0.42, s); b = mix(b, 0.6, s);
  }

  rgb(mix(r, 1, w), mix(g, 1, w), mix(b, 1, w));
}
