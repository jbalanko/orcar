#!/usr/bin/env node
// sim-selftest.mjs -- check the simulator's board code without a browser.
//
//   node tools/sim-selftest.mjs
//
// The simulator runs each board in a Web Worker built from sim/engine.js and
// sim/boards.js. This builds that same worker code, runs it in a Node vm that
// stands in for a worker, loads every example on every board, renders a few
// frames, and compares the colours with the command-line emulator
// (tools/pbsim.mjs). They must match exactly: one engine, two hosts.
// It also checks the simulator's scripts parse. Run by CI.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createBoard, loadBoards, engine } from './pbsim.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const fail = (msg) => { console.log('  [error] ' + msg); failed++; };

// 1. The page's scripts parse (they're plain scripts, loaded with <script src>).
for (const f of fs.readdirSync(path.join(ROOT, 'sim')).filter((f) => f.endsWith('.js'))) {
  try { new vm.Script(fs.readFileSync(path.join(ROOT, 'sim', f), 'utf8'), { filename: f }); }
  catch (e) { fail(`sim/${f} doesn't parse: ${e.message}`); }
}
const html = fs.readFileSync(path.join(ROOT, 'simulator.html'), 'utf8');
for (const m of html.matchAll(/<script src="([^"]+)"/g))
  if (!fs.existsSync(path.join(ROOT, m[1]))) fail(`simulator.html loads ${m[1]}, which doesn't exist`);

