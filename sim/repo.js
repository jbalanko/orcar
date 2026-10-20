// repo.js -- reads the Orcar repository (any folder name) for simulator.html.
//
// A page opened straight from disk isn't allowed to read other files by
// itself, so the person points it at the repo folder once:
//   - Chrome / Edge: a folder handle (File System Access API). Remembered
//     between visits (one "Reconnect" click), and it can watch and save files.
//   - Safari / Firefox: a folder picked through a file input, or dropped on
//     the page. A snapshot: re-pick it to see changes made on disk.
// When the page is served over http(s) (GitHub Pages, a Claude artifact,
// a local server) it fetches the same paths directly.
//
// Every source has the same shape:
//   { kind, name, canWatch, canWrite,
//     read(path) -> Promise<string>, list(dir) -> Promise<[path]>,
//     stamp(path) -> Promise<number|null>, write(path, text) -> Promise }
// Paths are repo-relative with forward slashes, e.g. "src/effects/x.effect.js".
//
// Defines one global, OrcarRepo. Needs sim/engine.js loaded first.

var OrcarRepo = (function () {
  'use strict';

  var SKIP = { '.git': 1, node_modules: 1, build: 1, out: 1, '.venv': 1, __pycache__: 1 };
  var MARK = 'maps/boards.json';
  var TEMPLATE = 'src/template/orcar_3d_mapped.js';
  var EFFECT_DIRS = ['src/examples', 'src/effects'];

  function notRepo(name) {
    var e = new Error('"' + name + '" doesn\'t look like the Orcar repository: it has no ' + MARK + '. Choose the folder that contains README.md, maps/ and src/.');
    e.notRepo = true;
    return e;
  }

  // ---------------------------------------------------------- folder handle
  async function walkHandle(dir, parts) {
    var h = dir;
    for (var i = 0; i < parts.length; i++) h = await h.getDirectoryHandle(parts[i]);
    return h;
  }
  async function fileHandleAt(root, path) {
    var parts = path.split('/');
    var dir = await walkHandle(root, parts.slice(0, -1));
    return dir.getFileHandle(parts[parts.length - 1]);
  }
  async function hasMark(dir) {
    try { await fileHandleAt(dir, MARK); return true; } catch (e) { return false; }
  }

  async function handleSource(handle) {
    var root = handle;
    if (!(await hasMark(root))) {
      // Allow the folder one level up (a zip that unpacked to a folder inside a folder of the same name).
      var found = null;
      for await (var entry of handle.values()) {
        if (entry.kind === 'directory' && !SKIP[entry.name] && (await hasMark(entry))) { found = entry; break; }
      }
      if (!found) throw notRepo(handle.name);
      root = found;
    }
    return {
      kind: 'handle', name: root.name, canWatch: true, canWrite: true, handle: handle,
      read: async function (p) { return (await (await fileHandleAt(root, p)).getFile()).text(); },
      stamp: async function (p) {
        try { var f = await (await fileHandleAt(root, p)).getFile(); return f.lastModified + ':' + f.size; } catch (e) { return null; }
      },
      list: async function (d) {
        var out = [];
        try {
          var dir = await walkHandle(root, d.split('/'));
          for await (var e of dir.values()) if (e.kind === 'file') out.push(d + '/' + e.name);
        } catch (e) { /* folder missing: nothing in it */ }
        return out.sort();
      },
      // Ask once for permission to write (needs a click to be in progress).
      requestWrite: async function () {
        if (!root.queryPermission) return true;
        if ((await root.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
        return (await root.requestPermission({ mode: 'readwrite' })) === 'granted';
      },
      remove: async function (p) {
        var parts = p.split('/');
        var dir = await walkHandle(root, parts.slice(0, -1));
        await dir.removeEntry(parts[parts.length - 1]);
      },
      write: async function (p, text) {
        if (root.requestPermission && (await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
          if ((await root.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Saving needs permission to write to the folder.');
        }
        var parts = p.split('/');
        var dir = root;
        for (var i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i], { create: true });
        var fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
        var w = await fh.createWritable();
        await w.write(text);
        await w.close();
      },
    };
  }

  // ---------------------------------------------------------- a set of File objects
  // From <input webkitdirectory> (webkitRelativePath) or a dropped folder.
  function filesSource(entries, label) {
    // entries: [{ path: '<folder>/maps/boards.json', file }]
    var markAt = entries.map(function (e) { return e.path; }).filter(function (p) { return p === MARK || p.slice(-MARK.length - 1) === '/' + MARK; })
      .sort(function (a, b) { return a.length - b.length; })[0];
    if (markAt === undefined) throw notRepo(label || 'That folder');
    var prefix = markAt.slice(0, markAt.length - MARK.length);
    var files = {};
    entries.forEach(function (e) {
      if (e.path.indexOf(prefix) !== 0) return;
      var rel = e.path.slice(prefix.length);
      if (rel.split('/').some(function (s) { return SKIP[s]; })) return;
      files[rel] = e.file;
    });
    var name = prefix.replace(/\/$/, '').split('/').pop() || label || 'Orcar repository';
    return {
      kind: 'files', name: name, canWatch: false, canWrite: false,
      read: function (p) { return files[p] ? files[p].text() : Promise.reject(new Error('missing ' + p)); },
      stamp: function () { return Promise.resolve(null); },
      list: function (d) {
        return Promise.resolve(Object.keys(files).filter(function (p) { return p.indexOf(d + '/') === 0 && p.slice(d.length + 1).indexOf('/') < 0; }).sort());
      },
      write: function () { return Promise.reject(new Error('This folder was opened read-only.')); },
    };
  }

  function fromFileList(fileList) {
    var entries = [];
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      entries.push({ path: f.webkitRelativePath || f.name, file: f });
    }
    return filesSource(entries, entries.length ? entries[0].path.split('/')[0] : 'That folder');
  }

  // A folder dropped on the page (DataTransfer). Prefers a real folder handle
  // (Chrome / Edge), which can be remembered, watched and saved to.
  async function fromDrop(dataTransfer) {
    var item = null;
    for (var i = 0; i < dataTransfer.items.length; i++) if (dataTransfer.items[i].kind === 'file') { item = dataTransfer.items[i]; break; }
    if (!item) return null;
    var handlePromise = item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null;
    var entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (handlePromise) {
      var h = await handlePromise;
      if (h && h.kind === 'directory') return { source: await handleSource(h), handle: h };
      if (h && h.kind === 'file') return { fileHandle: h };
    }
    if (entry && entry.isDirectory) {
      var all = [];
      await readEntries(entry, entry.name, all);
      return { source: filesSource(all, entry.name) };
    }
    return { file: dataTransfer.files[0] };
  }
  function readEntries(dirEntry, path, out) {
    return new Promise(function (resolve) {
      var reader = dirEntry.createReader(), pending = [];
      (function batch() {
        reader.readEntries(function (list) {
          if (!list.length) { Promise.all(pending).then(resolve); return; }
          list.forEach(function (e) {
            if (SKIP[e.name]) return;
            var p = path + '/' + e.name;
            if (e.isDirectory) pending.push(readEntries(e, p, out));
            else pending.push(new Promise(function (res) { e.file(function (f) { out.push({ path: p, file: f }); res(); }, res); }));
          });
          batch();
        }, function () { Promise.all(pending).then(resolve); });
      })();
    });
  }

  // ---------------------------------------------------------- over http(s)
  // Directory listings aren't available over http, so the effect list comes
  // from sim/manifest.json if the host provides one (tools/sim-artifact.mjs
  // writes it). Without it, the examples and effects menus are empty.
  function httpSource() {
    var manifest = null;
    function getManifest() {
      if (!manifest) manifest = fetch('sim/manifest.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : { files: [] }; })
        .catch(function () { return { files: [] }; });
      return manifest;
    }
    return {
      kind: 'http', name: 'this site', canWatch: false, canWrite: false,
      read: function (p) {
        return fetch(p, { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('could not load ' + p + ' (' + r.status + ')');
          return r.text();
        });
      },
      stamp: function () { return Promise.resolve(null); },
      list: function (d) {
        return getManifest().then(function (m) {
          return (m.files || []).filter(function (p) { return p.indexOf(d + '/') === 0 && p.slice(d.length + 1).indexOf('/') < 0; }).sort();
        });
      },
      write: function () { return Promise.reject(new Error('Saving isn\'t available on a hosted copy.')); },
    };
  }

  // ---------------------------------------------------------- load what the simulator needs
  // -> { source, fit, boards: [{ id, node, pixels, map, raw, norm }], template, effects: { 'src/examples': [...], 'src/effects': [...] } }
  async function load(source, engine) {
    var cfg;
    try { cfg = JSON.parse(await source.read(MARK)); }
    catch (e) { if (e.notRepo) throw e; throw notRepo(source.name); }
    var boards = await Promise.all(cfg.boards.map(async function (b) {
      var raw = JSON.parse(await source.read('maps/' + b.map));
      return { id: b.id, node: b.node, pixels: b.pixels, map: b.map, raw: raw, norm: engine.normalizeMap(raw, cfg.fit) };
    }));
    var template = await source.read(TEMPLATE);
    var effects = {};
    for (var i = 0; i < EFFECT_DIRS.length; i++) {
      effects[EFFECT_DIRS[i]] = (await source.list(EFFECT_DIRS[i])).filter(function (p) { return /\.effect\.js$/.test(p); });
    }
    return { source: source, fit: cfg.fit, boards: boards, template: template, effects: effects };
  }

  // ---------------------------------------------------------- remembering the folder (Chrome / Edge)
  var DB = 'orcar-simulator', STORE = 'handles';
  function idb(mode, fn) {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var tx = req.result.transaction(STORE, mode);
        var r = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(r && r.result); };
        tx.onerror = function () { reject(tx.error); };
      };
    });
  }
  function rememberFolder(handle) { return idb('readwrite', function (s) { return s.put(handle, 'repo'); }).catch(function () {}); }
  function forgetFolder() { return idb('readwrite', function (s) { return s.delete('repo'); }).catch(function () {}); }
  function rememberedFolder() { return idb('readonly', function (s) { return s.get('repo'); }).catch(function () { return null; }); }

  var canPickFolder = typeof window.showDirectoryPicker === 'function';
  var canPickFile = typeof window.showOpenFilePicker === 'function';

  return {
    MARK: MARK, TEMPLATE: TEMPLATE, EFFECT_DIRS: EFFECT_DIRS,
    handleSource: handleSource, fromFileList: fromFileList, fromDrop: fromDrop, httpSource: httpSource, load: load,
    rememberFolder: rememberFolder, forgetFolder: forgetFolder, rememberedFolder: rememberedFolder,
    canPickFolder: canPickFolder, canPickFile: canPickFile,
  };
})();
