// RANDOM TRACE -- a small living spot of light that wanders the whale along
// its strands, resting here and there.
//
// Looks:    the whale glows a dim, slowly shimmering deep blue. A bright spot
//           (white by default) sits on it, breathing: it swells and shrinks a
//           little, more on one side than the other, with a lumpy, uneven
//           outline. After a while it sets off along the strand it's on, and
//           at each crossing of a rib and a spine it may turn, zig-zagging
//           across the whale (with the odd detour) to somewhere else, where
//           it settles again. It stretches into a short tail while it moves.
//           Where it goes and how long it stays are random; it never stays
//           put longer than about a minute (two "slots", see below).
// Sync:     safe -- every trip is planned from a slot number taken from
//           time(), with seeded prng() in beforeRender, over a fixed junction
//           table that's the same on every board. The spot's place along the
//           trip, its breathing and its lumpy outline are pure functions of
//           time(), control values and position.
// Try:      "Spot Colour" (white = saturation at 0); "Background" picker for
//           the whale's glow (brightness 0 turns it off); "Wander Speed" is
//           how fast it travels; "Spot Size" its radius; "Restlessness" how
//           often it moves on (at the lowest it can rest up to about a
//           minute, at the highest up to about 25 s).
//
// How it finds its way: JUNCTIONS (below) lists where strands cross, as
// positions along each strand (featurePos fractions, 0..1 in the default
// direction). Each controller only knows its own pixels' positions, so the
// crossings can't be found at run time; they were measured from the maps
// (pixel pairs on two strands within 4" of each other) on 2026-10-24. Count
// changes don't move them (they're fractions), but if the DXF changes they
// should be measured again. Strand ends with no crossing become dead ends.
// Strands that aren't in the table (R1, R2, R11-R14, the A spines, S6B,
// the fluke) just show the background until they're added.

var slotSecs = 30;    // slider: a trip happens once per slot; a stay is < 2 slots
var speed = 32;       // slider: pixels per second while travelling
var spotSize = 9;     // slider: spot radius, in pixels along the strands
var spotH = 0; var spotS = 0; var spotV = 1;      // picker: the spot (white)
var bgH = 0.62; var bgS = 1; var bgV = 0.22;      // picker: the background

export function sliderWanderSpeed(v) { speed = mix(10, 80, clamp(v, 0, 1)); }
export function sliderSpotSize(v) { spotSize = mix(4, 18, clamp(v, 0, 1)); }
export function sliderRestlessness(v) { slotSecs = mix(30, 12, clamp(v, 0, 1)); }
export function hsvPickerSpotColour(h, s, v) { spotH = h; spotS = s; spotV = v; }
export function hsvPickerBackground(h, s, v) { bgH = h; bgS = s; bgV = v * 0.5; }

