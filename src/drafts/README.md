# Drafts

The simulator keeps your work in progress here: new effects, copies and anything the chat sends, one `<name>.effect.js` file each. Everything in this folder except this README is ignored by git, so drafts never get committed by accident and aren't touched when you pull.

- Open, rename, delete or **Save to repo** a draft from the simulator (`simulator.html`). Save to repo moves it to `src/effects/`, where it's built, checked and shared like any other effect.
- Drafts are ordinary effect files: any editor or AI assistant can work on them, and the simulator reloads one when its file changes.
- `npm run build` and CI ignore this folder. To check a draft by hand: `node tools/build.mjs src/drafts/<name>.effect.js && node tools/pbcheck.mjs src/drafts/<name>.js`.

Only Chrome and Edge can write files here. In Safari and Firefox the simulator keeps drafts in the browser instead.
