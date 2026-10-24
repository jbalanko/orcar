// ASSEMBLY -- the whale builds itself up piece by piece, then bursts into colour.
//
// Looks:    the whale starts dark. One fin slowly fades in white and fades
//           away, then another fin, then two fins, then a rib, then two ribs,
//           a spine, two spines... From there the pieces (ribs, spines,
//           dorsal, pectorals, fluke) are chosen at random, more of them each
//           time, and the fades get shorter until the pieces come in as
//           bright white flashes that decay. The finale flickers random
//           halves of the whole whale, then everything flashes together a
//           few times. It goes dark for a moment, then the whole whale comes
//           on bright white at once. A rainbow washes over it nose to tail
//           and keeps washing along the body for a while, then fades to
//           black and the show starts again.
// Sync:     safe -- the timeline is a pure function of time(); which pieces
//           light comes from prng() seeded by slot number in beforeRender,
//           the same draws on every board.
// Safety:   no piece, and no large area, flashes faster than 2.5 Hz (slots
//           are at least 0.4 s), inside the 3 Hz limit of contract s8.
// Try:      "Pace" scales the whole show (about 70 s .. 4.5 min);
//           "Rainbow Length" sets how long the final rainbow wash lasts.

var pace = 1;           // slider: 1 = default speed, larger = slower
var rainbowSecs = 38;   // slider: how long the final rainbow wash lasts
export function sliderPace(v) { pace = mix(0.5, 2, v); }
export function sliderRainbowLength(v) { rainbowSecs = mix(15, 75, v); }

// ---- the timeline, in seconds at pace 1 ----
var INTRO = 3;          // dark at the start
var NSLOTS = 36;        // build-up slots
var SLOT_LONG = 6;      // first build slot (slow fade in and out)
var SLOT_SHORT = 0.45;  // last build slot (quick flash)
var FIN_SLOT = 0.4;     // finale flicker slots (2.5 Hz, under the 3 Hz limit)
var FIN_SLOTS = 15;     // the last FIN_ALL of them light everything
var FIN_ALL = 3;
var DARK = 1.5;         // dark pause before the big flash
var WHITE = 3;          // everything bright white
var OUTRO = 4;          // fade to black (the end of the rainbow wash)

// ---- pieces: every installed rib, spine and fin ----
var MAXP = 40;                       // more than all features in the template
var PIECE = array(pixelCount);       // local index -> piece number, or -1
var PIECE_F = array(MAXP);           // piece number -> feature
var KIND = array(MAXP);              // 0 fin, 1 rib, 2 spine
var PIECE_V = array(MAXP);           // brightness this frame (build-up)
var PIECE_DELAY = array(MAXP);       // when it starts within the slot, or -1
var CAND = array(MAXP);              // scratch list for picking
var nPieces = 0;
var builtFor = -1;

function addPiece(f, kind) {
  if (f[F_COUNT] == 0 || nPieces >= MAXP) return;   // not installed: skip
  PIECE_F[nPieces] = f;
  KIND[nPieces] = kind;
  var lo = NODE_OFFSET;
  var hi = NODE_OFFSET + pixelCount - 1;
  for (var i = max(f[F_START], lo); i <= min(f[F_END], hi); i++) PIECE[i - lo] = nPieces;
  nPieces++;                         // counted on EVERY board, so all agree
}

function buildPieces() {
  PIECE.mutate((v) => -1);
  nPieces = 0;
  addPiece(DORSAL, 0);
  addPiece(LEFT_PECTORAL, 0);
  addPiece(RIGHT_PECTORAL, 0);
  addPiece(FLUKE, 0);
  for (var r = 0; r < GROUP_ALL_RIBS.length; r++) addPiece(GROUP_ALL_RIBS[r], 1);
  for (var s = 0; s < GROUP_ALL_SPINES.length; s++) addPiece(GROUP_ALL_SPINES[s], 2);
}

// Clear the picks, then light n pieces of one kind (-1 = any kind). If
// that kind isn't installed, any piece will do.
function pick(kind, n, maxDelay) {
  for (var p = 0; p < MAXP; p++) PIECE_DELAY[p] = -1;
  var nc = 0;
  for (var q = 0; q < nPieces; q++) {
    if (kind < 0 || KIND[q] == kind) { CAND[nc] = q; nc++; }
  }
  if (nc == 0) { for (var a = 0; a < nPieces; a++) CAND[a] = a; nc = nPieces; }
  n = min(n, nc);
  for (var i = 0; i < n; i++) {      // partial shuffle: n distinct pieces
    var j = i + floor(prng(nc - i));
    var tmp = CAND[i]; CAND[i] = CAND[j]; CAND[j] = tmp;
    PIECE_DELAY[CAND[i]] = prng(maxDelay);
  }
}