// Where strands cross: [feature, position, feature, position, ...] per point.
var JUNCTIONS = [
  [R3, 0.000, S2B, 0.000],
  [R3, 0.167, S3B, 0.000],
  [R3, 0.292, S4B, 0.000],
  [R3, 0.708, S8B, 0.000],
  [R3, 0.833, S9B, 0.000],
  [R3, 1.000, S10B, 0.000],
  [R4, 0.102, S1B, 0.000, RIGHT_PECTORAL, 0.000],
  [R4, 0.190, S2B, 0.123],
  [R4, 0.285, S3B, 0.165],
  [R4, 0.372, S4B, 0.105],
  [R4, 0.445, S5B, 0.000],
  [R4, 0.555, S7B, 0.000],
  [R4, 0.628, S8B, 0.105],
  [R4, 0.715, S9B, 0.161],
  [R4, 0.810, S10B, 0.128],
  [R4, 0.898, S11B, 0.000, LEFT_PECTORAL, 0.000],
  [R5, 0.073, S1B, 0.178],
  [R5, 0.164, S2B, 0.240],
  [R5, 0.242, S3B, 0.323],
  [R5, 0.345, S4B, 0.216],
  [R5, 0.430, S5B, 0.189],
  [R5, 0.570, S7B, 0.194],
  [R5, 0.655, S8B, 0.216],
  [R5, 0.758, S9B, 0.323],
  [R5, 0.836, S10B, 0.238],
  [R5, 0.927, S11B, 0.183],
  [R6, 0.047, S1B, 0.346],
  [R6, 0.141, S2B, 0.345],
  [R6, 0.224, S3B, 0.465],
  [R6, 0.329, S4B, 0.322],
  [R6, 0.418, S5B, 0.368],
  [R6, 0.582, S7B, 0.370],
  [R6, 0.671, S8B, 0.322],
  [R6, 0.776, S9B, 0.468],
  [R6, 0.865, S10B, 0.349],
  [R6, 0.953, S11B, 0.349],
  [R7, 0.041, S1B, 0.505],
  [R7, 0.129, S2B, 0.450],
  [R7, 0.224, S3B, 0.606],
  [R7, 0.324, S4B, 0.421],
  [R7, 0.418, S5B, 0.547],
  [R7, 0.582, S7B, 0.546],
  [R7, 0.676, S8B, 0.421],
  [R7, 0.776, S9B, 0.605],
  [R7, 0.871, S10B, 0.448],
  [R7, 0.959, S11B, 0.505],
  [R8, 0.047, S1B, 0.664],
  [R8, 0.142, S2B, 0.556],
  [R8, 0.231, S3B, 0.748],
  [R8, 0.331, S4B, 0.520],
  [R8, 0.426, S5B, 0.717],
  [R8, 0.574, S7B, 0.722],
  [R8, 0.669, S8B, 0.520],
  [R8, 0.769, S9B, 0.750],
  [R8, 0.858, S10B, 0.552],
  [R8, 0.953, S11B, 0.670],
  [R9, 0.074, S1B, 0.832],
  [R9, 0.160, S2B, 0.661],
  [R9, 0.259, S3B, 0.898],
  [R9, 0.358, S4B, 0.626],
  [R9, 0.438, S5B, 0.906],
  [R9, 0.494, S6C, 0.143],
  [R9, 0.549, S7B, 0.898],
  [R9, 0.636, S8B, 0.620],
  [R9, 0.735, S9B, 0.887],
  [R9, 0.840, S10B, 0.657],
  [R9, 0.926, S11B, 0.835],
  [R10, 0.101, S1B, 1.000],
  [R10, 0.188, S2B, 0.749],
  [R10, 0.289, S3B, 1.000],
  [R10, 0.376, S4B, 0.684],
  [R10, 0.456, S5B, 1.000],
  [R10, 0.497, S6C, 0.286],
  [R10, 0.544, S7B, 1.000],
  [R10, 0.624, S8B, 0.684],
  [R10, 0.711, S9B, 1.000],
  [R10, 0.812, S10B, 0.750],
  [R10, 0.899, S11B, 1.000],
  [S1B, 0.056, RIGHT_PECTORAL, 1.000],
  [S11B, 0.055, LEFT_PECTORAL, 1.000],
  [S6C, 0.000, DORSAL, 1.000],
  [S6C, 1.000, S4B, 1.000, S8B, 1.000],   // tail end: within ~7" of each other
  [DORSAL, 0.535],                        // resting places part way along a strand:
  [LEFT_PECTORAL, 0.510],                 // the dorsal tip and the pectoral tips
  [RIGHT_PECTORAL, 0.510]
];

// Every strand with a position (all but the kaleidoscope and TEST).
var FEATS = [
  R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14,
  S2A, S4A, S6A, S8A, S10A,
  S1B, S2B, S3B, S4B, S5B, S6B, S7B, S8B, S9B, S10B, S11B, S6C,
  FLUKE, DORSAL, LEFT_PECTORAL, RIGHT_PECTORAL
];
var N_FEATS = FEATS.length;

var MAX_STOPS = 224;
var MAX_NODES = 128;
var MAX_PATH = 64;
var MIN_HOPS = 5;       // even a trip back to the same place goes somewhere first
var DETOURS = 4;        // random turns allowed that lead away from the target
var MIN_REST = 1.5;     // seconds: shortest stay at the start of a slot
var END_PAD = 1;        // seconds: a trip ends at least this long before its slot does
var LUMP = 0.35;        // how uneven the spot's outline is
var NOISE_K = 22;       // lumpiness / shimmer noise scale (cells per world unit)
var CLOCK_SECONDS = 655.36;   // time(10) loops every 655.36 s

