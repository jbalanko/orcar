// 03 RIB CHASE -- ribs light one after another, nose to tail, each one
// sweeping clockwise (starboard, over the top, to port).
//
// Shows:    building your OWN per-pixel lookup table on the first frame
//           (which rib, how far along it) and featurePos() directions.
// Looks:    a comet runs up and over each rib in turn, leaving a fading
//           glow on the ribs it has passed.
// Sync:     safe -- the current rib and progress come from time().
// Bonus:    doubles as a direction test (test 5 in the project task list): the
//           comet must always start on the STARBOARD side. If a rib starts
//           on port, flip its `reversed` flag in the template.
// Try:      do the same for spines with GROUP_ALL_SPINES.

var RIB_ORD = array(pixelCount);   // local index -> 0..nRibs-1 (nose->tail), or -1
var RIB_POS = array(pixelCount);   // local index -> 0..1 along that rib (CW)
var nRibs = 0;                     // installed ribs (count > 0)
var builtFor = -1;

var secondsPerRib = 0.4;
export function sliderSpeed(v) { secondsPerRib = mix(1.5, 0.15, v); }

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

var cursor = 0;    // 0..nRibs: which rib, plus progress along it

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
  // One lap of all ribs, plus a 1-rib pause, in sync on every board
  var lap = (nRibs + 1) * secondsPerRib;
  cursor = time(lap / 65.536) * (nRibs + 1);
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
  if (rib < 0) { hsv(0, 0, 0); return; }          // not a rib

  var current = floor(cursor);
  var progress = cursor - current;                // 0..1 along the current rib
  var v = 0;
  if (rib == current) {
    var behind = progress - pos;                  // >0 once the comet has passed
    if (behind >= 0) v = max(0.15, 1 - behind * 4);   // bright head, short tail, faint glow
  } else if (rib < current) {
    v = 0.15 * (1 - (cursor - rib - 1) / nRibs);  // ribs already passed glow faintly
  }
  hsv(0.5 + rib * 0.03, 0.9, v);
}
