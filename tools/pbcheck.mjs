#!/usr/bin/env node
// pbcheck.mjs -- check an Orcar pattern before it goes on the sculpture.
//
//   node tools/pbcheck.mjs patterns/examples/04-deep-sea.js
//   node tools/pbcheck.mjs my-pattern.js --preview out/preview.json
//
// What it does (all six boards, using the real maps and pixel counts):
//   1. Lint: language features Pixelblaze doesn't support, arrays allocated
//      per frame, random() in shared decisions, risky accumulators.
//   2. Load + run: errors, NaN colours, pixels never set, budget use,
//      BOARD_TOTAL vs configured pixel count.
//   3. Sync check: renders each board twice with different boot times and
//      frame rates, then compares the frames at the same clock times. If they
//      differ, the pattern depends on frame history, and the six boards may
//      disagree on the truck.
//   4. Controls: calls every slider/toggle/picker at 0 and 1 to catch NaN.
//   5. --preview FILE: writes positions (inches) + colours for a few moments,
//      for tools/preview.py to draw.
//
// It is an emulator, not the device: floats instead of 16.16 fixed point,
// stand-in perlin()/random(). Passing here is necessary, not sufficient.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBoard, loadBoards, engine } from './pbsim.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (!args.length || args.includes('-h') || args.includes('--help')) {
  console.log('usage: node tools/pbcheck.mjs PATTERN.js [--preview out.json] [--times 1,5,9] [--quiet]');
  process.exit(0);
}
const file = args[0];
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const previewOut = opt('--preview', null);
const previewTimes = opt('--times', '2.1,5.35,8.6,11.2').split(',').map(Number);
const quiet = args.includes('--quiet');

const src = fs.readFileSync(file, 'utf8');
const boards = loadBoards(KIT);
const problems = { error: [], warn: [], info: [] };
const add = (level, msg) => problems[level].push(msg);

// ---------------------------------------------------------------- 1. lint
// The rules live in sim/engine.js, shared with the browser simulator.
for (const item of engine.lint(src)) add(item.level, engine.formatLint(item));