// The graph: a stop is one strand's place at a node; a node is a point where
// one or more strands meet. A node's stops are contiguous.
var STOP_F = array(MAX_STOPS);     // FEATS index
var STOP_P = array(MAX_STOPS);     // 0..1 along the strand, default direction
var STOP_N = array(MAX_STOPS);     // node
var STOP_RANK = array(MAX_STOPS);  // place among its strand's stops, by position
var ORDER = array(MAX_STOPS);      // stops grouped by strand, sorted by position
var NODE_FIRST = array(MAX_NODES);
var NODE_CNT = array(MAX_NODES);
var DIST = array(MAX_NODES);       // hops to the target (bfs)
var QUEUE = array(MAX_NODES);
var MAIN = array(MAX_NODES);       // nodes of the largest connected part
var FEAT_FIRST = array(N_FEATS);   // where each strand's stops start in ORDER
var FEAT_NS = array(N_FEATS);
var FEAT_LEN = array(N_FEATS);     // pixels from end to end (count - 1)
var ENTRY_D = array(N_FEATS);      // per frame: pixels from the spot to the entry point
var ENTRY_P = array(N_FEATS);      // per frame: entry point, pixels along the strand
var PATH_A = array(MAX_PATH);      // trip segment i runs from stop PATH_A[i]...
var PATH_B = array(MAX_PATH);      // ...along one strand to stop PATH_B[i]
var PATH_CUM = array(MAX_PATH);    // pixels travelled by the end of segment i
var nStops = 0; var nNodes = 0; var nMain = 0; var nPath = 0;

// Per-pixel tables (local index), built on the first frame
var FID = array(pixelCount);       // FEATS index, or -1
var PPX = array(pixelCount);       // pixels along its strand, default direction
var pixBuiltFor = -1;

// FEATS index of feature f, or -1 if it isn't installed
function featIndex(f) {
  if (f[F_COUNT] <= 0) return -1;
  for (var i = 0; i < N_FEATS; i++) {
    if (FEATS[i][F_COUNT] > 0 && FEATS[i][F_START] == f[F_START]) return i;
  }
  return -1;
}

function addNodeStart() { NODE_FIRST[nNodes] = nStops; }
function addStop(fi, p) {
  STOP_F[nStops] = fi; STOP_P[nStops] = p; STOP_N[nStops] = nNodes; nStops++;
}
function addNodeEnd() {
  NODE_CNT[nNodes] = nStops - NODE_FIRST[nNodes];
  if (NODE_CNT[nNodes] > 0) nNodes++;
}

// 1 if strand fi already has a stop within 0.02 of position p
function hasStopNear(fi, p) {
  for (var s = 0; s < nStops; s++) {
    if (STOP_F[s] == fi && abs(STOP_P[s] - p) < 0.02) return 1;
  }
  return 0;
}

// The stop next to stop s along its strand (side -1 or +1), or -1 at an end
function neighbour(s, side) {
  var fi = STOP_F[s];
  var r = STOP_RANK[s] + side;
  if (r < 0 || r >= FEAT_NS[fi]) return -1;
  return ORDER[FEAT_FIRST[fi] + r];
}

// DIST[n] = hops from node src (999 = unreachable)
function bfs(src) {
  for (var i = 0; i < nNodes; i++) DIST[i] = 999;
  DIST[src] = 0;
  QUEUE[0] = src;
  var qh = 0; var qt = 1;
  while (qh < qt) {
    var n = QUEUE[qh]; qh++;
    for (var s = NODE_FIRST[n]; s < NODE_FIRST[n] + NODE_CNT[n]; s++) {
      for (var side = -1; side <= 1; side += 2) {
        var t = neighbour(s, side);
        if (t >= 0 && DIST[STOP_N[t]] == 999) {
          DIST[STOP_N[t]] = DIST[n] + 1;
          QUEUE[qt] = STOP_N[t]; qt++;
        }
      }
    }
  }
}

