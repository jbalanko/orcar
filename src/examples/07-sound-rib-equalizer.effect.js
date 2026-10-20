// 07 SOUND: RIB EQUALIZER -- each rib is one frequency band, bass at the
// nose to treble at the tail; each rib fills from the ground up with its
// band's level. The spines glow with overall loudness.
//
// Shows:    reading the sensor board (frequencyData, energyAverage),
//           automatic gain so it works in a quiet room and at a festival,
//           frame-rate-independent smoothing.
// Sync:     MOSTLY safe. The sound data comes from one sensor board and is
//           broadcast to all boards; each board smooths it on its own, so
//           boards can differ slightly (a few % brightness) -- fine for
//           level-following effects like this. See 08 for the harder case.
// Needs:    the sensor board on the leader, followers set to use "remote"
//           sound (Settings > Expansion Data Source).
// Try:      map bands to spines (S1..S11, starboard->port) instead.

export var frequencyData = array(32);  // 32 buckets, ~37 Hz .. 10 kHz, NOT evenly spaced (reference s8).
                                       // The default (silence) is used if no sensor board is connected.
export var energyAverage = 0;          // overall volume

var RIB_ORD = array(pixelCount);
var RIB_FILL = array(pixelCount);  // 0 at the rib's feet .. 1 at its top
var nRibs = 0;
var builtFor = -1;
var LEVEL = array(14);             // smoothed level per installed rib (max 14 ribs)

var sensitivity = 0.5;
export function sliderSensitivity(v) { sensitivity = v; }

function buildRibTables() {
  RIB_ORD.mutate((v) => -1);
  var lo = NODE_OFFSET;
  var hi = NODE_OFFSET + pixelCount - 1;
  nRibs = 0;
  for (var r = 0; r < GROUP_ALL_RIBS.length; r++) {
    var f = GROUP_ALL_RIBS[r];
    if (f[F_COUNT] == 0) continue;
    for (var i = max(f[F_START], lo); i <= min(f[F_END], hi); i++) {
      RIB_ORD[i - lo] = nRibs;
      // ribs go feet -> top -> feet, so 1 - |2p - 1| is 0 at the feet, 1 at the top
      RIB_FILL[i - lo] = 1 - abs(2 * featurePos(f, i) - 1);
    }
    nRibs++;
  }
}

var peak = 0.02;      // auto-gain: slowly-decaying running peak of the band levels
var loud = 0;         // smoothed overall loudness 0..1
var ePeak = 0.02;     // auto-gain for energyAverage (its own scale)

// Frame-rate-independent smoothing: move `cur` toward `target`, halfway in
// `halfLifeMs`. Same visual speed at 20 fps and at 200 fps.
function approach(cur, target, delta, halfLifeMs) {
  var k = 1 - pow(0.5, delta / halfLifeMs);
  return cur + (target - cur) * k;
}

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
  var binsPer = 28 / max(1, nRibs);       // use buckets 0..27 (~12 Hz .. ~6 kHz)
  var maxBand = 0;
  for (var r = 0; r < nRibs; r++) {
    var a = floor(r * binsPer);
    var b = max(a + 1, floor((r + 1) * binsPer));
    var s = 0;
    for (var i = a; i < b; i++) s += frequencyData[i];
    s = s / (b - a);
    maxBand = max(maxBand, s);
    var target = s / peak;
    // fast attack, slower release
    LEVEL[r] = approach(LEVEL[r], target, delta, target > LEVEL[r] ? 25 : 180);
  }
  // auto-gain: the peak decays with a 4 s half-life, jumps up instantly
  peak = max(maxBand, approach(peak, maxBand, delta, 4000));
  peak = max(peak, mix(0.02, 0.002, sensitivity));   // floor: silence stays dark
  ePeak = max(energyAverage, approach(ePeak, energyAverage, delta, 4000));
  ePeak = max(ePeak, mix(0.02, 0.002, sensitivity));
  loud = approach(loud, clamp(energyAverage / ePeak, 0, 1), delta, 150);
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  var rib = RIB_ORD[index];
  var fill = RIB_FILL[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }

  if (rib >= 0) {
    var lvl = clamp(LEVEL[rib], 0, 1);
    var hue = 0.66 - 0.66 * rib / max(1, nRibs - 1);     // blue bass -> red treble
    if (fill <= lvl) hsv(hue, 1, 0.25 + 0.75 * fill / max(lvl, 0.01));
    else hsv(hue, 1, 0.02);
  } else {
    hsv(0.6, 0.7, 0.05 + 0.6 * loud);                     // spines and fins: loudness
  }
}
