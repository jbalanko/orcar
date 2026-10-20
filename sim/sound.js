// sound.js -- the simulator's sound sources, analysed the way the Pixelblaze
// sensor board analyses its microphone.
//
// The sensor board (open source: github.com/simap/pixelblaze_sensor_board)
// samples audio at 20 kHz and, for every 512 samples (25.6 ms, about 39
// packets a second), sends:
//   frequencyData[32]  buckets 0-5 from a 32-point FFT of the audio averaged
//                      down to 400 Hz (12.5 Hz bins), buckets 6-31 from a
//                      512-point FFT (39 Hz bins), each bucket the largest bin
//                      in its range, so the buckets are NOT evenly spaced
//   energyAverage      mean absolute sample value
//   maxFrequencyMagnitude, maxFrequency   the strongest 39 Hz bin and its Hz
// This file does the same on any audio: resampled to 20 kHz, windowed,
// FFT'd, bucketed with the firmware's bucket table.
//
// What isn't known: the absolute scale. The board's values depend on its
// microphone and the room, and haven't been measured on the truck yet. The
// scale here (SCALE) puts loud music's kick buckets near 0.1, the range the
// emulator's earlier synthetic data used, and both FFTs are scaled so a tone
// reads about the same in a low bucket as in a high one. (The low path
// averages blocks of 50 samples, as the firmware does, so it reads a little
// low toward 160 Hz and lets some 300-400 Hz through into the kick buckets.
// The board does the same.) The Level control covers
// "quiet room" to "loud music". Effects are expected to auto-gain anyway.
//
// Sources: a synthetic beat (generated here, no audio file in the repo), an
// audio file, or the microphone. A clip (beat or file) is analysed in
// advance into one frame per packet, so the boards can read it at any
// simulated time: pause, step, slow motion and sync stress all line up.
// The microphone is analysed live.
//
// Defines one global, OrcarSound. The analysis part (analyzeClip, analyzeAt,
// BUCKETS) needs no browser, so tools/sim-selftest.mjs tests it in Node.

