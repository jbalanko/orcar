#!/usr/bin/env python3
"""mapgen.py -- generate the six per-board Pixelblaze 3D maps from the DXF.

    python3 tools/mapgen.py                 generate + check; write maps/ only if all checks pass
    python3 tools/mapgen.py --dry-run       generate + check, write nothing
    python3 tools/mapgen.py --compare       also report how far each strand moved vs the current maps
    python3 tools/mapgen.py --fix-template  also update MAP_MIN_*/MAP_MAX_* in the template to the new ghost box

Inputs (nothing else):
  * the DXF named in maps/mapgen.json   -- strand GEOMETRY (one named group per strand)
  * src/template/orcar_3d_mapped.js          -- COUNTS, WIRING ORDER and DIRECTIONS (via tools/wiring.mjs)
  * maps/mapgen.json                     -- name mapping, placeholder, ghost-box policy, tolerances

Outputs:
  * maps/pixelblaze_A.json .. _F.json    -- one [x, y, z] (inches) per pixel, in pixel order, ghosts last
  * maps/boards.json                     -- pixel count per board (from the template)
  * maps/MAPGEN_REPORT.md                -- what was generated, every warning, strand-by-strand table

The same inputs always give byte-identical outputs. Requires: pip install ezdxf; node 18+.
See docs/MAP_GENERATION.md.
"""
import argparse
import hashlib
import json
import math
import pathlib
import re
import subprocess
import sys
from collections import Counter, defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
MID_X = 79.824          # symmetry plane (template MID_X), inches

try:
    import ezdxf
except ImportError:
    sys.exit("mapgen needs ezdxf:  pip install ezdxf   (add --break-system-packages on some Linux setups)")

# ---------------------------------------------------------------------------
# Default direction per feature (must match the template header, "Default
# directions"). Each rule decides which END of the drawn path is pixel 0 when
# reversed == 0. Closed loops (rings) start at their lowest point and head
# toward starboard (low X) first, i.e. clockwise as seen from the nose.
# ---------------------------------------------------------------------------
def kind(name):
    if re.fullmatch(r"R\d+", name): return "rib"
    if re.fullmatch(r"S\d+[ABC]", name): return "spine"
    return {"DORSAL": "dorsal", "LEFT_PECTORAL": "pectoral", "RIGHT_PECTORAL": "pectoral",
            "FLUKE": "fluke"}.get(name, "other")

def start_first(name, a, b):
    """True if endpoint a should be pixel 0 (default direction)."""
    k = kind(name)
    if k in ("rib", "fluke"):            # CW from the front: starboard (low X) end first
        return (a[0], a[1]) <= (b[0], b[1])
    return (a[1], a[0]) <= (b[1], b[0])  # spines, dorsal, pectorals: front (low Y) end first

# ---------------------------------------------------------------------------
def load_cfg():
    return json.loads((ROOT / "maps/mapgen.json").read_text())

def load_wiring():
    out = subprocess.run(["node", str(ROOT / "tools/wiring.mjs")], capture_output=True, text=True)
    if out.returncode:
        sys.exit("could not read the template wiring:\n" + out.stderr)
    return json.loads(out.stdout)

