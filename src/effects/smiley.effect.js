// SMILEY -- a big smiley face lit up on each side of the whale.
//
// Shows:    a 2D picture drawn on the side view (y, z), defined in inches
//           with the template's converters, like Orca Livery.
// Looks:    on each flank of the body, a softly glowing yellow disc with two
//           bright eye dashes and a bright grin, on a dim blue sea that
//           shimmers gently. The face breathes slowly and blinks every few
//           seconds. The face is symmetric, so it reads the same from either
//           side of the road.
// Sync:     safe -- a fixed function of position, time() and controls.
// Parts:    ribs and spines on the sides of the body. Dorsal, pectorals,
//           head and tail stay sea blue. Kaleidoscope (EYE_1/EYE_2) default;
//           TEST off.
// Safety:   the blink is a short dip on the small eye areas only; nothing
//           large flashes.
// Note:     the lattice is coarse (ribs ~2 ft apart, spines ~20 in apart),
//           so the face is drawn like pixel art: the eyes sit on ribs and the
//           smile's ends land on the middle spines (see the constants).

var faceH = 0.14; var faceS = 1; var faceV = 1;   // picker: face colour (yellow)
var fill = 0.3;        // slider 0..1 -> brightness of the face disc behind the features
var size = 0.5;        // slider 0..1 -> face 85% .. 115% of its design size
var blink = 1;         // toggle: blink every few seconds
var glow = 0.5;        // slider 0..1 -> how much the face breathes

export function hsvPickerFaceColour(h, s, v) { faceH = h; faceS = s; faceV = v; }
export function sliderFaceFill(v) { fill = v; }
export function sliderFaceSize(v) { size = v; }
export function toggleBlink(on) { blink = on; }
export function sliderGlow(v) { glow = v; }

// Design, in map inches on the side view (+y aft, +z up from the rib feet).
// Ribs R5..R9 stand at y ~105, 129, 153, 177, 201; spines zig-zag at
// z ~8, 30, 50, 70, 85 on each side. The face is centred on the middle rib:
// each eye is a dash on the ribs either side (z ~54..74), and the grin is a
// U that runs along the bottom spine and turns up the same ribs to z ~27,
// leaving a clear gap below the eyes.
var FACE_Y = nY(153);  var FACE_Z = nZ(44);
var FACE_R = nLen(50);
var EYE_DY = nLen(24); var EYE_DZ = nLen(20);     // eye centres from the face centre
var EYE_RY = nLen(7);  var EYE_RZ = nLen(10);
var MOUTH_R = nLen(35.4);                          // smile arc, around the face centre
var MOUTH_W = nLen(6);                             // half thickness of the smile
var MOUTH_TOP = nLen(-16);                         // only the arc below this height
var EDGE = nLen(3);                                // softness of every border
var SIDE = nLen(12);                               // ignore pixels this close to the centreline

var scale = 1;
var openEye = 1;
var breathe = 1;
var rippleT = 0;
var faceR = 1; var faceG = 0.8; var faceB = 0;

// Kaleidoscope (EYE_1/EYE_2, unmapped) default; TEST strand off. See contract s3.3.
function kaleidoscope(index) {
  var f = inFeature(EYE_1, index) ? EYE_1 : EYE_2;
  if (!inFeature(f, index)) { hsv(0, 0, 0); return; }
  hsv(featurePos(f, index) + time(8 / 65.536), 1, 0.8);
}

// 1 inside an ellipse, 0 outside, soft over about EDGE at the border.
function blob(dy, dz, ry, rz) {
  var d = hypot(dy / ry, dz / rz);          // 1 on the ellipse
  return clamp((1 - d) * min(ry, rz) / EDGE + 0.5, 0, 1);
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
  scale = 0.85 + 0.3 * clamp(size, 0, 1);

  // Blink: the eyes squash shut and reopen over 0.3 s, once every 6 s.
  openEye = 1;
  if (blink) {
    var t = time(6 / 65.536) * 6;         // seconds into the 6 s loop
    if (t < 0.3) openEye = 0.15 + 0.85 * abs(t / 0.15 - 1);
  }

  breathe = 1 - glow * 0.3 * (1 - wave(time(4 / 65.536)));   // 4 s breath
  rippleT = time(9 / 65.536);

  // Face colour as RGB, so it can be blended with the sea per pixel.
  var h = frac(faceH) * 6;
  var v = faceV * breathe;
  faceR = v * mix(1, clamp(abs(h - 3) - 1, 0, 1), faceS);
  faceG = v * mix(1, clamp(2 - abs(h - 2), 0, 1), faceS);
  faceB = v * mix(1, clamp(2 - abs(h - 4), 0, 1), faceS);
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }

  // Dim blue sea everywhere, rippling gently nose to tail.
  var k = 0.7 + 0.3 * wave(y * 3 - rippleT + z);
  var sr = 0; var sg = 0.02 * k; var sb = 0.25 * k;

  if (abs(x - MID_X) < SIDE || inFeature(LEFT_PECTORAL, index) ||
      inFeature(RIGHT_PECTORAL, index) || inFeature(DORSAL, index)) {
    rgb(sr, sg, sb); return;
  }

  // Side-view position relative to the face, in design units.
  var dy = (y - FACE_Y) / scale;
  var dz = (z - FACE_Z) / scale;
  var d = hypot(dy, dz);

  // The features: eye dashes (squashed flat while blinking) and the grin.
  var eyes = blob(abs(dy) - EYE_DY, dz - EYE_DZ, EYE_RY, max(EYE_RZ * openEye, EDGE));
  var mouth = clamp((MOUTH_W - abs(d - MOUTH_R)) / EDGE + 0.5, 0, 1) *
              clamp((MOUTH_TOP - dz) / EDGE + 0.5, 0, 1);
  var lit = max(eyes, mouth);

  // Brightness: the dim disc, the bright features on top.
  var a = max(clamp((FACE_R - d) / EDGE + 0.5, 0, 1) * clamp(fill, 0, 1) * 0.6, lit);
  rgb(mix(sr, faceR, a), mix(sg, faceG, a), mix(sb, faceB, a));
}
