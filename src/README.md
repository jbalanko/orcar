# Sources

Edit these, then run `npm run build` to produce the paste-ready files in `patterns/`.

| Folder | What |
|---|---|
| `examples/` | Annotated example effects (`*.effect.js`). Copy one to start a new effect. |
| `effects/` | The team's effects. New effects go here as `<name>.effect.js`. |
| `drafts/` | Work in progress from the simulator (New, copies, effects the chat sent). Ignored by git and by the build; **Save to repo** in the simulator moves a draft to `effects/`. See `drafts/README.md`. |
| `template/` | The feature map shared by every pattern: strand names, counts, wiring, groups, tags and landmarks. Change it only for wiring or count changes (see `docs/MAP_GENERATION.md`). |

An `.effect.js` file holds **only the effect section** (your variables, `beforeRender()` and `render3D()`). It won't run on a Pixelblaze by itself, because it relies on names the template defines. The build glues template and effect together.

To watch an effect while you edit it, open `simulator.html` in the repo root and pick the effect. It adds the template itself, so you don't need to build first (`docs/SIMULATOR.md`).

Rules for writing effects: `docs/ORCAR_CONTRACT.md`.
