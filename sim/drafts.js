// drafts.js -- where the simulator keeps drafts (work that isn't a repo file yet).
//
//   disk      src/drafts/<id>.effect.js in the repo folder (Chrome / Edge, with
//             permission to write). Gitignored. Any editor or AI can work on them.
//   browser   this browser's storage (Safari / Firefox, or when writing isn't
//             allowed). Private to this browser.
//   artifact  the Claude artifact's database, collection "drafts" (doc id = draft
//             id; fields name, code, by, rev, updatedAt). Shared with everyone
//             who opens the artifact, and readable and writable by the chat.
//
// Every store: { kind, where, list() -> [{ id, name, by }], read(id) -> { name, code, by, rev } | null,
//   write(id, { name, code }), remove(id) }, plus stamp(id)/path(id) on disk and
//   onChange(fn) on the artifact.
//
// Defines one global, OrcarDrafts.

var OrcarDrafts = (function () {
  'use strict';

  var DIR = 'src/drafts';

  function slug(s) {
    return String(s || '').toLowerCase().replace(/\.effect\.js$|\.js$/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  function disk(source) {
    var path = function (id) { return DIR + '/' + id + '.effect.js'; };
    return {
      kind: 'disk', where: 'src/drafts/ in your folder (not in git)',
      path: path,
      list: async function () {
        return (await source.list(DIR)).filter(function (p) { return /\.effect\.js$/.test(p); })
          .map(function (p) { var id = p.split('/').pop().replace(/\.effect\.js$/, ''); return { id: id, name: id }; });
      },
      read: async function (id) {
        try { return { name: id, code: await source.read(path(id)) }; } catch (e) { return null; }
      },
      write: function (id, d) { return source.write(path(id), d.code); },
      remove: function (id) { return source.remove(path(id)); },
      stamp: function (id) { return source.stamp(path(id)); },
    };
  }

  function browser() {
    var KEY = 'orcar-sim:drafts';
    var all = function () { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
    var put = function (o) {
      try { localStorage.setItem(KEY, JSON.stringify(o)); }
      catch (e) { throw new Error('This browser wouldn\'t store the draft (storage full or blocked).'); }
    };
    return {
      kind: 'browser', where: 'this browser only',
      list: function () {
        var o = all();
        return Promise.resolve(Object.keys(o).map(function (id) { return { id: id, name: o[id].name || id, t: o[id].t }; }));
      },
      read: function (id) { var o = all(); return Promise.resolve(o[id] ? { name: o[id].name || id, code: o[id].code } : null); },
      write: function (id, d) { var o = all(); o[id] = { name: d.name, code: d.code, t: Date.now() }; put(o); return Promise.resolve(); },
      remove: function (id) { var o = all(); delete o[id]; put(o); return Promise.resolve(); },
    };
  }

  // db: the artifact's database namespace; tab: this tab's rev prefix.
  function artifact(db, tab) {
    var col = db.collection('drafts');
    var cache = {}, listeners = [], ready = null;
    // Snapshots served from cache (or partial first pages) still describe what
    // was there before this page opened: everything up to and including the
    // first snapshot from the server counts as initial, and the store is ready then.
    var settled = false, done = null;
    ready = new Promise(function (resolve) {
      done = resolve;
      col.onSnapshot(function (qs) {
        var initial = !settled;
        if (!(qs.metadata && qs.metadata.fromCache)) settled = true;
        qs.docChanges().forEach(function (ch) {
          var id = ch.doc.id;
          if (ch.type === 'removed') delete cache[id];
          else cache[id] = ch.doc.data();
          listeners.forEach(function (fn) { fn({ type: ch.type, id: id, data: cache[id] || null, initial: initial, pending: !!(qs.metadata && qs.metadata.hasPendingWrites) }); });
        });
        if (settled) resolve();
      }, function () { settled = true; resolve(); });
      setTimeout(function () { settled = true; resolve(); }, 8000);
    });
    return {
      kind: 'artifact', where: 'this artifact (shared, and visible to the chat)',
      list: async function () {
        await ready;
        return Object.keys(cache).map(function (id) { return { id: id, name: cache[id].name || id, by: cache[id].by }; });
      },
      read: async function (id) {
        await ready;
        if (cache[id]) return { name: cache[id].name || id, code: cache[id].code || '', by: cache[id].by, rev: cache[id].rev };
        var snap = await col.doc(id).get();
        if (!snap.exists) return null;
        var d = snap.data();
        return { name: d.name || id, code: d.code || '', by: d.by, rev: d.rev };
      },
      write: function (id, d) {
        var rev = tab + Date.now();
        cache[id] = { name: d.name, code: d.code, by: 'page', rev: rev };
        return col.doc(id).set({ name: d.name, code: d.code, by: 'page', rev: rev, updatedAt: new Date().toISOString() });
      },
      remove: function (id) { delete cache[id]; return col.doc(id).delete(); },
      onChange: function (fn) { listeners.push(fn); },
    };
  }

  return { disk: disk, browser: browser, artifact: artifact, slug: slug, DIR: DIR };
})();