// ---------------------------------------------------------------- 2. run
const FPS = 40, SECONDS = 12;
const report = [];
const previewFrames = previewTimes.map((t) => ({ t, boards: [] }));
for (const b of boards) {
  const board = createBoard({ src, pixelCount: b.pixels, nodeId: b.node, mapPoints: b.norm, startMs: 0 });
  const st = board.stats;
  const g = board.globalsReport();
  if (board.ctx.BOARD_TOTAL && Number.isFinite(board.ctx.BOARD_TOTAL[b.node]) && board.ctx.BOARD_TOTAL[b.node] !== b.pixels)
    add('error', `board ${b.id}: BOARD_TOTAL[${b.node}] = ${board.ctx.BOARD_TOTAL[b.node]} but maps/boards.json says ${b.pixels} pixels -- indices will drift`);
  if (b.raw.length > b.pixels + 2) add('error', `board ${b.id}: map has ${b.raw.length} entries for ${b.pixels} pixels -- more than the 2 ghost entries extra`);
  let t0 = Date.now(), frames = 0;
  const dt = 1000 / FPS;
  let nextPrev = 0;
  for (let f = 0; f < FPS * SECONDS; f++) {
    const px = board.frame(dt);
    frames++;
    while (nextPrev < previewFrames.length && board.nowMs >= previewFrames[nextPrev].t * 1000) {
      const cols = [];
      for (let i = 0; i < Math.min(b.raw.length - 2, b.pixels); i++)
        cols.push([b.raw[i][0], b.raw[i][1], b.raw[i][2], +px[i * 3].toFixed(3), +px[i * 3 + 1].toFixed(3), +px[i * 3 + 2].toFixed(3)]);
      previewFrames[nextPrev].boards.push({ id: b.id, pixels: cols });
      nextPrev++;
    }
  }
  const ms = (Date.now() - t0) / frames;
  const callsPerPixel = Object.fromEntries(Object.entries(st.calls)
    .map(([k, v]) => [k, +(v / frames / b.pixels).toFixed(2)])
    .filter(([k, v]) => v >= 0.05 && !['hsv', 'rgb', 'paint', 'hsv24'].includes(k)));
  st.errors.forEach((e) => add('error', `board ${b.id}: ${e}`));
  if (st.badColour.length) add('error', `board ${b.id}: bad colour values, e.g. ${JSON.stringify(st.badColour[0])}`);
  if (st.arraysAllocatedAfterLoad) add('error', `board ${b.id}: ${st.arraysAllocatedAfterLoad} array elements allocated after load (per frame) -- memory leak on device`);
  if (st.unsetPixels) add('warn', `board ${b.id}: ${(st.unsetPixels / frames).toFixed(0)} pixels/frame never get hsv()/rgb() -- don't rely on what the device shows for them; end every render path with a colour (hsv(0, 0, 0) for off)`);
  if (st.undrawn) add('error', `board ${b.id}: ${st.undrawn} pixels lie past the end of its map (${b.raw.length} entries for ${b.pixels} pixels) -- render3D() never draws them, so they freeze. Give every pixel a map entry (placeholders for unmapped strands), ghosts last.`);
  if (st.multiSetPixels) add('info', `board ${b.id}: some pixels call hsv()/rgb() more than once per frame (last call wins; wasted work)`);
  if (g.globals > 256) add('error', `board ${b.id}: ~${g.globals} globals (limit 256)`);
  else if (g.globals > 220) add('warn', `board ${b.id}: ~${g.globals} globals (limit 256)`);
  if (g.arrayElements > 10240) add('error', `board ${b.id}: ${g.arrayElements} array elements (limit 10,240)`);
  else if (g.arrayElements > 9000) add('warn', `board ${b.id}: ${g.arrayElements} array elements (limit 10,240)`);
  report.push({ board: b.id, pixels: b.pixels, globals: g.globals, arrayElements: g.arrayElements,
    emulatorMsPerFrame: +ms.toFixed(2), callsPerPixel, render: board.renderFn,
    sensors: board.usesSensor, controls: board.controls.map((c) => c.name) });
}

// ---------------------------------------------------------------- 2b. no sensor board
if (report[0].sensors.length) {
  const b = boards[1];
  const nb = createBoard({ src, pixelCount: b.pixels, nodeId: b.node, mapPoints: b.norm, sensor: 'none' });
  for (let f = 0; f < 40; f++) nb.frame(25);
  if (nb.stats.errors.length) add('error', `with NO sensor board connected: ${nb.stats.errors[0]} -- give sensor variables defaults, e.g. export var frequencyData = array(32)`);
  if (nb.stats.badColour.length) add('error', `with NO sensor board connected: bad colours, e.g. ${JSON.stringify(nb.stats.badColour[0])}`);
}

