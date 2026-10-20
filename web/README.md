# Web pages served from the Orcar

| File | Upload as | What |
|---|---|---|
| `play.html` | `/play.html` | The public control page: big touch controls for the pattern running on board A. |
| `test.html` | `/test.html` | Admin test page: connection checks, pattern list, raw controls and variables, message log. |

These files go onto **board A** exactly as they are (no build). From the repo root, on the Orcar Wi-Fi:

```sh
curl -F "data=@web/play.html;filename=/play.html" http://<board-A>/edit   # upload or update
```

Then, in a browser on the same Wi-Fi:

| Address | Does |
|---|---|
| `http://<board-A>/play.html` | Opens the page |
| `http://<board-A>/list` | Lists every file on the board |
| `http://<board-A>/delete?path=/play.html` | Removes the page (only ever delete files you uploaded) |

`python3 tools/pbfind.py` finds board A's address. Everything else (iPad setup, writing effects for the page, how it works, maintaining it, troubleshooting) is in [`docs/PUBLIC_UI.md`](../docs/PUBLIC_UI.md).

After changing a page, run `npm run web:check`.
