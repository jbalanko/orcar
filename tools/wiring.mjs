#!/usr/bin/env node
// wiring.mjs -- print the template's wiring as JSON (used by mapgen.py).
//
//   node tools/wiring.mjs [template.js]
//
// Runs the template the same way a controller would and reports, per board,
// the features in pixel order with their count and reversed flag, plus the
// template's ghost-box constants. The template is the single source of truth
// for counts and wiring; the map generator never duplicates them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBoard } from './pbsim.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || path.join(ROOT, 'src/template/orcar_3d_mapped.js');
const src = fs.readFileSync(file, 'utf8');

// Feature names = every `export var NAME = feature(...)` in the template
const names = [...src.matchAll(/export\s+var\s+([A-Z][A-Z0-9_]*)\s*=\s*feature\(/g)].map((m) => m[1]);
const board = createBoard({ src, pixelCount: 1000, nodeId: 0, mapPoints: [] });
if (board.stats.errors.length) { console.error(board.stats.errors.join('\n')); process.exit(1); }
const c = board.ctx;
const nameOf = (f) => names.find((n) => c[n] === f);

const out = { boards: [], box: {} };
c.BOARDS.forEach((b, bi) => {
  const feats = [];
  b.forEach((chain, ch) => chain.forEach((f) => {
    const n = nameOf(f);
    if (n) feats.push({ name: n, channel: ch, count: f[0], reversed: f[3], start: f[1] });
  }));
  out.boards.push({ id: 'ABCDEF'[bi], node: bi, total: c.BOARD_TOTAL[bi], features: feats });
});
for (const k of ['MAP_MIN_X', 'MAP_MIN_Y', 'MAP_MIN_Z', 'MAP_MAX_X', 'MAP_MAX_Y', 'MAP_MAX_Z']) out.box[k] = c[k];
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
