// =====================================================================
// ORCA PLAYGROUND -- a demo of every Pixelblaze UI control type, made for
// the public touch-screen page (web/play.html,
// served as /play.html; see docs/PUBLIC_UI.md).
//
// What it looks like: the whole whale glows in a soft ocean colour, waves of
// a second colour roll from nose to tail, plankton sparkles over the body,
// and a Splash press sends a bright ripple out from the dorsal fin.
//
// Controls (in the order the public page shows them):
//   triggerSplash          Splash        bright ripple spreading out from the dorsal fin tip
//   hsvPickerOceanColour   Ocean Colour  the glow colour of the whole body
//   rgbPickerWaveColour    Wave Colour   colour of the rolling waves
//   toggleRainbowWaves     Rainbow Waves waves cycle through the rainbow instead
//   sliderWaveSpeed        Wave Speed    one lap of the body every 12 s (0) .. 2 s (1)
//   inputNumberWaveCount   Wave Count    how many waves fit along the body (1-8)
//   sliderSparkle          Sparkle       how much plankton twinkles
//   showNumberSplashes     Splashes      splashes since the pattern started
//   gaugeSplashPower       Splash Power  full at a splash, drains as the ripple fades
//
// Readouts: showNumber/gauge values are also mirrored in exported vars named
// after the control (showNumberSplashes -> splashes, gaugeSplashPower ->
// splashPower), so the public page can read them with getVars.
//
// Sync: waves, colours, sparkle and wave count are safe (pure functions of
// position, global index, time() and control values). Splash depends on
// trigger presses on the leader reaching the followers, which is NOT yet
// verified (contract section 11), so this pattern doubles as that test: if
// only board A ripples, triggers don't replicate. Readouts come from
// whichever board the page is connected to (the leader).
//
// Show safety: at most one splash per second (presses inside the gap are
// ignored), and the splash is a moving ring, not a whole-body flash. The
// fastest wave setting makes each pixel pulse at most 4 times per 2 s.
// =====================================================================

// ---- Controls (defaults give a calm look with no control touched) ----
var oceanH = 0.58;   // deep sea blue
var oceanS = 0.9;
var oceanV = 0.6;
var waveR = 0.15;    // cyan waves
var waveG = 0.85;
var waveB = 1;
var speed = 0.3;     // 0..1
var sparkle = 0.3;   // 0..1
var waveCount = 3;   // whole waves along the body
var rainbow = 0;     // 1 = rainbow waves

// ---- Splash state (declared before the controls that use it) ----------
var SPLASH_LOOP = 10;        // seconds per loop of the splash clock
var SPLASH_SECONDS = 1.6;    // how long a ripple lasts (well under one loop)
var SPLASH_GAP = 1;          // minimum seconds between splashes
var splashAt = -1;           // splash clock value at the last splash; -1 = none running
var splashFade = 0;          // 1 at the start of a splash .. 0 at its end
var ripple = -1;             // ripple radius (world units); -1 = no ripple
export var splashes = 0;     // mirrors showNumberSplashes()
export var splashPower = 0;  // mirrors gaugeSplashPower()

function splashClock() { return time(SPLASH_LOOP / 65.536); }

// ---- Control handlers (the order here is the order on the public page) --
export function triggerSplash() {
  var now = splashClock();
  // Ignore presses during the gap after the last splash (flash safety)
  if (splashAt >= 0 && mod(now - splashAt, 1) * SPLASH_LOOP < SPLASH_GAP) return;
  splashAt = now;
  splashes = splashes + 1;
}
export function hsvPickerOceanColour(h, s, v) { oceanH = h; oceanS = s; oceanV = v; }
export function rgbPickerWaveColour(r, g, b) { waveR = r; waveG = g; waveB = b; }
export function toggleRainbowWaves(on) { rainbow = on; }
export function sliderWaveSpeed(v) { speed = v; }
export function inputNumberWaveCount(v) { waveCount = clamp(round(v), 1, 8); }  // range 1..8
export function sliderSparkle(v) { sparkle = v; }
export function showNumberSplashes() { return splashes; }
export function gaugeSplashPower() { return splashPower; }

// The ripple starts at the dorsal fin tip and runs out past the nose and fluke tips
var SPLASH_ORIGIN = DORSAL_TIP;
var SPLASH_REACH = max(
  hypot3(NOSE_TIP[0] - SPLASH_ORIGIN[0], NOSE_TIP[1] - SPLASH_ORIGIN[1], NOSE_TIP[2] - SPLASH_ORIGIN[2]),
  hypot3(FLUKE_TIP_LEFT[0] - SPLASH_ORIGIN[0], FLUKE_TIP_LEFT[1] - SPLASH_ORIGIN[1], FLUKE_TIP_LEFT[2] - SPLASH_ORIGIN[2])
) + nLen(12);
var SPLASH_WIDTH = nLen(20);  // thickness of the ripple ring