def read_dxf(cfg, report):
    path = ROOT / cfg["dxf"]
    doc = ezdxf.readfile(path)
    strands, extra = {}, []
    for ins in doc.modelspace().query("INSERT"):
        label = ""
        for a in ins.attribs:
            if a.dxf.tag == cfg["name_attribute"]:
                label = a.dxf.text.strip()
        if label in cfg.get("box_extra", []):          # not a strand, but must be inside the ghost box
            for v in ins.virtual_entities():
                if v.dxftype() == "LINE": extra += [tuple(v.dxf.start), tuple(v.dxf.end)]
                elif hasattr(v, "flattening"): extra += [tuple(p) for p in v.flattening(0.05)]
            continue
        if label in cfg["ignore"]:
            continue
        name = cfg["names"].get(label, label)
        segs, layers, other = [], Counter(), Counter()
        for v in ins.virtual_entities():          # world coordinates, block transforms applied
            if v.dxftype() == "LINE":
                segs.append((tuple(v.dxf.start), tuple(v.dxf.end)))
                layers[v.dxf.layer] += 1
            else:
                other[v.dxftype()] += 1
        if other:
            report.warn(f"`{label}`: ignored non-LINE entities {dict(other)}")
        if not segs:
            report.warn(f"`{label}`: no LINE geometry, skipped")
            continue
        if name in strands:
            report.error(f"two DXF groups map to `{name}` (second is `{label}`)")
            continue
        layer = max((l for l in layers if l != "0"), key=lambda l: layers[l], default="0")
        strands[name] = {"label": label, "segs": segs, "layer": layer}
    sha = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
    return strands, extra, sha

# ---------------------------------------------------------------------------
# Segments -> one ordered path
# ---------------------------------------------------------------------------
def chain(name, segs, tol, report):
    q = lambda p: (round(p[0], 3), round(p[1], 3), round(p[2], 3))
    adj = defaultdict(list)
    pts = {}
    for i, (a, b) in enumerate(segs):
        ka, kb = q(a), q(b)
        pts[ka], pts[kb] = a, b
        adj[ka].append((i, kb)); adj[kb].append((i, ka))
    # bridge small gaps between dangling ends
    ends = [k for k, v in adj.items() if len(v) == 1]
    used = set()
    for i, e in enumerate(ends):
        if e in used: continue
        best = None
        for f in ends[i + 1:]:
            if f in used: continue
            d = math.dist(e, f)
            if d <= tol and (best is None or d < best[0]): best = (d, f)
        if best:
            d, f = best
            idx = len(segs); segs = segs + [(pts[e], pts[f])]
            adj[e].append((idx, f)); adj[f].append((idx, e)); used |= {e, f}
            report.warn(f"`{name}`: bridged a {d:.3f}\" gap in the drawn path")
    if any(len(v) > 2 for v in adj.values()):
        report.error(f"`{name}`: the drawn path branches -- each strand must be one unbranched line")
        return None, False
    ends = [k for k, v in adj.items() if len(v) == 1]
    closed = not ends
    if not closed and len(ends) != 2:
        report.error(f"`{name}`: path has {len(ends) // 2} separate pieces (gaps larger than {tol}\")")
        return None, False
    start = min(adj, key=lambda k: (k[2], k[0], k[1])) if closed else ends[0]
    order, seen, cur, prev_seg = [start], set(), start, None
    while True:
        nxt = [(i, k) for i, k in adj[cur] if i not in seen]
        if not nxt: break
        if closed and cur == start and len(nxt) == 2:     # ring: leave the lowest point toward starboard
            nxt.sort(key=lambda t: pts[t[1]][0])
        i, k = nxt[0]
        seen.add(i); order.append(k); cur = k
        if closed and k == start: break
    if len(seen) != len(segs):
        report.error(f"`{name}`: not all segments are connected ({len(seen)}/{len(segs)})")
        return None, closed
    path = [pts[k] for k in order]
    if not closed and not start_first(name, path[0], path[-1]):
        path.reverse()
    return path, closed

def resample(path, n):
    """n points evenly spaced along the path, both ends included (closed: last point != first)."""
    cum = [0.0]
    for a, b in zip(path, path[1:]): cum.append(cum[-1] + math.dist(a, b))
    L = cum[-1]
    if n == 1: targets = [L / 2]
    else: targets = [L * k / (n - 1) for k in range(n)]
    out, j = [], 0
    for t in targets:
        while j < len(cum) - 2 and cum[j + 1] < t: j += 1
        seg = cum[j + 1] - cum[j]
        w = 0 if seg == 0 else (t - cum[j]) / seg
        a, b = path[j], path[j + 1]
        out.append([a[i] + (b[i] - a[i]) * w for i in range(3)])
    return out, L