// Brightness through one slot (u = 0..1). sharp 0 = slow fade in and out,
// sharp 1 = a near-instant flash that decays. Dark for the last bit so each
// piece visibly "turns off" before the next.
function envelope(u, sharp) {
  u = u / 0.85;
  if (u <= 0 || u >= 1) return 0;
  var a = mix(0.45, 0.04, sharp);
  if (u < a) { var up = u / a; return up * up * (3 - 2 * up); }
  var d = 1 - (u - a) / (1 - a);
  return pow(d, mix(1.5, 3, sharp));
}

function slotLen(k) { return mix(SLOT_LONG, SLOT_SHORT, pow(k / (NSLOTS - 1), 0.6)); }

// mode: 0 dark, 1 build-up / finale (PIECE_V), 2 white, 3 rainbow
var mode = 0;
var white = 0;          // white level (modes 2 and 3)
var front = 0;          // rainbow front, 0 nose .. past the tail
var rbPhase = 0;        // rainbow scroll
var glow = 1;           // fades the rainbow out at the end
var Y_SPAN = Y_HI - Y_LO;

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
  if (builtFor != id) { buildPieces(); builtFor = id; }
  // --- your per-frame code ---
  var buildLen = 0;
  for (var k = 0; k < NSLOTS; k++) buildLen += slotLen(k);
  var finLen = FIN_SLOTS * FIN_SLOT;
  var total = INTRO + buildLen + finLen + DARK + WHITE + rainbowSecs;

  var t = time(total * pace / 65.536) * total;   // seconds into the show at pace 1
  rbPhase = time(9 / 65.536);

  if (t < INTRO) { mode = 0; return; }
  t -= INTRO;

  if (t < buildLen) {
    // Find this slot and how far through it we are
    var slot = 0;
    var start = 0;
    while (slot < NSLOTS - 1 && t >= start + slotLen(slot)) { start += slotLen(slot); slot++; }
    var u = (t - start) / slotLen(slot);
    var prog = slot / (NSLOTS - 1);
    var sharp = smoothstep(0.2, 0.8, prog);

    prngSeed(slot + 1);
    if (slot == 0 || slot == 1) pick(0, 1, 0);       // a fin, another fin
    else if (slot == 2) pick(0, 2, 0);               // a couple of fins
    else if (slot == 3) pick(1, 1, 0);               // a rib
    else if (slot == 4) pick(1, 2, 0);               // two ribs
    else if (slot == 5) pick(2, 1, 0);               // a spine
    else if (slot == 6) pick(2, 2, 0);               // two spines
    else pick(-1, 1 + floor(pow(prog, 1.3) * max(2, nPieces * 0.55)), mix(0.1, 0.35, sharp));

    var peak = mix(0.75, 1, sharp);
    for (var p = 0; p < nPieces; p++) {
      var dl = PIECE_DELAY[p];
      PIECE_V[p] = dl < 0 ? 0 : peak * envelope((u - dl) / (1 - dl), sharp);
    }
    mode = 1;
    return;
  }
  t -= buildLen;

  if (t < finLen) {
    // Finale: random halves of the whale flicker, then all of it together
    var fs = floor(t / FIN_SLOT);
    var fu = t / FIN_SLOT - fs;
    prngSeed(1000 + fs);
    if (fs >= FIN_SLOTS - FIN_ALL) {
      for (var a = 0; a < MAXP; a++) PIECE_DELAY[a] = 0;
    } else {
      pick(-1, ceil(nPieces * 0.55), 0.15);
    }
    for (var q = 0; q < nPieces; q++) {
      var d2 = PIECE_DELAY[q];
      PIECE_V[q] = d2 < 0 ? 0 : envelope((fu - d2) / (1 - d2), 1);
    }
    mode = 1;
    return;
  }
  t -= finLen;

  if (t < DARK) { mode = 0; return; }
  t -= DARK;

  if (t < WHITE) {
    // Snap on in 0.15 s, hold, then ease down a touch
    mode = 2;
    white = t < 0.15 ? t / 0.15 : mix(1, 0.85, smoothstep(1, WHITE, t));
    return;
  }
  t -= WHITE;

  // Rainbow: sweeps in nose to tail over 5 s, keeps washing along the body,
  // then fades out over the last OUTRO seconds.
  mode = 3;
  white = 0.85;
  front = mix(-0.2, 1.3, smoothstep(0, 5, t));
  glow = 1 - smoothstep(rainbowSecs - OUTRO, rainbowSecs, t);
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  var p = PIECE[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---
  if (tags == 0) { kaleidoscope(index); return; }
  if (p < 0 || mode == 0) { hsv(0, 0, 0); return; }

  if (mode == 1) { hsv(0, 0, PIECE_V[p]); return; }
  if (mode == 2) { hsv(0, 0, white); return; }

  // mode 3: rainbow along the body, white ahead of the front
  var yN = (y - Y_LO) / Y_SPAN;
  var col = 1 - smoothstep(front - 0.2, front, yN);   // 1 behind the front
  hsv(yN * 0.9 - rbPhase, col, mix(white, 0.8, col) * glow);
}
