#!/usr/bin/env python3
"""Package the Orcar skills as self-contained ZIPs for claude.ai.

    python3 tools/package_skill.py   ->  build/skills/orcar-effects.zip, build/skills/orcar-maps.zip

Upload each in claude.ai: Settings > Capabilities > Skills > Upload skill.
(Claude Code doesn't need this: it loads .claude/skills/ straight from the repo.)
Each ZIP mirrors the repo layout, so the paths in SKILL.md work in both places.
"""
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKILLS = {
    "orcar-effects": ["docs/ORCAR_CONTRACT.md", "docs/PIXELBLAZE_REFERENCE.md", "src/template/*.js",
                      "src/examples/*.effect.js", "tools/*.mjs", "tools/*.py", "sim/**/*", "simulator.html",
                      "docs/SIMULATOR.md", "docs/PUBLIC_UI.md", "maps/*.json"],
    "orcar-maps": ["docs/MAP_GENERATION.md", "docs/ORCAR_CONTRACT.md", "src/template/*.js", "model/*",
                   "maps/*", "src/examples/00-map-check.effect.js", "src/examples/00b-wiring-check.effect.js",
                   "tools/*.mjs", "tools/*.py", "sim/engine.js", "package.json"],
}
for name, patterns in SKILLS.items():
    out = ROOT / "build" / "skills" / f"{name}.zip"
    out.parent.mkdir(parents=True, exist_ok=True)
    files = [(ROOT / ".claude/skills" / name / "SKILL.md", "SKILL.md")]
    seen = set()
    for pattern in patterns:
        for p in sorted(ROOT.glob(pattern)):
            rel = str(p.relative_to(ROOT))
            if p.is_file() and rel not in seen:
                seen.add(rel); files.append((p, rel))
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for src, arc in files:
            z.write(src, f"{name}/{arc}")
    print(f"wrote {out.relative_to(ROOT)} ({len(files)} files)")
