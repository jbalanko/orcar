#!/usr/bin/env node
// sim-artifact.mjs -- gather the simulator and the repo files it reads into
// one folder, for hosting it somewhere other than your own disk.
//
//   node tools/sim-artifact.mjs            -> build/sim-artifact/   (for a Claude artifact)
//   node tools/sim-artifact.mjs --pages    -> build/sim-pages/      (a plain static site, e.g. GitHub Pages)
//
// Served over http(s), the page fetches the files by relative path, so the
// folder mirrors the repo: simulator.html, sim/, maps/, src/template/,
// src/examples/, src/effects/, and the docs its Docs tab shows. A served site can't list folders, so this also
// writes sim/manifest.json with the effect files.
//
// --pages keeps simulator.html as a complete document (index.html too).
// Without it, the page is written without its <!doctype>/<html>/<head>/<body>
// wrapper, because the Claude Artifact tool adds its own. The folder's
// files.json lists every file to publish alongside the page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = process.argv.includes('--pages');
const OUT = path.join(ROOT, 'build', pages ? 'sim-pages' : 'sim-artifact');

function walk(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name).split(path.sep).join('/')]);
}
const effects = ['src/examples', 'src/effects'].flatMap((d) => walk(d).filter((f) => f.endsWith('.effect.js'))).sort();
const files = [
  ...walk('sim').filter((f) => f !== 'sim/manifest.json'),
  'maps/boards.json',
  ...walk('maps').filter((f) => /^maps\/pixelblaze_.*\.json$/.test(f)),
  'src/template/orcar_3d_mapped.js',
  // the Docs tab (and the Pixelblaze names the editor suggests)
  'docs/ORCAR_CONTRACT.md', 'docs/PIXELBLAZE_REFERENCE.md', 'docs/SIMULATOR.md',
  ...effects,
];

fs.rmSync(OUT, { recursive: true, force: true });
// Licence files get a .txt name so every host serves them with a known type.
for (const [i, f] of files.entries()) {
  const to = /\/LICENSE$/.test(f) ? f + '.txt' : f;
  fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), path.join(OUT, to));
  files[i] = to;
}
fs.writeFileSync(path.join(OUT, 'sim/manifest.json'), JSON.stringify({ files: effects }, null, 1) + '\n');
files.push('sim/manifest.json');

let html = fs.readFileSync(path.join(ROOT, 'simulator.html'), 'utf8');
if (pages) {
  fs.writeFileSync(path.join(OUT, 'simulator.html'), html);
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
} else {
  // Keep what's inside <head> (minus charset/viewport, which the wrapper has)
  // and inside <body>, in that order.
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = head.trim() + '\n' + body.trim() + '\n';
  if (!html.trimStart().startsWith('<title>')) html = html.replace(/^\s*/, '');
  fs.writeFileSync(path.join(OUT, 'simulator.html'), html);
}
fs.writeFileSync(path.join(OUT, 'files.json'), JSON.stringify(files, null, 1) + '\n');
console.log(`wrote ${path.relative(ROOT, OUT)}/ (${files.length} files + simulator.html)`);
