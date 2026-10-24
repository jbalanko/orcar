// SMILEY -- a big smiley face lit up on each side of the whale.
//
// Shows:    a 2D picture drawn on the side view (y, z), defined in inches
//           with the template's converters, like Orca Livery.
// Looks:    on each flank of the body, a softly glowing yellow disc with two
//           eyes and a bright grin, on a dim blue sea that shimmers gently.
//           The face acts out a little loop: it smiles, glances toward the
//           nose then the tail (pupils and mouth sliding together), turns the
//           smile into a frown, glances about grumpily, then cheers up again.
//           It breathes slowly and blinks every few seconds. The same face is
//           on both sides, so its glances go nose-ward / tail-ward, which is
//           left/right on the port side and right/left on starboard.
// Sync:     safe -- a fixed function of position, time() and controls.
// Parts:    ribs and spines on the sides of the body. Dorsal, pectorals,
//           head and tail stay sea blue. Kaleidoscope (EYE_1/EYE_2) default;
//           TEST off.
// Safety:   the blink is a short dip on the small eye areas only; nothing
//           large flashes.
// Note:     the lattice is coarse (ribs ~2 ft apart, spines ~20 in apart),
//           so the face is drawn like pixel art: each eye is a dim dash on a
//           rib with a bright pupil that slides onto the spine crossing it,
//           and the mouth runs along the low spines and up the ribs (see the
//           constants).

var faceH = 0.14; var faceS = 1; var faceV = 1;   // picker: face colour (yellow)
var fill = 0.5;        // slider 0..1 -> face disc brightness 0 .. 0.8 (centre 0.4)
var size = 0.5;        // slider 0..1 -> face 98% .. 128% of its design size (centre 113%)
var blink = 1;         // toggle: blink every few seconds
var glow = 0.5;        // slider 0..1 -> how much the face breathes, 0 .. 0.8 (centre 0.4)
var speed = 0.5;       // slider 0..1 -> expression loop 40 s .. 16 s
var frowns = 1;        // toggle: include the frown in the loop (off = always smiling)

export function hsvPickerFaceColour(h, s, v) { faceH = h; faceS = s; faceV = v; }
export function sliderFaceFill(v) { fill = v; }
export function sliderFaceSize(v) { size = v; }
export function toggleBlink(on) { blink = on; }
export function sliderGlow(v) { glow = v; }
export function sliderExpressionSpeed(v) { speed = v; }
export function toggleFrowns(on) { frowns = on; }

// Design, in map inches on the side view (+y aft, +z up from the rib feet).
// Ribs R5..R9 stand at y ~105, 129, 153, 177, 201; spines zig-zag at
// z ~8, 30, 50, 70, 85 on each side. The face is centred on the middle rib:
// each eye sits on the ribs either side, centred on the z ~68 spine so a
// glancing pupil lights that spine; the mouth is a curve below, between the
// bottom spine (z ~8) and the z ~30 spine, with its ends on the same ribs.
var FACE_Y = nY(153);  var FACE_Z = nZ(44);
var FACE_R = nLen(50);
var EYE_DY = nLen(24); var EYE_DZ = nLen(24);     // eye centres from the face centre
var EYE_RY = nLen(6);  var EYE_RZ = nLen(12);     // the dim eye dash
var PUP_RY = nLen(7);  var PUP_RZ = nLen(8);      // the bright pupil
var LOOK_DY = nLen(11);                            // how far a pupil slides when glancing
var MOUTH_MID = nLen(-26);                         // mouth height, mid curve (z ~18)
var MOUTH_DEPTH = nLen(18);                        // centre-to-ends height difference
var MOUTH_HW = nLen(24);                           // half width: ends land on the eye ribs
var MOUTH_W = nLen(6);                             // half thickness of the mouth line
var SLIDE_DY = nLen(10);                           // how far the mouth slides sideways
var EDGE = nLen(3);                                // softness of every border
var SIDE = nLen(12);                               // ignore pixels this close to the centreline

var scale = 1;
var openEye = 1;
var breathe = 1;
var rippleT = 0;
var faceR = 1; var faceG = 0.8; var faceB = 0;
var look = 0;          // -1 nose-ward .. 1 tail-ward
var slide = 0;         // same, for the mouth
var curve = 1;         // 1 smile .. -1 frown

// The expression loop: 8 equal beats, each easing to these targets.
//           smile  nose  tail  smile frown nose  tail  cheer up
var B_LOOK  = [0,    -1,    1,    0,    0,   -1,    1,    0];
var B_SLIDE = [0,    -1,    1,    0,    0,    1,   -1,    0];
var B_CURVE = [1,     1,    1,    1,   -1,   -1,   -1,    1];

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
  scale = 0.982 + 0.3 * clamp(size, 0, 1);

  // Blink: the eyes squash shut and reopen over 0.3 s, once every 6 s.
  openEye = 1;
  if (blink) {
    var t = time(6 / 65.536) * 6;         // seconds into the 6 s loop
    if (t < 0.3) openEye = 0.15 + 0.85 * abs(t / 0.15 - 1);
  }

  // Expression: which beat of the loop, eased over its first 30%.
  var loopSecs = mix(40, 16, clamp(speed, 0, 1));
  var p = time(loopSecs / 65.536) * 8;
  var beat = floor(p);
  var prev = (beat + 7) % 8;
  var e = smoothstep(0, 0.3, p - beat);
  look = mix(B_LOOK[prev], B_LOOK[beat], e);
  slide = mix(B_SLIDE[prev], B_SLIDE[beat], e);
  curve = frowns ? mix(B_CURVE[prev], B_CURVE[beat], e) : 1;

  breathe = 1 - clamp(glow, 0, 1) * 0.8 * 0.3 * (1 - wave(time(4 / 65.536)));   // 4 s breath
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

  // Eyes: a dim dash with a bright pupil that glances, both squashed flat
  // while blinking.
  var ey = abs(dy) - EYE_DY;
  var ez = dz - EYE_DZ;
  var eyes = max(blob(ey, ez, EYE_RY, max(EYE_RZ * openEye, EDGE)) * 0.4,
                 blob(dy - (dy < 0 ? -EYE_DY : EYE_DY) - look * LOOK_DY, ez,
                      PUP_RY, max(PUP_RZ * openEye, EDGE)));

  // Mouth: a parabola, ends up for a smile and down for a frown, sliding
  // sideways. Thickness is measured across the curve, so its steep ends
  // still light a stretch of rib.
  var u = (dy - slide * SLIDE_DY) / MOUTH_HW;
  var mz = MOUTH_MID + curve * MOUTH_DEPTH * (u * u - 0.5);
  var slope = curve * MOUTH_DEPTH * 2 * u / MOUTH_HW;
  var mouth = clamp((MOUTH_W - abs(dz - mz) / sqrt(1 + slope * slope)) / EDGE + 0.5, 0, 1) *
              clamp((1.15 - abs(u)) * MOUTH_HW / EDGE + 0.5, 0, 1);
  var lit = max(eyes, mouth);

  // Brightness: the dim disc, the bright features on top.
  var a = max(clamp((FACE_R - d) / EDGE + 0.5, 0, 1) * clamp(fill, 0, 1) * 0.8 * 0.6, lit);
  rgb(mix(sr, faceR, a), mix(sg, faceG, a), mix(sb, faceB, a));
}
