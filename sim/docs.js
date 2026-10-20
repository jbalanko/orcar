// docs.js -- the simulator's Docs tab: the repo's own docs, read from the
// repo (nothing copied) and shown as formatted pages.
//
// Links work inside the tab: "#section" anchors, other docs, and repo paths
// written as code (`docs/ORCAR_CONTRACT.md`, `src/examples/05-...effect.js`)
// open the doc or the effect. Web links open in a new tab.
//
// Defines one global, OrcarDocs. Needs marked (sim/vendor/marked-*) loaded first.

var OrcarDocs = (function () {
  'use strict';

  var DOCS = [
    { path: 'docs/ORCAR_CONTRACT.md', title: 'Effects contract' },
    { path: 'docs/PIXELBLAZE_REFERENCE.md', title: 'Pixelblaze reference' },
    { path: 'docs/SIMULATOR.md', title: 'Simulator help' },
  ];

  // GitHub-style heading ids, so "#what-the-checks-mean" links work as on GitHub.
  function slug(text) {
    return String(text).trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-');
  }

  // opts: { read(path) -> Promise<text>, openEffect(path), exists(path) -> bool,
  //         box, select, search, counter }
  function Docs(opts) {
    this.o = opts;
    this.cache = {};
    this.path = DOCS[0].path;
    this.matches = []; this.at = -1; this.req = 0;
    var me = this;
    DOCS.forEach(function (d) { me._option(d); });
    opts.select.onchange = function () { me.open(this.value); };
    opts.search.oninput = function () { me.find(this.value, false); };
    opts.search.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); me.find(this.value, true, e.shiftKey); } };
    opts.box.addEventListener('click', function (e) { me._click(e); });
  }
  Docs.prototype._option = function (d) {
    var o = document.createElement('option'); o.value = d.path; o.textContent = d.title; this.o.select.appendChild(o);
  };

  // ------------------------------------------------------------------ sanitizing
  // The docs are the repo's own files, but nothing in them may run or reach
  // out: markdown is parsed into an inert document, and only plain document
  // elements and attributes are kept (an allowlist, not a blocklist).
  var KEEP = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, P: 1, A: 1, UL: 1, OL: 1, LI: 1, CODE: 1, PRE: 1, EM: 1, STRONG: 1, B: 1, I: 1,
    DEL: 1, S: 1, BLOCKQUOTE: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TH: 1, TD: 1, HR: 1, BR: 1, IMG: 1, SPAN: 1, DIV: 1,
    DETAILS: 1, SUMMARY: 1, KBD: 1, SUP: 1, SUB: 1, INPUT: 1, DL: 1, DT: 1, DD: 1 };
  // dropped with everything inside them; any other unknown element is unwrapped (its text kept)
  var DROP = /^(SCRIPT|STYLE|IFRAME|FRAME|FRAMESET|OBJECT|EMBED|APPLET|BASE|META|LINK|FORM|TEXTAREA|SELECT|BUTTON|TEMPLATE|NOSCRIPT|SVG|MATH|AUDIO|VIDEO|SOURCE|TRACK|CANVAS|PORTAL|DIALOG)$/;
  var ATTRS = { A: { href: 1, title: 1 }, IMG: { src: 1, alt: 1, title: 1 }, TH: { align: 1, colspan: 1, rowspan: 1 }, TD: { align: 1, colspan: 1, rowspan: 1 },
    OL: { start: 1 }, INPUT: { type: 1, checked: 1, disabled: 1 }, DETAILS: { open: 1 } };
  function safeUrl(v, forImage) {
    var u = String(v || '').replace(/[\u0000- \u007f-\u009f]/g, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return /^https?:/i.test(u) || (!forImage && /^mailto:/i.test(u)) ? u : null;
    return /^\/\//.test(u) ? null : u;   // relative (or "#..."); protocol-relative isn't
  }
  function sanitize(root) {
    var walk = function (node) {
      [].slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) return;
        if (n.nodeType !== 1) { n.remove(); return; }
        var tag = n.tagName.toUpperCase();
        if (DROP.test(tag) || n.namespaceURI !== 'http://www.w3.org/1999/xhtml') { n.remove(); return; }
        if (!KEEP[tag]) { walk(n); while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n); n.remove(); return; }
        var ok = ATTRS[tag] || {};
        [].slice.call(n.attributes).forEach(function (at) {
          var name = at.name.toLowerCase();
          if (!ok[name]) { n.removeAttribute(at.name); return; }
          if (name === 'href' || name === 'src') {
            var u = safeUrl(at.value, name === 'src');
            if (u === null) n.removeAttribute(at.name); else n.setAttribute(at.name, u);
          }
        });
        if (tag === 'INPUT') { if ((n.getAttribute('type') || '').toLowerCase() !== 'checkbox') { n.remove(); return; } n.setAttribute('disabled', ''); }
        walk(n);
      });
    };
    walk(root);
    return root;
  }

  // "../README.md", "SIMULATOR.md#x" -> repo path relative to docs/
  function resolve(href) {
    var parts = ('docs/' + href).split('/'), out = [];
    parts.forEach(function (p) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
    return out.join('/');
  }

  // Show a doc, optionally scrolled to the first heading containing `heading`.
  Docs.prototype.open = async function (path, heading) {
    var me = this, box = this.o.box, req = ++this.req;
    path = path || this.path;
    if (!DOCS.some(function (d) { return d.path === path; })) { var d = { path: path, title: path }; DOCS.push(d); this._option(d); }
    this.path = path;
    this.o.select.value = path;
    if (this.shown !== path) {
      var md;
      try { md = this.cache[path] || (this.cache[path] = await this.o.read(path)); }
      catch (e) {
        if (req !== this.req) return;
        box.innerHTML = ''; var p = document.createElement('p'); p.className = 'ref-empty'; p.textContent = 'Couldn\'t read ' + path + ': ' + e.message; box.appendChild(p); this.shown = null; return;
      }
      if (req !== this.req) return;   // another doc was asked for meanwhile
      var parsed = new DOMParser().parseFromString('<!doctype html><body>' + marked.parse(md, { gfm: true }), 'text/html').body;
      sanitize(parsed);
      parsed.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(function (h) { h.id = 'doc-' + slug(h.textContent); });
      // repo paths written as code become links, if the file is there
      var exists = this.o.exists || function () { return true; };
      parsed.querySelectorAll('code').forEach(function (c) {
        if (c.closest('pre') || c.closest('a')) return;
        var t = c.textContent.trim();
        if (/^(docs\/[\w.-]+\.md|src\/(examples|effects|drafts)\/[\w.-]+\.effect\.js)$/.test(t) && exists(t)) {
          var a = document.createElement('a'); a.href = '#'; a.dataset.repo = t; a.className = 'doc-repo-link';
          a.title = /\.md$/.test(t) ? 'Open this doc' : 'Open this effect in the editor';
          c.parentNode.insertBefore(a, c); a.appendChild(c);
        }
      });
      parsed.querySelectorAll('a[href]').forEach(function (a) {
        if (/^https?:|^mailto:/i.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      });
      box.innerHTML = '';
      while (parsed.firstChild) box.appendChild(document.adoptNode(parsed.firstChild));
      this.shown = path;
      this.matches = []; this.at = -1;
      if (this.o.search.value) this.find(this.o.search.value, false);
      else this._count();
    }
    if (!heading || !this.scrollTo(heading)) box.scrollTop = 0;
  };

  // Scroll the box when it scrolls by itself (the desktop layout); on a phone
  // the page scrolls instead. (scrollIntoView would also move the page's
  // overflow-hidden panes on desktop.)
  Docs.prototype._reveal = function (el, at) {
    var box = this.o.box;
    if (box.scrollHeight > box.clientHeight + 1 && box.clientHeight < window.innerHeight) {
      box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - (at ? box.clientHeight * at : 6);
    } else el.scrollIntoView({ block: at ? 'center' : 'start' });
  };

  // Another folder was opened: read the docs again.
  Docs.prototype.reset = function () { this.cache = {}; this.shown = null; };

  // A heading by its id ("32-normalization"), or the first whose text contains `heading`.
  Docs.prototype.scrollTo = function (heading) {
    var box = this.o.box, want = String(heading).toLowerCase().trim();
    var hs = [].slice.call(box.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    var h = hs.filter(function (x) { return x.id === 'doc-' + want || x.id === 'doc-' + slug(want); })[0] ||
      hs.filter(function (x) { return x.textContent.toLowerCase().indexOf(want) >= 0; })[0] ||
      hs.filter(function (x) { return x.textContent.toLowerCase().indexOf(want.replace(/-/g, ' ')) >= 0; })[0];
    if (!h) return false;
    this._reveal(h, 0);
    h.classList.add('doc-flash');
    setTimeout(function () { h.classList.remove('doc-flash'); }, 1400);
    return true;
  };

  Docs.prototype._click = function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (a.dataset.repo) {
      e.preventDefault();
      if (/\.md$/.test(a.dataset.repo)) this.open(a.dataset.repo);
      else this.o.openEffect(a.dataset.repo);
      return;
    }
    if (/^https?:|^mailto:/i.test(href)) return;   // opens in a new tab
    e.preventDefault();   // nothing else may navigate the simulator away
    if (href.charAt(0) === '#') { this.scrollTo(href.slice(1)); return; }
    var m = href.match(/^([^#?]+\.md)(?:#(.*))?$/);
    if (m) this.open(resolve(m[1]), m[2] || null);
  };

  // Highlight every match; Enter steps through them.
  Docs.prototype.find = function (q, step, back) {
    var box = this.o.box;
    if (step && this.matches.length && this.lastQ === String(q || '').trim()) { this._go(back ? this.at - 1 : this.at + 1); return; }
    this.lastQ = String(q || '').trim();
    box.querySelectorAll('mark.doc-hit').forEach(function (m) { var t = document.createTextNode(m.textContent); m.parentNode.replaceChild(t, m); });
    box.normalize();
    this.matches = []; this.at = -1;
    q = String(q || '').trim();
    if (q.length < 2) { this._count(); return; }
    var low = q.toLowerCase(), walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), nodes = [], n;
    while ((n = walker.nextNode())) if (n.nodeValue.toLowerCase().indexOf(low) >= 0) nodes.push(n);
    var me = this;
    nodes.forEach(function (node) {
      var text = node.nodeValue, lower = text.toLowerCase(), frag = document.createDocumentFragment(), i = 0, j;
      while ((j = lower.indexOf(low, i)) >= 0) {
        frag.appendChild(document.createTextNode(text.slice(i, j)));
        var m = document.createElement('mark'); m.className = 'doc-hit'; m.textContent = text.slice(j, j + q.length);
        frag.appendChild(m); me.matches.push(m);
        i = j + q.length;
      }
      frag.appendChild(document.createTextNode(text.slice(i)));
      node.parentNode.replaceChild(frag, node);
    });
    if (this.matches.length) this._go(back ? this.matches.length - 1 : 0);
    this._count();
  };
  Docs.prototype._count = function () {
    if (!this.o.counter) return;
    var q = String(this.o.search.value || '').trim();
    this.o.counter.textContent = this.matches.length ? this.count() : q.length >= 2 ? 'no matches' : '';
  };
  Docs.prototype._go = function (k) {
    if (!this.matches.length) return;
    this.at = (k + this.matches.length) % this.matches.length;
    this.matches.forEach(function (m) { m.classList.remove('on'); });
    var m = this.matches[this.at];
    m.classList.add('on');
    this._count();
    this._reveal(m, 1 / 3);
  };
  Docs.prototype.count = function () { return this.matches.length ? (this.at + 1) + ' of ' + this.matches.length : ''; };

  return { Docs: Docs, DOCS: DOCS, slug: slug, sanitize: sanitize, resolve: resolve };
})();
