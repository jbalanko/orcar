// view.js -- draws the Orcar's LEDs in 3D on a canvas, for simulator.html.
//
// Positions are the maps' own inches, in the Pixelblaze map frame
// (+x port, +y aft, +z up), so what you see has the sculpture's real
// proportions. No libraries: a few thousand glowing dots is light work for a
// 2D canvas.
//
// Mouse / trackpad: drag to orbit, Shift-drag (or right-drag) to pan,
// scroll or pinch to zoom, double-click to reset the view.
//
// Defines one global, OrcarView.

var OrcarView = (function () {
  'use strict';

  // Camera presets: yaw 0 looks from in front of the nose (port on the right),
  // yaw 90 looks at the port side (nose on the left). Pitch is degrees above.
  var PRESETS = {
    threeQuarter: { yaw: 52, pitch: 18, label: '3/4' },
    port: { yaw: 90, pitch: 4, label: 'Port' },
    starboard: { yaw: -90, pitch: 4, label: 'Starboard' },
    nose: { yaw: 0, pitch: 6, label: 'Nose' },
    top: { yaw: 90, pitch: 89, label: 'Top' },
  };
  var BOARD_COLOURS = ['#e8a33d', '#4fb3d9', '#9b7fe6', '#5cc48a', '#e0697a', '#d6d15a'];

  function View(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts || {};
    this.boards = [];            // [{ id, pts: Float32Array xyz (inches), colours: Float32Array rgb, hidden: Uint8Array }]
    this.screen = null;          // projected positions for picking
    this.showUnlit = true;
    this.showBoards = false;
    this.brightness = 1;
    this.ledSize = 1;
    this.strips = [];            // unmapped strands, drawn as flat strips: [{ label, board, start, count }]
    this.hover = null;
    // "Show on whale": { masks: [Uint8Array per board] | null, points: [{ p: [x,y,z] inches, label }],
    //                    planes: [{ axis: 'x'|'y'|'z', v: inches, label }] } or null
    this.highlight = null;
    this.setPreset('threeQuarter');
    this._bind();
  }

  View.prototype.setGeometry = function (boards, box) {
    // boards: [{ id, raw: [[x,y,z]...], pixels, hidden: Uint8Array }] ; box: { min:[x,y,z], max:[x,y,z] }
    this.boards = boards.map(function (b) {
      var n = b.pixels, pts = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) {
        var p = b.raw[i] || [0, 0, 0];
        pts[i * 3] = p[0]; pts[i * 3 + 1] = p[1]; pts[i * 3 + 2] = p[2];
      }
      return { id: b.id, pts: pts, colours: new Float32Array(n * 3), hidden: b.hidden || new Uint8Array(n), n: n };
    });
    this.box = box;
    this.center = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
    this.span = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    this.reset();
  };

  View.prototype.setColours = function (i, rgb) { if (this.boards[i]) this.boards[i].colours.set(rgb.subarray(0, this.boards[i].colours.length)); };
  View.prototype.clearColours = function () { this.boards.forEach(function (b) { b.colours.fill(0); }); };

  View.prototype.setPreset = function (name) {
    var p = PRESETS[name] || PRESETS.threeQuarter;
    this.yaw = p.yaw * Math.PI / 180;
    this.pitch = p.pitch * Math.PI / 180;
    this.preset = name;
    this.pan = [0, 0, 0];
  };
  View.prototype.reset = function () {
    this.setPreset(this.preset || 'threeQuarter');
    this.dist = (this.span || 300) * 1.3;
  };

  // Camera basis for the current yaw/pitch.
  View.prototype._camera = function () {
    var cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    var dir = [sy * cp, -cy * cp, sp];                       // from target towards the camera
    var t = [this.center[0] + this.pan[0], this.center[1] + this.pan[1], this.center[2] + this.pan[2]];
    var cam = [t[0] + dir[0] * this.dist, t[1] + dir[1] * this.dist, t[2] + dir[2] * this.dist];
    var f = [-dir[0], -dir[1], -dir[2]];
    // right = f x up(0,0,1); near the poles use the yaw direction instead
    var r = [f[1], -f[0], 0];
    var rl = Math.hypot(r[0], r[1]);
    if (rl < 1e-4) { r = [cy, sy, 0]; rl = 1; }
    r = [r[0] / rl, r[1] / rl, 0];
    var u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    return { cam: cam, f: f, r: r, u: u, t: t };
  };

  View.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.dpr = dpr;
  };

  View.prototype.draw = function () {
    this.resize();
    var ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, dpr = this.dpr;
    // Theme colours, re-read twice a second rather than every frame.
    var nowT = performance.now();
    if (!this._css || nowT - this._cssAt > 500) {
      var cs = getComputedStyle(this.canvas), names = ['--view-bg', '--view-grid', '--view-unlit', '--view-label', '--view-highlight', '--font-ui'], vals = {};
      names.forEach(function (n) { vals[n] = cs.getPropertyValue(n).trim(); });
      this._css = { getPropertyValue: function (n) { return vals[n] || ''; } };
      this._cssAt = nowT;
    }
    var css = this._css;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = css.getPropertyValue('--view-bg').trim() || '#060b10';
    ctx.fillRect(0, 0, W, H);
    if (!this.boards.length) return;

    var c = this._camera();
    var focal = Math.min(W, H) * 1.25;
    var cx = W / 2, cy = H / 2 - (this.strips.length ? 18 * dpr : 0);
    function proj(x, y, z, out) {
      var dx = x - c.cam[0], dy = y - c.cam[1], dz = z - c.cam[2];
      var d = dx * c.f[0] + dy * c.f[1] + dz * c.f[2];
      if (d < 1) { out[2] = -1; return; }
      out[0] = cx + (dx * c.r[0] + dy * c.r[1] + dz * c.r[2]) / d * focal;
      out[1] = cy - (dx * c.u[0] + dy * c.u[1] + dz * c.u[2]) / d * focal;
      out[2] = d;
    }
    var tmp = [0, 0, 0];

    // Floor grid at the bottom of the box, one square per foot.
    var grid = css.getPropertyValue('--view-grid').trim() || 'rgba(140,170,200,0.08)';
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1 * dpr;
    var b = this.box, z0 = b.min[2], pad = 24;
    var x0 = Math.floor((b.min[0] - pad) / 12) * 12, x1 = Math.ceil((b.max[0] + pad) / 12) * 12;
    var y0 = Math.floor((b.min[1] - pad) / 12) * 12, y1 = Math.ceil((b.max[1] + pad) / 12) * 12;
    ctx.beginPath();
    var a = [0, 0, 0], e = [0, 0, 0];
    for (var gx = x0; gx <= x1; gx += 12) { proj(gx, y0, z0, a); proj(gx, y1, z0, e); if (a[2] > 0 && e[2] > 0) { ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); } }
    for (var gy = y0; gy <= y1; gy += 12) { proj(x0, gy, z0, a); proj(x1, gy, z0, e); if (a[2] > 0 && e[2] > 0) { ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); } }
    ctx.stroke();

    // LEDs: far ones first so near cores sit on top; glow is additive.
    var screen = this.screen = this.screen && this.screen.length === this.boards.length ? this.screen : this.boards.map(function (bd) { return new Float32Array(bd.n * 3); });
    var total = 0;
    for (var bt = 0; bt < this.boards.length; bt++) total += this.boards[bt].n;
    if (!this._depth || this._depth.length < total) { this._depth = new Float32Array(total); this._who = new Int32Array(total); }
    var depth = this._depth, who = this._who, count = 0;
    for (var bi = 0; bi < this.boards.length; bi++) {
      var bd = this.boards[bi], s = screen[bi];
      for (var i = 0; i < bd.n; i++) {
        if (bd.hidden[i]) { s[i * 3 + 2] = -1; continue; }
        proj(bd.pts[i * 3], bd.pts[i * 3 + 1], bd.pts[i * 3 + 2], tmp);
        s[i * 3] = tmp[0]; s[i * 3 + 1] = tmp[1]; s[i * 3 + 2] = tmp[2];
        if (tmp[2] > 0) { depth[count] = tmp[2]; who[count] = bi * 65536 + i; count++; }
      }
    }
    var keys = this._keys && this._keys.length >= count ? this._keys : (this._keys = new Uint32Array(total));
    for (var k = 0; k < count; k++) keys[k] = k;
    var order = keys.subarray(0, count);
    order.sort(function (p, q) { return depth[q] - depth[p]; });

    var base = 0.8 * focal * this.ledSize;   // an LED glows about 0.8" across
    var hl = this.highlight, hlColour = css.getPropertyValue('--view-highlight').trim() || '#ffd36b';
    var unlit = css.getPropertyValue('--view-unlit').trim() || 'rgba(170,190,210,0.16)';
    var br = this.brightness;
    for (var pass = 0; pass < 2; pass++) {
      ctx.globalCompositeOperation = pass === 0 ? 'lighter' : 'source-over';
      for (var kk = 0; kk < count; kk++) {
        var wv = who[order[kk]], bIdx = wv >> 16, li = wv & 65535;
        var bdd = this.boards[bIdx], sc = screen[bIdx];
        var d = sc[li * 3 + 2], px = sc[li * 3], py = sc[li * 3 + 1];
        if (px < -40 || py < -40 || px > W + 40 || py > H + 40) continue;
        var size = Math.max(0.9 * dpr, base / d);
        var r = bdd.colours[li * 3] * br, g = bdd.colours[li * 3 + 1] * br, bl = bdd.colours[li * 3 + 2] * br;
        var hm = hl && hl.masks ? hl.masks[bIdx] : null, picked = hm && hm[li];
        if (hm && !picked) { r *= 0.15; g *= 0.15; bl *= 0.15; }   // everything else dims
        var lit = Math.max(r, g, bl);
        if (pass === 1 && picked) {
          ctx.strokeStyle = hlColour;
          ctx.lineWidth = Math.max(1, size * 0.45);
          ctx.beginPath(); ctx.arc(px, py, Math.max(2.2 * dpr, size * 1.9), 0, 6.2832); ctx.stroke();
        }
        if (pass === 0) {
          if (lit < 0.02) continue;
          // soft glow, radius and strength follow brightness
          ctx.fillStyle = 'rgba(' + (r * 255 | 0) + ',' + (g * 255 | 0) + ',' + (bl * 255 | 0) + ',' + (0.10 + 0.22 * lit).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(px, py, size * 3.2, 0, 6.2832); ctx.fill();
        } else {
          if (this.showBoards) {
            ctx.strokeStyle = BOARD_COLOURS[bIdx % BOARD_COLOURS.length];
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = Math.max(1, size * 0.4);
            ctx.beginPath(); ctx.arc(px, py, size * 1.5, 0, 6.2832); ctx.stroke();
            ctx.globalAlpha = 1;
          }
          if (lit < 0.02) {
            if (!this.showUnlit) continue;
            ctx.fillStyle = unlit;
            ctx.beginPath(); ctx.arc(px, py, Math.max(0.6 * dpr, size * 0.55), 0, 6.2832); ctx.fill();
            continue;
          }
          // bright core: the LED's colour pushed towards white as it saturates, like a real diode
          var m = Math.max(lit, 1e-6), boost = 0.35 * lit;
          var cr = Math.min(1, r / m * lit + boost), cg = Math.min(1, g / m * lit + boost), cb = Math.min(1, bl / m * lit + boost);
          ctx.fillStyle = 'rgb(' + (cr * 255 | 0) + ',' + (cg * 255 | 0) + ',' + (cb * 255 | 0) + ')';
          ctx.beginPath(); ctx.arc(px, py, size, 0, 6.2832); ctx.fill();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // Highlighted planes and points
    if (hl) this._drawHighlight(proj, tmp, hlColour, css);

    // Hover ring
    if (this.hover) {
      var hs = screen[this.hover.board];
      if (hs && hs[this.hover.index * 3 + 2] > 0) {
        ctx.strokeStyle = css.getPropertyValue('--view-label').trim() || '#fff';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath(); ctx.arc(hs[this.hover.index * 3], hs[this.hover.index * 3 + 1], 7 * dpr, 0, 6.2832); ctx.stroke();
      }
    }

    // Orientation labels at the box edges
    var mid = this.center;
    var labels = [
      ['NOSE', mid[0], b.min[1] - 14, mid[2]],
      ['TAIL', mid[0], b.max[1] + 14, mid[2]],
      ['PORT', b.max[0] + 14, mid[1], b.min[2]],
      ['STARBOARD', b.min[0] - 14, mid[1], b.min[2]],
    ];
    ctx.font = (600) + ' ' + (10.5 * dpr) + 'px ' + (css.getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = css.getPropertyValue('--view-label').trim() || 'rgba(200,220,235,0.6)';
    for (var l = 0; l < labels.length; l++) {
      proj(labels[l][1], labels[l][2], labels[l][3], tmp);
      if (tmp[2] > 0) ctx.fillText(labels[l][0], Math.max(40 * dpr, Math.min(W - 40 * dpr, tmp[0])), Math.max(56 * dpr, Math.min(H - 20 * dpr, tmp[1])));
    }

    this._drawStrips(css);
  };

  View.prototype._drawHighlight = function (proj, tmp, colour, css) {
    var ctx = this.ctx, dpr = this.dpr, b = this.box, pad = 6;
    ctx.save();
    ctx.font = '600 ' + (11 * dpr) + 'px ' + (css.getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    (this.highlight.planes || []).forEach(function (pl) {
      var lo = [b.min[0] - pad, b.min[1] - pad, b.min[2]], hi = [b.max[0] + pad, b.max[1] + pad, b.max[2] + pad];
      var corners;
      if (pl.axis === 'x') corners = [[pl.v, lo[1], lo[2]], [pl.v, hi[1], lo[2]], [pl.v, hi[1], hi[2]], [pl.v, lo[1], hi[2]]];
      else if (pl.axis === 'y') corners = [[lo[0], pl.v, lo[2]], [hi[0], pl.v, lo[2]], [hi[0], pl.v, hi[2]], [lo[0], pl.v, hi[2]]];
      else corners = [[lo[0], lo[1], pl.v], [hi[0], lo[1], pl.v], [hi[0], hi[1], pl.v], [lo[0], hi[1], pl.v]];
      var pts = corners.map(function (c) { var o = [0, 0, 0]; proj(c[0], c[1], c[2], o); return o; });
      if (pts.some(function (q) { return q[2] <= 0; })) return;
      ctx.beginPath();
      pts.forEach(function (q, k) { if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.closePath();
      ctx.globalAlpha = 0.10; ctx.fillStyle = colour; ctx.fill();
      ctx.globalAlpha = 0.85; ctx.setLineDash([6 * dpr, 5 * dpr]); ctx.strokeStyle = colour; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = colour; ctx.fillText(pl.label, pts[3][0] + 6 * dpr, pts[3][1] - 8 * dpr);
    });
    (this.highlight.points || []).forEach(function (pt) {
      proj(pt.p[0], pt.p[1], pt.p[2], tmp);
      if (tmp[2] <= 0) return;
      var x = tmp[0], y = tmp[1], r = 9 * dpr;
      ctx.strokeStyle = colour; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r * 1.7, y); ctx.lineTo(x - r * 0.5, y); ctx.moveTo(x + r * 0.5, y); ctx.lineTo(x + r * 1.7, y);
      ctx.moveTo(x, y - r * 1.7); ctx.lineTo(x, y - r * 0.5); ctx.moveTo(x, y + r * 0.5); ctx.lineTo(x, y + r * 1.7); ctx.stroke();
      ctx.fillStyle = colour; ctx.fillText(pt.label, x + r * 1.9, y - r);
    });
    ctx.restore();
  };

  // Unmapped strands (the kaleidoscope, TEST) have no positions, so they're
  // drawn as flat strips along the bottom, in pixel order.
  View.prototype._drawStrips = function (css) {
    if (!this.strips.length) { this.stripBoxes = []; return; }
    var ctx = this.ctx, dpr = this.dpr, W = this.canvas.width, H = this.canvas.height;
    var rowH = 15 * dpr, labelW = 118 * dpr, x0 = 14 * dpr, right = W - 14 * dpr;
    var y = H - 12 * dpr - this.strips.length * rowH;
    ctx.font = (500) + ' ' + (10.5 * dpr) + 'px ' + (css.getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    var boxes = this.stripBoxes = [];
    var unlit = css.getPropertyValue('--view-unlit').trim() || 'rgba(170,190,210,0.16)';
    for (var s = 0; s < this.strips.length; s++) {
      var st = this.strips[s], bd = this.boards[st.board];
      if (!bd) continue;
      ctx.fillStyle = css.getPropertyValue('--view-label').trim() || 'rgba(200,220,235,0.6)';
      ctx.fillText(st.label, x0, y + rowH / 2);
      var w = Math.max(1, (right - x0 - labelW) / st.count);
      for (var i = 0; i < st.count; i++) {
        var li = st.start + i;
        var r = bd.colours[li * 3] * this.brightness, g = bd.colours[li * 3 + 1] * this.brightness, b = bd.colours[li * 3 + 2] * this.brightness;
        var hmask = this.highlight && this.highlight.masks ? this.highlight.masks[st.board] : null;
        if (hmask && !hmask[li]) { r *= 0.15; g *= 0.15; b *= 0.15; }
        ctx.fillStyle = Math.max(r, g, b) < 0.02 ? unlit : 'rgb(' + (r * 255 | 0) + ',' + (g * 255 | 0) + ',' + (b * 255 | 0) + ')';
        ctx.fillRect(x0 + labelW + i * w, y + 3 * dpr, Math.max(1, w - (w > 3 ? 1 : 0)), rowH - 6 * dpr);
      }
      var hm2 = this.highlight && this.highlight.masks ? this.highlight.masks[st.board] : null;
      if (hm2) {
        var any = false;
        for (var q = 0; q < st.count && !any; q++) any = !!hm2[st.start + q];
        if (any) {
          ctx.strokeStyle = css.getPropertyValue('--view-highlight').trim() || '#ffd36b';
          ctx.lineWidth = 1.5 * dpr;
          ctx.strokeRect(x0 + labelW - 2 * dpr, y + 1 * dpr, right - x0 - labelW + 4 * dpr, rowH - 2 * dpr);
        }
      }
      boxes.push({ strip: st, x: x0 + labelW, y: y, w: right - x0 - labelW, h: rowH, cell: w });
      y += rowH;
    }
  };

  // Nearest LED to a point on the canvas (CSS px), or null.
  View.prototype.pick = function (mx, my) {
    var dpr = this.dpr || 1, x = mx * dpr, y = my * dpr;
    var boxes = this.stripBoxes || [];
    for (var s = 0; s < boxes.length; s++) {
      var bx = boxes[s];
      if (x >= bx.x && x <= bx.x + bx.w && y >= bx.y && y <= bx.y + bx.h) {
        var i = Math.min(bx.strip.count - 1, Math.floor((x - bx.x) / bx.cell));
        return { board: bx.strip.board, index: bx.strip.start + i, strip: true };
      }
    }
    if (!this.screen) return null;
    var best = null, bestD = 10 * dpr * 10 * dpr, bestZ = Infinity;
    for (var b = 0; b < this.screen.length; b++) {
      var sc = this.screen[b];
      for (var i2 = 0; i2 < sc.length / 3; i2++) {
        var z = sc[i2 * 3 + 2];
        if (z <= 0) continue;
        var dx = sc[i2 * 3] - x, dy = sc[i2 * 3 + 1] - y, d2 = dx * dx + dy * dy;
        if (d2 < bestD - 4 || (d2 <= bestD + 4 && z < bestZ)) { bestD = d2; bestZ = z; best = { board: b, index: i2 }; }
      }
    }
    return best;
  };

  View.prototype._bind = function () {
    var v = this, cv = this.canvas, drag = null;
    cv.addEventListener('pointerdown', function (e) {
      cv.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 || e.button === 1 };
    });
    cv.addEventListener('pointermove', function (e) {
      if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (drag.pan) {
          var c = v._camera(), k = v.dist / (Math.min(cv.clientWidth, cv.clientHeight) * 1.25);
          for (var a = 0; a < 3; a++) v.pan[a] += (-dx * c.r[a] + dy * c.u[a]) * k;
        } else {
          v.yaw -= dx * 0.008;   // drag right turns the whale to the right, as if holding it
          v.pitch = Math.max(-1.2, Math.min(1.55, v.pitch + dy * 0.008));
        }
        v.preset = null;
        if (v.opts.onChange) v.opts.onChange();
      } else if (v.opts.onHover) {
        var r = cv.getBoundingClientRect();
        v.opts.onHover(v.pick(e.clientX - r.left, e.clientY - r.top), e.clientX - r.left, e.clientY - r.top);
      }
    });
    function end(e) { drag = null; try { cv.releasePointerCapture(e.pointerId); } catch (x) {} }
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', function () { if (!drag && v.opts.onHover) v.opts.onHover(null); });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var k = e.ctrlKey ? 0.02 : 0.0015;     // pinch arrives as ctrl+wheel
      v.dist = Math.max(v.span * 0.25, Math.min(v.span * 6, v.dist * Math.exp(e.deltaY * k)));
      if (v.opts.onChange) v.opts.onChange();
    }, { passive: false });
    cv.addEventListener('dblclick', function () { v.preset = v.preset || 'threeQuarter'; v.reset(); if (v.opts.onChange) v.opts.onChange(); });
  };

  return { View: View, PRESETS: PRESETS, BOARD_COLOURS: BOARD_COLOURS };
})();
