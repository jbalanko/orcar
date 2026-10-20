#!/usr/bin/env node
// check-all.mjs -- run pbcheck on every built pattern in patterns/. Exit 1 on any [error].
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['examples', 'effects'].flatMap((d) => {
  const dir = path.join(ROOT, 'patterns', d);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort().map((f) => path.join(dir, f)) : [];
});
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/pbcheck.mjs'), f, '--quiet'], { encoding: 'utf8' });
  process.stdout.write(r.stdout.replace(/^\n/, ''));
  if (r.status !== 0) failed++;
}
console.log(`\n${files.length - failed}/${files.length} patterns passed`);
process.exit(failed ? 1 : 0);