// 2. Build the worker source the way the page does.
const page = vm.createContext({ URL, Blob: class {}, performance, setTimeout, clearTimeout });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'sim/engine.js'), 'utf8'), page, { filename: 'engine.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'sim/boards.js'), 'utf8'), page, { filename: 'boards.js' });
const workerSrc = vm.runInContext('OrcarBoards.workerSource()', page);

// A vm context that behaves enough like a worker's global scope.
function fakeWorker() {
  const inbox = [];
  let handler = null;
  const self = { postMessage: (m) => inbox.push(m), addEventListener: (t, fn) => { handler = fn; } };
  const ctx = vm.createContext(self);
  ctx.self = ctx;
  vm.runInContext(workerSrc, ctx, { filename: 'worker.js' });
  return { send: (m) => handler({ data: structuredClone(m) }), inbox };
}

// 3. Every example on every board: worker output == pbsim output.
const boards = loadBoards(ROOT);
const head = engine.templateHead(fs.readFileSync(path.join(ROOT, 'src/template/orcar_3d_mapped.js'), 'utf8'));
const examples = fs.readdirSync(path.join(ROOT, 'src/examples')).filter((f) => f.endsWith('.effect.js')).sort();
const steps = [25, 25, 40, 25, 300, 25];
for (const ex of examples) {
  const src = engine.buildPattern(head, fs.readFileSync(path.join(ROOT, 'src/examples', ex), 'utf8'), 'src/examples/' + ex);
  for (const b of boards) {
    const w = fakeWorker();
    if (!w.inbox.length || w.inbox[0].type !== 'ready') { fail(`${ex}: worker didn't start`); break; }
    w.send({ type: 'load', src, pixelCount: b.pixels, nodeId: b.node, mapPoints: b.norm, startMs: 60000, controlValues: [] });
    const loaded = w.inbox.find((m) => m.type === 'loaded');
    if (!loaded) { fail(`${ex} board ${b.id}: no 'loaded' reply (${JSON.stringify(w.inbox.at(-1))})`); continue; }
    const ref = createBoard({ src, pixelCount: b.pixels, nodeId: b.node, mapPoints: b.norm, startMs: 60000, sensor: 'none' });
    let worst = 0;
    for (const s of steps) {
      w.send({ type: 'frame', id: 1, steps: [s], featureNames: ['R4', 'EYE_1'] });
      const got = w.inbox.at(-1);
      if (got.type !== 'frame') { fail(`${ex} board ${b.id}: ${got.type} ${got.message || ''}`); break; }
      const want = ref.frame(s);
      for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(Math.fround(want[i]) - got.pixels[i]));
      if (got.stats.errors.length) fail(`${ex} board ${b.id}: ${got.stats.errors[0].message}`);
    }
    if (worst > 0) fail(`${ex} board ${b.id}: worker colours differ from pbsim by up to ${worst}`);
  }
}
// 4. A runtime error reports the effect's line.
{
  const w = fakeWorker();
  w.send({ type: 'load', src: 'var a = 1;\nexport function render(i) {\n  hsv(nope(), 1, 1);\n}\n', pixelCount: 3, nodeId: 0, mapPoints: [], startMs: 0 });
  w.send({ type: 'frame', id: 1, steps: [25] });
  const e = w.inbox.at(-1).stats.errors[0];
  if (!e || e.line !== 3) fail(`runtime error line: expected 3, got ${JSON.stringify(e)}`);
}
// 5. The editor's suggestions can still read the Pixelblaze reference (a
//    reformatted docs/PIXELBLAZE_REFERENCE.md would silently empty them).
{
  const Sym = new Function(fs.readFileSync(path.join(ROOT, 'sim/symbols.js'), 'utf8') + '\nreturn OrcarSymbols;')();
  const pb = Sym.fromReferenceDoc(fs.readFileSync(path.join(ROOT, 'docs/PIXELBLAZE_REFERENCE.md'), 'utf8'));
  const want = ['hsv', 'rgb', 'time', 'wave', 'perlin', 'clamp', 'random', 'pixelCount', 'PI', 'slider'];
  const missing = want.filter((n) => !pb[n]);
  if (missing.length || Object.keys(pb).length < 60) fail(`editor suggestions: only ${Object.keys(pb).length} Pixelblaze names read from docs/PIXELBLAZE_REFERENCE.md (missing ${missing.join(', ') || 'none'}); keep its "- \`name(args)\`: note" bullets and tables`);
  if (pb.hsv && !pb.hsv.note) fail('editor suggestions: hsv() has no note');
}
// 6. Sound: the sensor-board analysis puts tones in the firmware's buckets, and
//    a board fed a clip in a worker draws what pbsim draws with the same clip.
{
  const sc = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sim/sound.js'), 'utf8'), sc, { filename: 'sound.js' });
  const Snd = vm.runInContext('OrcarSound', sc);
  const tone = (f, sec = 2) => { const x = new Float32Array(Snd.RATE * sec); for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * f * i / Snd.RATE); return x; };
  for (const [f, want] of [[38, 0], [50, 1], [150, 5], [440, 10], [1000, 15], [3000, 22], [9000, 31]]) {
    const a = Snd.analyzeClip(tone(f)), fr = a.frames.subarray(20 * Snd.FIELDS, 21 * Snd.FIELDS);
    let best = 0; for (let i = 0; i < 32; i++) if (fr[i] > fr[best]) best = i;
    if (best !== want) fail(`sound: a ${f} Hz tone lands in bucket ${best}, expected ${want}`);
    if (f > 200 && Math.abs(fr[34] - f) > 40) fail(`sound: maxFrequency for ${f} Hz reads ${fr[34]}`);
  }
  if (Math.abs(1000 / Snd.FRAME_MS - 39.06) > 0.01) fail('sound: packets should come every 512 samples at 20 kHz');
  // a beat-like clip: 100 Hz thumps twice a second
  const x = new Float32Array(Snd.RATE * 4);
  for (let i = 0; i < x.length; i++) { const t = i / Snd.RATE; x[i] = 0.6 * Math.sin(2 * Math.PI * 100 * t) * Math.exp(-(t % 0.5) * 12); }
  const clip = Snd.analyzeClip(x);
  const cfg = { kind: 'clip', frames: clip.frames, count: clip.count, frameMs: clip.frameMs, offsetMs: 1234, level: 1.5, t0: 60000 };
  const src = engine.buildPattern(head, fs.readFileSync(path.join(ROOT, 'src/examples/08-sound-beat-ripple.effect.js'), 'utf8'), 'src/examples/08-sound-beat-ripple.effect.js');
  const b = boards[0], w = fakeWorker();
  w.send({ type: 'load', src, pixelCount: b.pixels, nodeId: b.node, mapPoints: b.norm, startMs: 60000, controlValues: [], sensor: cfg });
  const ref = createBoard({ src, pixelCount: b.pixels, nodeId: b.node, mapPoints: b.norm, startMs: 60000,
    sensor: (t) => engine.sensorFromFrame(cfg.frames, engine.clipFrameIndex(cfg, t) * engine.SENSOR_FIELDS, cfg.level) });
  let worst = 0, lit = 0;
  for (let k = 0; k < 80; k++) {
    w.send({ type: 'frame', id: 1, steps: [25] });
    const got = w.inbox.at(-1), want = ref.frame(25);
    for (let i = 0; i < want.length; i++) { worst = Math.max(worst, Math.abs(Math.fround(want[i]) - got.pixels[i])); lit = Math.max(lit, want[i]); }
  }
  if (worst > 0) fail(`sound: a worker fed a clip differs from pbsim by up to ${worst}`);
  if (lit === 0) fail('sound: example 08 stayed dark on a beat');
}
console.log(failed ? `sim self-test: ${failed} problem(s)` : `sim self-test: ${examples.length} examples x ${boards.length} boards match pbsim`);
process.exit(failed ? 1 : 0);
