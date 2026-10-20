# Ready-to-paste patterns

Every `.js` file here is a complete Pixelblaze pattern. To run one:

1. Open the file and copy **all** of it.
2. In the Pixelblaze web page of the **leader (board A)**, create a new pattern, paste, and save.
3. Sync runs it on all six boards.

Start with `examples/00-map-check.js` and `examples/00b-wiring-check.js` to check the truck.

To see a pattern before you're at the truck, open `simulator.html` in the repo root (see `docs/SIMULATOR.md`). It runs these same files, and the `src/` sources, on the real LED map.

These files are **generated** from `src/` by `npm run build`. Don't edit them here; edit the matching `src/…/*.effect.js` and rebuild. After any change to the template or the maps, re-paste the patterns you use: each saved pattern carries its own copy of the wiring.
