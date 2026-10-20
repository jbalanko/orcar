// app.js -- the simulator page: editor, repo, boards, view, controls, checks.
// See docs/SIMULATOR.md for what it does and doesn't check.
(function () {
  'use strict';

  var engine = orcarEngine();
  var $ = function (id) { return document.getElementById(id); };
  var store = {   // per-viewer conveniences only; the page works without it
    get: function (k) { try { var v = localStorage.getItem('orcar-sim:' + k); return v === null ? null : JSON.parse(v); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('orcar-sim:' + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem('orcar-sim:' + k); } catch (e) {} },
  };

  var S = {
    repo: null, head: null, headStamp: null,
    doc: null,              // { label, path, fileHandle, origin, savedText, stamp }
    run: null,              // { full, mode, offset, featureNames, tagNames }
    boardInfo: [], boardStats: [], describe: [],
    unmapped: [],           // per board: Uint8Array of placeholder pixels
    controls: [], controlValues: {}, controlDefaults: {},
    lint: [], syntax: null, fatal: null,
    flash: null, loadedAt: 0,
    drafts: null, draftList: [], draftSig: null, ticks: 0, lastTyped: 0, selfRemoved: {},
  };
  var BOARD_COLOURS = OrcarView.BOARD_COLOURS;

  // ===================================================================== editor
  var cm = CodeMirror($('editor'), {
    value: '', mode: 'javascript', lineNumbers: true, indentUnit: 2, tabSize: 2,
    matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true,
    gutters: ['issues-gutter', 'CodeMirror-linenumbers'],
    extraKeys: {
      'Ctrl-Enter': function () { runNow(); }, 'Cmd-Enter': function () { runNow(); },
      'Ctrl-S': function () { save(); }, 'Cmd-S': function () { save(); },
      'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment',
      Tab: function (c) { c.execCommand(c.somethingSelected() ? 'indentMore' : 'insertSoftTab'); },
    },
  });
  var runTimer = null, backupTimer = null, quietChange = false;
  cm.on('change', function () {
    if (quietChange) return;
    S.lastTyped = Date.now();
    if (isDraft(S.doc)) scheduleDraftSave();
    else { clearTimeout(backupTimer); backupTimer = setTimeout(saveBackup, 600); }
    updateDirty();
    if ($('autoRun').checked) { clearTimeout(runTimer); runTimer = setTimeout(autoRun, 700); }
    claudeLink.changed();
  });
  // Auto-run waits while a suggestion list is open: a half-typed name would
  // only be an error, and the re-run would close the list.
  function autoRun() {
    if (cm.state.completionActive) { runTimer = setTimeout(autoRun, 400); return; }
    runNow();
  }
  function setEditor(text) { quietChange = true; cm.setValue(text); cm.clearHistory(); quietChange = false; updateDirty(); }

  // ===================================================================== view + sim
  var view = new OrcarView.View($('view'), { onHover: hover });
  var sim = new OrcarBoards.Sim({
    status: function () {},
    loaded: function (i, info) {
      S.boardInfo[i] = info;
      if (i === 0) buildControls(info);
      scheduleIssues();
    },
    frame: function (i, pixels, nowMs, stats, readouts, describe, levels) {
      view.setColours(i, pixels);
      S.boardStats[i] = stats;
      if (describe) { S.describe[i] = describe; updateStrips(); refreshShow(); if (i === 0) scheduleReference(); }
      if (readouts) showReadouts(readouts);
      if (S.flash) S.flash.push(i, levels);
      scheduleIssues();
    },
    fatal: function (info) {
      S.fatal = info;
      $('stoppedText').textContent = info.hung ? info.message : 'Board ' + info.board + ': ' + info.message;
      $('stopped').hidden = false;
      renderIssues();
    },
  });

  var last = performance.now();
  function loop(now) {
    var dt = now - last; last = now;
    sim.tick(dt);
    soundTick(now);
    view.draw();
    $('clock').textContent = (Math.max(0, sim.elapsedMs()) / 1000).toFixed(1) + ' s';
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ===================================================================== repo
  function setRepoChip(state, text, action) {
    var chip = $('repoChip');
    chip.className = 'chip' + (state ? ' ' + state : '');
    $('repoText').textContent = text;
    var old = chip.querySelector('button');
    if (old) old.remove();
    if (action) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = action.label; b.onclick = action.fn;
      chip.appendChild(b);
    }
  }

  function welcome(show, opts) {
    opts = opts || {};
    $('welcome').hidden = !show;
    $('welcomeErr').hidden = !opts.error;
    $('welcomeErr').textContent = opts.error || '';
    $('reconnect').hidden = !opts.reconnect;
    if (opts.reconnect) $('reconnectName').textContent = opts.reconnect;
    var note = '';
    if (location.protocol === 'file:' && !OrcarRepo.canPickFolder)
      note = 'In this browser the folder is read once: pick it again (or reload the page) after files change on disk. Chrome and Edge remember the folder and pick up changes automatically.';
    $('welcomeNote').textContent = note;
  }

  async function connect(source, handle) {
    if (S.doc) {
      if (!(await leaveDoc())) return;
      S.doc = null;   // reopened from the new folder below
    }
    try {
      var repo = await OrcarRepo.load(source, engine);
      var head = engine.templateHead(repo.template);
      if (head === null) throw new Error('src/template/orcar_3d_mapped.js has no PATTERN marker, so effects can\'t be joined to it. Check the template.');
      S.repo = repo; S.head = head;
      S.headStamp = await source.stamp(OrcarRepo.TEMPLATE);
      if (handle) OrcarRepo.rememberFolder(handle);
      setupGeometry();
      await chooseDraftStore();
      fillPicker();
      welcome(false);
      refreshDocs();
      setRepoChip('on', repo.source.name + (source.canWatch ? '' : source.kind === 'http' ? '' : ' (snapshot)'),
        source.kind === 'files' ? { label: 'Re-read', fn: pickFolder } : null);
      $('saveBtn').disabled = false; $('copyBtn').disabled = false;
      var lastPath = store.get('last');
      var all = [].concat(repo.effects['src/effects'], repo.effects['src/examples'], S.draftList.map(function (d) { return 'draft:' + d.id; }));
      var first = (lastPath && all.indexOf(lastPath) >= 0) ? lastPath
        : (all.indexOf('src/examples/04-deep-sea.effect.js') >= 0 ? 'src/examples/04-deep-sea.effect.js' : all[0]);
      if (!S.doc) {
        if (first) await openTarget(first);
      } else {
        runNow();
      }
    } catch (e) {
      welcome(true, { error: e.message });
      setRepoChip('warn', 'No folder');
    }
  }

  async function pickFolder() {
    if (OrcarRepo.canPickFolder && location.protocol !== 'http:' && location.protocol !== 'https:') {
      try {
        var h = await window.showDirectoryPicker({ id: 'orcar-lights', mode: 'read' });
        await connect(await OrcarRepo.handleSource(h), h);
      } catch (e) {
        if (e.name !== 'AbortError') welcome(true, { error: e.message });
      }
    } else {
      $('folderInput').click();
    }
  }
  $('pickFolder').onclick = pickFolder;
  $('folderInput').onchange = async function () {
    var files = this.files;
    if (!files || !files.length) return;
    try { await connect(OrcarRepo.fromFileList(files)); }
    catch (e) { welcome(true, { error: e.message }); }
    this.value = '';
  };
  $('reconnect').onclick = async function () {
    var h = await OrcarRepo.rememberedFolder();
    if (!h) { welcome(true, {}); return; }
    try {
      if ((await h.requestPermission({ mode: 'read' })) !== 'granted') throw new Error('The browser didn\'t allow reading the folder. Choose it again.');
      await connect(await OrcarRepo.handleSource(h), h);
    } catch (e) { welcome(true, { error: e.message }); }
  };

  // Drag a folder (connect) or a .js file (open) anywhere on the page.
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', async function (e) {
    e.preventDefault();
    try {
      var got = await OrcarRepo.fromDrop(e.dataTransfer);
      if (!got) return;
      if (got.source) await connect(got.source, got.handle);
      else if (got.fileHandle) { if (await leaveDoc()) await openFileHandle(got.fileHandle); }
      else if (got.file) { if (await leaveDoc()) await openFileObject(got.file); }
    } catch (err) {
      if (!S.repo) welcome(true, { error: err.message }); else toast(err.message);
    }
  });

  // ===================================================================== geometry
  function setupGeometry() {
    var boards = S.repo.boards;
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    S.unmapped = boards.map(function (b) {
      // Unmapped strands (kaleidoscope, TEST) all sit on one placeholder point.
      var counts = {}, n = b.pixels, flag = new Uint8Array(n);
      for (var i = 0; i < n && i < b.raw.length; i++) { var k = b.raw[i].join(','); counts[k] = (counts[k] || 0) + 1; }
      for (var j = 0; j < n; j++) {
        if (j >= b.raw.length) { flag[j] = 1; continue; }   // past the end of the map: frozen on the device
        if (counts[b.raw[j].join(',')] >= 8) flag[j] = 1;
      }
      // Ghost entries (past pixelCount) give the shared box.
      b.raw.forEach(function (p) { for (var a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); } });
      return flag;
    });
    view.setGeometry(boards.map(function (b, i) { return { id: b.id, raw: b.raw, pixels: b.pixels, hidden: S.unmapped[i] }; }), { min: min, max: max });
    updateStrips();
    var leg = $('legend');
    leg.innerHTML = '';
    boards.forEach(function (b, i) {
      var s = document.createElement('span');
      var dot = document.createElement('i');
      dot.style.background = BOARD_COLOURS[i % BOARD_COLOURS.length];
      s.appendChild(dot);
      s.appendChild(document.createTextNode(b.id + ' · ' + b.pixels));
      leg.appendChild(s);
    });
  }

  // Flat strips for unmapped pixels, labelled by feature once the boards report them.
  function updateStrips() {
    if (!S.repo) return;
    var strips = [];
    S.repo.boards.forEach(function (b, bi) {
      var flag = S.unmapped[bi], d = S.describe[bi], off = d && d.boardOffset ? d.boardOffset[b.node] : null;
      var i = 0;
      while (i < b.pixels) {
        if (!flag[i]) { i++; continue; }
        var start = i;
        var name = off !== null && off !== undefined ? featureAt(bi, off + i) : null;
        while (i < b.pixels && flag[i] && (off === null || off === undefined || featureAt(bi, off + i) === name)) i++;
        strips.push({ label: (name ? name : 'Unmapped') + ' · ' + b.id + ' · ' + (i - start), board: bi, start: start, count: i - start });
      }
    });
    view.strips = strips;
  }

  function featureAt(bi, g) {
    var d = S.describe[bi];
    if (!d || !d.features) return null;
    for (var n in d.features) { var f = d.features[n]; if (f[0] > 0 && g >= f[1] && g <= f[2]) return n; }
    return null;
  }

  // ===================================================================== documents
  // The open effect is one of:
  //   repo   a file in src/examples or src/effects (saved explicitly)
  //   draft  work in progress in the draft store (saved automatically)
  //   file   a file opened from elsewhere
  function baseName(p) { return String(p).split('/').pop(); }
  function docKey() { return S.doc ? (S.doc.origin === 'draft' ? 'draft:' + S.doc.id : (S.doc.path || S.doc.label)) : ''; }
  function isDraft(doc) { return !!doc && doc.origin === 'draft'; }
  function isDirty() { return !!S.doc && !isDraft(S.doc) && cm.getValue() !== S.doc.savedText; }

  // Unsaved edits to repo and opened files are also backed up in the browser,
  // and offered back if the page closes before they're saved.
  function backupKey() { return S.doc && !isDraft(S.doc) ? 'backup:' + (S.doc.path || S.doc.label) : null; }
  function saveBackup() {
    var k = backupKey();
    if (!k) return;
    var text = cm.getValue();
    if (text === S.doc.savedText) store.del(k); else store.set(k, { text: text, base: S.doc.savedText, t: Date.now() });
  }
  function updateDirty() {
    $('dirty').hidden = !isDirty();
    if (isDraft(S.doc)) draftStatus(cm.getValue() === S.doc.savedText ? 'saved' : 'pending');
  }

  function setDoc(doc) {
    S.doc = doc;
    var shown = isDraft(doc) ? doc.name : (doc.path || doc.label);
    $('docName').textContent = shown;
    $('docName').title = isDraft(doc) ? 'Draft, saved in ' + S.drafts.where : shown;
    setEditor(doc.savedText);
    hideFileBanner();
    store.set('last', isDraft(doc) ? 'draft:' + doc.id : (doc.path || null));
    syncPicker();
    showDraftBar();
    var key = backupKey(), d = key && store.get(key);
    if (d && d.text !== doc.savedText) {
      showFileBanner('You have unsaved edits to this file from ' + new Date(d.t).toLocaleString() + '.' +
        (d.base === doc.savedText ? '' : ' The file has changed on disk since then, so restoring them replaces those changes.'),
        [{ label: 'Restore them', fn: function () { hideFileBanner(); if (S.doc !== doc) return; setEditor(d.text); saveBackup(); runNow(); } },
         { label: 'Discard', fn: function () { hideFileBanner(); var now = store.get(key); if (now && now.t === d.t) store.del(key); } }]);
    }
    claudeLink.opened();
    runNow();
  }

  async function openPath(path) {
    var text = await S.repo.source.read(path);
    setDoc({ label: baseName(path), path: path, origin: 'repo', savedText: text, stamp: await S.repo.source.stamp(path) });
  }
  async function openFileHandle(h) {
    var f = await h.getFile();
    setDoc({ label: f.name, fileHandle: h, origin: 'file', savedText: await f.text(), stamp: f.lastModified + ':' + f.size });
  }
  async function openFileObject(f) {
    setDoc({ label: f.name, origin: 'file', savedText: await f.text() });
  }
  async function openDraft(id) {
    var d = await S.drafts.read(id);
    if (!d) { toast('That draft no longer exists.'); await refreshDrafts(); return; }
    var doc = { origin: 'draft', id: id, name: d.name || id, label: (d.name || id) + '.effect.js', savedText: d.code, rev: d.rev, dbCode: d.code };
    if (S.drafts.kind === 'disk') { doc.path = S.drafts.path(id); doc.stamp = await S.drafts.stamp(id); }
    setDoc(doc);
  }
  async function openTarget(value) {
    if (value.indexOf('draft:') === 0) await openDraft(value.slice(6));
    else await openPath(value);
  }

  // ------------------------------------------------------------- leaving an effect
  // Before another effect replaces the open one. Drafts save themselves;
  // anything else with unsaved edits asks first. -> true to go ahead.
  async function leaveDoc() {
    if (isDraft(S.doc)) {
      if (await flushDraft()) return true;
      var choice0 = await askChoice('This draft isn\'t saved',
        'The last changes to "' + S.doc.name + '" couldn\'t be saved (' + (draftSaving.error || 'still saving') + ').',
        [{ value: 'retry', label: 'Try again', primary: true }, { value: 'download', label: 'Download a copy' },
         { value: 'discard', label: 'Leave without them' }, { value: 'cancel', label: 'Cancel' }]);
      if (choice0 === 'retry') { draftSaving.error = null; draftSaving.pending = true; return leaveDoc(); }
      if (choice0 === 'download') { download(S.doc.id + '.effect.js', cm.getValue()); return false; }
      if (choice0 === 'discard') { clearTimeout(draftSaving.timer); draftSaving.timer = null; draftSaving.pending = false; draftSaving.error = null; return true; }
      return false;
    }
    if (!isDirty()) return true;
    var doc = S.doc, canSave = canSaveInPlace(doc);
    var choice = await askChoice('Unsaved changes',
      (doc.path || doc.label) + ' has changes you haven\'t saved.',
      [canSave ? { value: 'save', label: 'Save' } : null,
       S.drafts ? { value: 'draft', label: 'Keep as draft', primary: !canSave } : null,
       { value: 'discard', label: 'Discard changes' },
       { value: 'cancel', label: 'Cancel' }].filter(Boolean));
    if (choice === 'save') { await save(); return !isDirty(); }
    if (choice === 'draft') {
      var made = await makeDraft(doc.label.replace(/\.effect\.js$|\.js$/, '') + ' edits', cm.getValue(), false);
      if (!made) return false;
      store.del(backupKey());
      return true;
    }
    if (choice === 'discard') { store.del(backupKey()); return true; }
    return false;
  }
  function canSaveInPlace(doc) {
    if (!doc || !S.repo) return false;
    if (doc.fileHandle && doc.fileHandle.createWritable) return true;
    return !!(S.repo.source.canWrite && doc.path && doc.path.indexOf('src/effects/') === 0);
  }
  window.addEventListener('beforeunload', function (e) {
    if (isDirty() || draftSaving.pending || draftSaving.error) { e.preventDefault(); e.returnValue = ''; }
  });

  // ------------------------------------------------------------- the menu
  // Repo effects by path; drafts as "draft:<id>". Anything else (an opened
  // file) takes the first entry while it's open.
  function syncPicker() {
    var p = $('picker'), doc = S.doc, first = p.querySelector('option[value=""]');
    if (!first) return;
    var value = !doc ? '' : isDraft(doc) ? 'draft:' + doc.id : (doc.path || '');
    var opt = value ? p.querySelector('option[value="' + CSS.escape(value) + '"]') : null;
    if (opt) { first.textContent = 'Open an effect…'; p.value = value; return; }
    first.textContent = doc ? doc.label.replace(/\.effect\.js$|\.js$/, '') + (doc.origin === 'file' ? ' (opened file)' : '') : 'Open an effect…';
    p.value = '';
  }
  function fillPicker() {
    var p = $('picker');
    p.innerHTML = '';
    var none = document.createElement('option');
    none.value = ''; none.textContent = 'Open an effect…';
    p.appendChild(none);
    var groups = [['drafts', 'Drafts'], ['src/effects', 'Team effects'], ['src/examples', 'Examples']];
    groups.forEach(function (g) {
      var og = document.createElement('optgroup'), list;
      if (g[0] === 'drafts') {
        list = S.draftList || [];
        og.label = 'Drafts' + (list.length ? '' : ' (none yet: press New)');
        list.forEach(function (d) {
          var o = document.createElement('option');
          o.value = 'draft:' + d.id; o.textContent = d.name + (d.by === 'claude' ? ' (from the chat)' : '');
          og.appendChild(o);
        });
      } else {
        list = S.repo.effects[g[0]];
        og.label = g[1] + (list.length ? '' : ' (none yet)');
        list.forEach(function (path) {
          var o = document.createElement('option');
          o.value = path; o.textContent = baseName(path).replace(/\.effect\.js$/, '');
          og.appendChild(o);
        });
      }
      p.appendChild(og);
    });
    p.disabled = false;
    syncPicker();
  }
  async function refreshDrafts() {
    if (!S.drafts) { S.draftList = []; return; }
    var list = await S.drafts.list().catch(function () { return []; });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    var sig = JSON.stringify(list);
    if (sig !== S.draftSig) { S.draftSig = sig; S.draftList = list; if (S.repo) fillPicker(); }
  }
  $('picker').onchange = async function () {
    var value = this.value;
    if (!value) { syncPicker(); return; }
    if (!(await leaveDoc())) { syncPicker(); return; }
    try { await openTarget(value); } catch (e) { toast(e.message); syncPicker(); }
  };

  $('openBtn').onclick = async function () {
    if (OrcarRepo.canPickFile && location.protocol === 'file:') {
      try {
        var hs = await window.showOpenFilePicker({ id: 'orcar-effect', types: [{ description: 'Pixelblaze pattern', accept: { 'text/javascript': ['.js'] } }] });
        if (!(await leaveDoc())) return;
        await openFileHandle(hs[0]);
      } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
    } else {
      $('fileInput').click();
    }
  };
  $('fileInput').onchange = async function () {
    var f = this.files[0];
    this.value = '';
    if (f && (await leaveDoc())) await openFileObject(f);
  };

  // ------------------------------------------------------------- drafts
  // Where drafts live: the artifact's database, the repo's src/drafts/ (when
  // the browser may write there), or this browser.
  function chooseDraftStore() {
    S.drafts = null;
    if (claudeLink.db) { try { S.drafts = OrcarDrafts.artifact(claudeLink.db, claudeLink.tab); } catch (e) { S.drafts = null; } }
    if (S.drafts) { /* the artifact's database */ }
    else if (S.repo && S.repo.source.canWrite && S.repo.source.kind === 'handle' && !S.diskDraftsRefused) S.drafts = OrcarDrafts.disk(S.repo.source);
    else S.drafts = OrcarDrafts.browser();
    if (S.drafts.onChange) S.drafts.onChange(claudeLink.draftChanged);
    S.draftSig = null;
    return refreshDrafts();
  }
  // Writing to src/drafts needs the folder's write permission, asked for
  // during a click. Refused -> drafts go to the browser instead.
  async function draftsWritable() {
    if (S.drafts.kind !== 'disk') return true;
    var ok = false;
    try { ok = await S.repo.source.requestWrite(); } catch (e) { ok = false; }
    if (!ok) {
      S.diskDraftsRefused = true;
      await chooseDraftStore();
      toast('The browser didn\'t allow writing to the folder, so drafts are kept in this browser instead.');
    }
    return true;
  }
  async function uniqueDraftId(name) {
    var base = OrcarDrafts.slug(name) || 'untitled', id = base, n = 2;
    var taken = {};
    (await S.drafts.list()).forEach(function (d) { taken[d.id] = 1; });
    while (taken[id]) id = base + '-' + n++;
    return id;
  }
  // Create a draft. open: show it now.
  async function makeDraft(name, code, open) {
    try {
      await draftsWritable();
      var id = await uniqueDraftId(name);
      await S.drafts.write(id, { name: id, code: code });
      await refreshDrafts();
      if (open) await openDraft(id);
      else toast('Kept as draft "' + id + '".');
      return id;
    } catch (e) { toast('Couldn\'t create the draft: ' + e.message); return null; }
  }

  // Autosave: a moment after typing stops, one write at a time.
  var draftSaving = { timer: null, writing: false, pending: false, error: null };
  function scheduleDraftSave() {
    draftSaving.pending = true;
    draftSaving.error = null;   // new typing: try again (once per pause)
    draftStatus('pending');
    clearTimeout(draftSaving.timer);
    draftSaving.timer = setTimeout(writeDraftNow, 700);
  }
  async function writeDraftNow() {
    clearTimeout(draftSaving.timer); draftSaving.timer = null;
    var doc = S.doc;
    if (!isDraft(doc)) { draftSaving.pending = false; return; }
    if (draftSaving.writing) { draftSaving.again = true; return; }
    draftSaving.writing = true;
    var code = cm.getValue();
    try {
      // A draft file changed on disk since we last saved it (an editor or AI
      // wrote it): don't overwrite that silently.
      if (S.drafts.stamp && doc.stamp) {
        var now = await S.drafts.stamp(doc.id);
        if (now && now !== doc.stamp) { draftSaving.writing = false; draftConflict(doc, now); return; }
      }
      await S.drafts.write(doc.id, { name: doc.name, code: code });
      doc.savedText = code; doc.dbCode = code;
      if (S.drafts.stamp) doc.stamp = await S.drafts.stamp(doc.id);
      draftSaving.pending = cm.getValue() !== code;
      draftSaving.error = null;
      draftStatus(draftSaving.pending ? 'pending' : 'saved');
    } catch (e) {
      // Stop here (no retry loop); the next edit tries again, and leaving asks first.
      draftSaving.error = e.message || 'unknown error';
      draftSaving.writing = false; draftSaving.again = false;
      draftStatus('error', draftSaving.error);
      return;
    }
    draftSaving.writing = false;
    if (draftSaving.again) { draftSaving.again = false; writeDraftNow(); }
    else if (draftSaving.pending && S.doc === doc) scheduleDraftSave();
  }
  function draftConflict(doc, stamp) {
    draftStatus('error', 'the file changed on disk');
    draftSaving.error = 'the file changed on disk';
    showFileBanner(S.drafts.path(doc.id) + ' changed on disk while you were editing it.', [
      { label: 'Load the file', fn: async function () {
        hideFileBanner();
        if (S.doc !== doc) return;
        var d = await S.drafts.read(doc.id);
        doc.stamp = await S.drafts.stamp(doc.id);
        doc.savedText = d ? d.code : '';
        draftSaving.pending = false; draftSaving.error = null;
        setEditor(doc.savedText); draftStatus('saved'); runNow(); claudeLink.changed();
      } },
      { label: 'Keep mine', fn: function () {
        hideFileBanner();
        if (S.doc !== doc) return;
        doc.stamp = stamp; draftSaving.error = null;
        writeDraftNow();
      } }]);
  }
  // -> true once everything typed is saved
  async function flushDraft() {
    if (!isDraft(S.doc)) return true;
    if (draftSaving.pending || draftSaving.timer) await writeDraftNow();
    while (draftSaving.writing) await new Promise(function (r) { setTimeout(r, 30); });
    return !draftSaving.error && !draftSaving.pending;
  }
  function draftStatus(state, msg) {
    var el = $('draftState');
    if (!el) return;
    el.textContent = state === 'pending' ? 'Saving…' : state === 'error' ? 'Not saved: ' + msg : 'Saved';
    el.title = state === 'error' ? 'Keep typing to try again, or use Save to repo / Download.' : '';
    el.className = 'draft-state ' + state;
  }
  function showDraftBar() {
    var on = isDraft(S.doc);
    $('draftBar').hidden = !on;
    if (!on) return;
    $('draftWhere').textContent = 'Draft, kept in ' + S.drafts.where + '.';
    draftStatus('saved');
    $('draftConfirm').hidden = true; $('draftActions').hidden = false;
  }

  $('newBtn').onclick = async function () {
    if (!S.repo) return;
    await draftsWritable();   // asks for write permission while the click still counts
    var current = S.doc ? cm.getValue() : null, currentName = S.doc ? (S.doc.name || S.doc.label.replace(/\.effect\.js$|\.js$/, '')) : '';
    var r = await askNew(currentName);
    if (!r) return;
    if (r.copy && isDirty()) store.del(backupKey());   // the copy carries the unsaved edits
    else if (!(await leaveDoc())) return;
    await makeDraft(r.name, r.copy && current !== null ? current : starterEffect(), true);
  };
  $('draftRename').onclick = async function () {
    var doc = S.doc;
    if (!isDraft(doc)) return;
    var name = await askName('Rename draft', 'Lowercase letters, numbers and hyphens.', doc.name, 'Rename');
    if (!name || OrcarDrafts.slug(name) === doc.id) return;
    try {
      await flushDraft();
      var id = await uniqueDraftId(name);
      await S.drafts.write(id, { name: id, code: cm.getValue() });
      S.selfRemoved[doc.id] = 1;
      await S.drafts.remove(doc.id);
      var ctl = store.get('controls:draft:' + doc.id);
      if (ctl) store.set('controls:draft:' + id, ctl);
      store.del('controls:draft:' + doc.id);
      await refreshDrafts();
      await openDraft(id);
      if (id !== OrcarDrafts.slug(name)) toast('A draft called "' + OrcarDrafts.slug(name) + '" already exists, so this one is "' + id + '".');
    } catch (e) { toast(e.message); }
  };
  $('draftDelete').onclick = function () {
    $('draftConfirmText').textContent = 'Delete the draft "' + S.doc.name + '"? This can\'t be undone.';
    $('draftActions').hidden = true; $('draftConfirm').hidden = false;
  };
  $('draftDeleteNo').onclick = function () { $('draftConfirm').hidden = true; $('draftActions').hidden = false; };
  $('draftDeleteYes').onclick = async function () {
    var doc = S.doc;
    try {
      clearTimeout(draftSaving.timer); draftSaving.timer = null; draftSaving.pending = false; draftSaving.error = null;
      while (draftSaving.writing) await new Promise(function (r) { setTimeout(r, 30); });   // a write in flight would bring it back
      S.selfRemoved[doc.id] = 1;
      await S.drafts.remove(doc.id);
      store.del('controls:draft:' + doc.id);
      await refreshDrafts();
      toast('Deleted the draft "' + doc.name + '".');
      await openFallback();
    } catch (e) { toast(e.message); }
  };
  $('draftPromote').onclick = async function () {
    var doc = S.doc;
    if (!isDraft(doc)) return;
    await flushDraft();
    var src = S.repo.source, path = 'src/effects/' + doc.id + '.effect.js';
    if (src.canWrite) {
      try {
        if (await src.stamp(path)) { toast(path + ' already exists. Rename the draft first.'); return; }
        await src.write(path, cm.getValue());
        S.selfRemoved[doc.id] = 1;
        await S.drafts.remove(doc.id);
        S.repo.effects['src/effects'] = (await src.list('src/effects')).filter(function (p) { return /\.effect\.js$/.test(p); });
        await refreshDrafts();
        fillPicker();
        await openPath(path);
        toast('Saved to ' + path + '. Run npm run build (or ask Claude) to make the paste-ready file, then commit both.');
      } catch (e) { toast(e.message); }
    } else if (S.drafts.kind === 'artifact') {
      var ask = 'Add the draft "' + doc.id + '" from the Orcar Simulator artifact to src/effects/ and rebuild.';
      showFileBanner('This page can\'t write to the repo. In a Claude chat that has the repo, ask: "' + ask + '"', [
        { label: 'Copy prompt', fn: function () { try { navigator.clipboard.writeText(ask).then(function () { toast('Copied the prompt. Paste it into a Claude chat that has the repo.'); }, function () {}); } catch (e) {} } },
        { label: 'Close', fn: hideFileBanner }]);
    } else {
      download(doc.id + '.effect.js', cm.getValue());
      toast('Downloaded ' + doc.id + '.effect.js. Put it in src/effects/ in the repo; the draft stays here until you delete it.');
    }
  };
  // After a delete: the last repo effect, or an example.
  async function openFallback() {
    var all = [].concat(S.repo.effects['src/effects'], S.repo.effects['src/examples']);
    var pick = all.indexOf('src/examples/04-deep-sea.effect.js') >= 0 ? 'src/examples/04-deep-sea.effect.js' : all[0];
    if (pick) await openPath(pick);
  }

  // A new effect that runs straight away and keeps every MUST.
  function starterEffect() {
    return [
      '// NEW EFFECT -- describe it here: what moves, where on the whale, colours.',
      '//',
      '// Looks:  a slow colour gradient from nose to tail.',
      '// Sync:   safe -- position + time() only.',
      '// Rules:  docs/ORCAR_CONTRACT.md. Names you can use: the Reference tab.',
      '',
      'var speed = 0.5;         // slider',
      'export function sliderSpeed(v) { speed = v; }',
      '',
      'var shift = 0;           // hue offset, set each frame',
      '',
      '// Kaleidoscope (EYE_1/EYE_2, unmapped) default; TEST strand off. See contract s3.3.',
      'function kaleidoscope(index) {',
      '  var f = inFeature(EYE_1, index) ? EYE_1 : EYE_2;',
      '  if (!inFeature(f, index)) { hsv(0, 0, 0); return; }',
      '  hsv(featurePos(f, index) + time(8 / 65.536), 1, 0.8);',
      '}',
      '',
      'export function beforeRender(delta) {',
      '  // --- keep: builds this controller\'s tables once ---',
      '  var id = nodeId();                      // A=0 ... F=5',
      '  if (tagsBuiltFor != id) {',
      '    NODE_OFFSET = BOARD_OFFSET[id];',
      '    buildTags();',
      '    tagsBuiltFor = id;',
      '  }',
      '  // --- your per-frame code ---',
      '  shift = time(mix(30, 5, speed) / 65.536);   // one colour loop every 30 s (slow) .. 5 s (fast)',
      '}',
      '',
      'export function render3D(index, x, y, z) {',
      '  // --- keep: read local tables, then convert to global index ---',
      '  var tags = TAGS[index];',
      '  var bb = BB_POS[index];',
      '  index = index + NODE_OFFSET;',
      '  // --- your per-pixel code ---',
      '  if (tags == 0) { kaleidoscope(index); return; }',
      '  var along = (y - Y_LO) / (Y_HI - Y_LO);   // 0 at the nose .. 1 at the tail',
      '  hsv(along * 0.3 + shift, 1, 0.7);',
      '}',
      '',
    ].join('\n');
  }

  // ------------------------------------------------------------- small dialogs
  // Resolve with a value; never use alert()/confirm()/prompt() (the artifact
  // viewer blocks them).
  function askChoice(title, text, buttons) {
    return new Promise(function (resolve) {
      var dlg = $('choiceDlg');
      $('choiceTitle').textContent = title;
      $('choiceText').textContent = text;
      var row = $('choiceRow');
      row.innerHTML = '';
      buttons.forEach(function (b) {
        var el = document.createElement('button');
        el.type = 'button'; el.className = 'btn' + (b.primary || b.value === 'save' ? ' primary' : '');
        el.textContent = b.label;
        el.onclick = function () { dlg.close(b.value); };
        row.appendChild(el);
      });
      dlg.onclose = function () { resolve(dlg.returnValue || 'cancel'); };
      dlg.returnValue = '';
      dlg.showModal();
    });
  }
  function askName(title, why, value, okLabel) {
    return new Promise(function (resolve) {
      var dlg = $('nameDlg');
      $('nameTitle').textContent = title;
      $('nameWhy').textContent = why;
      $('nameInput').value = value || '';
      $('nameOk').textContent = okLabel || 'OK';
      $('nameCopyRow').hidden = true;
      dlg.returnValue = '';
      dlg.onclose = function () { resolve(dlg.returnValue === 'ok' ? (OrcarDrafts.slug($('nameInput').value) || null) : null); };
      dlg.showModal();
      $('nameInput').select();
    });
  }
  function askNew(currentName) {
    return new Promise(function (resolve) {
      var dlg = $('nameDlg');
      $('nameTitle').textContent = 'New effect';
      $('nameWhy').textContent = 'It starts as a draft, saved as you type. When it\'s ready, use Save to repo.';
      $('nameInput').value = 'untitled';
      $('nameOk').textContent = 'Create';
      $('nameCopyRow').hidden = !currentName;
      $('nameStarter').checked = true;
      $('nameCopyLabel').textContent = 'A copy of ' + currentName;
      dlg.returnValue = '';
      dlg.onclose = function () {
        if (dlg.returnValue !== 'ok') { resolve(null); return; }
        resolve({ name: OrcarDrafts.slug($('nameInput').value) || 'untitled', copy: !$('nameCopyRow').hidden && $('nameCopy').checked });
      };
      dlg.showModal();
      $('nameInput').select();
    });
  }
  $('nameCopy').onchange = $('nameStarter').onchange = function () {
    if ($('nameCopy').checked && $('nameInput').value === 'untitled') $('nameInput').value = OrcarDrafts.slug($('nameCopyLabel').textContent.replace(/^A copy of /, '')) + '-copy';
  };

  // ===================================================================== save + copy
  // The file's current stamp on disk, or undefined when it can't be known.
  async function diskStamp(doc) {
    if (doc.fileHandle) { var f = await doc.fileHandle.getFile(); return f.lastModified + ':' + f.size; }
    if (doc.path && doc.origin === 'repo' && S.repo.source.canWatch) return S.repo.source.stamp(doc.path);
    return undefined;
  }
  async function save(force) {
    if (!S.doc || S.saving) return;
    var text = cm.getValue(), doc = S.doc;
    if (isDraft(doc)) { await flushDraft(); toast('Draft saved. Use Save to repo when it\'s ready.'); return; }
    if (force !== true && doc.stamp) {
      var now = await diskStamp(doc).catch(function () { return undefined; });
      if (now !== undefined && now !== null && now !== doc.stamp) {
        showFileBanner((doc.path || doc.label) + ' changed on disk since you opened it. Saving now would replace those changes.', [
          { label: 'Save mine anyway', fn: function () { hideFileBanner(); save(true); } },
          { label: 'Load the file instead', fn: async function () { hideFileBanner(); await reloadDoc(doc); } }]);
        return;
      }
    }
    S.saving = true;
    try {
      if (S.doc.fileHandle && S.doc.fileHandle.createWritable) {
        if (S.doc.fileHandle.requestPermission && (await S.doc.fileHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Saving needs permission to write the file.');
        var w = await S.doc.fileHandle.createWritable(); await w.write(text); await w.close();
        var f = await S.doc.fileHandle.getFile();
        savedAs(text, f.lastModified + ':' + f.size);
        toast('Saved ' + S.doc.label + '.');
        return;
      }
      if (S.repo && S.repo.source.canWrite && S.doc.path && S.doc.path.indexOf('src/effects/') === 0) {
        await S.repo.source.write(S.doc.path, text);
        savedAs(text, await S.repo.source.stamp(S.doc.path));
        toast('Saved ' + S.doc.path + '. Run npm run build (or ask Claude) to refresh patterns/.');
        return;
      }
      if (S.repo && S.repo.source.canWrite) { saveAsDialog(); return; }
      // Can't write here (an artifact, a hosted copy, a read-only folder): keep it as a draft.
      S.saving = false;
      var name = await askName('Keep your changes as a draft', 'This copy can\'t write to the repo, so your version is kept as a draft (' + S.drafts.where + ').',
        doc.label.replace(/\.effect\.js$|\.js$/, '').replace(/^\d+b?-/, 'my-'), 'Keep as draft');
      if (name) { store.del(backupKey()); await makeDraft(name, text, true); }
      return;
    } catch (e) { toast(e.message); }
    finally { S.saving = false; }
  }
  async function reloadDoc(doc) {
    var text = doc.fileHandle ? await (await doc.fileHandle.getFile()).text() : await S.repo.source.read(doc.path);
    doc.savedText = text;
    doc.stamp = await diskStamp(doc);
    if (S.doc === doc) { setEditor(text); runNow(); }
  }
  function savedAs(text, stamp) {
    S.doc.savedText = text; S.doc.stamp = stamp;
    store.del(backupKey());
    updateDirty();
  }
  $('saveBtn').onclick = function () { save(); };

  function slug(s) { return String(s).toLowerCase().replace(/\.effect\.js$|\.js$/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function saveAsDialog() {
    var dlg = $('saveAs');
    var base = S.doc ? slug(S.doc.label.replace(/^\d+b?-/, '')) : 'my-effect';
    $('saveAsName').value = base === '' ? 'my-effect' : (/^my-/.test(base) ? base : 'my-' + base);
    $('saveAsWhy').innerHTML = S.doc && S.doc.path && S.doc.path.indexOf('src/examples/') === 0
      ? 'Examples stay as they are. Your version goes in <code>src/effects/</code>.' : 'New effects go in <code>src/effects/</code>.';
    var upd = function () { $('saveAsPath').textContent = 'src/effects/' + (slug($('saveAsName').value) || 'my-effect') + '.effect.js'; };
    $('saveAsName').oninput = upd; upd();
    $('saveAsErr').hidden = true;
    dlg.returnValue = '';
    dlg.showModal();
    dlg.onclose = async function () {
      if (dlg.returnValue !== 'ok') return;
      var path = 'src/effects/' + (slug($('saveAsName').value) || 'my-effect') + '.effect.js';
      try {
        if (await S.repo.source.stamp(path)) {
          $('saveAsErr').textContent = path + ' already exists. Choose another name.';
          $('saveAsErr').hidden = false;
          dlg.returnValue = '';
          dlg.showModal();
          return;
        }
        var text = cm.getValue(), oldBackup = backupKey();
        await S.repo.source.write(path, text);
        store.del(oldBackup);
        S.repo.effects['src/effects'] = (await S.repo.source.list('src/effects')).filter(function (p) { return /\.effect\.js$/.test(p); });
        fillPicker();
        S.doc = { label: baseName(path), path: path, origin: 'repo', savedText: text, stamp: await S.repo.source.stamp(path) };
        $('docName').textContent = path; syncPicker(); store.set('last', path);
        showDraftBar(); updateDirty();
        toast('Saved ' + path + '. Run npm run build (or ask Claude) to make the paste-ready file in patterns/effects/.');
      } catch (e) { toast(e.message); }
    };
  }

  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function pasteReady() {
    var text = cm.getValue();
    if (engine.isFullPattern(text)) return text;
    return engine.buildPattern(S.head, text, S.doc && S.doc.path ? S.doc.path : (S.doc ? S.doc.label : 'the simulator'));
  }
  $('copyBtn').onclick = function () {
    if (!S.head) return;
    var text = pasteReady();
    var fallback = function () {
      $('copyText').value = text;
      $('copyDialog').showModal();
      $('copyText').select();
    };
    try {
      navigator.clipboard.writeText(text).then(function () {
        toast('Copied the complete pattern (' + text.split('\n').length + ' lines). Paste it into a new pattern on board A, the leader.');
      }, fallback);
    } catch (e) { fallback(); }
  };

  // ===================================================================== watching files
  function showFileBanner(text, actions) {
    $('fileBannerText').textContent = text;
    var box = $('fileBannerActions');
    box.innerHTML = '';
    actions.forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn'; b.type = 'button'; b.textContent = a.label; b.onclick = a.fn;
      box.appendChild(b);
    });
    $('fileBanner').hidden = false;
  }
  function hideFileBanner() { $('fileBanner').hidden = true; }

  var watching = false;
  setInterval(async function () {
    if (watching || !S.repo || document.hidden || S.saving || draftSaving.writing || draftSaving.pending) return;
    watching = true;
    try {
      var src = S.repo.source;
      // New or removed draft files (an editor or Claude Code may make them).
      if (S.drafts && S.drafts.kind === 'disk' && (++S.ticks % 3 === 0)) await refreshDrafts();
      // The template: rebuild every pattern from the new copy.
      if (src.canWatch) {
        var ts = await src.stamp(OrcarRepo.TEMPLATE);
        if (ts && ts !== S.headStamp) {
          S.headStamp = ts;
          var head = engine.templateHead(await src.read(OrcarRepo.TEMPLATE));
          if (head !== null) { S.head = head; toast('The template changed on disk. Re-running with the new copy.'); runNow(); }
        }
      }
      // The open file.
      var doc = S.doc, stamp = null, read = null;
      if (doc && doc.path && src.canWatch && (doc.origin === 'repo' || (isDraft(doc) && S.drafts.kind === 'disk'))) { stamp = await src.stamp(doc.path); read = function () { return src.read(doc.path); }; }
      else if (doc && doc.fileHandle) { var f = await doc.fileHandle.getFile(); stamp = f.lastModified + ':' + f.size; read = function () { return f.text(); }; }
      if (stamp && doc.stamp && stamp !== doc.stamp) {
        var text = await read();
        if (S.doc !== doc || S.saving) return;   // switched files or saved meanwhile: look again next tick
        doc.stamp = stamp;
        if (text === doc.savedText) return;
        if (cm.getValue() === doc.savedText) {
          doc.savedText = text;
          var cur = cm.getCursor(), top = cm.getScrollInfo().top;
          setEditor(text); cm.setCursor(cur); cm.scrollTo(null, top);
          toast((doc.path || doc.label) + ' changed on disk. Reloaded.');
          runNow();
        } else {
          showFileBanner((doc.path || doc.label) + ' changed on disk, and you have unsaved edits here.', [
            { label: 'Load the file', fn: function () { hideFileBanner(); if (S.doc !== doc) return; doc.savedText = text; setEditor(text); runNow(); } },
            { label: 'Keep mine', fn: function () { hideFileBanner(); if (S.doc !== doc) return; doc.savedText = text; updateDirty(); } },
          ]);
        }
      }
    } catch (e) { /* the file may be mid-save; try again next tick */ }
    finally { watching = false; }
  }, 1000);

  // ===================================================================== run
  function runNow() {
    clearTimeout(runTimer);
    if (!S.repo || !S.head || !S.doc) return;
    var text = cm.getValue();
    var full, mode, offset;
    if (engine.isFullPattern(text)) { full = text; mode = 'pattern'; offset = 0; }
    else {
      var pre = S.head + engine.effectBanner(S.doc.path || S.doc.label);
      full = pre + text; mode = 'effect'; offset = pre.split('\n').length - 1;
    }
    $('modeBanner').hidden = false;
    $('modeText').textContent = mode === 'effect'
      ? 'Effect section. The template (src/template/orcar_3d_mapped.js) is added in front when it runs, as npm run build does.'
      : 'Complete pattern: it carries its own copy of the template.';
    S.lint = engine.lint(full);
    S.syntax = syntaxError(full);
    var featureNames = [], tagNames = {};
    updateReference(mode === 'effect' ? S.head : (engine.templateHead(text) || text));
    full.replace(/export\s+var\s+([A-Z][A-Z0-9_]*)\s*=\s*feature\(/g, function (m, n) { featureNames.push(n); });
    full.replace(/var\s+(TAG_[A-Z0-9_]+)\s*=\s*(\d+)/g, function (m, n, v) { tagNames[n.slice(4)] = +v; });
    var prevMode = S.run && S.run.mode;
    S.run = { full: full, mode: mode, offset: offset, featureNames: featureNames, tagNames: tagNames, text: text };
    if (S.syntax) {
      // Like the device: an edit that doesn't compile leaves the last good version running.
      // A different file that doesn't compile stops the old one, so it isn't shown under the new name.
      if (S.runningKey !== docKey()) { sim.stop(); view.clearColours(); S.runningKey = null; S.boardInfo = []; S.boardStats = []; }
      snd.restartNext = false;
      renderIssues(); return;
    }
    S.fatal = null; $('stopped').hidden = true;
    if (S.controlsKey !== docKey()) {
      S.controlsKey = docKey();
      S.controlValues = store.get('controls:' + S.controlsKey) || {};
      S.controls = [];   // rebuild the panel for this effect
    }
    S.runningKey = docKey();
    S.boardInfo = []; S.boardStats = []; S.describe = [];
    S.flash = new FlashMeter(S.repo.boards, $('stress').checked);
    S.loadedAt = performance.now();
    var cv = [];
    for (var name in S.controlValues) cv.push({ name: name, args: S.controlValues[name] });
    // a re-run carries on from the same point in the music; Restart goes back to its start
    snd.runOffsetMs = snd.restartNext ? 0 : snd.nextPosMs !== null ? snd.nextPosMs : clipPosMs();
    snd.restartNext = false; snd.nextPosMs = null;
    sim.load(S.repo.boards, full, { stress: $('stress').checked, featureNames: featureNames, controlValues: cv, valueNames: refValueNames(), sensor: sensorConfig() });
    if (prevMode !== mode) cm.refresh();
    renderIssues();
    claudeLink.ran();
  }
  $('runBtn').onclick = runNow;
  $('stoppedRun').onclick = runNow;

  function syntaxError(full) {
    try {
      acorn.parse(engine.prepareSource(full).code, { ecmaVersion: 2020, sourceType: 'script', locations: true, allowReturnOutsideFunction: true });
      return null;
    } catch (e) {
      return { line: e.loc ? e.loc.line : 0, message: String(e.message).replace(/\s*\(\d+:\d+\)$/, '') };
    }
  }

  // ===================================================================== controls
  function prettyName(n) {
    var p = engine.CONTROL_PREFIXES.filter(function (x) { return n.indexOf(x) === 0; }).sort(function (a, b) { return b.length - a.length; })[0] || '';
    return n.slice(p.length).replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  }
  function kindOf(n) { return engine.CONTROL_PREFIXES.filter(function (x) { return n.indexOf(x) === 0; }).sort(function (a, b) { return b.length - a.length; })[0]; }
  function setControl(name, args) {
    S.controlValues[name] = args;
    sim.control(name, args);
    store.set('controls:' + S.controlsKey, S.controlValues);
  }
  function hsvToHex(h, s, v) {
    var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    var rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
    return rgbToHex(rgb[0], rgb[1], rgb[2]);
  }
  function rgbToHex(r, g, b) { return '#' + [r, g, b].map(function (x) { return ('0' + Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16)).slice(-2); }).join(''); }
  function hexToRgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; }); }
  function rgbToHsv(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; }
    return [h, mx ? d / mx : 0, mx];
  }

  var readoutEls = {};
  function buildControls(info) {
    var names = info.controls.map(function (c) { return c.name; });
    var same = names.join() === S.controls.join();
    if (same) return;
    S.controls = names;
    var saved = S.controlValues;
    var box = $('controls');
    box.innerHTML = '';
    readoutEls = {};
    var readouts = [];
    if (!names.length) { box.innerHTML = '<div class="empty">This pattern has no controls.</div>'; sim.readoutNames = []; return; }
    names.forEach(function (n) {
      var k = kindOf(n), el = document.createElement('div'), label = prettyName(n), id = 'ctl-' + n;
      el.className = 'ctl';
      var has = saved && saved[n];
      if (k === 'slider') {
        el.innerHTML = '<div class="name"><label for="' + id + '"></label><span class="val"></span></div><input type="range" min="0" max="1" step="0.001" id="' + id + '">';
        var r = el.querySelector('input'), val = el.querySelector('.val');
        el.querySelector('label').textContent = label;
        var dflt = info.defaults && typeof info.defaults[n] === 'number' ? info.defaults[n] : null;
        var show = function (v, isSet) {
          val.textContent = isSet ? (+v).toFixed(3) : dflt !== null ? (+dflt).toFixed(3) + ' (default)' : 'pattern default';
          el.classList.toggle('unset', !isSet && dflt === null);
        };
        r.value = has ? saved[n][0] : dflt !== null ? Math.max(0, Math.min(1, dflt)) : 0.5; show(r.value, !!has);
        r.oninput = function () { show(r.value, true); setControl(n, [+r.value]); };
      } else if (k === 'toggle') {
        el.innerHTML = '<label class="toggle"><input type="checkbox" id="' + id + '"> <span></span></label><small></small>';
        el.querySelector('span').textContent = label;
        var cb = el.querySelector('input'), sm = el.querySelector('small');
        var tdef = info.defaults && typeof info.defaults[n] === 'number' ? info.defaults[n] : null;
        cb.checked = has ? !!saved[n][0] : !!tdef;
        sm.textContent = has || tdef !== null ? '' : 'pattern default until you click it';
        cb.onchange = function () { sm.textContent = ''; setControl(n, [cb.checked ? 1 : 0]); };
      } else if (k === 'hsvPicker' || k === 'rgbPicker') {
        el.innerHTML = '<div class="name"><label for="' + id + '"></label><span class="val"></span></div><input type="color" id="' + id + '">';
        el.querySelector('label').textContent = label;
        var c = el.querySelector('input'), cv = el.querySelector('.val');
        c.value = has ? (k === 'hsvPicker' ? hsvToHex.apply(null, saved[n]) : rgbToHex.apply(null, saved[n])) : '#808080';
        cv.textContent = has ? '' : 'pattern default';
        el.classList.toggle('unset', !has);
        c.oninput = function () {
          var rgb = hexToRgb(c.value); cv.textContent = ''; el.classList.remove('unset');
          setControl(n, k === 'hsvPicker' ? rgbToHsv(rgb[0], rgb[1], rgb[2]) : rgb);
        };
      } else if (k === 'trigger') {
        el.innerHTML = '<button class="btn" type="button"></button><small>Not yet verified on the truck: a press on board A may not reach B–F.</small>';
        el.querySelector('button').textContent = label;
        el.querySelector('button').onclick = function () { sim.control(n, []); };
      } else if (k === 'inputNumber') {
        el.innerHTML = '<div class="name"><label for="' + id + '"></label></div><input type="number" step="any" id="' + id + '">';
        el.querySelector('label').textContent = label;
        var num = el.querySelector('input');
        if (has) num.value = saved[n][0];
        num.onchange = function () { if (num.value !== '') setControl(n, [+num.value]); };
      } else if (k === 'showNumber' || k === 'gauge') {
        el.innerHTML = '<div class="name"><span></span><span class="val">…</span></div>' + (k === 'gauge' ? '<div class="gauge"><i></i></div>' : '');
        el.querySelector('span').textContent = label;
        readoutEls[n] = { kind: k, val: el.querySelector('.val'), bar: el.querySelector('.gauge i') };
        readouts.push(n);
      }
      box.appendChild(el);
    });
    sim.readoutNames = readouts;
  }
  function showReadouts(r) {
    for (var n in r) {
      var e = readoutEls[n];
      if (!e) continue;
      var v = r[n];
      e.val.textContent = Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)) : 'NaN';
      if (e.bar) e.bar.style.width = (Math.max(0, Math.min(1, v || 0)) * 100) + '%';
    }
  }
  $('resetCtl').onclick = function () {
    S.controlValues = {}; S.controls = [];
    store.del('controls:' + S.controlsKey);
    runNow();
  };

  // ===================================================================== transport
  function setPlaying(p) {
    sim.playing = p;
    $('playBtn').textContent = p ? '❚❚' : '▶';
    $('playBtn').title = p ? 'Pause (Space)' : 'Play (Space)';
    $('playBtn').setAttribute('aria-label', p ? 'Pause' : 'Play');
    $('stepBtn').disabled = p;
  }
  $('playBtn').onclick = function () { setPlaying(!sim.playing); };
  $('stepBtn').onclick = function () { sim.step(); };
  $('restartBtn').onclick = function () { snd.restartNext = true; if (snd.player) snd.player.stop(); runNow(); };
  $('speed').onchange = function () { sim.speed = +this.value; };
  $('stress').onchange = function () { runNow(); };

  // ===================================================================== sound
  // What the sensor board hears (sim/sound.js). A beat or file is analysed in
  // advance and the boards read it at their own clock time; the microphone is
  // read live, one packet every 25.6 ms, and never played back.
  var snd = {
    kind: 'beat', bpm: 124, levelExp: 0, hear: true, volume: 0.7,
    clip: null,              // the beat's or file's { analysis, buffer }
    beats: {},               // bpm -> clip
    file: null,              // { name, clip }
    mic: null, micFrame: null, lastMicAt: 0,
    runOffsetMs: 0, restartNext: false, nextPosMs: null, busyToken: 0, lastPointer: 0, bpmTimer: null,
    player: null, note: '', noteWarn: false, busy: '', shown: '', drawnKey: '',
  };
  (function () {
    var v = store.get('sound') || {};
    if (/^(none|beat|file|mic)$/.test(v.kind)) snd.kind = v.kind;
    if (v.bpm >= 90 && v.bpm <= 150) snd.bpm = v.bpm;
    if (typeof v.levelExp === 'number') snd.levelExp = Math.max(-2, Math.min(2, v.levelExp));
    if (typeof v.hear === 'boolean') snd.hear = v.hear;
    if (typeof v.volume === 'number') snd.volume = Math.max(0, Math.min(1, v.volume));
  })();
  try { snd.player = new OrcarSound.Player(); snd.player.setVolume(snd.volume); } catch (e) { snd.player = null; }
  // The microphone, where the page may ask for it (not inside the Claude artifact, for one)
  (function () {
    var pol = document.permissionsPolicy || document.featurePolicy, ok = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    try { if (ok && pol && pol.allowsFeature) ok = pol.allowsFeature('microphone'); } catch (e) {}
    var o = $('soundSrc').querySelector('option[value="mic"]');
    if (!ok) { o.disabled = true; o.textContent = 'Microphone (not available here)'; if (snd.kind === 'mic') snd.kind = 'beat'; }
  })();
  function saveSound() { store.set('sound', { kind: snd.kind, bpm: snd.bpm, levelExp: snd.levelExp, hear: snd.hear, volume: snd.volume }); }
  function soundLevel() { return Math.pow(2, snd.levelExp); }
  function usesSound() {
    var i = S.boardInfo[0];
    return !!(i && i.usesSensor && i.usesSensor.some(function (n) { return /^(frequencyData|energyAverage|maxFrequency|maxFrequencyMagnitude)$/.test(n); }));
  }
  function activeClip() { return snd.kind === 'beat' || snd.kind === 'file' ? snd.clip : null; }
  function clipPosMs() {
    var c = activeClip();
    if (!c) return 0;
    var d = c.analysis.durationMs;
    return (((snd.runOffsetMs + Math.max(0, sim.elapsedMs())) % d) + d) % d;
  }
  function sensorConfig() {
    if (snd.kind === 'none') return { kind: 'none' };
    var c = activeClip();
    // the microphone, or a clip that's still being prepared: live packets (silence until they come)
    if (!c) return { kind: 'live', level: soundLevel() };
    var a = c.analysis;
    return { kind: 'clip', frames: a.frames, count: a.count, frameMs: a.frameMs, offsetMs: snd.runOffsetMs, level: soundLevel() };
  }
  function soundCheckText() {
    var truck = ' The real sensor board\'s levels haven\'t been measured yet, so check thresholds on the truck.';
    if (snd.kind === 'none') return 'Sound is set to "No sensor board", so you see its silent look. Choose a sound under the whale to see it react.';
    var what = snd.kind === 'beat' ? 'the synthetic beat (' + snd.bpm + ' BPM)' : snd.kind === 'file' ? (snd.file ? '"' + snd.file.name + '"' : 'an audio file') : 'your microphone';
    return 'Sound: ' + what + ', at level ' + $('soundLevelVal').textContent + '.' + truck + ' Also try "No sensor board": it must still look right without one.';
  }

  // A busy note belongs to the operation that set it; a later one can't be cleared by an earlier one.
  function setBusy(token, text) { snd.busyToken = token; snd.busy = text; showSound(); }
  function clearBusy(token) { if (snd.busyToken === token) { snd.busy = ''; showSound(); } }
  function nextToken() { return (snd.token = (snd.token || 0) + 1); }
  // One render per tempo, shared by everyone waiting for it (a render takes a few seconds).
  function beatClip(bpm) {
    if (!snd.beats[bpm]) {
      var keys = Object.keys(snd.beats);
      if (keys.length >= 3) delete snd.beats[keys[0]];
      var p = snd.beats[bpm] = OrcarSound.renderBeat(bpm).then(function (c) { p.done = true; return c; }, function (e) { delete snd.beats[bpm]; throw e; });
    }
    return snd.beats[bpm];
  }
  // Switch to a source. Returns false if it couldn't (and nothing changed).
  async function setSound(kind, opts) {
    opts = opts || {};
    var token = nextToken();
    var clip = null, mic = null, oldClip = activeClip(), oldPos = clipPosMs();
    try {
      if (kind === 'beat') { if (!snd.beats[snd.bpm] || !snd.beats[snd.bpm].done) setBusy(token, 'Making the beat…'); clip = await beatClip(snd.bpm); }
      else if (kind === 'file') clip = snd.file ? snd.file.clip : null;   // no file yet: silence until one is chosen
      else if (kind === 'mic') {
        if (snd.mic) mic = snd.mic;
        else { setBusy(token, 'Asking for the microphone…'); mic = new OrcarSound.Mic(); await mic.start(); }
      }
    } catch (e) {
      clearBusy(token);
      if (mic && mic !== snd.mic) mic.stop();
      if (token === snd.token) { toast((kind === 'mic' ? 'Microphone: ' : kind === 'beat' ? 'Beat: ' : 'Audio file: ') + (e && e.message || e)); showSound(); }
      return false;
    }
    clearBusy(token);
    if (token !== snd.token) { if (mic && mic !== snd.mic) mic.stop(); return false; }   // another choice came in meanwhile
    // the beat at a new tempo: keep the place in the bar, not the place in milliseconds
    if (kind === 'beat' && oldClip && snd.kind === 'beat' && clip !== oldClip)
      snd.nextPosMs = oldPos * clip.analysis.durationMs / oldClip.analysis.durationMs;
    if (snd.mic && mic !== snd.mic) { snd.mic.stop(); snd.mic = null; snd.micFrame = null; }
    snd.mic = mic;
    snd.kind = kind; snd.clip = clip;
    if (snd.player) snd.player.setBuffer(clip ? clip.buffer : null, clip ? clip.analysis.durationMs / 1000 : 0);
    if (!opts.quiet) saveSound();
    showSound();
    if (S.doc && !opts.noRun) runNow();
    scheduleIssues();
    return true;
  }
  async function useFile(file) {
    if (!file) return;
    var token = nextToken();
    setBusy(token, 'Reading ' + file.name + '…');
    try {
      if (file.size > OrcarSound.MAX_BYTES) throw new Error('that file is ' + Math.round(file.size / 1048576) + ' MB; use one under 250 MB (about 20 minutes)');
      var bytes = await file.arrayBuffer();
      var clip = await OrcarSound.loadFile(bytes);
      var rec = { name: file.name, clip: clip, saved: false };
      snd.file = rec;
      // to come back next time (this browser only)
      OrcarSound.saveFile({ name: file.name, type: file.type, bytes: bytes }).then(function () { rec.saved = true; showSound(); }, function () {});
      clearBusy(token);
      if (token !== snd.token) return;   // something else was chosen while it loaded: keep the file for later, don't switch
      snd.restartNext = true;   // a new file starts from its beginning
      await setSound('file');
    } catch (e) {
      clearBusy(token);
      toast('Audio file: ' + (e && e.message || 'couldn\'t read it'));
    }
  }

  $('soundSrc').addEventListener('pointerdown', function () { snd.lastPointer = Date.now(); });
  $('soundSrc').onchange = function () {
    var kind = this.value;
    // With no file yet, "Audio file…" shows Choose…; chosen with the mouse, it opens the chooser too.
    if (kind === 'file' && !snd.file && Date.now() - snd.lastPointer < 15000) $('audioInput').click();
    setSound(kind).then(function (ok) { if (!ok) $('soundSrc').value = snd.kind; });
  };
  $('fileBtn').onclick = function () { $('audioInput').click(); };
  $('audioInput').onchange = function () { var f = this.files && this.files[0]; this.value = ''; useFile(f); };
  $('beatBpm').oninput = function () { $('beatBpmVal').textContent = this.value + ' BPM'; this.setAttribute('aria-valuetext', this.value + ' BPM'); };
  $('beatBpm').onchange = function () {
    snd.bpm = +this.value; saveSound();
    clearTimeout(snd.bpmTimer);   // arrow keys fire one change per step: render only where it settles
    snd.bpmTimer = setTimeout(function () { if (snd.kind === 'beat') setSound('beat'); }, 450);
  };
  $('soundLevel').oninput = function () {
    snd.levelExp = +this.value;
    showSound();
    sim.sensor({ level: soundLevel() });   // no re-run: the boards just hear it louder or quieter
  };
  $('soundLevel').onchange = function () { saveSound(); scheduleIssues(); };
  $('hear').onchange = function () { snd.hear = this.checked; saveSound(); showSound(); };
  $('volume').oninput = function () { snd.volume = +this.value; if (snd.player) snd.player.setVolume(snd.volume); };
  $('volume').onchange = saveSound;

  function fmtLevel(e) {
    var v = Math.pow(2, e);
    return (v >= 1 ? (Math.round(v * 100) / 100) : v === 0.5 ? '½' : v === 0.25 ? '¼' : (Math.round(v * 100) / 100)) + '×';
  }
  function showSound() {
    $('soundSrc').value = snd.kind;
    $('beatOpts').hidden = snd.kind !== 'beat';
    $('fileOpts').hidden = snd.kind !== 'file';
    $('fileName').textContent = snd.file ? snd.file.name : 'no file chosen';
    $('fileName').title = snd.file ? snd.file.name + (snd.file.saved ? ' (kept in this browser for next time)' : '') : '';
    $('fileBtn').textContent = snd.file ? 'Choose…' : 'Choose a file…';
    $('levelOpts').hidden = snd.kind === 'none';
    $('hearOpts').hidden = !(snd.kind === 'beat' || snd.kind === 'file');
    $('beatBpm').value = snd.bpm; $('beatBpmVal').textContent = snd.bpm + ' BPM'; $('beatBpm').setAttribute('aria-valuetext', snd.bpm + ' BPM');
    $('soundLevel').value = snd.levelExp; $('soundLevelVal').textContent = fmtLevel(snd.levelExp); $('soundLevel').setAttribute('aria-valuetext', fmtLevel(snd.levelExp));
    $('hear').checked = snd.hear; $('volume').value = snd.volume; $('volume').disabled = !snd.hear;
  }
  function setNote(text, warn) {
    if (text === snd.shown && !!warn === snd.noteWarn) return;
    snd.shown = text; snd.noteWarn = !!warn;
    $('soundNote').textContent = text;
    $('soundNote').className = 'sound-note' + (warn ? ' warn' : '');
  }

  function soundTick(now) {
    // while boards reload, assume the effect still reads sound as it did (so the music doesn't stop)
    var uses = S.boardInfo[0] ? (snd.usesLast = usesSound()) : !!snd.usesLast;
    // the microphone: one packet per 25.6 ms while playing (paused = frozen, like the whale)
    if (snd.kind === 'mic' && snd.mic && sim.playing && now - snd.lastMicAt >= OrcarSound.FRAME_MS) {
      // one packet per 25.6 ms on average, whatever the screen's refresh rate
      snd.lastMicAt = Math.max(snd.lastMicAt + OrcarSound.FRAME_MS, now - OrcarSound.FRAME_MS);
      var f = snd.mic.read();
      if (f) { snd.micFrame = new Float32Array(f); if (uses) sim.sensor({ live: snd.micFrame }); }
    }
    var c = activeClip();
    var could = !!c && snd.hear && uses && sim.playing && sim.speed === 1 && !document.hidden && !S.fatal && sim.boards.length > 0;
    var want = could && sim.started;
    var state = OrcarSound.state();
    if (snd.player) {
      try {
        // While the boards restart (an edit re-runs them), the music keeps
        // playing; once they're going, they pick it up where it is.
        if (could && !sim.started && snd.player.playing()) snd.carry = true;
        else {
          if (snd.carry && sim.started) {
            var p = snd.player.position();
            if (p !== null) { snd.runOffsetMs = p * 1000 - Math.max(0, sim.elapsedMs()); sim.sensor({ offsetMs: snd.runOffsetMs }); }
          }
          snd.carry = false;
          // The music is the clock: if the page stalled (or the tab was throttled), the
          // whale catches up with the music rather than the music jumping back.
          if (want && snd.player.playing()) {
            var ahead = snd.player.ahead(clipPosMs() / 1000);
            if (ahead !== null && ahead > 0.02 && ahead < 3) sim.simMs += ahead * 1000;
          }
          snd.player.sync(want, clipPosMs() / 1000);
        }
      } catch (e) {}
    }
    // the note beside the meter
    if (snd.busy) setNote(snd.busy);
    else if (!S.boardInfo[0]) setNote('');
    else if (!uses) setNote(snd.kind === 'none' ? '' : 'This effect doesn\'t react to sound.');
    else if (snd.kind === 'file' && !snd.file) setNote('Choose a file: silence until then.', true);
    else if (snd.kind === 'none') setNote('No sensor board: the silent look.');
    else if (snd.kind === 'mic') setNote('Listening (not played back).');
    else if (c && snd.hear && sim.speed !== 1) setNote('Muted at ' + $('speed').selectedOptions[0].textContent + ': the whale still follows it.');
    else if (want && state !== 'running') setNote('Click anywhere to hear it.', true);
    else setNote('');
    drawSpectrum(uses);
  }

  // The 32 buckets the boards are getting now (with the level applied), and energyAverage at the right.
  var spec = $('spectrum'), specCtx = spec.getContext('2d');
  function currentFrame() {
    if (snd.kind === 'mic') return snd.micFrame ? { f: snd.micFrame, at: 0 } : null;
    var c = activeClip();
    if (!c || snd.kind === 'none') return null;
    var a = c.analysis, k = Math.floor(clipPosMs() / a.frameMs) % a.count;
    return { f: a.frames, at: k * OrcarSound.FIELDS, k: k };
  }
  function drawSpectrum(uses) {
    var fr = currentFrame(), lv = soundLevel();
    var key = (fr ? (fr.k !== undefined ? fr.k : Math.round(performance.now() / 25)) : 'x') + ':' + lv + ':' + uses + ':' + snd.kind;
    if (key === snd.drawnKey) return;
    snd.drawnKey = key;
    var dpr = window.devicePixelRatio || 1, w = spec.clientWidth || 192, h = spec.clientHeight || 30;
    if (spec.width !== Math.round(w * dpr)) { spec.width = Math.round(w * dpr); spec.height = Math.round(h * dpr); }
    var g = specCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var css = getComputedStyle(spec), accent = css.getPropertyValue('--accent').trim() || '#3cb4ad', muted = css.getPropertyValue('--muted').trim() || '#888';
    var bw = (w - 10) / 32;
    // a value's bar height: square root, so quiet sound still shows; 0.1 fills it
    var hgt = function (v) { return Math.sqrt(Math.min(1, v / 0.1)) * (h - 4); };
    g.globalAlpha = uses ? 1 : 0.4;
    if (!fr) {
      g.fillStyle = muted; g.globalAlpha = 0.35;
      for (var i0 = 0; i0 < 32; i0++) g.fillRect(i0 * bw + 1, h - 3, Math.max(1, bw - 1), 1);
      g.globalAlpha = 1; return;
    }
    g.fillStyle = accent;
    for (var i = 0; i < 32; i++) {
      var v = Math.min(1, fr.f[fr.at + i] * lv), bh = Math.max(1, hgt(v));
      g.fillRect(i * bw + 1, h - 2 - bh, Math.max(1, bw - 1), bh);
    }
    var e = Math.min(1, fr.f[fr.at + 32] * lv), eh = Math.max(1, Math.sqrt(Math.min(1, e / 0.03)) * (h - 4));
    g.fillStyle = muted;
    g.fillRect(w - 6, h - 2 - eh, 4, eh);
    g.globalAlpha = 1;
  }
  spec.addEventListener('mousemove', function (e) {
    var r = spec.getBoundingClientRect(), x = e.clientX - r.left, bw = (r.width - 10) / 32, fr = currentFrame(), lv = soundLevel();
    if (x > r.width - 8) { spec.title = 'energyAverage' + (fr ? ' = ' + (Math.min(1, fr.f[fr.at + 32] * lv)).toFixed(4) : ''); return; }
    var i = Math.max(0, Math.min(31, Math.floor(x / bw))), b = OrcarSound.BUCKETS[i];
    spec.title = 'frequencyData[' + i + ']: ' + Math.round(b[0]) + (b[1] > b[0] ? '–' + Math.round(b[1]) : '') + ' Hz' + (fr ? ' = ' + Math.min(1, fr.f[fr.at + i] * lv).toFixed(4) : '');
  });

  // Start with the remembered source. A remembered file comes back from this
  // browser's storage; the microphone needs asking again, so it starts on the beat.
  async function startSound() {
    showSound();
    var token = nextToken(), kind = snd.kind;
    if (kind === 'mic') { kind = snd.kind = 'beat'; showSound(); toastLater = 'Sound is on the synthetic beat: choose Microphone again to use it.'; }
    if (kind === 'file') {
      try {
        var rec = await OrcarSound.lastFile();
        if (rec && rec.bytes) { snd.file = { name: rec.name, clip: await OrcarSound.loadFile(rec.bytes) }; }
      } catch (e) { snd.file = null; }
      if (!snd.file) { kind = 'beat'; toastLater = 'The last audio file wasn\'t kept in this browser, so sound is on the synthetic beat.'; }
      else snd.file.saved = true;
    }
    if (token !== snd.token) { toastLater = ''; return; }   // the person chose something meanwhile
    await setSound(kind, { quiet: true });
  }
  var toastLater = '';
  document.addEventListener('visibilitychange', function () { if (document.hidden && snd.player) snd.player.stop(); });

  var presets = $('presets');
  Object.keys(OrcarView.PRESETS).forEach(function (k, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = OrcarView.PRESETS[k].label; b.title = OrcarView.PRESETS[k].label + ' view (' + (i + 1) + ')';
    b.setAttribute('aria-pressed', k === 'threeQuarter');
    b.onclick = function () { setPreset(k); };
    presets.appendChild(b);
  });
  function setPreset(k) {
    view.setPreset(k);
    [].forEach.call(presets.children, function (b, i) { b.setAttribute('aria-pressed', Object.keys(OrcarView.PRESETS)[i] === k); });
  }
  view.opts.onChange = function () { [].forEach.call(presets.children, function (b) { b.setAttribute('aria-pressed', 'false'); }); };
  $('optUnlit').onchange = function () { view.showUnlit = this.checked; };
  $('optBoards').onchange = function () { view.showBoards = this.checked; $('legend').hidden = !this.checked; };
  $('optBright').oninput = function () { view.brightness = +this.value; $('brightVal').textContent = Math.round(this.value * 100) + '%'; };

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t.closest && (t.closest('.CodeMirror') || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if ((e.key === 's' || e.key === 'S') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
      return;
    }
    if (e.key === ' ') { e.preventDefault(); setPlaying(!sim.playing); }
    else if (e.key === 'ArrowRight' && !sim.playing) sim.step();
    else if (/^[1-5]$/.test(e.key)) setPreset(Object.keys(OrcarView.PRESETS)[+e.key - 1]);
  });
  $('checksToggle').onclick = function () {
    var list = $('issues'), open = list.hidden;
    list.hidden = !open; $('checksNote').hidden = !open; $('refList').hidden = !open; $('docBody').hidden = !open;
    $('lower').classList.toggle('ref-open', open && $('checksPane').hidden);
    this.textContent = open ? 'Hide' : 'Show';
    this.setAttribute('aria-expanded', open);
  };

  // ===================================================================== reference tab
  var ref = { model: null, src: null, timer: null };
  function updateReference(src) {
    if (src === ref.src) return;
    ref.src = src;
    try { ref.model = OrcarReference.parse(src || ''); } catch (e) { ref.model = null; }
    scheduleReference();
    setTimeout(symbols, 0);   // start reading the Pixelblaze names before the first suggestion
  }
  function refValueNames() {
    var out = [];
    if (ref.model) for (var n in ref.model.byName) { var k = ref.model.byName[n].kind; if (k === 'value' || k === 'plane' || k === 'landmark') out.push(n); }
    return out;
  }
  function scheduleReference() {
    if ($('refPane').hidden) return;   // rendered when the tab opens
    clearTimeout(ref.timer);
    ref.timer = setTimeout(renderReference, 60);
  }
  function renderReference() {
    var list = $('refList'), top = list.scrollTop;
    if (!ref.model) { list.innerHTML = '<p class="ref-empty">Open the repo folder to see what the template provides.</p>'; return; }
    OrcarReference.render(list, ref.model, {
      insert: function (text) { cm.focus(); cm.replaceSelection(text); },
      value: function (n) {
        var vals = S.describe.map(function (d) { return d && d.values ? d.values[n] : undefined; });
        if (vals[0] === undefined || typeof vals[0] !== 'number') return vals[0];
        var differ = vals.some(function (v) { return typeof v === 'number' && v !== vals[0]; });
        if (!differ) return vals[0];
        return 'per board: ' + S.repo.boards.map(function (b, i) { return b.id + ' ' + (typeof vals[i] === 'number' ? vals[i] : '?'); }).join(' · ');
      },
      feature: function (n) { for (var i = 0; i < S.describe.length; i++) { var d = S.describe[i]; if (d && d.features && d.features[n]) return d.features[n]; } return undefined; },
      canShow: canShow, show: function (e) { toggleShow(e); }, showing: shown.name,
      docHeading: function (e) { return OrcarSymbols.docHeading(e); },
      openDoc: function (h) { openDoc('docs/ORCAR_CONTRACT.md', h); },
    }, $('refSearch').value);
    list.scrollTop = top;
  }
  function showTab(which, docsOpening) {
    if (!/^(checks|ref|docs)$/.test(which)) which = 'checks';
    var panes = { checks: ['tabChecks', 'checksPane'], ref: ['tabRef', 'refPane'], docs: ['tabDocs', 'docsPane'] };
    Object.keys(panes).forEach(function (k) {
      $(panes[k][0]).setAttribute('aria-selected', k === which);
      $(panes[k][1]).hidden = k !== which;
    });
    $('lower').classList.toggle('ref-open', which !== 'checks');
    if (which === 'ref') renderReference();
    if (which === 'docs' && !docsOpening && (docs.repo !== S.repo || !docs.shown)) { if (docs.repo !== S.repo) docs.reset(); docs.repo = S.repo; docs.open(); }
    store.set('tab', which);
    // the checks may be collapsed: opening a tab shows it
    $('checksToggle').textContent = 'Hide'; $('checksToggle').setAttribute('aria-expanded', 'true');
    $('issues').hidden = false; $('checksNote').hidden = false; $('refList').hidden = false; $('docBody').hidden = false;
    setTimeout(function () { cm.refresh(); }, 0);
  }
  $('tabChecks').onclick = function () { showTab('checks'); };
  $('tabRef').onclick = function () { showTab('ref'); };
  $('tabDocs').onclick = function () { showTab('docs'); };
  $('refSearch').oninput = function () { $('refList').scrollTop = 0; renderReference(); };

  // ===================================================================== docs tab
  // The repo's own docs, read from the open folder (or the hosted copy).
  // An effect path in a doc -> what the effect menu calls it, if it's there.
  function effectTarget(path) {
    if (!S.repo) return null;
    var m = path.match(/^src\/drafts\/([\w.-]+)\.effect\.js$/);
    if (m) return S.draftList.some(function (d) { return d.id === m[1]; }) ? 'draft:' + m[1] : null;
    return [].concat(S.repo.effects['src/effects'] || [], S.repo.effects['src/examples'] || []).indexOf(path) >= 0 ? path : null;
  }
  var docs = new OrcarDocs.Docs({
    read: function (path) { return S.repo ? S.repo.source.read(path) : Promise.reject(new Error('open the repo folder first')); },
    exists: function (path) { return /\.md$/.test(path) ? OrcarDocs.DOCS.some(function (d) { return d.path === path; }) : !!effectTarget(path); },
    openEffect: async function (path) {
      var target = effectTarget(path);
      if (!target) { toast(path + ' isn\'t in this folder.'); return; }
      if (target === docKey()) return;
      if (!(await leaveDoc())) return;
      try { await openTarget(target); } catch (e) { toast(e.message); }
    },
    box: $('docBody'), select: $('docSelect'), search: $('docSearch'), counter: $('docCount'),
  });
  function openDoc(path, heading) {
    if (docs.repo !== S.repo) { docs.reset(); docs.repo = S.repo; }
    showTab('docs', true);
    docs.open(path, heading);
  }
  // after a folder is opened: the docs are that folder's
  function refreshDocs() {
    if (docs.repo === S.repo) return;
    docs.reset(); docs.repo = S.repo;
    if (!$('docsPane').hidden) docs.open();
  }

  // ===================================================================== editor suggestions + hover hints
  // Template names (from the Reference tab's model), Pixelblaze built-ins (from
  // docs/PIXELBLAZE_REFERENCE.md) and the effect's own names.
  var syms = { model: undefined, tpl: {}, pb: {}, pbRepo: null, text: null, eff: {}, merged: null };
  function symbols() {
    if (S.repo && syms.pbRepo !== S.repo) {
      syms.pbRepo = S.repo;
      S.repo.source.read('docs/PIXELBLAZE_REFERENCE.md').then(function (md) {
        syms.pb = OrcarSymbols.fromReferenceDoc(md); syms.merged = null;
      }, function () { syms.pb = {}; syms.merged = null; });
    }
    if (syms.model !== ref.model) { syms.model = ref.model; syms.tpl = OrcarSymbols.fromTemplate(ref.model); syms.merged = null; }
    var text = cm.getValue();
    if (text !== syms.text) {
      syms.text = text;
      var eff = OrcarSymbols.fromEffect(text);
      if (JSON.stringify(Object.keys(eff)) !== JSON.stringify(Object.keys(syms.eff))) { syms.eff = eff; syms.merged = null; }
    }
    // the effect's own names shadow built-ins (an effect's `var light` isn't the sensor); the template's win
    if (!syms.merged) syms.merged = Object.assign({}, syms.pb, syms.eff, syms.tpl);
    return syms.merged;
  }
  var hintsBox = $('hints');
  if (store.get('hints') === false) hintsBox.checked = false;
  hintsBox.onchange = function () { store.set('hints', this.checked); };
  OrcarSymbols.attach(cm, symbols, {
    enabled: function () { return hintsBox.checked; },
    open: function (sym) {
      if (sym.source === 'template') {
        $('refSearch').value = sym.name;
        showTab('ref');
        var hit = [].filter.call($('refList').querySelectorAll('.ref-name'), function (b) { return b.textContent === (sym.signature || sym.name); })[0];
        if (hit) { var row = hit.closest('.ref-item'); row.classList.add('ref-flash'); row.scrollIntoView({ block: 'nearest' }); setTimeout(function () { row.classList.remove('ref-flash'); }, 1400); }
      } else if (sym.doc) openDoc(sym.doc.path, sym.doc.heading);
    },
  });

  // ===================================================================== show on whale
  // Light up where a feature, group, tag, board, landmark or plane is; the rest dims.
  var shown = { name: null };
  function installed(n) { var f = ref.model && ref.model.byName[n]; return !!f && f.kind === 'feature' && f.count > 0; }
  function canShow(e) {
    if (e.kind === 'feature') return e.count > 0;
    if (e.kind === 'group') return groupFeatures(e.name).some(installed);
    if (e.kind === 'tag') return !ref.model.tagsFor[e.name] || groupFeatures(ref.model.tagsFor[e.name]).some(installed);
    if (e.kind === 'landmark' || e.kind === 'plane') return true;
    return e.kind === 'wiring' && /^BOARD_[A-F]$/.test(e.name);
  }
  function groupFeatures(n, seen) {
    seen = seen || {};
    if (seen[n]) return [];
    seen[n] = 1;
    var g = ref.model && ref.model.groups[n];
    if (!g) return [n];
    return [].concat.apply([], g.map(function (m) { return groupFeatures(m, seen); }));
  }
  function highlightFor(e) {
    if (!S.repo) return null;
    if (e.kind === 'landmark') return { masks: null, points: [{ p: e.inches, label: e.name }], planes: [] };
    if (e.kind === 'plane') return { masks: null, points: [], planes: [{ axis: e.axis, v: e.inches, label: e.name }] };
    var any = 0, masks = S.repo.boards.map(function (b, bi) {
      var m = new Uint8Array(b.pixels), d = S.describe[bi];
      if (e.kind === 'wiring') { if (b.id === e.name.slice(-1)) m.fill(1); }
      else if (e.kind === 'tag') {
        var bit = S.run && S.run.tagNames[e.name.slice(4)];
        if (d && d.tags && bit) for (var i = 0; i < b.pixels; i++) if (d.tags[i] & bit) m[i] = 1;
      } else {
        var off = d && d.boardOffset ? d.boardOffset[b.node] : null;
        if (d && d.features && off !== null && off !== undefined) {
          (e.kind === 'group' ? groupFeatures(e.name) : [e.name]).forEach(function (fn) {
            var f = d.features[fn];
            if (!f || !(f[0] > 0)) return;
            for (var g = Math.max(f[1], off); g <= f[2] && g - off < b.pixels; g++) m[g - off] = 1;
          });
        }
      }
      for (var k = 0; k < m.length; k++) if (m[k]) { any++; break; }
      return m;
    });
    return any ? { masks: masks, points: [], planes: [] } : { empty: true };
  }
  function toggleShow(e) {
    if (shown.name === e.name) { clearShow(); return; }
    var h = highlightFor(e);
    if (!h) { toast('Open the repo folder first.'); return; }
    if (h.empty) { toast(S.describe.length ? 'Nothing on the whale is in ' + e.name + '.' : 'Run an effect first, so the boards report where ' + e.name + ' is.'); return; }
    shown.name = e.name; shown.entry = e;
    view.highlight = h;
    $('hlText').textContent = 'Showing ' + e.name;
    $('hlChip').hidden = false;
    renderReference();
  }
  function clearShow() {
    if (!shown.name) return;
    shown.name = null; shown.entry = null;
    view.highlight = null;
    $('hlChip').hidden = true;
    if (!$('refPane').hidden) renderReference();
  }
  // a new run (or another folder) can move things: recompute what's shown
  function refreshShow() {
    if (!shown.entry) return;
    var e = ref.model && ref.model.byName[shown.entry.name];
    var h = e && canShow(e) ? highlightFor(e) : null;
    if (h && h.empty && S.repo && S.describe.filter(Boolean).length < S.repo.boards.length) return;   // not every board has reported yet
    if (!h || h.empty) { clearShow(); return; }
    shown.entry = e; view.highlight = h;
  }
  $('hlClear').onclick = clearShow;
  // Esc clears it, unless it's closing something else first (the suggestion
  // list, a dialog) or clearing a search field. Capture phase: runs before
  // CodeMirror closes its list.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !shown.name || cm.state.completionActive || document.querySelector('dialog[open]')) return;
    var t = e.target;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && !(t.closest && t.closest('.CodeMirror'))) return;
    clearShow();
  }, true);

  if (/^(ref|docs)$/.test(store.get('tab'))) showTab(store.get('tab'));

  // ===================================================================== hover
  function hover(hit, mx, my) {
    view.hover = hit;
    var tip = $('tip');
    if (!hit || !S.repo) { tip.hidden = true; return; }
    var b = S.repo.boards[hit.board], i = hit.index, d = S.describe[hit.board];
    var off = d && d.boardOffset ? d.boardOffset[b.node] : null;
    var g = off !== null && off !== undefined ? off + i : null;
    var feat = g !== null ? featureAt(hit.board, g) : null, fpos = '';
    if (feat) {
      var f = d.features[feat], k = g - f[1];
      fpos = ' · pixel ' + (k + 1) + ' of ' + f[0] + (f[3] ? ' (wired reversed)' : '');
    }
    var tags = d && d.tags ? d.tags[i] : null, tagList = [];
    if (tags && S.run) for (var tn in S.run.tagNames) if (tags & S.run.tagNames[tn]) tagList.push(tn.toLowerCase());
    var c = view.boards[hit.board].colours, r = c[i * 3], gg = c[i * 3 + 1], bl = c[i * 3 + 2];
    var raw = b.raw[i], nm = b.norm[i];
    var esc = function (s) { return String(s).replace(/[&<>]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]; }); };
    tip.innerHTML =
      '<b>' + esc(feat || (S.unmapped[hit.board][i] ? 'Unmapped pixel' : 'Pixel')) + '</b><span class="k">' + esc(fpos) + '</span><br>' +
      '<span class="k">Board</span> ' + esc(b.id) + ' (node ' + esc(b.node) + ') · <span class="k">index</span> ' + i + (g !== null ? ' · <span class="k">global</span> ' + g : '') + '<br>' +
      (tagList.length ? '<span class="k">Tags</span> ' + esc(tagList.join(', ')) + '<br>' : (tags === 0 ? '<span class="k">Tags</span> none (tags == 0)<br>' : '')) +
      (hit.strip || S.unmapped[hit.board][i] ? '<span class="k">No map position: drawn in the strip below</span><br>'
        : '<span class="k">At</span> <code>' + raw.map(function (v) { return v.toFixed(1); }).join(', ') + '</code> in · <code>' + nm.map(function (v) { return v.toFixed(3); }).join(', ') + '</code><br>') +
      '<span class="sw" style="background:' + rgbToHex(r, gg, bl) + '"></span> <code>rgb(' + [r, gg, bl].map(function (v) { return v.toFixed(2); }).join(', ') + ')</code>';
    tip.hidden = false;
    var stage = $('stage').getBoundingClientRect();
    var x = mx + 16, y = my + 16;
    if (x + tip.offsetWidth > stage.width - 8) x = mx - tip.offsetWidth - 12;
    if (y + tip.offsetHeight > stage.height - 8) y = my - tip.offsetHeight - 12;
    tip.style.left = Math.max(6, x) + 'px'; tip.style.top = Math.max(6, y) + 'px';
  }

  // ===================================================================== flash meter
  // Large-area flashing (contract section 8). Each board reports, for every
  // frame it renders, the average of its pixels' brightest channels (so a red
  // or blue strobe counts as much as a white one). The meter follows that for
  // each board, and for the whole whale (each board's latest level, weighted
  // by pixel count, at board A's frame times), and counts swings of at least
  // 10% of full scale. Seven swings (more than three flashes) within one
  // second is a warning. Swings are only seen at frame times, so one frame of
  // slack is allowed: a strobe at exactly 3 per second isn't flagged by
  // sampling jitter. A strobe faster than half a board's frame rate reads low
  // (it is still flagged). Measured before the brightness slider.
  function FlashMeter(boards, stress) {
    var n = boards.length;
    this.n = n;
    this.weights = boards.map(function (b) { return b.pixels; });
    this.dts = boards.map(function (b, i) { return 1000 / (stress ? OrcarBoards.STRESS[i % OrcarBoards.STRESS.length].fps : OrcarBoards.NORMAL_FPS); });
    this.sig = [];
    for (var i = 0; i <= n; i++) this.sig.push({ dir: 0, hi: null, lo: null, flips: [] });
    this.samples = boards.map(function () { return []; });   // recent [t, level] per board
    this.wholeAt = -Infinity;                                 // last board-A time folded into the whole-whale signal
    this.rates = new Array(n + 1).fill(0);                    // fastest flashes/second seen; last entry = whole whale
  }
  // -> null, or { rate, where } for the largest area flashing too fast
  FlashMeter.prototype.worst = function () {
    var n = this.n;
    if (this.rates[n] > 3) return { rate: this.rates[n], where: 'the whole whale' };
    var ids = [], rate = 0;
    for (var i = 0; i < n; i++) if (this.rates[i] > 3) { ids.push(S.repo.boards[i].id); rate = Math.max(rate, this.rates[i]); }
    return ids.length ? { rate: rate, where: boardsLabel(ids) } : null;
  };
  FlashMeter.prototype.push = function (bi, levels) {
    var sm = this.samples[bi];
    for (var k = 0; k < levels.length; k++) {
      // A long step means frames were skipped (the page fell behind): swings
      // can't be timed across it, so start counting again.
      if (levels[k][2] > this.dts[bi] * 1.5) { this.sig[bi].flips = []; this.sig[this.n].flips = []; }
      this._feed(bi, levels[k][0], levels[k][1], this.dts[bi]);
      sm.push(levels[k]);
    }
    this._whole();
  };
  FlashMeter.prototype._whole = function () {
    var A = this.samples[0], n = this.n, maxDt = Math.max.apply(null, this.dts);
    for (var a = 0; a < A.length; a++) {
      var t = A[a][0];
      if (t <= this.wholeAt) continue;
      var ws = 0, wl = 0, ready = true;
      for (var b = 0; b < n && ready; b++) {
        var sm = this.samples[b];
        if (!sm.length || sm[sm.length - 1][0] < t - 1e-6) { ready = false; break; }   // that board hasn't got here yet
        var v = sm[0][1];
        for (var k = 0; k < sm.length && sm[k][0] <= t + 1e-6; k++) v = sm[k][1];      // its level at time t
        ws += this.weights[b]; wl += v * this.weights[b];
      }
      if (!ready) break;
      this._feed(n, t, ws ? wl / ws : 0, maxDt);
      this.wholeAt = t;
    }
    // keep a little history before the whole-whale cursor
    for (var c = 0; c < n; c++) { var s2 = this.samples[c]; while (s2.length > 2 && s2[1][0] < this.wholeAt - 200) s2.shift(); }
  };
  FlashMeter.prototype._feed = function (si, t, L, dt) {
    var s = this.sig[si];
    if (s.hi === null) { s.hi = s.lo = L; return; }
    s.hi = Math.max(s.hi, L); s.lo = Math.min(s.lo, L);
    var flipped = false;
    if (s.dir >= 0 && s.hi - L >= 0.1) { s.dir = -1; flipped = true; }
    else if (s.dir <= 0 && L - s.lo >= 0.1) { s.dir = 1; flipped = true; }
    if (!flipped) return;
    s.hi = s.lo = L;
    s.flips.push(t);
    if (s.flips.length > 7) s.flips.shift();
    if (s.flips.length === 7) {
      var span = t - s.flips[0];
      if (span < 1000 - dt) this.rates[si] = Math.max(this.rates[si], 3000 / span);
    }
  };

  // ===================================================================== checks
  var issuesTimer = null;
  function scheduleIssues() { if (!issuesTimer) issuesTimer = setTimeout(function () { issuesTimer = null; renderIssues(); }, 300); }

  function mapLine(n) {
    if (!S.run) return n;
    var m = n - S.run.offset;
    return m > 0 ? m : 0;
  }
  function boardsLabel(ids) {
    var all = S.repo ? S.repo.boards.map(function (b) { return b.id; }) : [];
    ids = all.filter(function (x) { return ids.indexOf(x) >= 0; });
    if (ids.length === all.length && ids.length > 1) return 'all boards';
    return (ids.length > 1 ? 'boards ' : 'board ') + ids.join(', ');
  }

  function collectIssues() {
    var out = [];
    var add = function (level, text, line, where) { out.push({ level: level, text: text, line: line || 0, where: where || '' }); };
    if (S.syntax) {
      var ln = mapLine(S.syntax.line);
      add('error', 'Syntax error: ' + S.syntax.message + '. The boards keep running the last version that worked.', ln, ln ? '' : 'template');
    }
    S.lint.forEach(function (it) {
      var lines = it.lines.map(mapLine).filter(function (x) { return x > 0; });
      if (it.lines.length && !lines.length) return;   // only in the template: not this effect's problem
      add(it.level, it.text.replace(' ({lines})', ''), lines[0], lines.length > 1 ? 'lines ' + lines.join(', ') : '');
    });
    if (S.fatal) add('error', S.fatal.hung ? S.fatal.message : 'Board ' + S.fatal.board + ': ' + S.fatal.message);
    if (S.repo && !S.syntax) {
      var groups = {};
      var group = function (key, level, text, line, id) {
        if (!groups[key]) groups[key] = { level: level, text: text, line: line, ids: [] };
        if (groups[key].ids.indexOf(id) < 0) groups[key].ids.push(id);
      };
      S.repo.boards.forEach(function (b, i) {
        var st = S.boardStats[i] || (S.boardInfo[i] && S.boardInfo[i].stats), info = S.boardInfo[i], d = S.describe[i];
        if (st) {
          st.errors.forEach(function (e) {
            var when = /^load/.test(e.when) ? 'While loading' : /^control/.test(e.when) ? 'In ' + e.when.slice(8) + '()' : 'While rendering';
            var l = mapLine(e.line);
            group('e:' + e.message + ':' + l, 'error', when + ': ' + e.message, l, b.id);
          });
          if (st.badColour.length) {
            var bc = st.badColour[0];
            group('bad', 'error', 'Bad colour values, e.g. ' + bc.fn + '(' + bc.args.join(', ') + ') at pixel ' + bc.index + (bc.note ? ' (' + bc.note + ')' : ' -- NaN or not a number shows as black'), 0, b.id);
          }
          if (st.arraysAfterLoad) group('arr', 'error', st.arraysAfterLoad + ' array elements allocated after load (every frame). Arrays are never freed on the device: allocate them at the top level.', 0, b.id);
          if (st.undrawn) group('undrawn', 'error', st.undrawn + ' pixels are past the end of the map, so render3D() never draws them and they freeze. Regenerate the maps (npm run maps).', 0, b.id);
          if (st.frames > 0 && st.unsetPixels / st.frames >= 1) group('unset', 'warn', 'Some pixels never get hsv()/rgb() in a frame, so the device shows whatever they had before. End every path in render3D() with a colour (hsv(0, 0, 0) for off).', 0, b.id);
        }
        if (info) {
          if (info.globals > 256) group('glob', 'error', '~' + info.globals + ' globals (limit 256)', 0, b.id);
          else if (info.globals > 220) group('glob', 'warn', '~' + info.globals + ' globals (limit 256)', 0, b.id);
          if (info.arrayElements > 10240) group('ae', 'error', info.arrayElements + ' array elements (limit 10,240)', 0, b.id);
          else if (info.arrayElements > 9000) group('ae', 'warn', info.arrayElements + ' array elements (limit 10,240)', 0, b.id);
          if (!info.renderFn) group('norender', 'error', 'No render3D(), render2D() or render() is exported.', 0, b.id);
        }
        if (d && d.boardTotal && Number.isFinite(d.boardTotal[b.node]) && d.boardTotal[b.node] !== b.pixels)
          group('total', 'error', 'The template counts ' + d.boardTotal[b.node] + ' pixels on board ' + b.id + ' but maps/boards.json says ' + b.pixels + '. Indices will drift: regenerate the maps (npm run maps).', 0, b.id);
      });
      Object.keys(groups).forEach(function (k) {
        var gq = groups[k];
        add(gq.level, gq.text + ' (' + boardsLabel(gq.ids) + ')', gq.line);
      });
      var fw = S.flash && S.flash.worst();
      if (fw)
        add('warn', 'Flashing about ' + (fw.rate < 9.95 ? fw.rate.toFixed(1) : Math.round(fw.rate)) + ' times a second on ' + fw.where + '. The limit for large areas is 3 per second (contract section 8): slow it down, or put it behind a default-off toggle named so it\'s obvious.');
      var info0 = S.boardInfo[0];
      if (info0 && info0.usesSensor && info0.usesSensor.length)
        add('info', 'Uses the sensor board (' + info0.usesSensor.join(', ') + '). ' + soundCheckText());
      if ($('stress').checked)
        add('info', 'Sync stress is on: each board booted at a different time and runs at its own frame rate (' + S.repo.boards.map(function (b, i) { return b.id + ' ' + OrcarBoards.STRESS[i % OrcarBoards.STRESS.length].fps; }).join(', ') + ' fps). If neighbouring boards stop matching at the seams, the pattern depends on frame history (contract section 5). A clean result doesn\'t rule out other sync problems.');
      if (sim.hostKind === 'iframe')
        add('info', 'This browser wouldn\'t start background workers here, so the boards run on the page itself. An endless loop in a pattern will freeze the tab; your edits are kept and come back when you reload.');
    }
    var rank = { error: 0, warn: 1, info: 2 };
    out.sort(function (a, b) { return rank[a.level] - rank[b.level] || (a.line || 1e9) - (b.line || 1e9); });
    return out;
  }

  var marked = [];
  function renderIssues() {
    var list = collectIssues();
    var box = $('issues');
    box.innerHTML = '';
    var ne = 0, nw = 0;
    marked.forEach(function (m) { cm.setGutterMarker(m.line, 'issues-gutter', null); cm.removeLineClass(m.line, 'background', m.cls); });
    marked = [];
    list.forEach(function (it) {
      if (it.level === 'error') ne++; else if (it.level === 'warn') nw++;
      var row = document.createElement('div');
      row.className = 'issue ' + it.level;
      row.setAttribute('role', 'listitem');
      var where = it.where || (it.line ? 'line ' + it.line : '');
      row.innerHTML = '<span class="sev" aria-label="' + it.level + '"></span><p></p><span class="where"></span>';
      row.querySelector('p').textContent = it.text;
      row.querySelector('.where').textContent = where;
      if (it.line) {
        row.dataset.line = it.line;
        row.tabIndex = 0;
        var go = function () { cm.focus(); cm.setCursor({ line: it.line - 1, ch: 0 }); cm.scrollIntoView({ line: it.line - 1, ch: 0 }, 80); };
        row.onclick = go;
        row.onkeydown = function (e) { if (e.key === 'Enter') go(); };
        if (it.level !== 'info' && it.line <= cm.lineCount()) {
          var mk = document.createElement('div');
          mk.className = 'mk ' + it.level; mk.title = it.text;
          var cls = it.level === 'error' ? 'line-error' : 'line-warn';
          cm.setGutterMarker(it.line - 1, 'issues-gutter', mk);
          cm.addLineClass(it.line - 1, 'background', cls);
          marked.push({ line: it.line - 1, cls: cls });
        }
      }
      box.appendChild(row);
    });
    if (!list.length) box.innerHTML = '<div class="issue info"><span class="sev"></span><p>No problems found in this run.</p><span></span></div>';
    setCount($('countErr'), ne, ne === 1 ? 'error' : 'errors', 'err');
    $('countErr').className = 'count' + (ne ? ' error' : '');
    setCount($('countWarn'), nw, nw === 1 ? 'warning' : 'warnings', 'warn');
    $('countWarn').className = 'count' + (nw ? ' warn' : '');
    var ready = S.boardInfo.filter(Boolean).length;
    $('frameNote').textContent = (S.repo ? ready + '/' + S.repo.boards.length + ' boards' + (sim.hostKind ? ' · ' + (sim.hostKind === 'worker' ? 'workers' : 'in page') : '') + ' · ' : '') + '+x port · +y aft · +z up';
  }

  // ===================================================================== toast
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 5200);
  }

  // ===================================================================== Claude artifact link
  // When this page is published as a Claude artifact:
  //   - drafts live in the artifact's database ("drafts" collection), so the
  //     chat can send an effect by writing a draft (by: "claude"), and read or
  //     change the person's drafts;
  //   - "sim/current" always holds what's open, for the chat to read.
  // Outside an artifact none of this runs.
  var claudeLink = {
    db: null, active: false, ref: null, timer: null, writing: false, pending: false, applied: {},
    tab: 'page-' + Math.random().toString(36).slice(2, 8) + '-',   // this tab's writes carry this prefix
    start: async function () {
      if (!window.claude || typeof window.claude.use !== 'function') return;
      var db = null;
      try { db = await Promise.race([window.claude.use('db'), new Promise(function (r) { setTimeout(function () { r(null); }, 5000); })]); } catch (e) { db = null; }
      if (!db) return;
      this.db = db; this.active = true;
      this.ref = db.doc('sim/current');
      $('claudeChip').hidden = false; $('claudeChip').className = 'chip on';
    },
    opened: function () { this.changed(); },
    changed: function () {
      if (!this.active) return;
      var me = this;
      clearTimeout(this.timer);
      this.timer = setTimeout(function () { me.timer = null; me.writeCurrent(); }, 1500);
    },
    ran: function () {},
    writeCurrent: async function () {
      if (this.writing) { this.pending = true; return; }
      this.writing = true;
      try {
        var doc = S.doc;
        await this.ref.set({ code: cm.getValue(), name: doc ? (doc.name || doc.label) : '', path: doc && !isDraft(doc) && doc.path || null,
          draft: isDraft(doc) ? doc.id : null, mode: S.run ? S.run.mode : 'effect', by: 'page', rev: this.tab + Date.now(), updatedAt: new Date().toISOString() });
      } catch (e) { $('claudeChip').className = 'chip warn'; }
      this.writing = false;
      if (this.pending) { this.pending = false; this.writeCurrent(); }
    },
    // A draft changed in the artifact's database (here, in another tab, or by the chat).
    draftChanged: function (ev) {
      var me = claudeLink;
      refreshDrafts();
      var d = ev.data, doc = S.doc, open = isDraft(doc) && doc.id === ev.id;
      if (ev.initial) { if (d) me.applied[ev.id] = d.rev; return; }   // what was already there when the page loaded
      if (ev.type === 'removed') { if (S.selfRemoved[ev.id]) { delete S.selfRemoved[ev.id]; return; } if (open) toast('This draft was deleted elsewhere. Your text is still here; press New to keep it.'); return; }
      if (!d || ev.pending || (typeof d.rev === 'string' && d.rev.indexOf(me.tab) === 0) || d.rev === me.applied[ev.id]) return;
      me.applied[ev.id] = d.rev;
      var who = d.by === 'claude' ? 'The Claude chat' : 'Another open copy of this page';
      if (open) {
        if (d.code === cm.getValue()) return;
        var reload = function () {
          clearTimeout(draftSaving.timer); draftSaving.timer = null; draftSaving.pending = false; draftSaving.error = null;
          doc.savedText = d.code; setEditor(d.code); runNow(); claudeLink.changed();
          // Our autosave may have written the person's version meanwhile: put theirs back.
          if (doc.dbCode !== d.code) { draftSaving.pending = true; writeDraftNow(); } else draftStatus('saved');
          toast(who + ' updated this draft.');
        };
        doc.dbCode = d.code;
        if (draftSaving.pending || draftSaving.writing || cm.getValue() !== doc.savedText || Date.now() - S.lastTyped < 1500) {
          showFileBanner(who + ' changed this draft while you were editing it.', [
            { label: 'Load their version', fn: function () { hideFileBanner(); if (S.doc === doc) reload(); } },
            { label: 'Keep mine', fn: function () { hideFileBanner(); if (S.doc === doc) scheduleDraftSave(); } }]);
        } else reload();
        return;
      }
      if (d.by !== 'claude') return;   // another tab's own drafts: just listed
      var openIt = async function () { if (await leaveDoc()) { await openDraft(ev.id); toast(who + ' sent "' + (d.name || ev.id) + '". It\'s running now.'); } };
      if (!isDirty() && !draftSaving.pending && Date.now() - S.lastTyped > 1500) openIt();
      else showFileBanner(who + ' sent a new effect, "' + (d.name || ev.id) + '".', [
        { label: 'Open it', fn: function () { hideFileBanner(); openIt(); } },
        { label: 'Later', fn: hideFileBanner }]);
    },
  };

  // ===================================================================== start
  // v1 kept unsaved-edit backups as "draft:<path>"; they're "backup:<path>" now.
  try {
    for (var k = localStorage.length - 1; k >= 0; k--) {
      var key = localStorage.key(k);
      if (key && key.indexOf('orcar-sim:draft:') === 0) {
        if (localStorage.getItem('orcar-sim:backup:' + key.slice(16)) === null) localStorage.setItem('orcar-sim:backup:' + key.slice(16), localStorage.getItem(key));
        localStorage.removeItem(key);
      }
    }
  } catch (e) { /* storage blocked: nothing to migrate */ }

  async function start() {
    welcome(true, {});
    startSound().then(function () { if (toastLater) setTimeout(function () { toast(toastLater); toastLater = ''; }, 1500); });
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      $('welcome').querySelector('h1').textContent = 'Loading the Orcar…';
      $('pickFolder').hidden = true;
      $('welcome').querySelector('.drop-hint').hidden = true;
      await claudeLink.start();   // first, so drafts go to the artifact when there is one
      await connect(OrcarRepo.httpSource());
      return;
    }
    var h = OrcarRepo.canPickFolder ? await OrcarRepo.rememberedFolder() : null;
    if (h) {
      var perm = 'prompt';
      try { perm = await h.queryPermission({ mode: 'read' }); } catch (e) {}
      if (perm === 'granted') {
        try { await connect(await OrcarRepo.handleSource(h), h); return; } catch (e) { /* moved or deleted: ask again */ }
      }
      welcome(true, { reconnect: h.name });
    }
  }
  setPlaying(true);
  start();

  // For tests and for people poking around in the console.
  // "3 errors", or "3 err" when the pane is narrow (CSS picks)
  function setCount(el, n, long, short) {
    el.textContent = n + ' ';
    var a = document.createElement('span'); a.className = 'cw-long'; a.textContent = long;
    var b = document.createElement('span'); b.className = 'cw-short'; b.textContent = short;
    el.appendChild(a); el.appendChild(b);
    el.title = n + ' ' + long;
  }
  window.orcarSim = { S: S, sim: sim, view: view, editor: cm, connect: connect, runNow: runNow, repo: OrcarRepo, engine: engine, symbols: symbols, ref: ref, docs: docs,
    sound: function () { var p = snd.player && snd.player.position(); return { kind: snd.kind, boardsSec: +(clipPosMs() / 1000).toFixed(2), audioSec: p === null || p === undefined ? null : +p.toFixed(2) }; } };
})();
