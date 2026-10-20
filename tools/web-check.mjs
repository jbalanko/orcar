#!/usr/bin/env node
// web-check.mjs -- checks the public control page and the admin test page (web/*.html), and how
// every effect's controls will look on the public page. No dependencies; run by `npm run ci`.
//
//   node tools/web-check.mjs
//
// 1. Every inline script in web/*.html parses, and the pages load nothing from the internet
//    (the Orcar Wi-Fi has none).
// 2. web/play.html's pure helpers (between /* web-check:pure:start */ and :end markers) are run
//    in Node: the LZ-String decoder against a fixture made with the real lz-string library, and
//    the control discovery the page does on a pattern's source.
// 3. Every effect in src/effects and src/examples is read the way the page reads it, with
//    warnings for things the public page can't show well (docs/PUBLIC_UI.md, contract section 12).
//    The 00 calibration examples are skipped: they're for the crew, never the public.
// Exit 1 on any [error]; [warn] lines don't fail.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let errors = 0, warnings = 0;
const error = (m) => { errors++; console.log('[error] ' + m); };
const warn = (m) => { warnings++; console.log('[warn]  ' + m); };

// ---- 1. Syntax and offline ------------------------------------------------------
const pages = fs.readdirSync(path.join(ROOT, 'web')).filter((f) => f.endsWith('.html')).sort();
for (const f of pages) {
  const html = fs.readFileSync(path.join(ROOT, 'web', f), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!scripts.length) error(`web/${f}: no inline script found`);
  scripts.forEach((s, i) => {
    try { new vm.Script(s, { filename: `web/${f} <script> #${i + 1}` }); }
    catch (e) { error(`web/${f}: script #${i + 1} doesn't parse: ${e.message}`); }
  });
  const external = html.match(/(?:\b(?:src|href)\s*=\s*["']|url\(\s*["']?|@import\s+["']?)(?:https?:)?\/\/[^"')\s]+/gi);
  if (external) error(`web/${f}: loads from the network (${external.join(', ')}); the Orcar Wi-Fi has no internet`);
  if (/<script[^>]*\bsrc=/i.test(html)) error(`web/${f}: external <script src>; keep the page in one file`);
  console.log(`web/${f}: ${scripts.length} script(s) parse, nothing loaded from outside the page`);
}

// ---- 2. The play page's pure helpers ---------------------------------------------
const play = fs.readFileSync(path.join(ROOT, 'web/play.html'), 'utf8');
const pure = [...play.matchAll(/\/\* web-check:pure:start \*\/([\s\S]*?)\/\* web-check:pure:end \*\//g)].map((m) => m[1]).join('\n');
let H = null;
try {
  H = vm.runInNewContext(pure + '\n;({ lzFromUint8Array, controlsFromSource, rangesFromSource, friendly, lowerFirst, hsv2rgb, rgb2hsv, HIDE_SUFFIX })', {}, { filename: 'web/play.html (pure blocks)' });
} catch (e) { error('web/play.html: the pure blocks fail to run in isolation: ' + e.message); }

// Fixture: made with lz-string's compressToUint8Array from this exact source (unicode included)
const FIXTURE_LINES = [
  '// Fixture for tools/web-check.mjs -- not a real pattern. Unicode: é 漢字 🐋',
  '/* export function sliderCommentedOut(v) {} */',
  'export function triggerBoom() {}',
  'export function sliderSpeed(v) { speed = v }',
  '// export function sliderAlsoCommented(v) {}',
  'export function hsvPickerBody(h, s, v) {}',
  'export function rgbPickerTrim(r, g, b) {}',
  'export function toggleStrobe_FastFlash_Admin(on) {}',
  'export function inputNumberCount(v) { count = clamp(v, 2, 6) }  // range 2..6',
  'export function showNumberHits() { return hits }',
  'export function gaugeLevel() { return level }',
  'export function beforeRender(delta) {}',
];
const FIXTURE_SRC = FIXTURE_LINES.join('\n') + '\n' + 'x'.repeat(5000);
const FIXTURE_B64 = 'N4IgtghglgdiBcID0SAEAxKAPALgVwCcBTVAMwHsDUdzyAbAZyQHciAjAWgGMALIrgNYA6MACsGqDh1QxyOVBFTEIdVAAcIOHEQIwhqAKowoXcgBMi8VAEvUgIntA6tqpAvBuBoHYA6MJACpURLGqU8qR4MFw4UOQwqAx0UBYEAMLkYGBEMNpmAPJ4OAAUAG4AlKjAAL6o3kie/oEEwaHhkdE4BFAA5u06AEK0YHkl5TUBQWSNEVExcQkAympERGaFgzHzi6gAvKgFqGWeKH4j9WNhE9Gx8ToAgozkyanpmculezC1oyGnzag8DAUACiYBD1zABPPI8AA0MWhxRewzqDS+kwI7TYgMEOgAKm1+gRoe1oWxBq93sdPk1JjROnQiDNWuQ2EQAProCAMHDoOjsnjMq5mMCwPJREkIj7jb6wNS5AByeDATKS5FC+ThwFQphVmw13LAakK0IATNCAGwlCqoA4ECAwLqoQ1CIQmsXkiWTBg8cjMOUKnQACSgOAYA1KSiI+F0P0DElJRyRlOi7QgeC6ABkiAUiHQQ+riBHorTM6pY4iTgnUEyKMQAErpBJ5Cx0HAQUUwLDtjudrvdnu9vv9geDofDkejsfjieTqfTmezufzheLpfLlertfrjebrfbne7vf7g+Ho/Hk+ns/ni+Xq/Xm+3u/3h+Pp/Pl+vt/vj+fr/fn+/v//gDAKA4CQNAsDwIgyCoOgmDYLg+CEMQpDkJQ1C0PQjDzxAMogAA==';

if (H) {
  const decoded = H.lzFromUint8Array(new Uint8Array(Buffer.from(FIXTURE_B64, 'base64')));
  if (decoded !== JSON.stringify({ main: FIXTURE_SRC })) error('web/play.html: the LZ decoder does not reproduce the fixture source');
  const found = H.controlsFromSource(FIXTURE_SRC).map((d) => d.name).join(',');
  const want = 'triggerBoom,sliderSpeed,hsvPickerBody,rgbPickerTrim,toggleStrobe_FastFlash_Admin,inputNumberCount,showNumberHits,gaugeLevel';
  if (found !== want) error(`web/play.html: control discovery found [${found}], expected [${want}]`);
  const r = H.rangesFromSource(FIXTURE_SRC).inputNumberCount;
  if (!r || r[0] !== 2 || r[1] !== 6) error('web/play.html: the "// range 2..6" hint was not read');
  for (const [base, label] of [['WaveSpeed', 'Wave Speed'], ['Strobe_FastFlash_Admin', 'Strobe Fast Flash'], ['RGBColour', 'RGB Colour']]) {
    if (H.friendly(base) !== label) error(`web/play.html: friendly('${base}') gave '${H.friendly(base)}', expected '${label}'`);
  }
  for (const hsv of [[0, 1, 1], [0.58, 0.9, 0.6], [0.9, 0.3, 1], [0.33, 1, 0.5]]) {
    const back = H.rgb2hsv(...H.hsv2rgb(...hsv));
    if (back.some((v, i) => Math.abs(v - hsv[i]) > 1e-9)) error(`web/play.html: hsv -> rgb -> hsv round trip failed for [${hsv}]`);
  }
  if (!errors) console.log('web/play.html: source decoder, control discovery, labels and colour maths OK');
}

// ---- 3. Effects as the public page sees them ---------------------------------------
if (H) {
  const dirs = ['src/effects', 'src/examples'];
  let n = 0;
  for (const d of dirs) {
    for (const f of fs.readdirSync(path.join(ROOT, d)).filter((x) => x.endsWith('.effect.js') && !x.startsWith('00')).sort()) {
      const code = fs.readFileSync(path.join(ROOT, d, f), 'utf8');
      const controls = H.controlsFromSource(code), ranges = H.rangesFromSource(code);
      const where = `${d}/${f}`;
      n++;
      for (const c of controls) {
        const hidden = c.base.endsWith(H.HIDE_SUFFIX);
        if ((c.type === 'showNumber' || c.type === 'gauge')) {
          const v = H.lowerFirst(c.base);
          if (!new RegExp('export\\s+var\\s+' + v + '\\b').test(code)) warn(`${where}: ${c.name} has no "export var ${v}", so the public page can't show it live`);
        }
        if (c.type === 'inputNumber' && !ranges[c.name] && !hidden) warn(`${where}: ${c.name} has no "// range a..b" hint; the public page allows 0..99`);
        if (/strobe|flash/i.test(c.base) && (c.type === 'toggle' || c.type === 'trigger') && !hidden) warn(`${where}: ${c.name} looks like a strobe but is visible on the public page; end its name with ${H.HIDE_SUFFIX}`);
      }
    }
  }
  console.log(`${n} effects read the way the public page reads them`);
}

console.log(`\n${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
