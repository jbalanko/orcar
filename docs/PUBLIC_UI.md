# Public control page

The public control page lets anyone, kids included, play with the Orcar from a touch screen: a big **Splash!** button, colour wheels, sliders, switches. It shows only the controls of the pattern that's running, never the Pixelblaze's own settings, editor or pattern list. There's also an admin **test page** for checking the connection and poking at the Pixelblaze directly.

Both are single HTML files that live on **board A** (the sync leader) and are served by the Pixelblaze itself. There's nothing else to install or run: no server, no app, no internet.

Status: tested on a spare Pixelblaze 3 (firmware v3.51) and on the truck on 19 Oct 2026. The truck test found that repeated trigger presses reached only board A; the page now sends a new value with every press (see [Triggers and sync](#triggers-and-sync)), which still needs confirming on the truck.

## Quick start

| I want to… | Do this |
|---|---|
| **Put the page on the Orcar** | From the repo root, on the Orcar Wi-Fi: `curl -F "data=@web/play.html;filename=/play.html" http://<board-A>/edit` ([Uploading](#uploading-updating-and-removing-the-pages)) |
| **Open it** | `http://<board-A>/play.html` in any browser on the Orcar Wi-Fi |
| **Set up the iPad** | Open the page, then **Share → Add to Home Screen**; optionally lock it with Guided Access ([Setting up the iPad](#setting-up-the-ipad)) |
| **Try the demo** | Save `patterns/effects/orca-playground.js` on board A and run it: it uses every control type |
| **Make an effect work well on the page** | Follow [Writing effects for the page](#writing-effects-for-the-page) (and contract §12) |
| **Change the page** | Edit `web/play.html`, run `npm run web:check`, test on the spare board ([Maintaining the pages](#maintaining-the-pages)) |
| **Remove it** | `http://<board-A>/delete?path=/play.html` |

`<board-A>` is board A's address, for example `192.168.1.42`. `python3 tools/pbfind.py` finds it (README, "Finding the boards on the network").

## Files

| File | Served as | What |
|---|---|---|
| `web/play.html` | `/play.html` | The public control page. |
| `web/test.html` | `/test.html` | Admin test page: connection checks, pattern list, raw controls and variables, a message log. |
| `src/effects/orca-playground.effect.js` | (a pattern) | Demo effect that uses all eight control types. Built to `patterns/effects/orca-playground.js`. |
| `tools/web-check.mjs` | | Checks both pages and how every effect will look on the page (`npm run web:check`, part of `npm run ci`). |

The `web/` files are not built or generated: what's in the repo is exactly what gets uploaded.

## How it works

```
iPad / phone / laptop  (on the Orcar Wi-Fi)
   │  HTTP, port 80:       GET /play.html          (the page itself, from board A's flash)
   │  WebSocket, port 81:  control messages         (the same API the Pixelblaze's own UI uses)
   ▼
Board A (sync leader) ── sync ──▶ boards B–F
```

- **The page talks only to board A.** Sync does the rest: the leader's pattern switches and **control values** (sliders, toggles, pickers) are copied to all six boards. Exported variables are *not* copied (contract §5), which is why public knobs must be UI controls (contract §12).
- **It reads the running pattern's controls from the pattern's own source**: every `export function slider…`, `hsvPicker…` and so on, in the order they're written. So any pattern's controls appear automatically, with no setup per pattern.
- **It never saves anything.** Every change it sends is live-only: nothing is written to the Pixelblaze's flash, so heavy public use can't wear it out, and after a reboot each pattern comes back with its saved values. To change what a pattern starts with, set its controls in the Pixelblaze's own UI, which saves them.
- **It follows the running pattern.** When the pattern changes (from the Pixelblaze UI, the playlist or the test page), the page switches to the new pattern's controls within a second or two.
- **It works offline.** Everything is in the one file. Fonts are the device's own; there are no external scripts, stylesheets or images.

## Uploading, updating and removing the pages

The Pixelblaze has a small file API on its web port (80). Upload with `curl` from the repo root, on the Orcar Wi-Fi.

**Back up board A first** (once): Pixelblaze UI → Settings → Backup. Uploading can't touch patterns or settings, but the backup costs nothing.

**Upload or update** (an upload replaces any file with the same name):

```sh
curl -F "data=@web/play.html;filename=/play.html" http://<board-A>/edit
curl -F "data=@web/test.html;filename=/test.html" http://<board-A>/edit    # only if you want the test page there
```

After updating, reload the page on each device: pull down to refresh, or tap the faint **↻** in the bottom-right corner. A home-screen web app can hold on to the old copy; if it does, close it from the app switcher and open it again.

**List every file on the board** (name and size, one per line):

```
http://<board-A>/list
```

**Delete a file** (open it in a browser, or use `curl`):

```
http://<board-A>/delete?path=/play.html
http://<board-A>/delete?path=/test.html
```

Only delete files you uploaded. Everything else on the board belongs to the Pixelblaze: `index.html.gz` (its own UI), `config.json` and `config2.json`, `pixelmap.dat` and `pixelmap.txt`, `obconf.dat`, `/p/…` (patterns and their saved control values) and `/l/…` (playlists).

Things to know:

- **Always use a file extension.** The Pixelblaze picks the content type from the name, so a file called `/play` (no extension) downloads instead of opening. `/play/index.html` opens as `/play/`, but only with the trailing slash, which is why the page is `/play.html`.
- **Board A only.** The page connects back to whichever board served it, and only the leader's changes reach the other five. A copy on a follower would control that one board.
- **Space:** the page is about 30 KB of the board's pattern storage (Settings shows how much is free).
- **Firmware updates:** a firmware update should leave uploaded files alone, but check `/list` afterwards. The page also relies on parts of the Pixelblaze's websocket API that aren't officially documented, so re-test it after any firmware update (see [Testing a change](#testing-a-change)).
- **Without `curl`:** any tool that can send a multipart form works. The form field is `data`, and the file's name in the form is the path to save it under.

## Setting up the iPad

1. Join the Orcar Wi-Fi and open `http://<board-A>/play.html` in Safari.
2. **Share → Add to Home Screen.** It opens full screen from an icon labelled "Orcar", with no address bar.
3. **Reserve board A's address in the router** (DHCP reservation), so the icon keeps working. Its hostname starts with `ESP_` or `Espressif`.
4. **Keep it awake:** Settings → Display & Brightness → Auto-Lock → Never (while it's on power).
5. **Optional: lock it to the page with Guided Access.** Settings → Accessibility → Guided Access → on, and set a passcode. Open the page, triple-click the side (or top) button and tap Start. Triple-click and enter the passcode to leave.

The Pixelblaze has no login: anyone who joins the Orcar Wi-Fi can open the full Pixelblaze UI. Keep the Wi-Fi password to the crew, and let the public use only the iPad.

Needs iPadOS/iOS 15 or later, or any current desktop browser. The page also works on phones.

## What the page shows

| Pattern control | On the page |
|---|---|
| `trigger…` | A big round button. Presses are limited to one per second. |
| `hsvPicker…`, `rgbPicker…` | A colour picker in one of two styles (see below), with the current colour as a swatch by the title. |
| `slider…` | A wide slider you can tap or drag anywhere on, with a percentage. |
| `toggle…` | An on/off switch. |
| `inputNumber…` | − and + buttons around the number, limited to the pattern's range hint (or 0–99). |
| `showNumber…` | A big number (live; see [Readouts](#readouts-shownumber-and-gauge)). |
| `gauge…` | A bar (live). |

Labels come from the control's name: `sliderWaveSpeed` shows as "Wave Speed", `toggleRainbowWaves` as "Rainbow Waves". Underscores become spaces.

**Colour pickers.** Two styles are being compared, set by `COLOUR_STYLE` at the top of the page's script:

- `'wheel'`: a colour wheel (hue around the ring, white at the centre) and a brightness slider. The outer rim snaps to the full colour.
- `'shade'`: a row of preset colours, a hue slider and a shade slider (black → full colour → white). The shade knob snaps to the full colour at the tick in the middle.
- `'compare'` (current): the first colour control on a pattern gets the wheel, the second the shade style, and so on.

Both send the pattern the same values: `[h, s, v]` for `hsvPicker`, `[r, g, b]` for `rgbPicker`.

**Other things on the page:**

- **↻** (faint, bottom right): reloads the page. For the crew; most people won't notice it.
- **"Connecting to the Orcar…"**: shown when the connection drops. It reconnects by itself every 2 seconds.
- **"This light show plays all by itself"**: the running pattern has no controls.
- **"The whale is resting right now"**: no saved pattern is running, for example unsaved code in the Pixelblaze editor (it has no pattern ID, so the page can't read its controls). Save it and the controls appear.
- **Opened from a file instead of from the board**: the page asks which Pixelblaze to connect to. `play.html?host=<address>` also works.

## Writing effects for the page

The contract's §12 has the rules; this is the how-to. `src/effects/orca-playground.effect.js` is a worked example of all of it.

- **Every public knob is a UI control** (`slider…`, `toggle…`, `hsvPicker…`, `rgbPicker…`, `inputNumber…`, `trigger…`), never an exported variable. Only control values reach all six boards.
- **Order:** controls appear in the order their `export function`s appear in the source. Put the most fun one first.
- **Names are labels.** Pick names a kid understands: `sliderWaveSpeed`, not `sliderWspd`.
- **Hide crew-only controls** by ending the name with `_Admin`: `toggleStrobe_FastFlash_Admin` shows in the Pixelblaze UI but never on the public page. Any strobe toggle on a pattern the public can use must be hidden this way (contract §8 and §12).
- **Number ranges:** put `// range a..b` on the same line as the `export function inputNumber…`:
  ```js
  export function inputNumberWaveCount(v) { waveCount = clamp(round(v), 1, 8); }  // range 1..8
  ```
  The page keeps the number inside it. Clamp in the pattern too: the Pixelblaze UI doesn't read the hint.
- **Starting values:** the page shows each control at the pattern's **saved** value. A pattern that has never had a control changed in the Pixelblaze UI has no saved values, so the page starts sliders in the middle while the pattern runs its own defaults. After installing a pattern for the public, open it in the Pixelblaze UI and set each control once (the UI saves them).
- **Every control at both extremes must still be safe and still look good** (contract §8): fastest speed, all sparkle, darkest colour, white. The public will find the extremes.
- **Triggers:** the page allows one press per second, but enforce your own gap in the pattern too (the demo ignores presses within 1 s). The handler takes no arguments and should ignore any value: the page sends a different number with every press so that sync passes each press on to boards B–F (see [Triggers and sync](#triggers-and-sync)).
- **Keep it to about nine controls or fewer.** More gets crowded on an iPad.

### Readouts (showNumber and gauge)

The Pixelblaze UI calls `showNumber…`/`gauge…` functions itself. The public page can't do that, so **mirror each readout in an exported variable named after it**, with the first letter in lower case:

```js
export var splashes = 0;                                  // mirrors showNumberSplashes()
export function showNumberSplashes() { return splashes; }
export var splashPower = 0;                               // mirrors gaugeSplashPower()
export function gaugeSplashPower() { return splashPower; }
```

The page reads these variables twice a second while the pattern has readouts. Gauges should be 0–1. Readouts come from board A only (exported variables aren't synced), which is fine for counters and levels board A computes like every other board. `npm run web:check` warns about a readout without its variable.

Readouts are mostly useful for testing control types; on the truck, the whale itself is the feedback.

## The test page

`/test.html` is for the crew. It shows, top to bottom:

- **Checks** that tick as each step works: page served, WebSocket connected, settings and pattern list received, a pattern switched, controls read, a control changed.
- **Connection:** board name, firmware, pixel count, live FPS, the active pattern.
- **Brightness** and **Patterns** (tap to switch). Neither is saved, so a reboot undoes them.
- **Controls of the active pattern**, as plain sliders, toggles and pickers.
- **Manual commands:** send `setControls` or `setVars` by name, watch the exported variables (refreshed four times a second), re-read the controls or the pattern list.
- **Log:** every message sent (→) and received (←).

Use it to find a control's exact name, see what the Pixelblaze returns, or check a board before blaming the public page. It can switch patterns and change brightness, so don't leave it open on the public iPad. It isn't linked from the public page; delete it from the board if you'd rather it weren't reachable at all.

## Maintaining the pages

### The rules

- **One self-contained file each.** No build step, no external scripts, stylesheets, fonts or images: the Orcar has no internet, and one file is one upload. `npm run web:check` fails if a page loads anything from the network.
- **Plain `ws://` and `http://`.** The Pixelblaze has no HTTPS, and browsers block `ws://` from an `https://` page. Don't host the page anywhere served over HTTPS.
- **Never save to flash.** Don't send `"save": true`, and don't call anything that persists (pattern switches, controls, brightness): the public would wear out the flash, and the crew expects a reboot to restore the saved show.
- **Keep the pure helpers pure.** Code between `/* web-check:pure:start */` and `/* web-check:pure:end */` in `play.html` (the settings, colour maths, source decoder and control discovery) must not touch the page or the network: `tools/web-check.mjs` runs it in Node.
- **Keep the traffic light.** Board A is also the sync leader and has the sensor board. The page throttles drags to about 16 messages a second, turns off the live preview stream, and polls only `getControls` (every 1.5 s, or 0.5 s with readouts) and `getVars` (with readouts).

### Settings

At the top of the script in `play.html`:

| Setting | Default | What |
|---|---|---|
| `TRIGGER_MAX` | `30000` | Trigger presses send a counter that wraps at this value (it must stay inside 16.16 fixed point), starting at a random value. See [Triggers and sync](#triggers-and-sync). |
| `TRIGGER_COOLDOWN` | `1000` | ms before the trigger button works again. |
| `SEND_MS` | `60` | Throttle for drags (~16 sends a second). |
| `POLL_MS` | `500` | Refresh interval when the pattern has readouts. |
| `SYNC_MS` | `1500` | Refresh interval otherwise (picks up changes saved in the Pixelblaze UI). |
| `TOUCH_HOLD` | `4000` | ms after someone touches a control before outside changes can move it. |
| `HIDE_SUFFIX` | `'_Admin'` | Controls whose name ends with this are hidden. |
| `COLOUR_STYLE` | `'compare'` | `'wheel'`, `'shade'` or `'compare'` (see [What the page shows](#what-the-page-shows)). |
| `PALETTE` | 9 colours | Preset swatches in the shade style. |

### The messages it uses

All on the WebSocket at `ws://<board-A>:81`, JSON unless noted. The official reference covers only some of these; the rest come from watching the Pixelblaze UI (the pixelblaze-client project documents them).

| Sent | When | Answer |
|---|---|---|
| `{"sendUpdates":false,"getConfig":true}` | On connecting | Settings, then `{"activeProgram":{...}}` (which pattern is running), then an expander-config binary frame (ignored) |
| `{"getControls":"<id>"}` | When the pattern changes, then every 0.5–1.5 s | `{"controls":{"<id>":{name: value, ...}}}`: the pattern's **saved** control values |
| `{"getSources":"<id>"}` | When the pattern changes (again after 3 s if needed) | Binary frames of type 6: LZ-String-compressed JSON `{"main": "<source>"}` |
| `{"getVars":true}` | Twice a second, only with readouts | `{"vars":{...}}`: board A's exported variables |
| `{"setControls":{name: value}}` | When someone uses a control. For a trigger, the value is a counter that changes with every press. | Nothing needed. Not saved. |

The Pixelblaze also sends `{"activeProgram":...}` by itself whenever the sequencer changes the pattern, and a stats message (`{"fps":...}`) every second, which the page ignores. Binary frames are `[type, flags, data…]`; flags 1/2/4 mean first/middle/last, and the page joins them until it sees "last".

### Triggers and sync

A trigger has no value of its own, but sync copies a control to boards B–F only when its value changes. So each press from the page sends a **different** number: a counter that starts at a random value (so a reloaded page doesn't repeat the last one) and wraps at `TRIGGER_MAX`. The pattern's `trigger…()` handler ignores the value. Board A gets every press directly; the changing value is what makes sync pass each one on.

### Behaviours worth knowing

- **Sync copies a control only when its value changes.** Board A runs a trigger's handler on every `setControls`, but boards B–F only get a control whose value differs from the last one sent. With the same value every time (`{"triggerSplash":1}`), only the first press reached all six boards; after that the splash showed on board A alone, until some other control changed. Seen on the truck, 19 Oct 2026.

- **`getControls` returns saved values, not live ones.** The page never saves, so its own changes never show up there. That's what makes live updates safe: the page moves a control only when its saved value **changes** between polls (someone saved a change in the Pixelblaze UI), and never within `TOUCH_HOLD` of someone touching it here.
- **After a reload the page shows saved values,** even if the LEDs are still running values someone set on the page earlier. The next touch on a control sends that control's position; the others stay as shown.
- **Slow sources:** the source of an Orcar pattern is big (it includes the whole template), and right after a save the board is busy. The page asks again after 3 s; after 8 s it shows the controls that have saved values; when the full source arrives, it replaces that list.

### Testing a change

1. `npm run web:check` (syntax, offline, decoder, control discovery). It's also part of `npm run ci`.
2. Open `web/play.html` from disk with `?host=<spare-board>`, for example `file:///…/web/play.html?host=192.168.1.50`, with a pattern that has controls running on the **spare** Pixelblaze (not one of the truck's six).
3. Check: every control type moves the LEDs; the trigger fires once per second at most; switching patterns in the Pixelblaze UI changes the page; a change saved in the Pixelblaze UI appears on the page within ~2 s; pulling the board's power shows "Connecting…" and it recovers; it looks right on an iPad and a phone.
4. Upload to the spare and try it served from the board (`/play.html`), then on board A.

## Troubleshooting

| Problem | Fix |
|---|---|
| The page downloads instead of opening | The file has no extension. Upload it as `/play.html` and delete the other copy (`/delete?path=/play`). |
| "Connecting to the Orcar…" doesn't go away | The device isn't on the Orcar Wi-Fi, board A is off, or its address changed (`python3 tools/pbfind.py`). |
| No controls, "The whale is resting" | The running code isn't saved. Save the pattern in the Pixelblaze UI. |
| Only some controls appear | The board was slow to send the pattern's source; wait a few seconds or tap ↻. If it keeps happening, open the test page and check the pattern's controls there. |
| A control is missing | Its name ends with `_Admin` (hidden on purpose), or it isn't an `export function` with one of the eight prefixes. |
| A number or gauge shows "–" or doesn't move | The pattern doesn't export the matching variable (see [Readouts](#readouts-shownumber-and-gauge)). |
| Changes on the page affect only part of the whale | The page is served from a follower, not board A. For triggers: the page on board A is an old copy that sends the same value every press (upload the current `web/play.html`); see [Triggers and sync](#triggers-and-sync). |
| The page shows an old version | Reload; for a home-screen icon, close it in the app switcher and reopen. |

## Not yet verified

- **Triggers with a new value each press:** on the truck (19 Oct 2026) sliders, toggles, pickers and numbers reached all six boards every time, but a trigger sent with the same value reached boards B–F only on the first press. The page now sends a counter that changes with every press. Confirm with `orca-playground`: press Splash several times, a second or more apart; the whole whale should ripple every time.
- **The Pixelblaze UI's own trigger buttons:** it isn't known what value they send, so they may have the same first-press-only behaviour. Press Splash in the Pixelblaze UI several times and watch boards B–F.
- **How many devices can connect at once:** the Pixelblaze's limit on WebSocket connections isn't documented. Try the iPad, a phone and the Pixelblaze UI together.
- **Which colour picker:** `COLOUR_STYLE = 'compare'` shows both styles (wheel and shade) so they can be tried with real users; set it to the winner afterwards.