var OrcarSound = (function () {
  'use strict';

  var RATE = 20000, HIGH_N = 512, LOW_N = 32, DECIM = 50;
  var FRAME_MS = HIGH_N / RATE * 1000;   // 25.6
  var FIELDS = 35;                       // = engine SENSOR_FIELDS
  var SCALE = 0.2;                       // a full-scale sine reads 0.2 (saturates at 1)

  // ------------------------------------------------------------------ bucket table
  // [first bin, last bin] of each bucket. Low: 12.5 Hz bins of the 400 Hz FFT.
  // High: 39.0625 Hz bins of the 20 kHz FFT. From the firmware's
  // lowFrequencyMap / highFrequencyMap (see docs/PIXELBLAZE_REFERENCE.md §8).
  var LOW_MAP = [[3, 3], [4, 4], [5, 6], [7, 8], [9, 10], [11, 13]];
  var HIGH_MAP = [[5, 5], [6, 6], [7, 8], [9, 10], [11, 12], [13, 15], [16, 18], [19, 22], [23, 25], [26, 30],
    [31, 35], [36, 40], [41, 46], [47, 53], [54, 61], [62, 70], [71, 80], [81, 92], [93, 105], [106, 119],
    [120, 136], [137, 154], [155, 175], [176, 199], [200, 225], [226, 255]];
  var BUCKETS = LOW_MAP.map(function (r) { return [r[0] * 12.5, r[1] * 12.5]; })
    .concat(HIGH_MAP.map(function (r) { return [r[0] * RATE / HIGH_N, r[1] * RATE / HIGH_N]; }));

  // ------------------------------------------------------------------ FFT
  function makeFft(n) {
    var bits = Math.log2(n), rev = new Uint16Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (var i = 0; i < n; i++) { var r = 0; for (var b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    for (var k = 0; k < n / 2; k++) { cos[k] = Math.cos(2 * Math.PI * k / n); sin[k] = -Math.sin(2 * Math.PI * k / n); }
    var win = new Float64Array(n);
    for (var w = 0; w < n; w++) win[w] = 0.5 - 0.5 * Math.cos(2 * Math.PI * w / n);   // Hann
    var re = new Float64Array(n), im = new Float64Array(n), mag = new Float64Array(n / 2);
    // input: n samples (already in re order) -> mag[0..n/2), normalized so a
    // sine of amplitude a gives a in its bin
    return function (input) {
      for (var i = 0; i < n; i++) { re[rev[i]] = input[i] * win[i]; im[rev[i]] = 0; }
      for (var size = 2; size <= n; size *= 2) {
        var half = size / 2, step = n / size;
        for (var s = 0; s < n; s += size) {
          for (var j = 0; j < half; j++) {
            var a = s + j, b = a + half, c = cos[j * step], d = sin[j * step];
            var tr = re[b] * c - im[b] * d, ti = re[b] * d + im[b] * c;
            re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          }
        }
      }
      for (var m = 0; m < n / 2; m++) mag[m] = Math.sqrt(re[m] * re[m] + im[m] * im[m]) * 4 / n;
      return mag;
    };
  }
  var fftHigh = null, fftLow = null;

  // One packet from mono 20 kHz samples, for the 512 samples ending at `end`.
  // Reads before 0 wrap around when `loop` (a looping clip), else are silence.
  var hi = new Float64Array(HIGH_N), lo = new Float64Array(LOW_N);
  function analyzeAt(x, end, out, at, loop) {
    if (!fftHigh) { fftHigh = makeFft(HIGH_N); fftLow = makeFft(LOW_N); }
    var n = x.length;
    var get = function (i) { if (i >= 0 && i < n) return x[i]; return loop && n ? x[((i % n) + n) % n] : 0; };
    var sumAbs = 0;
    for (var i = 0; i < HIGH_N; i++) { hi[i] = get(end - HIGH_N + i); sumAbs += Math.abs(hi[i]); }
    // the low path: 50-sample averages (400 Hz), the last 32 of them (80 ms)
    for (var j = 0; j < LOW_N; j++) {
      var s = 0, base = end - (LOW_N - j) * DECIM;
      for (var k = 0; k < DECIM; k++) s += get(base + k);
      lo[j] = s / DECIM;
    }
    var mh = fftHigh(hi), ml = fftLow(lo);
    for (var b = 0; b < 6; b++) out[at + b] = Math.min(1, peak(ml, LOW_MAP[b]) * SCALE);
    for (var c = 0; c < 26; c++) out[at + 6 + c] = Math.min(1, peak(mh, HIGH_MAP[c]) * SCALE);
    // energyAverage: mean |sample|, in the same units as the buckets (on the
    // board a sine's energy reads about 0.64/8 of its bin, so: / 8)
    out[at + 32] = Math.min(1, sumAbs / HIGH_N * SCALE / 8);
    var best = 1;
    for (var f = 2; f < HIGH_N / 2; f++) if (mh[f] > mh[best]) best = f;
    out[at + 33] = Math.min(1, mh[best] * SCALE);
    out[at + 34] = best * RATE / HIGH_N;
    return out;
  }
  function peak(mag, r) { var m = 0; for (var i = r[0]; i <= r[1]; i++) if (mag[i] > m) m = mag[i]; return m; }

  // A whole looping clip (mono, 20 kHz) -> { frames, count, frameMs, durationMs }.
  // The loop is a whole number of packets (the last part-packet is dropped),
  // and playback loops at the same point (Player), so the two never drift.
  // Packet k is what the board sends at k x 25.6 ms: the 512 samples before it.
  function analyzeClip(x) {
    var count = Math.max(1, Math.floor(x.length / HIGH_N));
    x = x.subarray(0, count * HIGH_N);
    var frames = new Float32Array(count * FIELDS), tmp = new Float64Array(FIELDS);
    for (var k = 0; k < count; k++) {
      analyzeAt(x, k * HIGH_N, tmp, 0, true);
      frames.set(tmp, k * FIELDS);
    }
    return { frames: frames, count: count, frameMs: FRAME_MS, durationMs: count * FRAME_MS };
  }

  // ------------------------------------------------------------------ browser audio
  var ctx = null;
  function audio() {
    if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) throw new Error('this browser has no Web Audio'); ctx = new AC(); }
    return ctx;
  }
  // Browsers only start audio after the person clicks or presses a key.
  function unlock() {
    try { var a = audio(); if (a.state !== 'running') a.resume().catch(function () {}); } catch (e) {}
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { try { document.addEventListener(ev, unlock, true); } catch (e) {} });

  // Any AudioBuffer -> mono Float32Array at 20 kHz (the browser resamples).
  async function to20k(buffer) {
    var len = Math.ceil(buffer.duration * RATE);
    var oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, len, RATE);
    var src = oc.createBufferSource(); src.buffer = buffer; src.connect(oc.destination); src.start(0);
    var out = await oc.startRendering();
    return out.getChannelData(0);
  }

  // An audio file's bytes -> { buffer (for playback), analysis }
  var MAX_BYTES = 250 * 1024 * 1024;
  async function loadFile(bytes) {
    if (bytes.byteLength > MAX_BYTES) throw new Error('that file is ' + Math.round(bytes.byteLength / 1048576) + ' MB; use one under 250 MB (about 20 minutes)');
    var buf = await new Promise(function (resolve, reject) {
      var p = audio().decodeAudioData(bytes.slice(0), resolve, function (e) { reject(e || new Error('not an audio file this browser can play')); });
      if (p && p.then) p.then(resolve, reject);
    });
    if (buf.duration > 20 * 60) throw new Error('that file is ' + Math.round(buf.duration / 60) + ' minutes long; use one under 20 minutes');
    if (buf.duration < 1) throw new Error('that file is shorter than a second');
    return { buffer: buf, analysis: analyzeClip(await to20k(buf)) };
  }

  // ------------------------------------------------------------------ the synthetic beat
  // 16 bars at `bpm`: 8 bars of groove (four-on-the-floor kick, claps on 2
  // and 4, hats, an off-beat bassline), a 4-bar breakdown with no kick (pad
  // chords: tests that an effect calms down without a beat), a 2-bar build
  // (snare roll and riser), then a 2-bar drop with stabs. A minor:
  // Am - F - C - G. Deterministic: same bpm, same audio.
  async function renderBeat(bpm) {
    var SR = 44100, beat = 60 / bpm, bar = beat * 4, bars = 16, dur = bar * bars, tail = 2;
    var oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, Math.ceil((dur + tail) * SR), SR);
    var seed = 12345;
    var rnd = function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    var noise = oc.createBuffer(1, SR, SR), nd = noise.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;
    var comp = oc.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.12;
    var master = oc.createGain(); master.gain.value = 0.8;
    comp.connect(master); master.connect(oc.destination);

    function env(g, t, peak, attack, decay) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }
    // shared filters: one per instrument, not one per note (renders much faster)
    function bus(type, freq, q) { var f = oc.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q; f.connect(comp); return f; }
    var clickBus = bus('highpass', 3000), clapBus = bus('bandpass', 1300, 1.2), hatBus = bus('highpass', 7500),
      snareBus = bus('bandpass', 1900, 0.8), leadBus = bus('lowpass', 2400, 2);
    function noiseSrc(t, len) { var s = oc.createBufferSource(); s.buffer = noise; s.start(t, rnd() * 0.5, len); return s; }
    function kick(t, v) {
      var o = oc.createOscillator(), g = oc.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.07);
      env(g, t, v, 0.002, 0.42); o.connect(g); g.connect(comp); o.start(t); o.stop(t + 0.5);
      var n = noiseSrc(t, 0.01), gc = oc.createGain();
      env(gc, t, 0.25 * v, 0.001, 0.008);
      n.connect(gc); gc.connect(clickBus);
    }
    function clap(t, v) {
      var n = noiseSrc(t, 0.3), g = oc.createGain();
      g.gain.setValueAtTime(0.0001, t);
      [0, 0.011, 0.022].forEach(function (d) { g.gain.linearRampToValueAtTime(v, t + d + 0.001); g.gain.linearRampToValueAtTime(v * 0.25, t + d + 0.009); });
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      n.connect(g); g.connect(clapBus);
    }
    function hat(t, open, v) {
      var n = noiseSrc(t, open ? 0.3 : 0.08), g = oc.createGain();
      env(g, t, v, 0.001, open ? 0.22 : 0.04); n.connect(g); g.connect(hatBus);
    }
    function snare(t, v) {
      var n = noiseSrc(t, 0.15), g = oc.createGain();
      env(g, t, v, 0.001, 0.09); n.connect(g); g.connect(snareBus);
      var o = oc.createOscillator(), go = oc.createGain();
      o.frequency.value = 190; env(go, t, v * 0.5, 0.001, 0.06); o.connect(go); go.connect(comp); o.start(t); o.stop(t + 0.1);
    }
    function bass(t, f, len) {
      var o = oc.createOscillator(), lp = oc.createBiquadFilter(), g = oc.createGain();
      o.type = 'sawtooth'; o.frequency.value = f;
      lp.type = 'lowpass'; lp.Q.value = 5; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(180, t + len);
      env(g, t, 0.32, 0.004, len); o.connect(lp); lp.connect(g); g.connect(comp); o.start(t); o.stop(t + len + 0.05);
    }
    function chord(t, freqs, len, type, cutoff, v, attack) {
      var lp = oc.createBiquadFilter(), g = oc.createGain();
      lp.type = 'lowpass'; lp.frequency.value = cutoff;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + attack); g.gain.setValueAtTime(v, t + len - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.3);
      lp.connect(g); g.connect(comp);
      freqs.forEach(function (f, k) {
        [-6, 6].forEach(function (cents) {
          var o = oc.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = cents + k;
          o.connect(lp); o.start(t); o.stop(t + len + 0.35);
        });
      });
    }
    function riser(t, len) {
      var n = noiseSrc(t, len), bp = oc.createBiquadFilter(), g = oc.createGain();
      bp.type = 'bandpass'; bp.Q.value = 2; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(8000, t + len);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + len);
      n.connect(bp); bp.connect(g); g.connect(comp);
      // a noise buffer is 1 s long: loop it for long risers
      n.loop = true;
    }
    function lead(t, f, len, v) {
      var o = oc.createOscillator(), g = oc.createGain();
      o.type = 'sawtooth'; o.frequency.value = f;
      env(g, t, v, 0.003, len); o.connect(g); g.connect(leadBus); o.start(t); o.stop(t + len + 0.05);
    }
    var ROOTS = [55, 43.65, 65.41, 49.0];   // A1 F1 C2 G1
    var CHORDS = [[220, 261.6, 329.6], [174.6, 220, 261.6], [261.6, 329.6, 392], [196, 246.9, 293.7]];
    for (var b = 0; b < bars; b++) {
      var t0 = b * bar, ch = Math.floor(b / 2) % 4;
      var groove = b < 8 || b >= 14, breakdown = b >= 8 && b < 12, build = b === 12 || b === 13;
      for (var q = 0; q < 4; q++) {
        var tq = t0 + q * beat;
        if (groove) kick(tq, b >= 14 ? 1 : 0.9);
        if (build && b === 13) kick(tq, 0.5 + q * 0.12);
        if (groove && (q === 1 || q === 3)) clap(tq, 0.5);
        if (groove || build) hat(tq + beat / 2, q === 3 && b % 2 === 1, 0.18);
        if (breakdown && q % 2 === 1) hat(tq + beat / 2, false, 0.07);
        if (groove) { hat(tq + beat / 4, false, 0.06); hat(tq + beat * 3 / 4, false, 0.06); }
        if (groove) bass(tq + beat / 2, ROOTS[ch] * (q === 3 ? 2 : 1), beat * 0.42);
      }
      if (breakdown) chord(t0, CHORDS[ch].map(function (f) { return f / 2; }), bar, 'sawtooth', 1100, 0.07, 0.4);
      if (build) {
        var div = b === 12 ? 4 : 8;
        for (var r = 0; r < 4 * div; r++) snare(t0 + r * beat / div, 0.12 + 0.3 * (r / (4 * div)) * (b === 13 ? 1 : 0.5));
        if (b === 12) riser(t0, bar * 2);
      }
      // a 16th-note arpeggio over the chord in the second half of the groove and the drop (the mids: buckets 10-18)
      if (b >= 14 || (b >= 4 && b < 8)) for (var a16 = 0; a16 < 16; a16++) lead(t0 + a16 * beat / 4, CHORDS[ch][a16 % 3] * (a16 % 8 < 4 ? 2 : 4), beat * 0.22, 0.07);
      if (b >= 14 || (b >= 4 && b < 8)) for (var s2 = 0; s2 < 2; s2++) chord(t0 + s2 * beat * 2 + beat * 1.5, CHORDS[ch], beat * 0.3, 'square', 2600, 0.05, 0.005);
    }
    var rendered = await oc.startRendering();
    // fold the tail (decays past the loop end) back onto the start, so it loops seamlessly
    var n = Math.round(dur * SR);
    var loop = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: SR });
    var sq = 0;
    for (var c = 0; c < 2; c++) {
      var src = rendered.getChannelData(c), dst = loop.getChannelData(c);
      dst.set(src.subarray(0, n));
      for (var j = n; j < src.length; j++) dst[j - n] += src[j];
      for (var p = 0; p < n; p++) sq += dst[p] * dst[p];
    }
    // As loud as mastered dance music: raised to an RMS of about 0.22, then
    // soft-clipped (tanh) so the peaks stay under full scale, as a limiter would.
    var rms = Math.sqrt(sq / (2 * n)), gainV = rms > 0 ? 0.22 / rms : 1;
    for (var c2 = 0; c2 < 2; c2++) { var d2 = loop.getChannelData(c2); for (var q2 = 0; q2 < n; q2++) d2[q2] = 0.95 * Math.tanh(d2[q2] * gainV); }
    return { buffer: loop, analysis: analyzeClip(await to20k(loop)) };
  }

  // ------------------------------------------------------------------ playback
  // Plays a clip from a given position, looping; the page keeps it in step
  // with the simulated clock (Player.sync).
  function Player() { this.src = null; this.buffer = null; this.gain = null; this.volume = 0.7; this.loopSec = 0; }
  // loopSec: the clip's length in whole packets (its analysis' durationMs / 1000)
  Player.prototype.setBuffer = function (buf, loopSec) { this.stop(); this.buffer = buf; this.loopSec = buf ? Math.min(loopSec || buf.duration, buf.duration) : 0; };
  Player.prototype.playing = function () { return !!this.src; };
  Player.prototype.start = function (posSec) {
    this.stop();
    if (!this.buffer) return;
    var a = audio();
    if (!this.gain) { this.gain = a.createGain(); this.gain.connect(a.destination); }
    this.gain.gain.value = this.volume;
    var s = a.createBufferSource();
    s.buffer = this.buffer; s.loop = true; s.loopStart = 0; s.loopEnd = this.loopSec; s.connect(this.gain);
    // start a little ahead, by the time sound takes to reach the speakers (large on Bluetooth)
    var lat = a.outputLatency || a.baseLatency || 0;
    var d = this.loopSec, at = (((posSec + lat) % d) + d) % d;
    s.start(0, at);
    this.src = s; this.startedAt = a.currentTime; this.startPos = at;
  };
  Player.prototype.stop = function () { if (this.src) { try { this.src.stop(); } catch (e) {} this.src.disconnect(); this.src = null; } };
  // Seconds into the clip that the listener is hearing now, or null. (What
  // the context has played, less the time it takes to reach the speakers.)
  Player.prototype.position = function () {
    if (!this.src || !ctx) return null;
    var d = this.loopSec, lat = ctx.outputLatency || ctx.baseLatency || 0;
    return (((this.startPos + ctx.currentTime - this.startedAt - lat) % d) + d) % d;
  };
  // Signed seconds the music is ahead of posSec (behind if negative), around the loop.
  Player.prototype.ahead = function (posSec) {
    var p = this.position();
    if (p === null) return null;
    var d = this.loopSec;
    return ((p - posSec) % d + d * 1.5) % d - d / 2;
  };
  Player.prototype.setVolume = function (v) { this.volume = v; if (this.gain) this.gain.gain.value = v; };
  // want: should it be sounding; posSec: where the boards are in the clip.
  Player.prototype.sync = function (want, posSec) {
    if (!want || !this.buffer || !ctx || ctx.state !== 'running') { this.stop(); return; }   // (audio waits for a click or key)
    var off = this.ahead(posSec);
    if (off === null) { this.start(posSec); return; }
    if (Math.abs(off) > 0.08) this.start(posSec);
  };

  // ------------------------------------------------------------------ microphone
  // Live: every packet, the newest ~85 ms of input, resampled to 20 kHz and
  // analysed. Never played back (it would feed back into the microphone).
  function Mic() { this.stream = null; this.an = null; this.buf = null; this.x = null; this.frame = new Float32Array(FIELDS); }
  Mic.prototype.start = async function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('this browser doesn\'t allow microphone input here');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    var a = audio();
    var src = a.createMediaStreamSource(this.stream);
    // the newest ~90 ms (the low path needs 80 ms), at whatever rate the device runs
    var need = a.sampleRate * 0.09, size = 2048; while (size < need && size < 32768) size *= 2;
    this.an = a.createAnalyser(); this.an.fftSize = size; this.an.smoothingTimeConstant = 0;
    // anti-alias before resampling to 20 kHz (the board's own ADC filter does this job)
    var lp1 = a.createBiquadFilter(), lp2 = a.createBiquadFilter();
    lp1.type = lp2.type = 'lowpass'; lp1.frequency.value = lp2.frequency.value = 9000; lp1.Q.value = 0.54; lp2.Q.value = 1.31;
    var mute = a.createGain(); mute.gain.value = 0;   // keeps the graph running, silently
    src.connect(lp1); lp1.connect(lp2); lp2.connect(this.an); this.an.connect(mute); mute.connect(a.destination);
    this.nodes = [src, lp1, lp2, this.an, mute];
    this.buf = new Float32Array(this.an.fftSize);
    this.rate = a.sampleRate;
    this.x = new Float32Array(Math.floor(this.buf.length * RATE / this.rate));
  };
  Mic.prototype.read = function () {   // -> the packet for "now"
    if (!this.an) return null;
    this.an.getFloatTimeDomainData(this.buf);
    var r = this.rate / RATE, x = this.x, b = this.buf;
    for (var i = 0; i < x.length; i++) {   // box-filter resample (anti-aliased enough for 39 Hz bins)
      var a0 = Math.floor(i * r), a1 = Math.min(b.length, Math.floor((i + 1) * r)), s = 0;
      for (var k = a0; k < a1; k++) s += b[k];
      x[i] = a1 > a0 ? s / (a1 - a0) : 0;
    }
    return analyzeAt(x, x.length, this.frame, 0, false);
  };
  Mic.prototype.stop = function () {
    if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
    (this.nodes || []).forEach(function (n) { try { n.disconnect(); } catch (e) {} });
    this.stream = null; this.an = null; this.nodes = null;
  };

  // ------------------------------------------------------------------ remembering the last file
  // The file's bytes, in this browser's IndexedDB only.
  var IDB = 'orcar-sim-audio';
  function idb() {
    return new Promise(function (resolve, reject) {
      var r = indexedDB.open(IDB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('files'); };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }
  async function saveFile(rec) {
    var db = await idb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(rec, 'last');
      tx.oncomplete = function () { resolve(); }; tx.onerror = function () { reject(tx.error); };
    });
  }
  async function lastFile() {
    var db = await idb();
    return new Promise(function (resolve, reject) {
      var r = db.transaction('files').objectStore('files').get('last');
      r.onsuccess = function () { resolve(r.result || null); }; r.onerror = function () { reject(r.error); };
    });
  }

  return { MAX_BYTES: MAX_BYTES, RATE: RATE, FRAME_MS: FRAME_MS, FIELDS: FIELDS, SCALE: SCALE, BUCKETS: BUCKETS,
    analyzeAt: analyzeAt, analyzeClip: analyzeClip, loadFile: loadFile, renderBeat: renderBeat,
    Player: Player, Mic: Mic, saveFile: saveFile, lastFile: lastFile, audio: audio, unlock: unlock,
    state: function () { return ctx ? ctx.state : 'none'; } };
})();