// ---------------------------------------------------------------- 3. sync
// Same clock times, different history: A boots at t=0 and runs 40 fps;
// B booted 47.3 s earlier and runs 17 fps. Compare at shared sample times.
const sync = [];
for (const b of boards) {
  const A = createBoard({ src, pixelCount: b.pixels, nodeId: b.node, mapPoints: b.norm, startMs: 60000 });
  // B also gets sound late (15 ms) and drops ~5% of sensor packets
  const B = createBoard({ src, pixelCount: b.pixels, nodeId: b.node, mapPoints: b.norm, startMs: 60000 - 47300, sensorLatencyMs: 15, sensorDropRate: 0.05 });
  let worst = 0, diffPx = 0, visPx = 0, compared = 0;
  const samples = [3.13, 5.71, 8.37, 10.9].map((s) => 60000 + s * 1000);
  const step = (board, fps, until) => {
    let px;
    while (board.nowMs + 1000 / fps < until) px = board.frame(1000 / fps);
    return board.frame(until - board.nowMs);
  };
  for (const t of samples) {
    const pa = Float64Array.from(step(A, 40, t));
    const pb = step(B, 17, t);
    for (let i = 0; i < b.pixels; i++) {
      const d = Math.max(Math.abs(pa[i * 3] - pb[i * 3]), Math.abs(pa[i * 3 + 1] - pb[i * 3 + 1]), Math.abs(pa[i * 3 + 2] - pb[i * 3 + 2]));
      worst = Math.max(worst, d);
      if (d > 2 / 255) diffPx++;
      if (d > 0.15) visPx++;
      compared++;
    }
  }
  sync.push({ board: b.id, pctPixelsDiffer: +(100 * diffPx / compared).toFixed(1), pctVisible: +(100 * visPx / compared).toFixed(1), worst: +worst.toFixed(3) });
}
const maxPct = Math.max(...sync.map((s) => s.pctPixelsDiffer));
const maxVis = Math.max(...sync.map((s) => s.pctVisible));
if (maxVis > 2) add('warn', `sync: up to ${maxVis}% of pixels differ VISIBLY (>15% brightness) depending on boot time / frame rate. Boards will disagree at seams unless that is intended (e.g. independent per-pixel sparkle). See docs/ORCAR_CONTRACT.md section 5.`);
else if (maxPct > 0) add('info', `sync: ${maxPct}% of pixels depend slightly on frame history (worst ${Math.max(...sync.map((s) => s.worst))}, mostly invisible) -- typical of smoothing; check seams on the truck.`);

// ---------------------------------------------------------------- 4. controls
{
  const b = boards[1];
  const board = createBoard({ src, pixelCount: b.pixels, nodeId: b.node, mapPoints: b.norm });
  for (const c of board.controls) {
    for (const v of [0, 1]) {
      try {
        if (c.name.startsWith('hsvPicker') || c.name.startsWith('rgbPicker')) board.callControl(c.name, v, v, v);
        else if (c.name.startsWith('trigger') || c.name.startsWith('showNumber') || c.name.startsWith('gauge')) board.callControl(c.name);
        else board.callControl(c.name, v);
      } catch (e) { add('error', `control ${c.name}(${v}) threw: ${e.message}`); }
      board.frame(25); board.frame(25);
    }
  }
  if (board.stats.badColour.length) add('error', `extreme control values produce bad colours, e.g. ${JSON.stringify(board.stats.badColour[0])}`);
  board.stats.errors.forEach((e) => add('error', `with controls at extremes: ${e}`));
}

// ---------------------------------------------------------------- output
if (previewOut) {
  fs.mkdirSync(path.dirname(previewOut), { recursive: true });
  fs.writeFileSync(previewOut, JSON.stringify({ pattern: path.basename(file), frames: previewFrames }));
}
const verdict = problems.error.length ? 'FAIL' : problems.warn.length ? 'PASS with warnings' : 'PASS';
console.log(`\n${path.basename(file)}: ${verdict}`);
for (const lvl of quiet ? ['error', 'warn'] : ['error', 'warn', 'info']) for (const m of problems[lvl]) console.log(`  [${lvl}] ${m}`);
if (!quiet) {
  console.log('\n  board  px   globals  arrayEl  emu-ms/frame  per-pixel calls');
  for (const r of report) console.log(`  ${r.board}    ${String(r.pixels).padEnd(4)} ${String(r.globals).padEnd(8)} ${String(r.arrayElements).padEnd(8)} ${String(r.emulatorMsPerFrame).padEnd(13)} ${JSON.stringify(r.callsPerPixel)}`);
  console.log(`  sync (pixels that change with boot time/frame rate: any / visible): ${sync.map((s) => `${s.board} ${s.pctPixelsDiffer}/${s.pctVisible}%`).join('  ')}`);
  if (report[0].controls.length) console.log(`  controls: ${report[0].controls.join(', ')}`);
  if (report[0].sensors.length) console.log(`  sensor vars: ${report[0].sensors.join(', ')}`);
}
process.exit(problems.error.length ? 1 : 0);
