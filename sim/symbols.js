// symbols.js -- what a name in an effect means, for the editor's suggestions
// and hover hints.
//
// Three sources, none of them copied into the simulator:
//   template     the Reference tab's model of src/template/orcar_3d_mapped.js
//   pixelblaze   the built-ins documented in docs/PIXELBLAZE_REFERENCE.md
//                (so suggestions only offer functions the contract allows)
//   effect       names declared in the open effect itself
//
// A symbol: { name, kind, source, signature, note, insert, doc: { path, heading } }
//
// Defines one global, OrcarSymbols.

var OrcarSymbols = (function () {
  'use strict';

  var REF = 'docs/PIXELBLAZE_REFERENCE.md';
  function plain(md) {
    return String(md || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
  }

  // ------------------------------------------------------------------ Pixelblaze built-ins
  // Read from the reference: bullets ("- `name(args)`: what it does"), table
  // rows ("| `sliderName(v)` | ... |"), lists of signatures ("`abs(v)` · ..."),
  // the "Constants:" line, and the sensor variables table. Section 4 ("what
  // does NOT work") and the language sections are skipped.
  function fromReferenceDoc(md) {
    var out = {}, heading = '', skip = false;
    var add = function (name, kind, signature, note) {
      if (!name || out[name] && out[name].note) return;
      out[name] = { name: name, kind: kind, source: 'pixelblaze', signature: signature || name, note: note || '',
        insert: kind === 'function' ? name + '(' : name, doc: { path: REF, heading: heading } };
    };
    String(md || '').split('\n').forEach(function (line) {
      var h = line.match(/^#{2,3}\s+(.*)/);
      if (h) { heading = h[1].trim(); skip = /^(1|2|3|4|6|9)\./.test(heading); return; }
      var pc = line.match(/`pixelCount` is (.*)$/);
      if (pc) { add('pixelCount', 'constant', 'pixelCount', plain(pc[1])); return; }
      if (skip) return;
      var codes = [], m, re = /`([^`]+)`/g;
      while ((m = re.exec(line))) codes.push({ text: m[1], at: m.index, end: re.lastIndex });
      if (!codes.length) return;
      var bullet = /^\s*-\s+`/.test(line), row = /^\s*\|/.test(line);
      // Controls table: `sliderName(v)` -> suggest the prefix
      if (row) {
        var cells = line.split('|').slice(1, -1).map(function (c) { return c.trim(); });
        var first = (cells[0] || '').match(/^`([A-Za-z]+?)(Name)?\(([^)]*)\)`$/);
        if (first && first[2]) {
          add(first[1], 'control', first[1] + 'Name(' + first[3] + ')', plain('A UI control: export function ' + first[1] + 'Speed(' + first[3] + ') { … }. Gets ' + cells[1] + '. ' + (cells[2] || '')));
          return;
        }
        if (/sensor/i.test(heading) && /^(`[a-zA-Z]+`[,\s]*)+$/.test(cells[0] || '')) {
          (cells[0].match(/`([a-zA-Z]+)`/g) || []).forEach(function (c) { var n = c.slice(1, -1); add(n, 'sensor', n, plain(cells.slice(1).join(' '))); });
          return;
        }
      }
      if (/^\s*Constants:/.test(line)) {
        line.replace(/`([A-Z][A-Z0-9_]*)`(\s*\(([^)]*)\))?/g, function (all, n, p, d) { add(n, 'constant', n, d ? plain(d) : 'Pixelblaze constant'); });
        return;
      }
      // "2D: `translate`, `scale`, `rotate`" (written without their arguments)
      var twoD = line.match(/2D:\s*((?:`[a-z]\w*`[,\s]*)+)/);
      if (twoD) (twoD[1].match(/`(\w+)`/g) || []).forEach(function (c) { var n = c.slice(1, -1); add(n, 'function', n + '(…)', '2D map transform, like the 3D ones in this list'); });
      // pin modes: "pinMode(pin, mode) with `INPUT`, `OUTPUT`, ..."
      if (/pinMode\(/.test(line)) codes.forEach(function (c) { if (/^[A-Z][A-Z0-9_]{2,}$/.test(c.text)) add(c.text, 'constant', c.text, 'a pin mode for pinMode()'); });
      codes.forEach(function (c, k) {
        var fm = c.text.match(/^([a-zA-Z_][\w]*)\(([^)]*)\)$/);
        if (!fm || fm[1] === 'fn') return;
        var note = '';
        if (bullet) {
          // "- `a(x)` / `b(x)`: text" -> the text after the colon that follows the code spans
          var rest = line.slice(codes[codes.length - 1].end);
          var colon = line.indexOf(':', c.end);
          note = plain(colon >= 0 ? line.slice(colon + 1) : rest).replace(/^[.,;:\s]+/, '');
        } else {
          // "`frac(v)` (keeps the sign: ...)" -> a parenthesis right after it
          var after = line.slice(c.end).match(/^\s*\(([^)]*)\)/);
          if (after) note = plain(after[1]);
        }
        add(fm[1], 'function', c.text, note);
      });
    });
    return out;
  }

  // ------------------------------------------------------------------ template
  var CONTRACT = 'docs/ORCAR_CONTRACT.md';
  function fromTemplate(model) {
    var out = {};
    if (!model) return out;
    Object.keys(model.byName).forEach(function (n) {
      var e = model.byName[n];
      var note = [e.blockNote, e.note].filter(Boolean).join(' ');
      var detail = '';
      if (e.kind === 'feature') {
        var w = model.wiring[n];
        detail = (w ? 'board ' + w.board + ' ch ' + w.channel + ' · ' : '') + (e.count ? e.count + ' px' : 'not installed (count 0)') + (e.reversed ? ' · wired reversed' : '');
      } else if (e.kind === 'tag') detail = 'bit ' + e.bit + (model.tagsFor[n] ? ' = ' + model.tagsFor[n] : '') + ' · test with (tags & ' + n + ')';
      else if (e.kind === 'group') detail = e.members.length + ' features: ' + e.members.join(', ');
      else if (e.kind === 'landmark') detail = '[x, y, z] = ' + e.inches.join(', ') + ' in';
      else if (e.kind === 'plane') detail = e.axis + ' = ' + e.inches + ' in';
      var fn = e.kind === 'function' || e.kind === 'internal';
      out[n] = { name: n, kind: e.kind, source: 'template', signature: e.signature || n, note: note, detail: detail,
        insert: fn ? n + '(' : n, doc: { path: CONTRACT, heading: docHeading(e) } };
    });
    return out;
  }
  // The contract section that explains a kind of template name.
  function docHeading(e) {
    if (e.kind === 'landmark' || e.kind === 'plane' || /^n[XYZ]$|^nLen$|^mapPoint$|^[XYZ]_(LO|HI)$|^MAP_/.test(e.name)) return '3.2 Normalization';
    if (/^(TAGS|BB_POS|NODE_OFFSET|tagsBuiltFor|buildTags)$/.test(e.name)) return '2. Anatomy of an Orcar pattern';
    if (/^(EYE_1|EYE_2|TEST)$/.test(e.name)) return '3.3 Unmapped pixels';
    return '4. Features, groups and tags';
  }

  // ------------------------------------------------------------------ the open effect
  function fromEffect(text) {
    var out = {};
    String(text || '').replace(/\b(?:var|function)\s+([A-Za-z_$][\w$]*)/g, function (all, n) {
      if (!out[n]) out[n] = { name: n, kind: /function/.test(all) ? 'function' : 'variable', source: 'effect', signature: n, note: 'declared in this effect', insert: n };
    });
    return out;
  }

  // ------------------------------------------------------------------ editor wiring
  // getSymbols() -> merged map; opts: { open(sym) } for Ctrl/Cmd-click.
  function attach(cm, getSymbols, opts) {
    var ID = /[A-Za-z0-9_$]/;
    var mac = /Mac|iPhone|iPad/.test(navigator.platform);   // Cmd-click on a Mac, Ctrl-click elsewhere
    function wordAt(pos) {
      var line = cm.getLine(pos.line) || '', s = pos.ch, e = pos.ch;
      while (s > 0 && ID.test(line.charAt(s - 1))) s--;
      while (e < line.length && ID.test(line.charAt(e))) e++;
      return { word: line.slice(s, e), from: { line: pos.line, ch: s }, to: { line: pos.line, ch: e } };
    }
    function inCommentOrString(pos) {
      var t = cm.getTokenAt(pos).type || '';
      return /comment|string/.test(t);
    }

    // -------- suggestions
    var RANK = { template: 0, pixelblaze: 1, effect: 2 };
    function hint(c) {
      var cur = c.getCursor(), w = wordAt(cur);
      var typed = w.word.slice(0, cur.ch - w.from.ch);
      if (!typed) return null;
      var low = typed.toLowerCase(), syms = getSymbols(), list = [];
      Object.keys(syms).forEach(function (n) {
        var s = syms[n];
        if (s.kind === 'internal') return;
        var i = n.toLowerCase().indexOf(low);
        if (i < 0) return;
        list.push({ s: s, score: (n === typed ? -1 : 0) + (i === 0 ? 0 : 10) + (n.indexOf(typed) === 0 ? 0 : 1) + RANK[s.source] * 0.1 });
      });
      // Nothing to offer beyond what's already typed (R14, hsv24): no list.
      if (!list.some(function (x) { return x.s.name !== typed; })) return null;
      list.sort(function (a, b) { return a.score - b.score || a.s.name.localeCompare(b.s.name); });
      var parenNext = (c.getLine(cur.line) || '').charAt(w.to.ch) === '(';
      return {
        from: w.from, to: { line: cur.line, ch: w.to.ch },
        list: list.slice(0, 40).map(function (x) {
          var text = parenNext && /\($/.test(x.s.insert) ? x.s.insert.slice(0, -1) : x.s.insert;
          return { text: text, displayText: x.s.name, sym: x.s, render: function (el, self, data) {
            var nm = document.createElement('span'); nm.className = 'hint-name'; nm.textContent = data.sym.signature;
            var kd = document.createElement('span'); kd.className = 'hint-kind'; kd.textContent = label(data.sym);
            el.appendChild(nm); el.appendChild(kd);
            var note = data.sym.detail || data.sym.note;
            if (note) { var nt = document.createElement('div'); nt.className = 'hint-note'; nt.textContent = note.length > 110 ? note.slice(0, 107) + '…' : note; el.appendChild(nt); }
          } };
        }),
      };
    }
    function show(byTyping) {
      if (!CodeMirror.showHint) return;
      cm.showHint({ hint: hint, completeSingle: false, closeCharacters: /[\s()\[\]{};:>,.+\-*\/=<!&|?]/,
        // Enter on the name that's already typed in full (R1 while R10.. are listed) is a new line, not a pick
        extraKeys: { Enter: function (c, handle) {
          var st = c.state.completionActive, w = st && st.widget, data = w && w.data;
          var item = data && data.list[w.selectedHint];
          var typedNow = item ? c.getRange(data.from, c.getCursor()) : null;
          if (item && item.displayText === typedNow) { handle.close(); c.execCommand('newlineAndIndent'); }
          else handle.pick();
        } } });
    }
    cm.on('inputRead', function (c, change) {
      if (!opts.enabled()) return;
      if (change.origin !== '+input' || !/[\w$]$/.test(change.text.join(''))) return;
      var cur = c.getCursor(), w = wordAt(cur);
      if (cur.ch - w.from.ch < 2 || !/^[A-Za-z_$]/.test(w.word) || inCommentOrString(cur)) return;
      if (/[\d.]/.test((c.getLine(cur.line) || '').charAt(w.from.ch - 1))) return;   // a number or a property
      show(true);
    });
    cm.addKeyMap({ 'Ctrl-Space': function () { show(false); } });

    // -------- hover hints
    var tip = document.createElement('div');
    tip.className = 'cm-hover-tip'; tip.hidden = true;
    document.body.appendChild(tip);
    var timer = null, lastKey = '';
    function hide() { clearTimeout(timer); tip.hidden = true; lastKey = ''; }
    function symAtEvent(e) {
      if (e.target.closest && e.target.closest('.CodeMirror-gutters, .CodeMirror-gutter-wrapper, .CodeMirror-hints')) return null;
      var pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
      var line = cm.getLine(pos.line);
      if (line === undefined) return null;
      var w = wordAt(pos);
      if (!w.word || inCommentOrString({ line: pos.line, ch: w.from.ch + 1 })) return null;
      // the pointer must be on the word itself (coordsChar snaps to the nearest character)
      var a = cm.charCoords(w.from, 'window'), b = cm.charCoords(w.to, 'window');
      if (e.clientX < a.left || e.clientX > b.left || e.clientY < a.top || e.clientY > a.bottom) return null;
      var s = getSymbols()[w.word];
      return s && s.source !== 'effect' ? { s: s, w: w } : null;
    }
    cm.getWrapperElement().addEventListener('mousemove', function (e) {
      var hit = symAtEvent(e);
      if (!hit) { hide(); return; }
      var key = hit.s.name + ':' + hit.w.from.line + ':' + hit.w.from.ch;
      if (key === lastKey && !tip.hidden) return;
      lastKey = key;
      clearTimeout(timer);
      var x = e.clientX, y = e.clientY;
      timer = setTimeout(function () {
        var s = hit.s;
        tip.innerHTML = '';
        var top = document.createElement('div'); top.className = 'tip-top';
        var nm = document.createElement('code'); nm.textContent = s.signature;
        var kd = document.createElement('span'); kd.textContent = label(s);
        top.appendChild(nm); top.appendChild(kd); tip.appendChild(top);
        if (s.detail) { var d = document.createElement('div'); d.className = 'tip-detail'; d.textContent = s.detail; tip.appendChild(d); }
        if (s.note) { var n = document.createElement('div'); n.textContent = s.note; tip.appendChild(n); }
        var more = document.createElement('div'); more.className = 'tip-more';
        more.textContent = (mac ? '⌘' : 'Ctrl') + '-click: ' + (s.source === 'template' ? 'show it in the Reference tab' : 'open the Pixelblaze reference');
        tip.appendChild(more);
        tip.hidden = false;
        var r = tip.getBoundingClientRect();
        tip.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x + 12)) + 'px';
        tip.style.top = (y + 18 + r.height > window.innerHeight ? y - r.height - 10 : y + 18) + 'px';
      }, 350);
    });
    cm.getWrapperElement().addEventListener('mouseleave', hide);
    cm.on('keydown', hide);
    cm.on('scroll', hide);
    cm.getWrapperElement().addEventListener('mousedown', function (e) {
      if (e.button !== 0 || !(mac ? e.metaKey : e.ctrlKey)) return;
      var hit = symAtEvent(e);
      if (!hit) return;
      e.preventDefault(); e.stopPropagation();
      hide();
      opts.open(hit.s);
    }, true);
  }

  function label(s) {
    var where = s.source === 'template' ? 'template' : s.source === 'pixelblaze' ? 'Pixelblaze' : 'this effect';
    var kind = { feature: 'feature', group: 'group', tag: 'tag', landmark: 'landmark', plane: 'plane', function: 'function',
      internal: 'function', value: 'value', wiring: 'wiring', constant: 'constant', sensor: 'sensor variable', control: 'control', variable: 'variable' }[s.kind] || s.kind;
    return where + ' ' + kind;
  }

  return { fromReferenceDoc: fromReferenceDoc, fromTemplate: fromTemplate, fromEffect: fromEffect, attach: attach, label: label, docHeading: docHeading };
})();