// ---- Build the graph once, at load (the same on every board) ----
// (In a function so its loop variables don't use up globals.)
function buildGraph() {
  for (var j = 0; j < JUNCTIONS.length; j++) {
    var jn = JUNCTIONS[j];
    if (nNodes >= MAX_NODES) break;
    addNodeStart();
    for (var k = 0; k < jn.length; k += 2) {
      var fi = featIndex(jn[k]);
      if (fi >= 0 && nStops < MAX_STOPS) addStop(fi, jn[k + 1]);
    }
    addNodeEnd();
  }
  for (var f = 0; f < N_FEATS; f++) {
    FEAT_LEN[f] = max(1, FEATS[f][F_COUNT] - 1);
    if (FEATS[f][F_COUNT] <= 0) continue;
    for (var e = 0; e <= 1; e++) {        // strand ends become dead ends
      if (!hasStopNear(f, e) && nNodes < MAX_NODES && nStops < MAX_STOPS) {
        addNodeStart(); addStop(f, e); addNodeEnd();
      }
    }
  }
  // Sort each strand's stops by position.
  var o = 0;
  for (var g = 0; g < N_FEATS; g++) {
    FEAT_FIRST[g] = o;
    for (var s = 0; s < nStops; s++) {
      if (STOP_F[s] != g) continue;
      var i = o;
      while (i > FEAT_FIRST[g] && STOP_P[ORDER[i - 1]] > STOP_P[s]) {
        ORDER[i] = ORDER[i - 1]; i--;
      }
      ORDER[i] = s; o++;
    }
    FEAT_NS[g] = o - FEAT_FIRST[g];
    for (var r = 0; r < FEAT_NS[g]; r++) STOP_RANK[ORDER[FEAT_FIRST[g] + r]] = r;
  }
  // Destinations come from the largest connected part, so a trip can always
  // get there (a newly counted strand with no crossings yet is its own part).
  var bestSize = 0; var bestSrc = 0;
  for (var n = 0; n < nNodes; n++) {
    bfs(n);
    var size = 0;
    for (var m = 0; m < nNodes; m++) if (DIST[m] < 999) size++;
    if (size > bestSize) { bestSize = size; bestSrc = n; }
  }
  bfs(bestSrc);
  for (var q = 0; q < nNodes; q++) {
    if (DIST[q] < 999) { MAIN[nMain] = q; nMain++; }
  }
}
buildGraph();

// ---- Trip planning (per slot; the same on every board) ----
var plannedSlot = -1; var plannedN = -1;
var fromNode = 0; var departFrac = 0;

// Where the spot rests after slot j's trip
function destOf(j) {
  prngSeed(j + 1);
  prng(1); prng(1); prng(1); prng(1);   // early draws track the seed; skip them
  return MAIN[floor(prng(nMain))];
}

// Picks a neighbour of node cur at random. wander = any neighbour (except the
// one we came from, unless it's the only way); otherwise only neighbours
// closer to the target. Fills PATH_A/PATH_B for segment nPath; returns the
// next node, or -1 if there's no choice.
function step(cur, prevNode, wander) {
  var count = 0;
  for (var pass = 0; pass < 2; pass++) {
    var pick = pass ? floor(prng(count)) : -1;
    var c = 0;
    for (var s = NODE_FIRST[cur]; s < NODE_FIRST[cur] + NODE_CNT[cur]; s++) {
      for (var side = -1; side <= 1; side += 2) {
        var t = neighbour(s, side);
        if (t < 0) continue;
        var m = STOP_N[t];
        var ok = wander ? m != prevNode : DIST[m] < DIST[cur];
        if (!ok) continue;
        if (pass && c == pick) { PATH_A[nPath] = s; PATH_B[nPath] = t; return m; }
        c++;
      }
    }
    count = c;
    if (count == 0) {
      if (!wander) return -1;
      // Dead end: turning back is the only way.
      for (var s2 = NODE_FIRST[cur]; s2 < NODE_FIRST[cur] + NODE_CNT[cur]; s2++) {
        for (var side2 = -1; side2 <= 1; side2 += 2) {
          var t2 = neighbour(s2, side2);
          if (t2 >= 0) { PATH_A[nPath] = s2; PATH_B[nPath] = t2; return STOP_N[t2]; }
        }
      }
      return -1;
    }
  }
  return -1;
}

