// =====================================================================
// PORTAL -- only the ribs light. Rings of light flash on and off rib by
// rib, racing from the nose to the tail (or tail to nose), so looking down
// the whale feels like staring into a tunnel and being beamed into space.
//
// What it looks like: each rib swells up as the ring approaches, peaks
// with a white-hot core that cools into the portal colour, then fades off
// as the next rib takes over, so neighbouring ribs cross-fade (Smoothness
// 0 brings back hard on/off flashes). Warp makes the rings speed up as they go, like a
// jump to light speed; Swirl breaks each ring into two arcs that spin
// around the arch, turning the tunnel into a vortex. Spines and fins stay
// dark.
//
// Controls (in the order the public page shows them):
//   sliderSpeed           Speed          one trip down the ribs every 4 s (0) .. 0.4 s (1)
//   toggleTailToNose      Tail To Nose   rings run tail -> nose instead of nose -> tail
//   sliderRings           Rings          1, 2 or 3 rings in the tunnel at once
//   sliderWarp            Warp           0 = even pace, 1 = rings accelerate hard down the tunnel
//   sliderFlashLength     Flash Length   how long each rib stays fully on: half (0) .. 2.5 (1) rib-steps
//   sliderSmoothness      Smoothness     0 = hard on/off flashes, 1 = long fade-in and soft fade-out
//   sliderAfterglow       Afterglow      0 = short fade after each flash, 1 = long fading trail
//   sliderSwirl           Swirl          0 = solid rings, 1 = spinning arcs
//   sliderColour          Colour         the portal hue (default blue-violet)
//   sliderColourSpread    Colour Spread  how far the hue shifts from the first rib to the last
//   toggleStrobe_FastFlash_Admin         crew only: lifts the 3 flashes/s limit (default off)
//
// Sync: safe. Every rib's brightness is a pure function of its order,
// time() and the control values; nothing is accumulated or random.
// Moving Speed or Rings changes the loop length, so the rings jump once.
//
// Show safety (contract s8): each rib is a large area, so with the strobe
// toggle off no rib flashes more than 3 times per second at any setting:
// the trip time is stretched to at least 0.34 s per ring in the tunnel.
// Flashes last at least 0.1 s. Never the whole whale at once.
// =====================================================================

// ---- Settings ----------------------------------------------------------
var MAX_HZ_SECONDS = 0.34;   // minimum seconds between flashes of one rib (<= 3 Hz)
var TRAVEL = 0.75;           // a ring reaches the last rib at 75% of the trip; the rest is a dark pause

// ---- Controls (defaults give a calm look with no control touched) ------
var speed = 0.55;
var tailToNose = 0;
var rings = 1;
var warp = 0.4;
var flashLen = 0.15;
var smoothness = 0.6;
var afterglow = 0.35;
var swirl = 0;
var hue = 0.66;              // blue-violet
var spread = 0.2;            // shifts towards magenta down the tunnel
var strobe = 0;

export function sliderSpeed(v) { speed = clamp(v, 0, 1); }
export function toggleTailToNose(on) { tailToNose = on; }
export function sliderRings(v) { rings = clamp(1 + floor(v * 2.99), 1, 3); }
export function sliderWarp(v) { warp = clamp(v, 0, 1); }
export function sliderFlashLength(v) { flashLen = clamp(v, 0, 1); }
export function sliderSmoothness(v) { smoothness = clamp(v, 0, 1); }
export function sliderAfterglow(v) { afterglow = clamp(v, 0, 1); }
export function sliderSwirl(v) { swirl = clamp(v, 0, 1); }
export function sliderColour(v) { hue = v; }
export function sliderColourSpread(v) { spread = clamp(v, 0, 1); }
export function toggleStrobe_FastFlash_Admin(on) { strobe = on; }