// ---- Per-frame values ----------------------------------------------------
var waveT = 0;               // wave clock, 0..1 per lap
var sparkT = 0;              // sparkle clock, 0..1 per 6 s
var sparkleOn = 0;
var sparkleCut = 1;          // only the top part of each pixel's twinkle shows
var sparkleGain = 1;
var baseR = 0;               // ocean colour in RGB, dimmed
var baseG = 0;
var baseB = 0;

// HSV -> RGB into baseR/G/B (no objects in Pixelblaze, so it writes globals)
function setBaseFromHsv(h, s, v) {
  h = mod(h, 1);
  var i = floor(h * 6);
  var f = h * 6 - i;
  var p = v * (1 - s);
  var q = v * (1 - f * s);
  var t = v * (1 - (1 - f) * s);
  if (i == 0) { baseR = v; baseG = t; baseB = p; }
  else if (i == 1) { baseR = q; baseG = v; baseB = p; }
  else if (i == 2) { baseR = p; baseG = v; baseB = t; }
  else if (i == 3) { baseR = p; baseG = q; baseB = v; }
  else if (i == 4) { baseR = t; baseG = p; baseB = v; }
  else { baseR = v; baseG = p; baseB = q; }
}

// Kaleidoscope default (contract 3.3): colourful hues drifting along each strand. TEST off.
function kaleidoscope(index) {
  var f = inFeature(EYE_1, index) ? EYE_1 : EYE_2;
  if (!inFeature(f, index)) { hsv(0, 0, 0); return; }   // TEST strand or unassigned
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

  // Waves: one lap of the body every 12 s (speed 0) down to 2 s (speed 1)
  waveT = time((12 - 10 * speed) / 65.536);
  sparkT = time(6 / 65.536);

  // Ocean glow, dimmed so the waves and sparkles stand out
  setBaseFromHsv(oceanH, oceanS, oceanV * 0.35);

  sparkleOn = sparkle > 0.01;
  sparkleCut = 1 - sparkle * 0.35;
  sparkleGain = 1 / (1 - sparkleCut + 0.001);

  // Splash: age from the shared clock, expired well before the clock loops
  if (splashAt >= 0) {
    var age = mod(splashClock() - splashAt, 1) * SPLASH_LOOP;
    if (age >= SPLASH_SECONDS) {
      splashAt = -1;
    } else {
      splashFade = 1 - age / SPLASH_SECONDS;
      ripple = (age / SPLASH_SECONDS) * SPLASH_REACH;
    }
  }
  if (splashAt < 0) { splashFade = 0; ripple = -1; }
  splashPower = splashFade;
}

export function render3D(index, x, y, z) {
  // --- keep: read local tables, then convert to global index ---
  var tags = TAGS[index];
  var bb = BB_POS[index];
  index = index + NODE_OFFSET;
  // --- your per-pixel code ---

  if (tags == 0) { kaleidoscope(index); return; }   // kaleidoscope and TEST first

  var along = (y - Y_LO) / (Y_HI - Y_LO);           // 0 at the nose .. 1 at the tail

  // Waves rolling nose to tail, sharpened into distinct crests
  var w = wave(along * waveCount - waveT);
  w = w * w;
  w = w * w;
  var wr = waveR;
  var wg = waveG;
  var wb = waveB;
  if (rainbow) {
    var hue = along - waveT;
    wr = wave(hue);
    wg = wave(hue - 0.333);
    wb = wave(hue - 0.667);
  }

  // Sparkle: each pixel twinkles on its own phase and rate (deterministic, sync safe)
  var sp = 0;
  if (sparkleOn) {
    var ph = frac(index * 0.6180339);
    var tw = wave(sparkT * (1 + floor(ph * 3)) + ph);
    sp = max(0, tw - sparkleCut) * sparkleGain;
    sp = sp * sp;
  }

  // Splash ring spreading out from the dorsal fin tip
  var spl = 0;
  if (ripple >= 0) {
    var d = hypot3(x - SPLASH_ORIGIN[0], y - SPLASH_ORIGIN[1], z - SPLASH_ORIGIN[2]);
    var off = abs(d - ripple) / SPLASH_WIDTH;
    if (off < 1) spl = (1 - off) * splashFade;
  }

  rgb(
    min(1, baseR + wr * w * 0.9 + sp * 0.8 + spl),
    min(1, baseG + wg * w * 0.9 + sp * 0.9 + spl),
    min(1, baseB + wb * w * 0.9 + sp + spl)
  );
}
