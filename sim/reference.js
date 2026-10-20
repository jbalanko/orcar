// reference.js -- the simulator's Reference tab: what the template gives an
// effect, read from the template itself so it's always current.
//
// The template's own structure does the organizing: its section banners
// ("// ==== GROUPS ...", "// ---- Ribs ...") become the sections, and the
// comment beside or above each definition becomes its note. Values that are
// only known at run time (normalized constants, landmarks, feature ranges)
// come from the running boards.
//
// Defines one global, OrcarReference.

var OrcarReference = (function () {
  'use strict';

  // Template functions that only the template itself calls.
  var INTERNAL = { feature: 1, place: 1, mapPad: 1, tagGroup: 1, buildBackbonePos: 1, buildTags: 1 };
  var KIND_WORDS = { feature: 'feature strand', group: 'group', tag: 'tag', landmark: 'landmark point position', plane: 'plane axis position',
    function: 'function helper', internal: 'function internal', value: 'constant value', wiring: 'wiring board channel' };
  var SKIP_NOTE = /^feature\(count, reversed\)$|^ch0\b/;   // column headings in the template, not notes

  // ------------------------------------------------------------------ parse
  // -> { intro, sections: [{ title, sub, items: [entry | { note }] }], byName }
  function parse(src) {
    var model = { intro: '', sections: [], byName: {}, groups: {}, wiring: {}, tagsFor: {} };
    var m = src.match(/^\s*\/\*([\s\S]*?)\*\//);
    var body = src, offset = 0;
    if (m) {
      model.intro = m[1].replace(/^\s*=+\s*$/gm, '').replace(/^\n+|\s+$/g, '');
      offset = m[0].length;
      body = src.slice(offset);
    }
    var lines = body.split('\n');
    var lineBase = src.slice(0, offset).split('\n').length - 1;
    var section = { title: 'Basics', sub: '', items: [] };
    model.sections.push(section);
    var pendingNote = [], runNote = null, inRun = false, lastFn = null;

    function newSection(title, sub) {
      section = { title: title, sub: sub || '', items: [] };
      model.sections.push(section);
      pendingNote = []; runNote = null; inRun = false;
    }
    function add(entry) {
      // A comment block right above a function describes that function;
      // above a run of variables, it describes the run.
      var isFn = entry.kind === 'function' || entry.kind === 'internal';
      if (isFn && pendingNote.length) entry.blockNote = pendingNote.join(' ');
      else if (isFn && inRun && lastFn && lastFn.blockNote && !entry.note) entry.blockNote = lastFn.blockNote;   // nY, nZ: same as nX
      if (isFn) lastFn = entry;
      else if (!inRun && pendingNote.length) { runNote = pendingNote.join(' '); section.items.push({ note: runNote }); }
      pendingNote = [];
      inRun = true;
      section.items.push(entry);
      model.byName[entry.name] = entry;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], t = line.trim();
      // Section banner:  // ====  /  // TITLE -- text  /  // ====  (+ more // lines)
      if (/^\/\/\s*=+\s*$/.test(t)) {
        var titleLines = [];
        i++;
        while (i < lines.length && /^\s*\/\//.test(lines[i]) && !/^\s*\/\/\s*=+\s*$/.test(lines[i])) { titleLines.push(lines[i].trim().replace(/^\/\/\s?/, '')); i++; }
        var head = titleLines.join(' ');
        var tm = head.match(/^([A-Z0-9 \-\/()]+?)(?:\s+--\s+|\s*\(|$)([\s\S]*)/);
        newSection(tm ? tm[1].trim() : head, tm ? head.slice(tm[1].length).replace(/^\s*--\s*/, '').trim() : '');
        // the closing ==== line; any comment lines after it are the section's note
        while (i + 1 < lines.length && /^\s*\/\/(?!\s*=+\s*$)/.test(lines[i + 1])) {
          i++;
          var nt = lines[i].trim().replace(/^\/\/\s*/, '');
          if (!SKIP_NOTE.test(nt)) pendingNote.push(nt);
        }
        continue;
      }
      // Subsection:  // ---- Ribs (default: ...) ----
      var sm = t.match(/^\/\/\s*-{3,}\s*(.*?)\s*-*\s*$/);
      if (sm) {
        var txt = sm[1];
        while (i + 1 < lines.length && /^\s*\/\/\s{2,}/.test(lines[i + 1]) && !SKIP_NOTE.test(lines[i + 1].trim().replace(/^\/\/\s*/, ''))) { i++; txt += ' ' + lines[i].trim().replace(/^\/\/\s*/, '').replace(/-{3,}\s*$/, ''); }
        newSection(section.title === 'Basics' || section.title === 'Features' ? 'Features' : section.title, txt.replace(/\s+/g, ' ').trim());
        continue;
      }
      if (t === '') { inRun = false; runNote = null; pendingNote = []; continue; }
      if (/^\/\//.test(t)) {
        var c = t.replace(/^\/\/\s*/, '');
        if (/^var\s|^function\s|^export\s/.test(c)) continue;   // commented-out code (e.g. BLOWHOLE)
        if (SKIP_NOTE.test(c)) continue;   // column headings, not notes
        if (!inRun) pendingNote.push(c); else { inRun = false; pendingNote = [c]; }
        continue;
      }
      // A definition at the top level?
      var d = t.match(/^(export\s+)?var\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*)$/);
      var f = !d && t.match(/^(export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/);
      if (!d && !f) {
        // other top-level code (the placement loop): skip its block
        if (/\{\s*$/.test(t)) { var depth = 0; for (; i < lines.length; i++) { depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length; if (depth <= 0) break; } }
        continue;
      }
      var name = d ? d[2] : f[2];
      var startLine = lineBase + i + 1;
      // gather the whole statement (multi-line arrays, function bodies)
      var text = line, depthB = count(line, '[') - count(line, ']') + count(line, '{') - count(line, '}');
      while (depthB > 0 && i + 1 < lines.length) { i++; text += '\n' + lines[i]; depthB += count(lines[i], '[') - count(lines[i], ']') + count(lines[i], '{') - count(lines[i], '}'); }
      if (name.charAt(0) === '_' || name === 'NONE') continue;   // NONE: filler for unused channels
      var inline = (line.match(/\/\/\s?(.*)$/) || [, ''])[1].trim();
      if (inline) while (i + 1 < lines.length && /^\s{8,}\/\//.test(lines[i + 1])) { i++; inline += ' ' + lines[i].trim().replace(/^\/\/\s*/, ''); }
      var entry = { name: name, line: startLine, note: inline, exported: !!(d ? d[1] : f[1]) };
      if (f) {
        entry.kind = INTERNAL[name] ? 'internal' : 'function';
        entry.signature = name + '(' + f[3].replace(/\s+/g, ' ').trim() + ')';
        // a one-line function's trailing comment describes it; otherwise the comment above does
        if (text.indexOf('\n') >= 0) entry.note = '';
      } else {
        var value = stripComments(text.slice(text.indexOf('=') + 1)).trim().replace(/;\s*$/, '');
        var fm = value.match(/^feature\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/);
        if (fm) { entry.kind = 'feature'; entry.count = +fm[1]; entry.reversed = +fm[2]; }
        else if (/^\[/.test(value) && /^[\[\]\s,A-Za-z0-9_]+$/.test(value) && /[A-Za-z]/.test(value)) {
          var names = value.replace(/[\[\]\s]/g, '').split(',').filter(Boolean);
          if (/^BOARD_[A-F]$/.test(name)) { entry.kind = 'wiring'; entry.channels = channels(value); }
          else if (name === 'BOARDS') { entry.kind = 'wiring'; entry.members = names; }
          else { entry.kind = 'group'; entry.members = names; model.groups[name] = names; }
        }
        else if (/^TAG_/.test(name) && /^\d+$/.test(value)) { entry.kind = 'tag'; entry.bit = +value; }
        else if (/^mapPoint\(/.test(value)) { entry.kind = 'landmark'; entry.inches = nums(value); }
        else if (/^n[XYZ]\(\s*-?[\d.]+\s*\)$/.test(value)) { entry.kind = 'plane'; entry.axis = value.charAt(1).toLowerCase(); entry.inches = nums(value)[0]; }
        else { entry.kind = 'value'; entry.expr = value.length > 60 ? value.slice(0, 57) + '…' : value; }
      }
      add(entry);
    }
    // Wiring: feature -> board/channel. Tags: TAG -> group (from buildTags()).
    model.sections.forEach(function (s) {
      s.items.forEach(function (e) {
        if (e.kind !== 'wiring' || !e.channels) return;
        var board = e.name.slice(-1);
        e.channels.forEach(function (ch, c) {
          ch.forEach(function (n) { (model.groups[n] || [n]).forEach(function (fn) { if (fn !== 'NONE') model.wiring[fn] = { board: board, channel: c }; }); });
        });
      });
    });
    src.replace(/tagGroup\(\s*([A-Za-z_$][\w$]*)\s*,\s*(TAG_[A-Z0-9_]+)\s*\)/g, function (all, g, tag) { model.tagsFor[tag] = g; });
    model.sections = model.sections.filter(function (s) { return s.items.some(function (x) { return x.name; }); });
    // Most useful first for someone writing an effect; otherwise template order.
    var rank = function (s) {
      var t = s.title.toUpperCase();
      if (/LOOKUP/.test(t)) return 0;
      if (t === 'FEATURES') return 1;
      if (/GROUP/.test(t)) return 2;
      if (/PER-CONTROLLER|TAG/.test(t)) return 3;
      if (/MAP/.test(t)) return 4;
      if (/WIRING/.test(t)) return 6;
      if (t === 'BASICS') return 7;
      return 5;
    };
    model.sections = model.sections.map(function (s, k) { return { s: s, k: k }; })
      .sort(function (a, b) { return rank(a.s) - rank(b.s) || a.k - b.k; }).map(function (x) { return x.s; });
    return model;
  }
  function count(s, ch) { return s.split(ch).length - 1; }
  function nums(s) { return (s.match(/-?\d+(?:\.\d+)?/g) || []).map(Number); }
  function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); }
  // "[GROUP_R1_2, [R3], [NONE], ...]" -> [["GROUP_R1_2"], ["R3"], ["NONE"], ...]
  function channels(value) {
    var inner = value.trim().slice(1, -1), out = [], depth = 0, cur = '';
    for (var i = 0; i < inner.length; i++) {
      var ch = inner[i];
      if (ch === '[') depth++;
      if (ch === ']') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map(function (c) { return c.replace(/[\[\]\s]/g, '').split(',').filter(Boolean); });
  }

  // ------------------------------------------------------------------ render
  // opts: { insert(text), value(name) -> number | number[] | undefined,
  //         feature(name) -> [count, start, end, rev] | undefined,
  //         canShow(entry) -> bool, show(entry), showing -> name shown on the whale,
  //         docHeading(entry) -> contract section | null, openDoc(heading) }
  function render(box, model, opts, query) {
    box.innerHTML = '';
    var q = (query || '').trim().toLowerCase();
    var fmt = function (v) { return typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(1) : +v.toFixed(4) + '') : ''; };
    var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    var shown = 0;

    if (!q && model.intro) {
      var det = el('details', 'ref-intro');
      det.appendChild(el('summary', null, 'About the template: key concepts, quick reference, maintenance'));
      det.appendChild(el('pre', null, model.intro));
      box.appendChild(det);
    }
    model.sections.forEach(function (s) {
      var items = s.items.filter(function (e) {
        if (!e.name) return !q;
        if (!q) return true;
        return (e.name + ' ' + (e.note || '') + ' ' + (e.blockNote || '') + ' ' + (e.signature || '') + ' ' + (e.members || []).join(' ') + ' ' +
          (KIND_WORDS[e.kind] || '') + ' ' + (model.wiring[e.name] ? 'board ' + model.wiring[e.name].board + ' ch ' + model.wiring[e.name].channel : '')).toLowerCase().indexOf(q) >= 0;
      });
      if (!items.some(function (e) { return e.name; })) return;
      var sec = el('section', 'ref-sec');
      var h = el('h3', null, titleCase(s.title));
      if (s.sub) h.appendChild(el('span', null, ' · ' + s.sub));
      sec.appendChild(h);
      items.forEach(function (e) {
        if (!e.name) { sec.appendChild(el('p', 'ref-note', e.note)); return; }
        shown++;
        var row = el('div', 'ref-item ' + e.kind);
        var top = el('div', 'ref-top');
        var nameBtn = el('button', 'ref-name', e.signature || e.name);
        nameBtn.type = 'button';
        nameBtn.title = e.kind === 'function' || e.kind === 'internal' ? 'Insert ' + e.name + '( at the cursor' : 'Insert ' + e.name + ' at the cursor';
        nameBtn.onclick = function () { opts.insert(e.kind === 'function' || e.kind === 'internal' ? e.name + '(' : e.name); };
        top.appendChild(nameBtn);
        var meta = el('span', 'ref-meta');
        var chips = [];
        if (e.kind === 'feature') {
          var w = model.wiring[e.name];
          if (w) chips.push('board ' + w.board + ' ch ' + w.channel);
          chips.push(e.count ? e.count + ' px' : 'not installed (count 0)');
          if (e.reversed) chips.push('wired reversed');
          var fr = opts.feature(e.name);
          if (fr && fr[0] > 0) chips.push('global ' + fr[1] + '–' + fr[2]);
          if (!e.count) row.classList.add('off');
        } else if (e.kind === 'group') {
          chips.push(e.members.length + ' features');
        } else if (e.kind === 'tag') {
          chips.push('bit ' + e.bit + (model.tagsFor[e.name] ? ' = ' + model.tagsFor[e.name] : ''));
        } else if (e.kind === 'landmark') {
          chips.push(e.inches.join(', ') + ' in');
          var lv = opts.value(e.name);
          if (lv && lv.length) chips.push('→ ' + lv.map(fmt).join(', '));
        } else if (e.kind === 'plane') {
          chips.push(e.axis + ' = ' + e.inches + ' in');
          var pv = opts.value(e.name);
          if (typeof pv === 'number') chips.push('→ ' + fmt(pv));
        } else if (e.kind === 'value') {
          var v = opts.value(e.name);
          chips.push(typeof v === 'number' ? '= ' + fmt(v) : typeof v === 'string' ? v : e.expr);
        } else if (e.kind === 'internal') {
          chips.push('used by the template itself');
        }
        if (e.exported && e.kind !== 'feature') chips.push('exported');
        meta.textContent = chips.join(' · ');
        top.appendChild(meta);
        if (opts.canShow && opts.canShow(e)) {
          var sb = el('button', 'ref-show', 'Show');
          sb.type = 'button';
          var on = opts.showing === e.name;
          sb.setAttribute('aria-pressed', on);
          sb.title = on ? 'Stop showing ' + e.name + ' on the whale' : 'Show ' + e.name + ' on the whale';
          sb.onclick = function () { opts.show(e); };
          top.appendChild(sb);
        }
        row.appendChild(top);
        var note = e.note || '';
        if (e.kind === 'function' || e.kind === 'internal') note = [e.blockNote, e.note].filter(Boolean).join(' ');
        if (e.kind === 'group' || (e.kind === 'wiring' && e.members)) {
          var mem = el('div', 'ref-members');
          e.members.forEach(function (n, k) {
            var b = el('button', 'ref-chip', n); b.type = 'button'; b.onclick = function () { opts.insert(n); };
            mem.appendChild(b);
          });
          row.appendChild(mem);
        }
        if (note) row.appendChild(el('p', 'ref-text', note));
        var dh = opts.docHeading && opts.docHeading(e);
        if (dh && (e.kind !== 'value' || note)) {
          var dl = el('button', 'ref-doc', 'Contract § ' + dh.replace(/^([\d.]+?)\.?\s.*$/, '$1') + ' →');
          dl.type = 'button'; dl.title = 'Open "' + dh + '" in the Docs tab';
          dl.onclick = function () { opts.openDoc(dh); };
          row.appendChild(dl);
        }
        sec.appendChild(row);
      });
      box.appendChild(sec);
    });
    if (!shown) box.appendChild(el('p', 'ref-empty', q ? 'Nothing in the template matches "' + query + '".' : 'Open the repo folder to see what the template provides.'));
  }
  function titleCase(s) { return s.toLowerCase().replace(/(^|\s|-)([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }).replace(/\b3d\b/i, '3D'); }

  return { parse: parse, render: render };
})();
