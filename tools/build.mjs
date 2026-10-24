#!/usr/bin/env node
// build.mjs -- turn effect sources into paste-ready Pixelblaze patterns.
//
//   node tools/build.mjs                          src/examples/*.effect.js -> patterns/examples/*.js
//                                                 src/effects/*.effect.js  -> patterns/effects/*.js
//   node tools/build.mjs src/effects/x.effect.js  one file -> patterns/effects/x.js
//   node tools/build.mjs ~/elsewhere/x.effect.js  a file outside the repo -> x.js next to it
//
// Pixelblaze has no includes, so every pattern carries a full copy of the
// feature map. An effect source holds ONLY the part below the template's
// "PATTERN" marker. This script glues template + effect, so when the template
// changes you rebuild instead of hand-editing every pattern.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engine } from './pbsim.mjs';   // the glue lives in sim/engine.js, shared with the simulator

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(ROOT, 'src/template/orcar_3d_mapped.js');
const DIRS = ['examples', 'effects'];               // src/<dir> -> patterns/<dir>

const head = engine.templateHead(fs.readFileSync(TEMPLATE, 'utf8'));
if (head === null) { console.error('template PATTERN marker not found -- did the template change?'); process.exit(1); }

function build(srcFile, outFile) {
  const rel = path.relative(ROOT, srcFile).split(path.sep).join('/');   // '/' on Windows too, so builds match
  const from = rel.startsWith('..') ? path.basename(srcFile) : rel;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, engine.buildPattern(head, fs.readFileSync(srcFile, 'utf8'), from));
  console.log('built', path.relative(process.cwd(), outFile));
}

function outFor(src) {
  const abs = path.resolve(src);
  const name = path.basename(abs).replace(/\.effect\.js$/, '.js');
  const rel = path.relative(path.join(ROOT, 'src'), path.dirname(abs));
  if (DIRS.includes(rel)) return path.join(ROOT, 'patterns', rel, name);
  return path.join(path.dirname(abs), name);       // anywhere else: next to the source
}

const one = process.argv[2];
if (one) {
  if (!one.endsWith('.effect.js')) { console.error('effect sources must be named *.effect.js'); process.exit(1); }
  build(one, outFor(one));
} else {
  for (const dir of DIRS) {
    const out = path.join(ROOT, 'patterns', dir);
    // clear old outputs first, so a deleted or renamed effect leaves nothing behind
    if (fs.existsSync(out)) for (const f of fs.readdirSync(out)) if (f.endsWith('.js')) fs.unlinkSync(path.join(out, f));
    const src = path.join(ROOT, 'src', dir);
    if (!fs.existsSync(src)) continue;
    for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.effect.js')).sort()) build(path.join(src, f), path.join(out, f.replace(/\.effect\.js$/, '.js')));
  }
}