function planTrip(slot, nSlots) {
  fromNode = destOf(mod(slot - 1, nSlots));   // wraps with the clock, so no jump
  var to = destOf(slot);
  prngSeed(slot + 5001);
  prng(1); prng(1); prng(1); prng(1);
  departFrac = prng(1);
  nPath = 0;
  if (nMain < 2) return;
  bfs(to);
  var cur = fromNode; var prevNode = -1; var detours = DETOURS; var cum = 0;
  while (nPath < MAX_PATH && (cur != to || nPath < MIN_HOPS)) {
    var roll = prng(1);     // always drawn, so every board draws the same sequence
    var wander = cur == to || (detours > 0 && roll < 0.3);
    var next = step(cur, prevNode, wander);
    if (next < 0) break;
    if (DIST[next] >= DIST[cur] && cur != to) detours--;
    var s = PATH_A[nPath]; var t = PATH_B[nPath];
    cum += abs(STOP_P[t] - STOP_P[s]) * FEAT_LEN[STOP_F[s]];
    PATH_CUM[nPath] = cum;
    nPath++;
    prevNode = cur; cur = next;
  }
}

// ---- Per-frame state ----
var spotF = 0; var spotPx = 0; var spotDir = 1;
var rAhead = 1; var rBehind = 1; var spotBright = 1;
var drift = 0;
var bgR = 0; var bgG = 0; var bgB = 0;       // background colour at brightness 1
var spR = 1; var spG = 1; var spB = 1;       // spot colour
var cR = 0; var cG = 0; var cB = 0;          // output of hsvToRgb()

