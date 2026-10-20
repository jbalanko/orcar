// 08 SOUND: BEAT RIPPLE -- every kick drum sends a ring of light out from
// the dorsal fin, and the backbone flashes.
//
// Shows:    simple beat (onset) detection on the bass bins, and timing an
//           event with the synced clock instead of a delta counter.
// Sync:     NOT fully safe -- read this before using beat effects.
//           Every board runs this detector on its own copy of the broadcast
//           sound data. Packets can drop and frames land at different
//           moments, so occasionally one board sees a beat the others miss
//           (a ring that appears on only part of the whale). Things that
//           reduce it: a strong, clean kick; the refractory window below;
//           effects where a missed beat is not obvious. The robust fix is to
//           detect beats in ONE place (leader or an external Teensy) and
//           send them to every board as a signal -- see ORCAR_CONTRACT.md
//           "Sound across six boards".
// Needs:    sensor board on the leader; followers use "remote" sound.

export var frequencyData = array(32);   // default = silence if no sensor board

var threshold = 0.5;
export function sliderThreshold(v) { threshold = v; }
var hue = 0.55;
export function hsvPickerColour(h, s, v) { hue = h; }

var CLOCK = 6.5536;              // time(0.1) loops every 6.5536 s
var avgBass = 0.01;              // slow running average of the bass
var lastBeat = -1;               // clock value (0..1) at the last beat, -1 = none yet
var age = 99;                    // seconds since the last beat
var radius = 0;
var RING = nLen(16);
var SPEED_IN = 160;              // ring speed, inches per second
var RING_LIFE = 1.4;             // seconds a ring lives

function approach(cur, target, delta, halfLifeMs) {
  return cur + (target - cur) * (1 - pow(0.5, delta / halfLifeMs));
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
  // --- your per-frame code ---
  var now = time(0.1);                                  // synced 0..1 clock
  if (lastBeat >= 0) {
    age = mod(now - lastBeat, 1) * CLOCK;   // wraps safely...
    // ...but only for less than one loop of the clock: expire the event well
    // before 6.55 s, or a silent stretch would "replay" the last beat.
    if (age > RING_LIFE) { lastBeat = -1; age = 99; }
  }

  var bass = (frequencyData[1] + frequencyData[2] + frequencyData[3]) / 3;   // buckets 1-3 = 50-100 Hz: the kick
  var ratio = mix(1.3, 2.5, threshold);                 // how far above average counts as a kick
  // 0.34 s refractory window: at most ~3 whole-body flashes per second
  // (contract s8). Thresholds were tuned on synthetic audio -- tune on the
  // truck with the Var Watcher.
  if (bass > avgBass * ratio && bass > 0.003 && (lastBeat < 0 || age > 0.34)) {
    lastBeat = now;
    age = 0;
  }
  avgBass = approach(avgBass, bass, delta, 400);
  radius = nLen(age * SPEED_IN);
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }

  var v = 0.03;
  if (age < RING_LIFE) {
    var d = hypot3(x - DORSAL_TIP[0], y - DORSAL_TIP[1], z - DORSAL_TIP[2]);
    var off = abs(d - radius) / RING;
    if (off < 1) v = max(v, (1 - off) * (1 - age / RING_LIFE));
    if (bb >= 0) v = max(v, 1 - age * 4);              // backbone flash, 250 ms
  }
  hsv(hue, 1 - v * 0.4, v);
}