# ---------------------------------------------------------------------------
class Report:
    def __init__(self): self.errors, self.warnings, self.info, self.rows = [], [], [], []
    def error(self, m): self.errors.append(m)
    def warn(self, m): self.warnings.append(m)

def mean(v): return sum(v) / len(v)

def convention_checks(gen, wiring, report):
    """Geometric sanity checks that catch mislabelled or mis-wired strands."""
    side = lambda name: mean([p[0] for p in gen[name]]) - MID_X     # + = port
    for name in gen:
        k = kind(name)
        m = re.fullmatch(r"S(\d+)([ABC])", name)
        if m:
            n = int(m.group(1)); s = side(name)
            want = "starboard" if n < 6 else "port" if n > 6 else "centre"
            got = "centre" if abs(s) < 2 else ("port" if s > 0 else "starboard")
            if want != got:
                report.error(f"`{name}` lies on the {got} side; spines S1..S11 run starboard -> port, so it should be {want}. "
                             f"Check the DXF label (and the swaps in maps/mapgen.json).")
        if name == "LEFT_PECTORAL" and side(name) < 0: report.error("LEFT_PECTORAL lies on starboard; it should be port")
        if name == "RIGHT_PECTORAL" and side(name) > 0: report.error("RIGHT_PECTORAL lies on port; it should be starboard")
        if k == "rib":
            p = gen[name]
            if p[0][0] > p[-1][0] + 1 and wiring_rev(wiring, name) == 0:
                report.warn(f"`{name}` pixel 0 is not at the starboard end -- check its direction")
    ribs = sorted((int(n[1:]), mean([p[1] for p in gen[n]])) for n in gen if kind(n) == "rib")
    for (a, ya), (b, yb) in zip(ribs, ribs[1:]):
        if yb <= ya: report.error(f"R{b} (Y {yb:.1f}) is not aft of R{a} (Y {ya:.1f}); ribs must run nose -> tail")

def wiring_rev(wiring, name):
    for b in wiring["boards"]:
        for f in b["features"]:
            if f["name"] == name: return f["reversed"]
    return 0

# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--compare", action="store_true")
    ap.add_argument("--fix-template", action="store_true")
    ap.add_argument("--check", action="store_true", help="fail if the committed maps differ from what the DXF + template produce (for CI)")
    args = ap.parse_args()

    cfg = load_cfg()
    wiring = load_wiring()
    report = Report()
    strands, extra_pts, dxf_sha = read_dxf(cfg, report)
    dec = cfg["decimals"]
    rnd = lambda p: [round(v + 0.0, dec) + 0.0 for v in p]

    # 1. every strand with a count gets points
    gen, lengths, closed_flags = {}, {}, {}
    feature_board = {f["name"]: b["id"] for b in wiring["boards"] for f in b["features"]}
    for b in wiring["boards"]:
        for f in b["features"]:
            name, n = f["name"], f["count"]
            if name in cfg["placeholder_features"]:
                continue
            s = strands.get(name)
            if n == 0:
                continue
            if s is None:
                report.error(f"`{name}` has {n} pixels in the template but no geometry in the DXF")
                continue
            path, closed = chain(name, list(s["segs"]), cfg["gap_tolerance"], report)
            if path is None: continue
            pts, L = resample(path, n)
            if f["reversed"]: pts.reverse()
            gen[name], lengths[name], closed_flags[name] = pts, L, closed
            if s["layer"] != b["id"]:
                report.warn(f"`{name}` is on DXF layer {s['layer']} but wired to board {b['id']} in the template")
    for name, s in strands.items():
        if name not in feature_board:
            report.warn(f"DXF group `{s['label']}` (as `{name}`) matches no template feature -- add it to `names` or `ignore`")

    convention_checks(gen, wiring, report)

    # 2. ghost box
    gb = cfg["ghost_box"]
    if gb == "mapped":
        allp = [p for v in gen.values() for p in v]
    elif gb == "all":
        allp, src = [], []
        for name, s in strands.items():
            if name in feature_board:
                for a, b in s["segs"]: allp += [list(a), list(b)]; src += [name, name]
        allp += [list(p) for p in extra_pts]; src += ["(box_extra)"] * len(extra_pts)
        for i, ax in enumerate("XYZ"):
            lo_i = min(range(len(allp)), key=lambda k: allp[k][i]); hi_i = max(range(len(allp)), key=lambda k: allp[k][i])
            report.info.append(f"ghost box {ax} {allp[lo_i][i]:.3f} .. {allp[hi_i][i]:.3f}  set by `{src[lo_i]}` .. `{src[hi_i]}`")
    else:
        allp = [gb[0], gb[1]]
    lo = rnd([min(p[i] for p in allp) for i in range(3)])
    hi = rnd([max(p[i] for p in allp) for i in range(3)])
    ph = cfg["placeholder"]
    if not all(lo[i] <= ph[i] <= hi[i] for i in range(3)):
        report.error(f"placeholder {ph} lies outside the ghost box {lo}..{hi}")

    # 3. assemble boards
    maps, boards_json = {}, []
    for b in wiring["boards"]:
        out = []
        for f in b["features"]:
            if f["count"] == 0: continue
            if f["name"] in cfg["placeholder_features"]:
                out += [list(ph) for _ in range(f["count"])]
            elif f["name"] in gen:
                out += [rnd(p) for p in gen[f["name"]]]
            else:
                out += [list(ph) for _ in range(f["count"])]      # already reported as an error
        if len(out) != b["total"]:
            report.error(f"board {b['id']}: {len(out)} map entries for {b['total']} pixels")
        maps[b["id"]] = out + [lo, hi]
        boards_json.append({"id": b["id"], "node": b["node"], "pixels": b["total"], "map": f"pixelblaze_{b['id']}.json"})

    # 4. template ghost-box constants
    box = wiring["box"]
    tbox = [[box["MAP_MIN_X"], box["MAP_MIN_Y"], box["MAP_MIN_Z"]], [box["MAP_MAX_X"], box["MAP_MAX_Y"], box["MAP_MAX_Z"]]]
    box_ok = all(abs(tbox[0][i] - lo[i]) < 1e-6 and abs(tbox[1][i] - hi[i]) < 1e-6 for i in range(3))
    if not box_ok:
        if args.fix_template and not args.dry_run:
            t = ROOT / "src/template/orcar_3d_mapped.js"; s = t.read_text()
            for k, v in zip(["MAP_MIN_X", "MAP_MIN_Y", "MAP_MIN_Z", "MAP_MAX_X", "MAP_MAX_Y", "MAP_MAX_Z"], lo + hi):
                s = re.sub(rf"(var {k}\s*=\s*)[-0-9.]+;", rf"\g<1>{v:g};", s)
            t.write_text(s)
            report.warn(f"template ghost box updated to {lo} .. {hi} -- rebuild and re-paste every pattern")
        else:
            report.error(f"the template's ghost box {tbox[0]}..{tbox[1]} differs from the generated one {lo}..{hi}. "
                         f"Run with --fix-template (then rebuild and re-paste every pattern), or set ghost_box in maps/mapgen.json.")

    # 5. strand table + pitch warnings
    rows = []
    for b in wiring["boards"]:
        for f in b["features"]:
            n, name = f["count"], f["name"]
            if name in gen:
                L = lengths[name]; pitch = L / (n if closed_flags[name] else max(1, n - 1))
                flag = ""
                if abs(pitch - cfg["pitch_nominal"]) > cfg["pitch_warn_fraction"] * cfg["pitch_nominal"]:
                    flag = "check count"
                    report.warn(f"`{name}`: {n} pixels over {L:.1f}\" = {pitch:.2f}\" pitch (expected ~{cfg['pitch_nominal']}\") -- check its count")
                p0 = gen[name][0]
                rows.append((b["id"], f["channel"], name, n, f"{L:.1f}", f"{pitch:.2f}", "ring" if closed_flags[name] else "line",
                             f"({p0[0]:.1f}, {p0[1]:.1f}, {p0[2]:.1f})", flag))
            elif n and name in cfg["placeholder_features"]:
                rows.append((b["id"], f["channel"], name, n, "-", "-", "placeholder", "-", ""))
            elif n == 0:
                rows.append((b["id"], f["channel"], name, 0, f"{strands_len(strands, name):.1f}" if name in strands else "-", "-",
                             "not counted" if name in strands else "no geometry", "-", ""))

    # 6. compare with current maps
    compare = []
    if args.compare:
        for bid, m in maps.items():
            p = ROOT / f"maps/pixelblaze_{bid}.json"
            if not p.exists(): continue
            old = json.loads(p.read_text())
            if len(old) != len(m):
                compare.append(f"board {bid}: {len(old)} -> {len(m)} entries"); continue
            off = 0
            for b in wiring["boards"]:
                if b["id"] != bid: continue
                for f in b["features"]:
                    n = f["count"]
                    if not n: continue
                    d = max(math.dist(old[off + i], m[off + i]) for i in range(n))
                    if d > 0.01: compare.append(f"board {bid} `{f['name']}`: moved up to {d:.2f}\"")
                    off += n
            d = max(math.dist(old[-2 + i], m[-2 + i]) for i in range(2))
            if d > 0.001: compare.append(f"board {bid} ghost box moved up to {d:.3f}\"")
        if not compare: compare = ["no differences (all within 0.01\")"]

    # 7. write
    status = "FAILED" if report.errors else "OK"
    md = [f"# Map generation report\n", f"- Status: **{status}**",
          f"- DXF: `{cfg['dxf']}` (sha256 {dxf_sha})",
          f"- Ghost box ({gb}): {lo} .. {hi}",
          f"- Placeholder point: {ph}", ""]
    if report.errors: md += ["## Errors", *[f"- {e}" for e in report.errors], ""]
    if report.warnings: md += ["## Warnings", *[f"- {w}" for w in report.warnings], ""]
    if report.info: md += ["## Info", *[f"- {i}" for i in report.info], ""]
    md += ["## Strands", "", "| Board | Ch | Feature | Pixels | Drawn length (in) | Pitch (in) | Kind | Pixel 0 at | |",
           "|---|---|---|---|---|---|---|---|---|"]
    md += [f"| {' | '.join(str(c) for c in r)} |" for r in rows]
    text = "\n".join(md) + "\n"          # saved report: depends only on the inputs
    print(text)
    if compare: print("## Changes vs the previous maps\n" + "\n".join(f"- {c}" for c in compare) + "\n")
    files = {f"maps/pixelblaze_{bid}.json": json.dumps(m, separators=(",", ":")) + "\n" for bid, m in maps.items()}
    files["maps/MAPGEN_REPORT.md"] = text
    files["maps/boards.json"] = json.dumps({"_comment": "GENERATED by tools/mapgen.py from the template -- don't edit. Pixel count per controller and its map.",
                                            "fit": "contain", "boards": boards_json}, indent=2) + "\n"
    if args.check:
        stale = [f for f, c in files.items() if not (ROOT / f).exists() or (ROOT / f).read_text() != c]
        if report.errors or stale:
            print("STALE: " + ", ".join(stale) if stale else "errors above")
            print("Run `python3 tools/mapgen.py` and commit the results."); return 1
        print("maps are up to date"); return 0
    if args.dry_run:
        print("(dry run: nothing written)"); return 1 if report.errors else 0
    if report.errors:
        print("NOT writing maps: fix the errors above."); return 1
    for f, c in files.items(): (ROOT / f).write_text(c)
    print("wrote maps/pixelblaze_A..F.json, maps/boards.json, maps/MAPGEN_REPORT.md")
    return 0

def strands_len(strands, name):
    return sum(math.dist(a, b) for a, b in strands[name]["segs"])

if __name__ == "__main__":
    sys.exit(main())