// ---- Per-pixel tables (built once per board, as in example 03) ---------
var RIB_ORD = array(pixelCount);   // local index -> 0..nRibs-1 (nose->tail), or -1
var RIB_POS = array(pixelCount);   // local index -> 0..1 along that rib (CW)
var nRibs = 0;                     // installed ribs (count > 0)
var builtFor = -1;

function buildRibTables() {
  RIB_ORD.mutate((v) => -1);
  var lo = NODE_OFFSET;
  var hi = NODE_OFFSET + pixelCount - 1;
  nRibs = 0;
  for (var r = 0; r < GROUP_ALL_RIBS.length; r++) {   // R1..R14 = nose -> tail
    var f = GROUP_ALL_RIBS[r];
    if (f[F_COUNT] == 0) continue;                    // not installed: skip, no gap
    for (var i = max(f[F_START], lo); i <= min(f[F_END], hi); i++) {
      RIB_ORD[i - lo] = nRibs;
      RIB_POS[i - lo] = featurePos(f, i);
    }
    nRibs++;                                          // counted on EVERY board, so all agree
  }
}

// ---- Per-rib values, worked out once per frame -------------------------
var RIB_V = array(14);   // brightness of each installed rib, by order
var RIB_H = array(14);   // hue
var RIB_S = array(14);   // saturation (low = white-hot core of a fresh flash)
var spin = 0;            // swirl rotation, 0..1

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
  if (builtFor != id) { buildRibTables(); builtFor = id; }
  // --- your per-frame code ---
  // Trip time: how long one ring takes to cross the tunnel (plus its pause).
  // Each rib flashes rings / trip times a second, so stretch the trip to stay <= 3 Hz.
  var trip = mix(4, strobe ? 0.15 : 0.4, speed);
  if (!strobe) trip = max(trip, MAX_HZ_SECONDS * rings);
  var spacing = trip / rings;                         // seconds between flashes of one rib
  var now = time(trip / 65.536) * trip;               // seconds into this trip, shared by all boards

  var step = TRAVEL * trip / max(1, nRibs);           // average seconds between neighbouring ribs firing
  var on = min(max(mix(0.5, 2.5, flashLen) * step, strobe ? 0.05 : 0.1), 0.6 * spacing);
  var lead = min(smoothness * 2 * step, 0.35 * spacing);   // seconds to fade in before the ring arrives
  // seconds to fade out after the flash; Smoothness sets a minimum so ribs overlap
  var fade = max(0.02, max(afterglow, smoothness * 0.5) * (spacing - on - lead));
  var curve = mix(1, 3, warp);                        // >1: rings speed up down the tunnel

  for (var r = 0; r < nRibs; r++) {
    var u = nRibs > 1 ? r / (nRibs - 1) : 0;          // 0 at the nose .. 1 at the tail
    if (tailToNose) u = 1 - u;
    var arrive = pow(u, curve) * TRAVEL * trip;       // when the ring reaches this rib
    var age = mod(now - arrive, spacing);             // seconds since it last flashed
    var v = 0;
    if (age < on) v = 1;
    else {
      v = smoothstep(0, 1, 1 - (age - on) / fade);              // eased fade-out
      if (lead > 0) v = max(v, smoothstep(0, 1, 1 - (spacing - age) / lead));   // eased fade-in
    }
    RIB_V[r] = v;
    RIB_H[r] = hue + spread * u;
    RIB_S[r] = mix(0.35, 1, clamp(age / on, 0, 1));   // white-hot, cooling to colour
  }
  spin = time(2.5 / 65.536);
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  var rib = RIB_ORD[index];          // our own table: LOCAL index too
  var pos = RIB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }
  if (rib < 0) { hsv(0, 0, 0); return; }          // ribs only

  var v = RIB_V[rib];
  if (swirl > 0) v = v * mix(1, wave(pos * 2 - spin + rib * 0.08), swirl);   // two arcs spinning round the arch
  hsv(RIB_H[rib], RIB_S[rib], v);
}
