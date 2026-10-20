// 05 RANDOM RIB FLASH -- every couple of seconds a random rib flashes and
// fades, in a random colour. ALL SIX BOARDS AGREE on which rib and colour.
//
// Shows:    THE sync-safe randomness recipe. This is the one to copy
//           whenever a random decision affects more than one board.
//
//   WRONG:  if (timer > 2000) { pick = floor(random(nRibs)); timer = 0 }
//           Every board rolls its own dice, at its own moment: board A
//           flashes R3 while board B flashes R7. And `timer += delta`
//           drifts and overflows after ~33 s.
//
//   RIGHT:  derive a SLOT number from time() (synced across boards), seed
//           prng() with it, and draw the same number of values in the same
//           order on every board -- in beforeRender, never per pixel.
//
// Sync:     safe (boards may differ for one frame exactly at a slot change).
// Try:      flash a random spine instead; pick two ribs per slot.

var slotSeconds = 2;
export function sliderInterval(v) { slotSeconds = mix(4, 0.5, v); }

var RIB_ORD = array(pixelCount);   // local index -> installed-rib number, or -1
var nRibs = 0;
var builtFor = -1;

function buildRibTables() {
  RIB_ORD.mutate((v) => -1);
  var lo = NODE_OFFSET;
  var hi = NODE_OFFSET + pixelCount - 1;
  nRibs = 0;
  for (var r = 0; r < GROUP_ALL_RIBS.length; r++) {
    var f = GROUP_ALL_RIBS[r];
    if (f[F_COUNT] == 0) continue;
    for (var i = max(f[F_START], lo); i <= min(f[F_END], hi); i++) RIB_ORD[i - lo] = nRibs;
    nRibs++;
  }
}

// time(10) loops every 655.36 s; that is the longest clock we use here.
var CLOCK_SECONDS = 655.36;

var pick = 0;        // which rib flashes this slot
var pickHue = 0;
var age = 0;         // seconds since this slot started

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
  // Fit a whole number of slots into the clock loop so no slot gets cut
  // short when time(10) wraps. (The sequence repeats every ~11 minutes.)
  var nSlots = floor(CLOCK_SECONDS / slotSeconds);
  var cyc = time(10) * nSlots;            // 0..nSlots, identical on every board
  var slot = floor(cyc);                  // integer, identical on every board
  age = (cyc - slot) * (CLOCK_SECONDS / nSlots);

  prngSeed(slot + 1);                     // same seed ...
  pick = floor(prng(nRibs));              // ... same draws, same order -> same answer
  pickHue = prng(1);
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  var rib = RIB_ORD[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }

  var v = 0.04;                                     // everything else: faint
  if (rib == pick) v = max(v, 1 - age / 1.2);       // flash, fading over 1.2 s
  hsv(pickHue, rib == pick ? 0.8 : 0.3, v);
}