function hsvToRgb(h, s, v) {
  h = frac(h) * 6;
  var i = floor(h); var f = h - i;
  var p = v * (1 - s); var q = v * (1 - s * f); var t = v * (1 - s * (1 - f));
  if (i == 0) { cR = v; cG = t; cB = p; }
  else if (i == 1) { cR = q; cG = v; cB = p; }
  else if (i == 2) { cR = p; cG = v; cB = t; }
  else if (i == 3) { cR = p; cG = q; cB = v; }
  else if (i == 4) { cR = t; cG = p; cB = v; }
  else { cR = v; cG = p; cB = q; }
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
  if (pixBuiltFor != id) {                // which strand each pixel is on, and where
    FID.mutate((v) => -1);
    for (var fi = 0; fi < N_FEATS; fi++) {
      var f = FEATS[fi];
      var a = max(f[F_START], NODE_OFFSET);
      var b = min(f[F_END], NODE_OFFSET + pixelCount - 1);
      for (var i = a; i <= b; i++) {
        FID[i - NODE_OFFSET] = fi;
        PPX[i - NODE_OFFSET] = featurePos(f, i) * FEAT_LEN[fi];
      }
    }
    pixBuiltFor = id;
  }

  // Slots: a whole number of them per loop of the clock (as in example 05).
  var nSlots = max(1, floor(CLOCK_SECONDS / slotSecs));
  var slotLen = CLOCK_SECONDS / nSlots;
  var cyc = time(10) * nSlots;
  var slot = floor(cyc);
  var age = (cyc - slot) * slotLen;
  if (slot != plannedSlot || nSlots != plannedN) {
    planTrip(slot, nSlots);
    plannedSlot = slot; plannedN = nSlots;
  }

  // Where along the trip: rest, travel (eased at both ends), rest.
  var total = nPath > 0 ? PATH_CUM[nPath - 1] : 0;
  var travel = max(0.1, min(total / speed, slotLen - MIN_REST - END_PAD));
  var depart = MIN_REST + departFrac * max(0, slotLen - MIN_REST - END_PAD - travel);
  var u = clamp((age - depart) / travel, 0, 1);
  var moving = smoothstep(0, 0.08, u) * (1 - smoothstep(0.92, 1, u));
  var stopA = NODE_FIRST[fromNode]; var stopB = stopA; var w = 0;
  if (nPath > 0) {
    var dist = (0.35 * u + 0.65 * smoothstep(0, 1, u)) * total;
    var seg = 0;
    while (seg < nPath - 1 && PATH_CUM[seg] < dist) seg++;
    var segStart = seg > 0 ? PATH_CUM[seg - 1] : 0;
    stopA = PATH_A[seg]; stopB = PATH_B[seg];
    w = clamp((dist - segStart) / max(0.01, PATH_CUM[seg] - segStart), 0, 1);
  }
  spotF = STOP_F[stopA];
  var len = FEAT_LEN[spotF];
  spotPx = mix(STOP_P[stopA], STOP_P[stopB], w) * len;
  if (nPath > 0) spotDir = STOP_P[stopB] >= STOP_P[stopA] ? 1 : -1;
  // A little fidget along the strand, mostly while resting.
  spotPx = clamp(spotPx + (1 - moving) * 1.5 * (wave(time(3.7 / 65.536)) * 2 - 1), 0, len);

  // Breathing: two sides on their own rhythms, so it's never symmetrical;
  // a trailing tail while it travels.
  var b1 = wave(time(4.3 / 65.536));
  var b2 = wave(time(6.1 / 65.536));
  var b3 = wave(time(2.9 / 65.536));
  rAhead = spotSize * (0.75 + 0.35 * b1 + 0.1 * b3) * (1 - 0.15 * moving);
  rBehind = spotSize * (0.75 + 0.35 * b2 + 0.1 * (1 - b3)) * (1 + 0.8 * moving);
  spotBright = spotV * (0.85 + 0.15 * b1);

  // How far the spot is from where it enters each strand: its own strand,
  // plus any strand that crosses it within reach.
  for (var g = 0; g < N_FEATS; g++) ENTRY_D[g] = 999;
  ENTRY_D[spotF] = 0; ENTRY_P[spotF] = spotPx;
  var reach = max(rAhead, rBehind) * (1 + LUMP);
  for (var r = 0; r < FEAT_NS[spotF]; r++) {
    var s = ORDER[FEAT_FIRST[spotF] + r];
    var dn = abs(STOP_P[s] * len - spotPx);
    if (dn >= reach) continue;
    var n = STOP_N[s];
    for (var t = NODE_FIRST[n]; t < NODE_FIRST[n] + NODE_CNT[n]; t++) {
      var tg = STOP_F[t];
      if (tg != spotF && dn < ENTRY_D[tg]) { ENTRY_D[tg] = dn; ENTRY_P[tg] = STOP_P[t] * FEAT_LEN[tg]; }
    }
  }

  hsvToRgb(bgH, bgS, 1); bgR = cR; bgG = cG; bgB = cB;
  hsvToRgb(spotH, spotS, 1); spR = cR; spG = cG; spB = cB;
  drift = time(10) * 40;   // noise drifts slowly; one jump every 11 minutes
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  var fi = FID[index];
  var px = PPX[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }

  var nz = perlin(x * NOISE_K, y * NOISE_K, z * NOISE_K + drift, 0);
  var bv = bgV * (0.7 + 0.3 * nz);
  var k = 0;
  if (fi >= 0 && ENTRY_D[fi] < 999) {
    var off = px - ENTRY_P[fi];
    var r = (off * spotDir >= 0 ? rAhead : rBehind) * (1 + LUMP * nz);
    var d = ENTRY_D[fi] + abs(off);
    if (d < r) k = smoothstep(0, 1, 1 - d / r);
  }
  if (k <= 0) { rgb(bgR * bv, bgG * bv, bgB * bv); return; }
  var hot = k * k * k * 0.5;               // the centre runs hotter, towards white
  var sv = spotBright * k;
  var rr = mix(spR, 1, hot) * sv;
  var gg = mix(spG, 1, hot) * sv;
  var bl = mix(spB, 1, hot) * sv;
  var keep = (1 - k) * bv;                 // background fades out under the spot
  rgb(rr + bgR * keep, gg + bgG * keep, bl + bgB * keep);
}
