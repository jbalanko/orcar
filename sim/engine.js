// engine.js -- the Orcar Pixelblaze emulator core, shared by the command-line
// checker (tools/pbsim.mjs -> pbcheck, wiring) and the browser simulator
// (simulator.html). One copy, so the simulator and CI always agree.
//
// It is a plain script (no import/export) so a page opened straight from disk
// can load it with <script src>. It defines one global, orcarEngine(), which
// returns the API. Node loads it with new Function (see tools/pbsim.mjs).
//
// What it is NOT: bit-exact. It uses JavaScript floats, not Pixelblaze's 16.16
// fixed point, and its perlin()/random() are stand-ins. Always confirm on the
// truck.

function orcarEngine() {
  'use strict';

  // -------------------------------------------------------------------------
  // Map normalization -- a copy of the v3.51 Mapper page's normalizeMap().
  // fit = 'fill' (0) or 'contain' (1). Contain centers the shorter axes.
  // The editor quantizes to 16 bits (round(65535*e)); the firmware reads that
  // as a 16.16 fraction, so we divide by 65536.
  // -------------------------------------------------------------------------
  function normalizeMap(points, fit) {
    fit = fit || 'contain';
    const dims = points.reduce((d, p) => Math.max(d, p.length), 0);
    const lo = [], hi = [];
    let longest = 0;
    for (const p of points) {
      for (let t = 0; t < dims; t++) {
        const v = p[t] ?? 0;
        lo[t] = lo[t] === undefined ? v : Math.min(lo[t], v);
        hi[t] = hi[t] === undefined ? v : Math.max(hi[t], v);
        longest = Math.max(longest, hi[t] - lo[t]);
      }
    }
    return points.map((p) => {
      const out = [];
      for (let t = 0; t < dims; t++) {
        const range = hi[t] - lo[t];
        const n = longest !== 0 ? range / longest : 0;
        let e = range === 0 ? 0.5 : ((p[t] ?? 0) - lo[t]) / range;
        if (fit === 'contain') e = e * n + (1 - n) / 2;
        out.push(Math.round(65535 * e) / 65536);
      }
      while (out.length < 3) out.push(0);
      return out;
    });
  }

  // -------------------------------------------------------------------------
  // Synthetic sensor board: 123 BPM kick in the low bins, off-beat hats in the
  // high bins, a slow "song level" swell. Deterministic function of time, so
  // every simulated board sees identical data (like a perfect UDP broadcast).
  // Magnitudes are small on purpose -- real frequencyData values are small and
  // patterns are expected to auto-gain.
  // -------------------------------------------------------------------------
  // Sensor data as the simulator's sound sources supply it (sim/sound.js):
  // one Float32Array frame of SENSOR_FIELDS values per sensor-board packet.
  //   0..31 frequencyData · 32 energyAverage · 33 maxFrequencyMagnitude · 34 maxFrequency (Hz)
  // `level` scales the magnitudes (a quieter or louder room), saturating at 1
  // as the board's 16-bit values do.
  const SENSOR_FIELDS = 35;
  function sensorFromFrame(frames, at, level) {
    const lv = level === undefined ? 1 : level;
    const fd = new Array(32);
    for (let i = 0; i < 32; i++) fd[i] = Math.min(1, frames[at + i] * lv);
    return {
      frequencyData: fd,
      energyAverage: Math.min(1, frames[at + 32] * lv),
      maxFrequency: frames[at + 34],
      maxFrequencyMagnitude: Math.min(1, frames[at + 33] * lv),
      accelerometer: [0, 0, 0.0625],
      light: 0.5,
      analogInputs: [0, 0, 0, 0, 0],
    };
  }
  // A looping clip's frames, read at a board's clock time: the clip position
  // is offsetMs + (tMs - t0), wrapped to the clip's length.
  function clipFrameIndex(clip, tMs) {
    const k = Math.floor((clip.offsetMs + tMs - clip.t0) / clip.frameMs);
    return ((k % clip.count) + clip.count) % clip.count;
  }

  function sensorAt(tMs) {
    const t = tMs / 1000;
    const beat = (t * 2.05) % 1;              // 123 BPM (off the whole-second grid)
    const kick = Math.exp(-beat * 9);
    const hat = Math.exp(-((beat + 0.5) % 1) * 18);
    const level = 0.55 + 0.45 * Math.sin(t * 0.21);
    const fd = new Array(32);
    for (let i = 0; i < 32; i++) {
      const tone = 0.004 * (1 + Math.sin(i * 1.7 + t * 0.9));
      const k = i < 4 ? kick * (0.08 - i * 0.015) : 0;
      const h = i >= 20 && i < 29 ? hat * 0.02 : 0;
      fd[i] = level * (tone + k + h);
    }
    const energy = fd.reduce((a, b) => a + b, 0) / 32;
    let maxI = 0;
    for (let i = 1; i < 32; i++) if (fd[i] > fd[maxI]) maxI = i;
    return {
      frequencyData: fd,
      energyAverage: energy,
      maxFrequency: 20 + maxI * 312,
      maxFrequencyMagnitude: fd[maxI],
      accelerometer: [0, 0, 0.0625],
      light: 0.5,
      analogInputs: [0, 0, 0, 0, 0],
    };
  }

  // -------------------------------------------------------------------------
  // Perlin stand-in (Ken Perlin's improved noise). Range roughly -1..1, wraps
  // every 256. Pixelblaze's own implementation may differ in scale and seed.
  // -------------------------------------------------------------------------
  function makePerlin() {
    const p = new Uint8Array(512);
    const perm = [];
    let s = 1234567;
    for (let i = 0; i < 256; i++) perm.push(i);
    for (let i = 255; i > 0; i--) {
      s = (s * 1103515245 + 12345) >>> 0;
      const j = s % (i + 1);
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (t, a, b) => a + t * (b - a);
    const grad = (h, x, y, z) => {
      h &= 15;
      const u = h < 8 ? x : y;
      const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
      return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    };
    let wrap = [256, 256, 256];
    function noise(x, y, z, seed = 0) {
      x += seed * 17.13; y += seed * 31.7;
      const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
      x -= X; y -= Y; z -= Z;
      const Xi = ((X % wrap[0]) + wrap[0]) % wrap[0];
      const Yi = ((Y % wrap[1]) + wrap[1]) % wrap[1];
      const Zi = ((Z % wrap[2]) + wrap[2]) % wrap[2];
      const X1 = (Xi + 1) % wrap[0], Y1 = (Yi + 1) % wrap[1], Z1 = (Zi + 1) % wrap[2];
      const u = fade(x), v = fade(y), w = fade(z);
      const h = (a, b, c) => p[p[p[a] + b] + c];
      return lerp(w,
        lerp(v, lerp(u, grad(h(Xi, Yi, Zi), x, y, z), grad(h(X1, Yi, Zi), x - 1, y, z)),
                lerp(u, grad(h(Xi, Y1, Zi), x, y - 1, z), grad(h(X1, Y1, Zi), x - 1, y - 1, z))),
        lerp(v, lerp(u, grad(h(Xi, Yi, Z1), x, y, z - 1), grad(h(X1, Yi, Z1), x - 1, y, z - 1)),
                lerp(u, grad(h(Xi, Y1, Z1), x, y - 1, z - 1), grad(h(X1, Y1, Z1), x - 1, y - 1, z - 1))));
    }
    return {
      noise,
      setWrap(a, b, c) { wrap = [a, b, c].map((v) => Math.max(2, Math.min(256, Math.floor(v)))); },
    };
  }

  // -------------------------------------------------------------------------
  // Source preparation
  // -------------------------------------------------------------------------
  const SENSOR_VARS = ['frequencyData', 'energyAverage', 'maxFrequency',
    'maxFrequencyMagnitude', 'accelerometer', 'light', 'analogInputs'];
  const CONTROL_PREFIXES = ['slider', 'hsvPicker', 'rgbPicker', 'toggle', 'trigger',
    'inputNumber', 'showNumber', 'gauge'];

  // Pixelblaze's `export` isn't JavaScript we can eval in a script context, so
  // strip it (in place: line numbers don't move) and remember what was exported.
  function prepareSource(src) {
    const exports = [];
    const out = src.replace(/(^|[\s;}])export\s+(var|function)\s+([A-Za-z_$][\w$]*)/g,
      (m, pre, kind, name) => { exports.push({ kind, name }); return `${pre}${kind} ${name}`; });
    return { code: out, exports };
  }

  // Line number of a runtime error inside the pattern (both hosts name the
  // source "pattern.js"), or 0 if the engine can't tell.
  function errorLine(e) {
    const m = String((e && e.stack) || '').match(/pattern\.js:(\d+)/);
    return m ? +m[1] : 0;
  }

  // -------------------------------------------------------------------------
  // Create one simulated controller.
  //
  // host: where the pattern's globals live -- every board needs its own,
  //   just like the real controllers. { G: the global object, run(code) }.
  //   Node passes a vm context; the browser passes a Web Worker's own global.
  // opts: { src, pixelCount, nodeId, mapPoints (normalized [x,y,z] list),
  //         startMs, sensor: 'live' | 'none' | function(tMs) -> data, sensorLatencyMs, sensorDropRate }
  // sensor 'none' = no sensor board: the sensor variables are never filled in,
  // so patterns must declare defaults (export var frequencyData = array(32)).
  // 'live' = the synthetic data from sensorAt(); a function supplies its own
  // (the simulator's sound sources).
  // Latency/drops model imperfect UDP delivery to a follower.
  // -------------------------------------------------------------------------
  function createBoard(opts, host) {
    const { pixelCount, nodeId } = opts;
    const map = opts.mapPoints || [];
    const perlin = makePerlin();
    const stats = { calls: {}, arraysAllocatedAfterLoad: 0, colourSets: 0,
      badColour: [], unsetPixels: 0, multiSetPixels: 0, errors: [], errorInfo: [] };
    let loaded = false;
    let nowMs = opts.startMs ?? 0;
    let curIndex = -1, setsThisPixel = 0;
    const pixels = new Float64Array(pixelCount * 3);
    let palette = null;
    let prngState = 1;
    const xform = { m: identity() };
    const G = host.G;
    let CtxArray = Array;

    function count(name) { stats.calls[name] = (stats.calls[name] || 0) + 1; }
    function frac(v) { return v - Math.trunc(v); }
    function wrap01(v) { return v - Math.floor(v); }
    function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
    function noteError(prefix, e) {
      if (stats.errors.length < 5) {
        stats.errors.push(`${prefix}: ${e.message}`);
        stats.errorInfo.push({ when: prefix, message: e.message, line: errorLine(e), syntax: e.name === 'SyntaxError' });
      }
    }

    function setRGB(r, g, b, fn, args) {
      count(fn);
      setsThisPixel++;
      if (args.some((a) => typeof a !== 'number' || !Number.isFinite(a))) {
        if (stats.badColour.length < 5) stats.badColour.push({ index: curIndex, fn, args: args.map(String) });
        r = g = b = 0;
      } else if (args.some((a) => Math.abs(a) > 32767)) {
        if (stats.badColour.length < 5) stats.badColour.push({ index: curIndex, fn, args, note: 'outside 16.16 range: overflow on device' });
      }
      pixels[curIndex * 3] = clamp(r, 0, 1);
      pixels[curIndex * 3 + 1] = clamp(g, 0, 1);
      pixels[curIndex * 3 + 2] = clamp(b, 0, 1);
    }
    function hsvToRgb(h, s, v) {
      h = wrap01(h); s = clamp(s, 0, 1); v = clamp(v, 0, 1);
      const i = Math.floor(h * 6), f = h * 6 - i;
      const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
      return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    }
    function makeArray(n) {
      if (!(n >= 1)) throw new Error(`array(${n}) is illegal on Pixelblaze (size must be >= 1)`);
      if (loaded) stats.arraysAllocatedAfterLoad += n;
      return new CtxArray(Math.floor(n)).fill(0);
    }
    function identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
    function mul(a, b) { // column-major 4x4 multiply a*b
      const r = new Array(16).fill(0);
      for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++)
        for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k];
      return r;
    }
    function applyX(m) { xform.m = mul(m, xform.m); }

    const builtins = {
      pixelCount,
      PI: Math.PI, PI2: Math.PI * 2, PI3_4: Math.PI * 0.75, PISQ: Math.PI * Math.PI,
      E: Math.E, LN2: Math.LN2, LN10: Math.LN10, LOG2E: Math.LOG2E, LOG10E: Math.LOG10E,
      SQRT1_2: Math.SQRT1_2, SQRT2: Math.SQRT2,
      HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, INPUT_PULLDOWN: 3, OUTPUT_OPEN_DRAIN: 4, ANALOG: 5,
      abs: (v) => (count('abs'), Math.abs(v)),
      acos: (v) => (count('acos'), Math.acos(v)), asin: (v) => (count('asin'), Math.asin(v)),
      atan: (v) => (count('atan'), Math.atan(v)), atan2: (y, x) => (count('atan2'), Math.atan2(y, x)),
      ceil: Math.ceil, floor: Math.floor, round: Math.round, trunc: Math.trunc,
      clamp: (v, a, b) => clamp(v, a, b),
      cos: (v) => (count('cos'), Math.cos(v)), sin: (v) => (count('sin'), Math.sin(v)), tan: (v) => (count('tan'), Math.tan(v)),
      exp: (v) => (count('exp'), Math.exp(v)), log: (v) => (count('log'), Math.log(v)), log2: (v) => (count('log2'), Math.log2(v)),
      pow: (a, b) => (count('pow'), Math.pow(a, b)), sqrt: (v) => (count('sqrt'), Math.sqrt(v)),
      frac, hypot: (x, y) => (count('hypot'), Math.hypot(x, y)), hypot3: (x, y, z) => (count('hypot3'), Math.hypot(x, y, z)),
      max: Math.max, min: Math.min,
      mod: (x, y) => x - y * Math.floor(x / y),
      random: (m = 1) => (count('random'), Math.random() * m),
      prngSeed: (s) => { const old = prngState; prngState = (Math.floor(s * 65536) >>> 0) || 1; return old; },
      prng: (m = 1) => { count('prng'); let x = prngState; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; prngState = x || 1; return (x / 4294967296) * m; },
      time: (interval) => { count('time'); return wrap01(nowMs / 1000 / (65.536 * interval)); },
      wave: (v) => (count('wave'), (1 + Math.sin(wrap01(v) * Math.PI * 2)) / 2),
      square: (v, d) => (wrap01(v) < d ? 1 : 0),
      triangle: (v) => { v = wrap01(v); return v < 0.5 ? v * 2 : 2 - v * 2; },
      mix: (a, b, w) => a + (b - a) * w,
      smoothstep: (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); },
      bezierQuadratic: (t, p0, p1, p2) => (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2,
      bezierCubic: (t, p0, p1, p2, p3) => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3,
      perlin: (x, y, z, seed) => (count('perlin'), perlin.noise(x, y, z, seed)),
      perlinFbm: (x, y, z, lac, gain, oct) => { count('perlinFbm'); let s = 0, a = 1, f = 1; for (let o = 0; o < oct; o++) { s += a * perlin.noise(x * f, y * f, z * f); a *= gain; f *= lac; } return s; },
      perlinRidge: (x, y, z, lac, gain, off, oct) => { count('perlinRidge'); let s = 0, a = 1, f = 1; for (let o = 0; o < oct; o++) { const n = off - Math.abs(perlin.noise(x * f, y * f, z * f)); s += a * n * n; a *= gain; f *= lac; } return s; },
      perlinTurbulence: (x, y, z, lac, gain, oct) => { count('perlinTurbulence'); let s = 0, a = 1, f = 1; for (let o = 0; o < oct; o++) { s += a * Math.abs(perlin.noise(x * f, y * f, z * f)); a *= gain; f *= lac; } return s; },
      setPerlinWrap: (a, b, c) => perlin.setWrap(a, b, c),
      hsv: (h, s, v) => { const [r, g, b] = hsvToRgb(h, s, v); setRGB(r, g, b, 'hsv', [h, s, v]); },
      hsv24: (h, s, v) => { const [r, g, b] = hsvToRgb(h, s, v); setRGB(r, g, b, 'hsv24', [h, s, v]); },
      rgb: (r, g, b) => setRGB(r, g, b, 'rgb', [r, g, b]),
      setPalette: (a) => { palette = Array.from(a); },
      paint: (v, br = 1) => {
        if (!palette) { setRGB(0, 0, 0, 'paint', [v]); return; }
        v = wrap01(v);
        let r = palette[1], g = palette[2], b = palette[3];
        for (let i = 0; i + 7 < palette.length; i += 4) {
          const p0 = palette[i], p1 = palette[i + 4];
          if (v >= p0 && v <= p1) {
            const w = p1 > p0 ? (v - p0) / (p1 - p0) : 0;
            r = palette[i + 1] + (palette[i + 5] - palette[i + 1]) * w;
            g = palette[i + 2] + (palette[i + 6] - palette[i + 2]) * w;
            b = palette[i + 3] + (palette[i + 7] - palette[i + 3]) * w;
            break;
          }
          if (v > p1) { r = palette[i + 5]; g = palette[i + 6]; b = palette[i + 7]; }
        }
        setRGB(r * br, g * br, b * br, 'paint', [v, br]);
      },
      resetTransform: () => { xform.m = identity(); },
      transform: (...m) => applyX(m),
      translate: (x, y) => applyX([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1]),
      translate3D: (x, y, z) => applyX([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]),
      scale: (x, y) => applyX([x, 0, 0, 0, 0, y, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      scale3D: (x, y, z) => applyX([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]),
      rotate: (a) => applyX([Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      rotateZ: (a) => applyX([Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      rotateX: (a) => applyX([1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]),
      rotateY: (a) => applyX([Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]),
      pixelMapDimensions: () => (map.length ? 3 : 0),
      has2DMap: () => false, has3DMap: () => map.length > 0,
      mapPixels: (fn) => { for (let i = 0; i < pixelCount; i++) { const [x, y, z] = coords(i); fn(i, x, y, z); } },
      analogRead: () => 0, pinMode: () => {}, digitalWrite: () => {}, digitalRead: () => 0, touchRead: () => 0,
      clockYear: () => 2026, clockMonth: () => 10, clockDay: () => 18, clockHour: () => 20,
      clockMinute: () => 0, clockSecond: () => 0, clockWeekday: () => 1,
      nodeId: () => nodeId,
      array: (n) => (count('array'), makeArray(n)),
      arrayForEach: (a, fn) => a.forEach((v, i) => fn(v, i, a)),
      arrayLength: (a) => a.length,
      arrayMapTo: (s, d, fn) => { for (let i = 0; i < s.length; i++) { const v = fn(s[i], i, s); if (i < d.length) d[i] = v; } },
      arrayMutate: (a, fn) => { for (let i = 0; i < a.length; i++) a[i] = fn(a[i], i, a); },
      arrayReduce: (a, fn, init) => { let acc = init; for (let i = 0; i < a.length; i++) acc = fn(acc, a[i], i, a); return acc; },
      arraySort: (a) => a.sort((p, q) => p - q),
      arraySortBy: (a, fn) => a.sort(fn),
      arraySum: (a) => a.reduce((p, q) => p + q, 0),
      arrayReplace: (a, ...v) => { v.forEach((x, i) => { a[i] = x; }); },
      arrayReplaceAt: (a, off, ...v) => { v.forEach((x, i) => { a[off + i] = x; }); },
    };

    const ID = identity();
    function coords(i) {
      let [x, y, z] = i < map.length ? map[i] : [0, 0, 0];
      const m = xform.m;
      if (m.some((v, k) => v !== ID[k])) {
        const nx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const ny = m[1] * x + m[5] * y + m[9] * z + m[13];
        const nz = m[2] * x + m[6] * y + m[10] * z + m[14];
        x = nx; y = ny; z = nz;
      }
      return [x, y, z];
    }

    Object.assign(G, builtins);
    CtxArray = host.run('Array');
    // Array methods Pixelblaze supports as methods
    host.run(`
      Array.prototype.mutate = function (fn) { for (var i = 0; i < this.length; i++) this[i] = fn(this[i], i, this); };
      Array.prototype.mapTo = function (d, fn) { for (var i = 0; i < this.length; i++) { var v = fn(this[i], i, this); if (i < d.length) d[i] = v; } };
      Array.prototype.sum = function () { var s = 0; for (var i = 0; i < this.length; i++) s += this[i]; return s; };
      Array.prototype.sortBy = function (fn) { return this.sort(fn); };
      var __origSort = Array.prototype.sort;
      Array.prototype.sort = function (fn) { return __origSort.call(this, fn || function (a, b) { return a - b; }); };
    `);

    const baseline = new Set(Object.getOwnPropertyNames(G));
    const { code, exports } = prepareSource(opts.src);
    // Sensor vars are filled in by the firmware before each frame (see frame()),
    // not before load -- so a pattern without defaults is tested honestly.
    const sensorFn = typeof opts.sensor === 'function' ? opts.sensor : sensorAt;
    const sensorMode = typeof opts.sensor === 'function' ? 'live' : (opts.sensor || 'live');
    const latency = opts.sensorLatencyMs || 0;
    const dropRate = opts.sensorDropRate || 0;
    let frameNo = 0, lastSensor = null;
    try {
      host.run(code);
    } catch (e) {
      noteError('load', e);
    }
    loaded = true;

    const usesSensor = SENSOR_VARS.filter((v) => exports.some((e) => e.name === v));
    const controls = exports.filter((e) => e.kind === 'function' && CONTROL_PREFIXES.some((p) => e.name.startsWith(p) && e.name.length > p.length));
    const renderFn = ['render3D', 'render2D', 'render'].find((n) => typeof G[n] === 'function');

    function globalsReport() {
      const names = Object.getOwnPropertyNames(G).filter((n) => !baseline.has(n) && !SENSOR_VARS.includes(n) && !n.startsWith('__'));
      const seen = new Set();
      let elements = 0;
      const walk = (v) => {
        if (!Array.isArray(v) || seen.has(v)) return;
        seen.add(v); elements += v.length; v.forEach(walk);
      };
      names.forEach((n) => walk(G[n]));
      return { globals: names.length, arrayElements: elements, names };
    }

    function frame(deltaMs) {
      nowMs += deltaMs;
      frameNo++;
      if (sensorMode === 'live') {
        // deterministic "dropped packet": keep the previous data
        const h = Math.sin(frameNo * 12.9898 + nodeId * 78.233) * 43758.5453;
        const drop = lastSensor && (h - Math.floor(h)) < dropRate;
        const s = drop ? lastSensor : sensorFn(nowMs - latency);
        lastSensor = s;
        for (const v of usesSensor) G[v] = s[v];
      }
      try {
        if (typeof G.beforeRender === 'function') G.beforeRender(deltaMs);
        if (!renderFn) throw new Error('no render(), render2D() or render3D() exported');
        const fn = G[renderFn];
        // Observed on v3.51: render3D/render2D are NOT called for pixels past
        // the end of the map -- they keep their previous colour (frozen).
        const drawn = renderFn === 'render' || !map.length ? pixelCount : Math.min(pixelCount, map.length);
        stats.undrawn = pixelCount - drawn;
        for (let i = 0; i < drawn; i++) {
          curIndex = i; setsThisPixel = 0;
          pixels[i * 3] = pixels[i * 3 + 1] = pixels[i * 3 + 2] = 0;
          if (renderFn === 'render') fn(i);
          else { const [x, y, z] = coords(i); renderFn === 'render3D' ? fn(i, x, y, z) : fn(i, x, y); }
          if (setsThisPixel === 0) stats.unsetPixels++;
          if (setsThisPixel > 1) stats.multiSetPixels++;
        }
      } catch (e) {
        noteError(`frame @${(nowMs / 1000).toFixed(2)}s`, e);
      }
      return pixels;
    }

    function callControl(name, ...args) {
      if (typeof G[name] === 'function') return G[name](...args);
    }

    return { frame, stats, controls, usesSensor, renderFn, globalsReport, callControl,
      get nowMs() { return nowMs; }, get frameCount() { return frameNo; }, ctx: G };
  }

  // -------------------------------------------------------------------------
  // Lint: things Pixelblaze rejects or that break on the truck, found by
  // reading the source. Returns [{ level, text, lines }]. `text` has a
  // "{lines}" placeholder where the line numbers go, so callers can renumber
  // (the simulator shows effect-only line numbers); formatLint() fills it in.
  // -------------------------------------------------------------------------
  function stripComments(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
            .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  }
  function lineOf(s, idx) { return s.slice(0, idx).split('\n').length; }
  function functionBodies(s) {
    const out = [];
    const re = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
    let m;
    while ((m = re.exec(s))) {
      let depth = 1, i = re.lastIndex;
      while (i < s.length && depth) { if (s[i] === '{') depth++; else if (s[i] === '}') depth--; i++; }
      out.push({ name: m[1], start: re.lastIndex, end: i, body: s.slice(re.lastIndex, i - 1) });
    }
    return out;
  }

  function lint(src) {
    const items = [];
    const add = (level, text, lines) => items.push({ level, text, lines: lines || [] });
    const code = stripComments(src);
    const rules = [
      [/["'`]/g, 'error', 'string or template literal -- Pixelblaze has no strings'],
      [/\bswitch\s*\(/g, 'error', 'switch is not supported -- use else-if or an array of functions'],
      [/\b(let|const)\s+[A-Za-z_$]/g, 'error', 'let/const are not supported -- use var'],
      [/\bclass\s+[A-Za-z_$]/g, 'error', 'classes are not supported'],
      [/\bnew\s+[A-Za-z_$]/g, 'error', '"new" is not supported -- use array(n)'],
      [/\bMath\./g, 'error', 'Math.* does not exist -- use the bare functions (sin, floor, PI...)'],
      [/\bconsole\./g, 'error', 'console does not exist -- export a variable and use the Var Watcher'],
      [/\.(push|pop|shift|unshift|splice|slice|concat|indexOf|map|filter)\s*\(/g, 'error', 'unsupported array method -- arrays are fixed size; see reference'],
      [/[=(,:]\s*\{\s*[A-Za-z_$][\w$]*\s*:/g, 'error', 'object literal -- objects are not supported; use arrays + index constants'],
      [/\?\.|\?\?/g, 'error', 'optional chaining / ?? are not supported'],
      [/\.\.\.[A-Za-z_$\[]/g, 'error', 'spread / rest syntax is not supported'],
      [/[=!]==/g, 'warn', '=== / !== are not listed in the Pixelblaze docs -- use == / !='],
      [/\btypeof\b|\binstanceof\b|\btry\b|\bcatch\b|\bthrow\b/g, 'error', 'typeof/instanceof/try/catch/throw are not supported'],
    ];
    for (const [re, level, msg] of rules) {
      let m; re.lastIndex = 0;
      const hits = [];
      while ((m = re.exec(code))) hits.push(lineOf(code, m.index));
      if (hits.length) add(level, `${msg} ({lines})`, [...new Set(hits)].slice(0, 6));
    }
    const PER_FRAME = /^(beforeRender|render|render2D|render3D)$/;
    for (const f of functionBodies(code)) {
      if (!PER_FRAME.test(f.name)) continue;
      const ln = (i) => lineOf(code, f.start + i);
      let m;
      const arr = /\barray\s*\(|=\s*\[|return\s*\[/g;
      while ((m = arr.exec(f.body))) add('error', `${f.name}() allocates an array ({lines}) -- arrays are never freed; allocate at top level`, [ln(m.index)]);
      const rnd = /\brandom\s*\(/g;
      if (f.name === 'beforeRender' && (m = rnd.exec(f.body)))
        add('warn', `beforeRender() calls random() ({lines}) -- each board gets a different answer. For decisions that affect more than one board, seed prng() from a time() slot (see src/examples/05-random-rib-flash.effect.js)`, [ln(m.index)]);
      const hard = /\bindex\s*(<=|>=|<|>|==)\s*\d{2,}/g;
      while ((m = hard.exec(f.body))) add('warn', `${f.name}() compares index to a fixed number ({lines}) -- global indices shift as strands get counted; use inFeature()/featurePos() or tags`, [ln(m.index)]);
      const acc = /([A-Za-z_$][\w$]*)\s*\+=\s*delta\b/g;
      while ((m = acc.exec(f.body))) add('warn', `"${m[1]} += delta" ({lines}) -- grows past 32,767 in ~33 s and overflows; wrap it (mod) or use time(). Also differs per board.`, [ln(m.index)]);
    }
    // Closures: an inner arrow/function that reads the outer function's locals
    // works in JavaScript (and in the emulator) but NOT on Pixelblaze.
    for (const f of functionBodies(code)) {
      const header = code.slice(code.lastIndexOf('function', f.start), f.start);
      const params = (header.match(/\(([^)]*)\)/) || [, ''])[1].split(',').map((s) => s.trim()).filter(Boolean);
      const locals = new Set([...params, ...[...f.body.matchAll(/\bvar\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])]);
      if (!locals.size) continue;
      const arrow = /\(([^()]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>/g;
      let m;
      while ((m = arrow.exec(f.body))) {
        const own = new Set((m[1] ?? m[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
        let i = arrow.lastIndex, depth = 0;
        const startI = i;
        while (i < f.body.length) {
          const c = f.body[i];
          if (c === '(' || c === '{' || c === '[') depth++;
          else if (c === ')' || c === '}' || c === ']') { if (depth === 0) break; depth--; }
          else if ((c === ';' || c === ',') && depth === 0) break;
          i++;
        }
        const inner = f.body.slice(startI, i);
        const used = [...inner.matchAll(/\b[A-Za-z_$][\w$]*\b/g)].map((x) => x[0]).filter((n) => locals.has(n) && !own.has(n));
        if (used.length) add('error', `closure in ${f.name}() ({lines}) reads outer local(s) ${[...new Set(used)].join(', ')} -- Pixelblaze has no closures; pass them as parameters or use globals`, [lineOf(code, f.start + m.index)]);
      }
      for (const nf of f.body.matchAll(/\bfunction\b/g))
        add('warn', `function defined inside ${f.name}() ({lines}) -- it cannot see ${f.name}()'s locals on Pixelblaze; define it at the top level`, [lineOf(code, f.start + nf.index)]);
    }
    for (const f of functionBodies(code)) {
      if (f.name !== 'render3D' && f.name !== 'render') continue;
      const b = f.body;
      const iTags = b.search(/TAGS\s*\[\s*index\s*\]/), iOff = b.search(/index\s*=\s*index\s*\+\s*NODE_OFFSET/);
      const usesTables = /\bTAGS\b|\bBB_POS\b|NODE_OFFSET|inFeature|featurePos|inGroup/.test(b);
      if (usesTables && (iTags < 0 || iOff < 0 || iTags > iOff))
        add('error', `${f.name}() must start with the three "keep" lines: read TAGS[index]/BB_POS[index] BEFORE index = index + NODE_OFFSET`, [lineOf(code, f.start)]);
    }
    if (/function\s+beforeRender/.test(code) && src.includes('buildTags') && !/tagsBuiltFor\s*!=\s*id/.test(code)) {
      const bi = code.search(/function\s+beforeRender/);
      add('error', 'beforeRender() is missing the "keep" block that builds TAGS on the first frame', [lineOf(code, bi)]);
    }
    return items;
  }

  // Fill in an item's "{lines}" placeholder. mapLine renumbers (return 0 to
  // drop a line that isn't in the part being shown).
  function formatLint(item, mapLine) {
    const lines = item.lines.map(mapLine || ((n) => n)).filter((n) => n > 0);
    const label = lines.length ? `line ${lines.join(', ')}` : 'template';
    return item.text.replace('{lines}', label);
  }

  // -------------------------------------------------------------------------
  // Template + effect -> paste-ready pattern (what tools/build.mjs writes).
  // -------------------------------------------------------------------------
  const PATTERN_MARKER = /^\/\/ =+\n\/\/ PATTERN -- keep the marked lines[^\n]*\n\/\/ =+\n/m;

  // The part of the template above the PATTERN marker, or null if the marker
  // is missing.
  function templateHead(templateSrc) {
    const m = templateSrc.match(PATTERN_MARKER);
    return m ? templateSrc.slice(0, m.index) : null;
  }

  function effectBanner(from) {
    return `// =====================================================================\n// EFFECT (built from ${from} -- edit that file, then rebuild with\n// node tools/build.mjs; don't edit this file)\n// =====================================================================\n`;
  }

  // head + banner + effect, exactly as tools/build.mjs writes patterns/.
  function buildPattern(head, effectSrc, from) {
    return head + effectBanner(from) + effectSrc.trim() + '\n';
  }

  // Is this a complete pattern (template included) rather than an effect
  // section? Effect sections never define the template's tag builder.
  function isFullPattern(src) {
    return /function\s+buildTags\s*\(/.test(src);
  }

  return { normalizeMap, sensorAt, SENSOR_FIELDS, sensorFromFrame, clipFrameIndex, makePerlin, prepareSource, createBoard, errorLine,
    lint, formatLint, templateHead, effectBanner, buildPattern, isFullPattern,
    SENSOR_VARS, CONTROL_PREFIXES };
}
