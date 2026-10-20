// boards.js -- runs the six simulated controllers for simulator.html.
//
// Each board runs in its own Web Worker, so (like the real controllers) each
// has its own globals, and an endless loop in a pattern can't freeze the
// page: a watchdog stops the boards if one stops answering. If a browser
// refuses workers on a page opened from disk, each board runs in a hidden
// iframe instead (same isolation, but no watchdog).
//
// Defines one global, OrcarBoards. Needs sim/engine.js loaded first.

var OrcarBoards = (function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Runs INSIDE a worker or iframe: one simulated controller.
  // port = { post(msg, transfer), on(fn) }; G = that realm's global object;
  // run(code) evaluates code in G's global scope.
  // -------------------------------------------------------------------------
  function boardMain(engineFactory, port, G, run) {
    var engine = engineFactory();
    var board = null;
    var described = false;
    // Sound: what the sensor board would broadcast (see Sim.load's sensor option).
    var sensor = null, live = null, silent = null;
    function sensorOption(cfg) {
      sensor = cfg && cfg.kind !== 'none' ? cfg : null;
      if (!sensor) return 'none';
      silent = new Float32Array(engine.SENSOR_FIELDS);
      if (sensor.kind === 'clip') return function (t) { return engine.sensorFromFrame(sensor.frames, engine.clipFrameIndex(sensor, t) * engine.SENSOR_FIELDS, sensor.level); };
      return function () { return engine.sensorFromFrame(live || silent, 0, sensor.level); };   // live: the latest packet
    }

    function summary() {
      var s = board.stats;
      return {
        errors: s.errorInfo.slice(),
        badColour: s.badColour.slice(0, 2),
        unsetPixels: s.unsetPixels,
        multiSetPixels: s.multiSetPixels,
        arraysAfterLoad: s.arraysAllocatedAfterLoad,
        undrawn: s.undrawn || 0,
        frames: board.frameCount,
      };
    }
    function callControl(name, args) {
      try { board.callControl.apply(null, [name].concat(args || [])); }
      catch (e) { board.stats.errorInfo.length < 5 && board.stats.errorInfo.push({ when: 'control ' + name, message: e.message, line: engine.errorLine(e) }); }
    }
    function describe(names, valueNames) {
      var values = {};
      (valueNames || []).forEach(function (n) {
        var v = G[n];
        if (typeof v === 'number') values[n] = v;
        else if (v && v.length && v.length <= 4 && typeof v[0] === 'number') values[n] = Array.prototype.slice.call(v);
      });
      var features = {};
      (names || []).forEach(function (n) {
        var f = G[n];
        if (f && f.length === 4 && typeof f[0] === 'number') features[n] = [f[0], f[1], f[2], f[3]];
      });
      var arr = function (v) { return v && typeof v.length === 'number' ? Array.prototype.slice.call(v) : null; };
      return { values: values, features: features, boardOffset: arr(G.BOARD_OFFSET), boardTotal: arr(G.BOARD_TOTAL), tags: arr(G.TAGS), bbPos: arr(G.BB_POS) };
    }

    // A control's starting value, when its function just stores its argument
    // in a global (export function sliderSpeed(v) { speed = v }), so the
    // simulator can show the slider where the pattern starts.
    function defaults(controls) {
      var out = {};
      controls.forEach(function (c) {
        var f = G[c.name];
        if (typeof f !== 'function') return;
        var m = String(f).match(/^function\s*[\w$]*\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*([A-Za-z_$][\w$]*)\s*=\s*\1\s*;?\s*\}$/);
        if (m && typeof G[m[2]] === 'number' && isFinite(G[m[2]])) out[c.name] = G[m[2]];
      });
      return out;
    }

    port.on(function (m) {
      try {
        if (m.type === 'load') {
          var sc = m.sensor || null;
          board = engine.createBoard({ src: m.src, pixelCount: m.pixelCount, nodeId: m.nodeId,
            mapPoints: m.mapPoints, startMs: m.startMs, sensor: sensorOption(sc),
            sensorLatencyMs: sc ? sc.latencyMs || 0 : 0, sensorDropRate: sc ? sc.dropRate || 0 : 0 }, { G: G, run: run });
          // Saved control values are sent before the first frame, as on the device.
          var start = defaults(board.controls);
          (m.controlValues || []).forEach(function (c) { callControl(c.name, c.args); });
          var g = board.globalsReport();
          port.post({ type: 'loaded', controls: board.controls, defaults: start, renderFn: board.renderFn || null,
            usesSensor: board.usesSensor, globals: g.globals, arrayElements: g.arrayElements, stats: summary() });
        } else if (m.type === 'frame') {
          // levels: [time, average of each pixel's brightest channel] for every
          // frame rendered, so the page's flash meter sees frames it doesn't draw.
          var px = null, levels = [];
          for (var i = 0; i < m.steps.length; i++) {
            px = board.frame(m.steps[i]);
            var sum = 0, n = px.length / 3;
            for (var j = 0; j < n; j++) sum += Math.max(px[j * 3], px[j * 3 + 1], px[j * 3 + 2]);
            levels.push([board.nowMs, n ? sum / n : 0, m.steps[i]]);
          }
          var out = new Float32Array(px.length);
          out.set(px);
          var readouts = null;
          if (m.readouts) {
            readouts = {};
            m.readouts.forEach(function (n) { try { readouts[n] = +board.callControl(n); } catch (e) { readouts[n] = NaN; } });
          }
          var msg = { type: 'frame', id: m.id, nowMs: board.nowMs, pixels: out, levels: levels, stats: summary(), readouts: readouts };
          if (!described && m.featureNames) { described = true; msg.describe = describe(m.featureNames, m.valueNames); }
          port.post(msg, [out.buffer]);
        } else if (m.type === 'control') {
          callControl(m.name, m.args);
        } else if (m.type === 'sensor') {
          if (sensor && typeof m.level === 'number') sensor.level = m.level;
          if (sensor && typeof m.offsetMs === 'number') sensor.offsetMs = m.offsetMs;
          if (m.live) live = m.live;
        }
      } catch (e) {
        port.post({ type: 'fatal', message: e.message });
      }
    });
    port.post({ type: 'ready' });
  }

  // The code a worker runs: the engine, then boardMain wired to the worker.
  // Built from the functions' own source, so it works from disk (where a
  // worker can't load a .js file by URL) and needs no build step.
  var workerUrl = null;
  function workerSource() {
    return orcarEngine.toString() + '\n' +
      '(function () {\n' +
      '  var P = self.postMessage.bind(self), A = self.addEventListener.bind(self), E = self.eval;\n' +
      '  (' + boardMain.toString() + ')(orcarEngine,\n' +
      '    { post: function (m, t) { P(m, t || []); }, on: function (fn) { A("message", function (e) { fn(e.data); }); } },\n' +
      '    self, function (code) { return E(code + "\\n//# sourceURL=pattern.js"); });\n' +
      '})();\n';
  }

  // -------------------------------------------------------------------------
  // One board's host, seen from the page.
  // -------------------------------------------------------------------------
  function WorkerHost() {
    if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
    var self = this;
    this.kind = 'worker';
    this.w = new Worker(workerUrl);
    this.handler = null;
    this.ready = new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('worker did not start')); }, 4000);
      self.w.onmessage = function (e) {
        if (e.data && e.data.type === 'ready') { clearTimeout(t); resolve(); return; }
        if (self.handler) self.handler(e.data);
      };
      self.w.onerror = function (e) { clearTimeout(t); e.preventDefault && e.preventDefault(); reject(new Error(e.message || 'worker error')); };
    });
  }
  WorkerHost.prototype.send = function (m) { this.w.postMessage(m); };
  WorkerHost.prototype.terminate = function () { this.w.terminate(); };

  // Fallback: a sandboxed iframe (scripts only, no same-origin access), so
  // a pattern can't reach the page. It talks to the page by postMessage, like
  // a worker. Names that windows reserve (top, name, location, status...)
  // behave oddly as pattern globals here; workers don't have that problem.
  function iframeSource() {
    return '<!doctype html><meta charset="utf-8"><title>board</title><script>\n' +
      orcarEngine.toString() + '\n' +
      '(function () {\n' +
      '  var P = parent.postMessage.bind(parent), A = window.addEventListener.bind(window), E = window.eval;\n' +
      '  (' + boardMain.toString() + ')(orcarEngine,\n' +
      '    { post: function (m, t) { P(m, "*", t || []); }, on: function (fn) { A("message", function (e) { if (e.source === parent) fn(e.data); }); } },\n' +
      '    window, function (code) { return E(code + "\\n//# sourceURL=pattern.js"); });\n' +
      '})();\n<' + '/script>';
  }
  function IframeHost() {
    var self = this;
    this.kind = 'iframe';
    this.handler = null;
    this.f = document.createElement('iframe');
    this.f.setAttribute('aria-hidden', 'true');
    this.f.setAttribute('sandbox', 'allow-scripts');
    this.f.tabIndex = -1;
    this.f.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    this.ready = new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('board frame did not start')); }, 4000);
      self.listener = function (e) {
        if (e.source !== self.f.contentWindow) return;
        if (e.data && e.data.type === 'ready') { clearTimeout(t); resolve(); return; }
        if (self.handler) self.handler(e.data);
      };
      window.addEventListener('message', self.listener);
    });
    this.f.srcdoc = iframeSource();
    document.body.appendChild(this.f);
  }
  IframeHost.prototype.send = function (m) { this.f.contentWindow.postMessage(m, '*'); };
  IframeHost.prototype.terminate = function () { window.removeEventListener('message', this.listener); this.f.remove(); };

  var hostKind = null;   // decided by the first board that starts
  function createHost() {
    if (hostKind !== 'iframe') {
      try {
        var h = new WorkerHost();
        return h.ready.then(function () { hostKind = 'worker'; return h; }, function () {
          h.terminate(); hostKind = 'iframe'; return startIframe();
        });
      } catch (e) { hostKind = 'iframe'; }
    }
    return startIframe();
  }
  function startIframe() { var h = new IframeHost(); return h.ready.then(function () { return h; }); }

  // -------------------------------------------------------------------------
  // Sim: the six boards on one shared clock.
  // -------------------------------------------------------------------------
  var T0 = 60000;   // clock value when a run starts (ms). Any value works; not 0 so time() isn't at its seam.
  var NORMAL_FPS = 40;
  // Sync stress: like pbcheck's sync check, but different for every board.
  // Each board has been running for a different time before the run starts,
  // and renders at its own frame rate. Patterns that depend on frame history
  // then disagree at the board seams, as they would on the truck.
  // The rates are chosen, not measured: all different, spread from 17 to
  // 45 fps, and ordered by pixel count (fewest pixels = fastest), with board
  // B (807 pixels) slowest. Replace them with measured FPS once the truck's
  // are known. Boot offsets are arbitrary, 0 to 47 s.
  //            A (235 px)                B (807)                    C (578)
  var STRESS = [{ fps: 45, bootSec: 0 }, { fps: 17, bootSec: 47.3 }, { fps: 29, bootSec: 12.9 },
  //            D (589)                   E (377)                    F (430)
                { fps: 24, bootSec: 31.7 }, { fps: 40, bootSec: 5.4 }, { fps: 33, bootSec: 22.6 }];
  var MAX_STEPS = 12;            // frames per message when the page falls behind
  var WATCHDOG_MS = 2500;        // one message
  var WATCHDOG_WARM_MS = 30000;  // fast-forwarding a stressed board
  var WATCHDOG_LOAD_MS = 8000;   // loading the pattern (top-level code)

  function Sim(handlers) {
    this.h = handlers;          // { frame(i, pixels, nowMs, stats, readouts, describe), loaded(i, info), fatal(info), status(text) }
    this.boards = [];
    this.runId = 0;
    this.playing = true;
    this.speed = 1;
    this.stress = false;
    this.simMs = T0;
    this.featureNames = [];
    this.readoutNames = [];
    this.lastReadout = 0;
  }

  Sim.prototype.stop = function () {
    this.runId++;
    this.boards.forEach(function (b) { if (b.host) b.host.terminate(); });
    this.boards = [];
  };

  // boards: [{ id, node, pixels, norm }]; src: the complete pattern
  Sim.prototype.load = function (boards, src, opts) {
    var sim = this;
    this.stop();
    var run = this.runId;
    opts = opts || {};
    this.stress = !!opts.stress;
    this.sensorCfg = opts.sensor || null;
    this.featureNames = opts.featureNames || [];
    this.valueNames = opts.valueNames || [];
    this.simMs = T0;
    this.started = false;
    this.hostKind = null;
    this.boards = boards.map(function (b, i) {
      var cfg = sim.stress ? STRESS[i % STRESS.length] : { fps: NORMAL_FPS, bootSec: 0 };
      return { def: b, index: i, fps: cfg.fps, startMs: T0 - cfg.bootSec * 1000, clock: T0 - cfg.bootSec * 1000,
        host: null, busy: false, sentAt: 0, loaded: false, frames: 0, limit: WATCHDOG_MS };
    });
    this.h.status('Starting six boards…');
    return Promise.all(this.boards.map(function (b) {
      return createHost().then(function (host) {
        if (run !== sim.runId) { host.terminate(); return; }
        b.host = host;
        sim.hostKind = host.kind;
        host.handler = function (m) { sim._onMessage(b, m, run); };
        b.busy = true; b.sentAt = performance.now(); b.limit = WATCHDOG_LOAD_MS;
        host.send({ type: 'load', src: src, pixelCount: b.def.pixels, nodeId: b.def.node,
          mapPoints: b.def.norm, startMs: b.startMs, controlValues: opts.controlValues || [], sensor: sim._sensorFor(b) });
      });
    })).then(function () {
      if (run !== sim.runId) return;
      // Stressed boards fast-forward from their boot time to the shared start.
      sim.boards.forEach(function (b) {
        if (b.clock < T0) {
          var steps = [], t = b.clock, dt = 1000 / b.fps;
          while (t + dt < T0) { steps.push(dt); t += dt; }
          steps.push(T0 - t);
          sim._send(b, steps, WATCHDOG_WARM_MS);
        }
      });
      sim.h.status(sim.stress ? 'Sync stress: boards booted at different times and run at different frame rates' : '');
    });
  };

  // Sound for one board. Board A has the sensor board; with sync stress,
  // board B gets the broadcast 15 ms late and loses about 5% of packets, as
  // in pbcheck's sync check.
  Sim.prototype._sensorFor = function (b) {
    var c = this.sensorCfg;
    if (!c || c.kind === 'none') return null;
    var out = {};
    for (var k in c) out[k] = c[k];
    out.t0 = T0;
    if (this.stress && b.index === 1) { out.latencyMs = 15; out.dropRate = 0.05; }
    return out;
  };
  // Update every board's sound: { level }, { offsetMs } (where a clip is)
  // and/or { live: Float32Array frame }.
  Sim.prototype.sensor = function (m) {
    var msg = { type: 'sensor' };
    if (typeof m.level === 'number') { msg.level = m.level; if (this.sensorCfg) this.sensorCfg.level = m.level; }
    if (typeof m.offsetMs === 'number') { msg.offsetMs = m.offsetMs; if (this.sensorCfg) this.sensorCfg.offsetMs = m.offsetMs; }
    if (m.live) msg.live = m.live;
    // every board with a host: one still loading gets it right after its load (messages stay in order)
    this.boards.forEach(function (b) { if (b.host) b.host.send(msg); });
  };

  Sim.prototype._send = function (b, steps, limit) {
    b.busy = true;
    b.sentAt = performance.now();
    b.limit = limit || WATCHDOG_MS;
    var msg = { type: 'frame', id: ++b.frames, steps: steps };
    if (!b.described) { msg.featureNames = this.featureNames; msg.valueNames = this.valueNames; }
    if (b.index === 0 && this.readoutNames.length && performance.now() - this.lastReadout > 200) {
      msg.readouts = this.readoutNames;
      this.lastReadout = performance.now();
    }
    b.host.send(msg);
  };

  Sim.prototype._onMessage = function (b, m, run) {
    if (run !== this.runId) return;
    if (m.type === 'loaded') {
      b.loaded = true; b.busy = false;
      this.h.loaded(b.index, m);
    } else if (m.type === 'frame') {
      b.busy = false;
      b.clock = m.nowMs;
      if (m.describe) b.described = true;
      this.h.frame(b.index, m.pixels, m.nowMs, m.stats, m.readouts, m.describe || null, m.levels || []);
    } else if (m.type === 'fatal') {
      this.stop();
      this.h.fatal({ board: b.def.id, message: m.message });
    }
  };

  // Call every animation frame with the wall-clock time since the last call.
  Sim.prototype.tick = function (wallMs) {
    if (!this.boards.length) return;
    // The shared clock starts once every board has loaded (and, with sync
    // stress, caught up from its boot time), so none starts behind.
    var ready = this.boards.every(function (b) { return b.host && b.loaded && !b.busy && b.clock >= T0; });
    if (ready) this.started = true;
    if (this.playing && this.started) this.simMs += Math.min(wallMs, 100) * this.speed;
    var now = performance.now();
    for (var i = 0; i < this.boards.length; i++) {
      var b = this.boards[i];
      if (!b.host) continue;
      if (b.busy) {
        if (this.hostKind === 'worker' && now - b.sentAt > b.limit) {
          var id = b.def.id;
          this.stop();
          this.h.fatal({ board: id, hung: true,
            message: 'Board ' + id + ' stopped responding, so the simulator stopped all six boards. The pattern is probably stuck in an endless loop in beforeRender() or render3D().' });
          return;
        }
        continue;
      }
      if (!b.loaded || b.clock < T0) continue;
      // Every board renders on its own fixed schedule (1000/fps ms of
      // simulated time per frame), whatever the page's own refresh rate. When
      // several frames are due, they're sent together and the last is shown.
      var dt = 1000 / b.fps, n = Math.floor((this.simMs - b.clock) / dt + 1e-6);
      if (n < 1) continue;
      var steps = [];
      if (n > MAX_STEPS) { steps.push(dt * (n - MAX_STEPS + 1)); n = MAX_STEPS - 1; }
      for (var k = 0; k < n; k++) steps.push(dt);
      this._send(b, steps);
    }
  };

  Sim.prototype.step = function () {   // one frame at 40 fps, while paused
    this.simMs += 1000 / NORMAL_FPS;
  };

  Sim.prototype.control = function (name, args) {
    this.boards.forEach(function (b) { if (b.host) b.host.send({ type: 'control', name: name, args: args }); });
  };

  Sim.prototype.elapsedMs = function () { return this.simMs - T0; };

  return { Sim: Sim, STRESS: STRESS, NORMAL_FPS: NORMAL_FPS, T0: T0, boardMain: boardMain, workerSource: workerSource };
})();
