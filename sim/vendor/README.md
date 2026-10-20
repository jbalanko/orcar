# Third-party code for the simulator

Copied unchanged from npm so the simulator works offline and from disk, with nothing to install. Each folder keeps its licence (all MIT).

| Folder | Package | Files | Used for |
|---|---|---|---|
| `codemirror-5.65.20/` | [codemirror@5.65.20](https://codemirror.net/5/) | from the package's `lib/codemirror.js`, `lib/codemirror.css`, `mode/javascript/javascript.js`, `addon/edit/matchbrackets.js`, `addon/edit/closebrackets.js`, `addon/comment/comment.js`, `addon/selection/active-line.js`, `addon/hint/show-hint.js`, `addon/hint/show-hint.css` (copied into one folder) | the code editor and its suggestions |
| `marked-18.0.14/` | [marked@18.0.14](https://marked.js.org/) | from the package's `lib/marked.umd.js` | showing the docs (Markdown) in the Docs tab |
| `acorn-8.15.0/` | [acorn@8.15.0](https://github.com/acornjs/acorn) | from the package's `dist/acorn.js` | finding the line of a syntax error |

CodeMirror 5 rather than 6 because version 5 ships plain scripts that a page opened from disk can load; version 6 needs a bundler.

To update: `npm pack codemirror@5.x.y acorn@8.x.y marked@x.y.z`, copy the same files into new versioned folders, and change the `<script>` paths in `simulator.html`.
