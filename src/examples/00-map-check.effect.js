// 00 MAP CHECK -- confirms the 3D map, its bounds and the normalization
// (MAP_CENTERED) by lighting known parts of the whale by COORDINATES only.
//
// How to read it: the feature each probe SHOULD hit is drawn dim white (by
// feature index, which doesn't depend on the map). The probe lights pixels
// in colour purely from x/y/z. PASS = the colour sits exactly on the dim
// white feature. Colour somewhere else, or white with no colour, means the
// map, the ghost box or MAP_CENTERED is wrong.
//
// Probes (slider "Probe": 0 = all at once, 1..5 = one at a time):
//   1 RIB PLANE   y within 1" of R7's plane (Y 153.31")  -> all of R7, cyan
//                 (plus single pixels where spines cross it). Tests y.
//   2 CENTRELINE  x within 1" of the symmetry plane (X 79.824") -> the
//                 dorsal fin and S6C, magenta (plus the top pixel of each
//                 rib). Tests x CENTRING -- this is the MAP_CENTERED test.
//   3 PORT TIP    x beyond 150" -> only the tip of LEFT_PECTORAL (port),
//                 yellow. Tests the x bounds and scale.
//   4 TOP         z above 120" -> only the top of the dorsal fin, green
//                 (and the fluke tips, once the fluke is counted).
//                 Tests z CENTRING and scale.
//   5 GROUND      z below 1" -> the feet of the ribs that reach the ground
//                 (R4, R5, R7-R10), orange. Tests the z bounds.
// If the template's MAP_CENTERED disagreed with the Mapper (e.g. set to 0
// while Contain centres, which is the mistake this check was built for),
// probes 2 and 4 land far from their white targets: 2 out near the
// starboard pectoral tip, 4 lighting everything above ~39". Pictures of
// pass and fail: docs/img/.
//
// Sync: safe (static). Unmapped strands (kaleidoscope, TEST) are off.

var probe = 0;
export function sliderProbe(v) { probe = floor(v * 5.99); }

var R7_Y   = nY(153.31);
var MID    = nX(79.824);
var PORT_X = nX(150);
var TOP_Z  = nZ(120);
var LOW_Z  = nZ(1);
var TOL    = nLen(1);

export function beforeRender(delta) {
  // --- keep: builds this controller's tables once ---
  var id = nodeId();                      // A=0 ... F=5
  if (tagsBuiltFor != id) {
    NODE_OFFSET = BOARD_OFFSET[id];
    buildTags();
    tagsBuiltFor = id;
  }
  // --- your per-frame code ---
}

function on(p) { return probe == 0 || probe == p; }

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { hsv(0, 0, 0); return; }

  // Probes by coordinates (bright colour). Later probes win where they overlap.
  var hue = -1;
  if (on(1) && abs(y - R7_Y) < TOL) hue = 0.5;     // cyan
  if (on(5) && z < LOW_Z) hue = 0.07;              // orange
  if (on(2) && abs(x - MID) < TOL) hue = 0.83;     // magenta
  if (on(3) && x > PORT_X) hue = 0.16;             // yellow
  if (on(4) && z > TOP_Z) hue = 0.33;              // green
  if (hue >= 0) { hsv(hue, 1, 1); return; }

  // Targets by feature (dim white): where the probes SHOULD land
  var target = 0;
  if (on(1) && inFeature(R7, index)) target = 1;
  if (on(2) && (inFeature(DORSAL, index) || inFeature(S6C, index))) target = 1;
  if (on(3) && inFeature(LEFT_PECTORAL, index)) target = 1;
  if (on(4) && inFeature(DORSAL, index)) target = 1;
  if (on(5) && (tags & TAG_RIB)) target = 1;
  hsv(0, 0, target ? 0.12 : 0);
}
