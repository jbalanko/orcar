// pbsim.mjs -- the Node side of the Orcar Pixelblaze emulator.
//
// The emulator itself lives in sim/engine.js, shared with the browser
// simulator (simulator.html), so the checker and the simulator always agree.
// This file loads it and gives each simulated board its own vm context (its
// own globals, like a real controller).
//
// Purpose: catch mistakes BEFORE a pattern goes on the Orcar -- syntax errors,
// undefined functions, NaN colours, arrays allocated per frame, per-board
// drift, array budget. It is NOT bit-exact: it uses JavaScript floats, not
// Pixelblaze's 16.16 fixed point, and its perlin()/random() are stand-ins.
// Always confirm on real hardware.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

const ENGINE_FILE = new URL('../sim/engine.js', import.meta.url);
export const engine = new Function(fs.readFileSync(ENGINE_FILE, 'utf8') + '\nreturn orcarEngine();')();

export const { normalizeMap, sensorAt, prepareSource } = engine;

// A fresh vm context per board. The 5 s timeout catches an endless loop at load.
function vmHost() {
  const ctx = vm.createContext({});
  return { G: ctx, run: (code) => vm.runInContext(code, ctx, { filename: 'pattern.js', timeout: 5000 }) };
}

// opts: see createBoard() in sim/engine.js
export function createBoard(opts) {
  return engine.createBoard(opts, vmHost());
}

// ---------------------------------------------------------------------------
// Convenience: load boards.json + maps relative to the kit root.
// ---------------------------------------------------------------------------
export function loadBoards(kitRoot) {
  const cfg = JSON.parse(fs.readFileSync(path.join(kitRoot, 'maps/boards.json'), 'utf8'));
  return cfg.boards.map((b) => {
    const raw = JSON.parse(fs.readFileSync(path.join(kitRoot, 'maps', b.map), 'utf8'));
    return { ...b, raw, norm: normalizeMap(raw, cfg.fit) };
  });
}
