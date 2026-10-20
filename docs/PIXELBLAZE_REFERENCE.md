# Pixelblaze language reference (condensed, for writing Orcar patterns)

**Firmware this was checked against:** v3.51 (Pixelblaze 3, read from a Pixelblaze 3's own Edit and Mapper pages, 2026-10-18). Cross-checked with [simap/pixelblaze `README.expressions.md`](https://github.com/simap/pixelblaze/blob/master/README.expressions.md) and the ElectroMage forum. If the firmware is updated, re-check the "Functions" section against the device's Edit page.

This is a lookup sheet. For the Orcar-specific rules (coordinates, features, sync, show safety), read `docs/ORCAR_CONTRACT.md` first. That file wins wherever the two seem to disagree.

---

## 1. Program shape

A pattern is one source file. Code at the top level runs **once** when the pattern loads. Pixelblaze then calls these exported functions over and over:

| Function | When | Use for |
|---|---|---|
| `export function beforeRender(delta)` | Once per frame, before the pixels | Anything that's the same for every pixel: timers, sensor processing, picking events. `delta` = milliseconds since the previous frame (fractional). |
| `export function render3D(index, x, y, z)` | Once per pixel per frame, when a 3D map is installed | The colour of pixel `index`. `x, y, z` are normalized "world units" (see §6). |
| `export function render2D(index, x, y)` | Same, 2D map | (Not used on the Orcar.) |
| `export function render(index)` | Same, no map | Fallback. If several exist, the best match for the installed map is used automatically. |

Each render call sets the pixel's colour by calling `hsv()`, `rgb()` or `paint()`. Make sure every code path sets a colour. Use `hsv(0, 0, 0)` for off.

`pixelCount` is a global available even during load: the number of pixels configured on **this** controller.

## 2. Numbers: 16.16 fixed point (the biggest difference from JavaScript)

Every number is a 32-bit **16.16 fixed-point** value, not a float.

- Range is about **−32,768 to +32,767.99998**. There's no error for going outside it; the result is simply wrong (typically wrapped).
- Resolution is **1/65,536 ≈ 0.0000153**. Smaller values become 0.
- Products overflow easily: `index * index` overflows once `index > 181`, and `200 * 200` (inches squared) overflows. Work in normalized units, divide before multiplying, or use `hypot()` / `hypot3()`.
- `var t = 0; t += delta` (milliseconds) **overflows after about 33 seconds**. Use `time()` for clocks, or wrap with `mod()`.
- Bitwise operators (`& | ^ << >>`) act on all 32 bits, including the 16 fraction bits. This differs from JavaScript. The exception is `~`, which zeroes the lower 16 bits. To use a number as integer flags, keep it a whole number.
- Like every number, `random()` and `time()` results can't be finer than 1/65,536.

## 3. Language: what works

- Operators: `= + - * / % ! > < >= <= == != && || ?: >> << | & ^ ~`. `+=` and `++` aren't in the official list, but the Orcar template uses them on the device, so they work.
- `&&` and `||` return the operand value, like JavaScript: `v = 0 || 42` gives 42.
- `var` (global at the top level, local inside a function). **Assigning without `var` creates a global**, even inside a function.
- `if / else`, `for`, `while`, `break`, `continue`, `return`.
- Functions: `function f(a) { return a * 2 }` or `f = (a) => a * 2`. Functions can be stored in variables and arrays, passed and returned.
- Arrays: `array(n)` (n ≥ 1) or literals `[1, 2, 3]`, indexed with `a[i]`, nested arrays allowed, read-only `a.length`.
- `export var name` makes a global visible in the Var Watcher and the websocket API.

## 4. Language: what does NOT work (an AI will often try these)

| Don't write | Write instead |
|---|---|
| Strings `"..."`, `'...'`, template literals | Numbers. Name things with constants (`var MODE_CHASE = 1`). |
| Objects `{a: 1}`, classes, `new` | Arrays plus index constants: `var F_COUNT = 0; f[F_COUNT]` |
| `let`, `const` | `var` |
| `switch / case` | `else if` chains, or an array of functions: `modes[mode]()` |
| Closures (an inner function reading the outer function's locals) | Pass values as parameters, or use globals |
| `Math.sin`, `Math.PI`, `Math.random` | The bare built-ins: `sin`, `PI`, `random` |
| `console.log` | `export var debugValue` and read it in the Var Watcher. For one pixel: `if (index == 42) debugValue = v` |
| `push`, `pop`, `splice`, `slice`, `map`, `filter`, `indexOf`, `concat` | Fixed-size arrays allocated at load. Use `mutate`, `mapTo`, `forEach`, `reduce`, `sum`, `sort`, `sortBy`, `replace`. |
| `try / catch`, `typeof`, `?.`, `??`, spread `...` | Not supported. Write defensive arithmetic instead. |
| Allocating arrays in `beforeRender` / `render3D` | Allocate once at the top level. **Arrays are never freed**: per-frame allocation leaks until the pattern crashes. |
| `array(0)` | Illegal (found by the Orcar team). Use size 1, or a sentinel. |

`===` and `!==` aren't listed in the docs, so use `==` and `!=`.

## 5. Built-in functions

### Math

`abs(v)` · `floor(v)` · `ceil(v)` · `round(v)` · `trunc(v)` · `frac(v)` (keeps the sign: `frac(-5.5) == -0.5`) · `min(a, b)` · `max(a, b)` · `clamp(v, lo, hi)` · `mod(x, y)` (floored, takes the sign of `y`: `mod(-3.5, 3) == 2.5`; compare `-3.5 % 3 == -0.5`) · `sqrt(v)` · `pow(base, exp)` · `exp(x)` · `log(v)` · `log2(v)` · `sin(rad)` · `cos(rad)` · `tan(rad)` · `asin(x)` · `acos(x)` · `atan(x)` · `atan2(y, x)` · `hypot(x, y)` · `hypot3(x, y, z)`

Constants: `PI`, `PI2` (2π), `PI3_4` (3π/4), `PISQ` (π²), `E`, `LN2`, `LN10`, `LOG2E`, `LOG10E`, `SQRT1_2`, `SQRT2`.

### Random

- `random(max)`: true random number in 0..max (exclusive). **It differs on every board and every call.**
- `prngSeed(seed)` / `prng(max)`: repeatable pseudo-random sequence. The same seed gives the same sequence. `prngSeed` returns the old seed. This is the tool for random decisions that must agree across boards (contract §5).

### Waveforms and time (all inputs "wrap" in 0..1)

- `time(interval)`: a sawtooth from 0 to 1 that loops every **65.536 × interval seconds**. So `time(seconds / 65.536)` loops every `seconds`: about 0.0153 for 1 s, 0.153 for 10 s, 0.916 for 60 s. **It is synchronized across a sync group**, which makes it the backbone of every multi-board effect. Its output has 16-bit resolution, so a very long loop moves in coarse steps (with `time(10)` a 655 s loop, each step is about 10 ms).
- `wave(v)`: sine shaped, 0..1 (`(1 + sin(v·2π)) / 2`, but faster).
- `triangle(v)`: 0 → 1 → 0.
- `square(v, duty)`: 1 while `v < duty`, otherwise 0.
- `mix(lo, hi, w)`: linear interpolation.
- `smoothstep(lo, hi, v)`: eased 0..1 as `v` crosses lo..hi (needs `hi >= lo`).
- `bezierQuadratic(t, p0, p1, p2)` and `bezierCubic(t, p0, p1, p2, p3)`: 1D Bézier curves.

### Noise (3D Perlin)

- `perlin(x, y, z, seed)`: smooth noise. Each integer step is a new random "cell". The range is roughly −1..1 (check yours in the Var Watcher before relying on the exact range).
- `perlinFbm(x, y, z, lacunarity, gain, octaves)`, `perlinRidge(x, y, z, lacunarity, gain, offset, octaves)`, `perlinTurbulence(x, y, z, lacunarity, gain, octaves)`: fractal variants. Try gain 0.5–0.8; use lacunarity 2 if wrapping. More octaves cost more, roughly one `perlin()` each.
- `setPerlinWrap(x, y, z)`: repeat every N cells (2..256, integers). Use it to make noise loop seamlessly with a wrapping `time()`.

### Colour (call once per pixel)

- `hsv(h, s, v)`: hue wraps (negative wraps backwards); s and v are 0..1. On supported LEDs this uses 24-bit colour plus 5 bits of extra brightness, which gives smoother dim levels.
- `hsv24(h, s, v)`: 24-bit only. Try it if dim pixels flicker.
- `rgb(r, g, b)`: each 0..1.
- `setPalette([pos, r, g, b,  pos, r, g, b, ...])`: a gradient with positions 0..1. Call it at load or in `beforeRender`.
- `paint(v, brightness = 1)`: a colour from the palette at position `v`. `v` wraps, so `paint(1)` equals `paint(0)`. Use `v * 0.999` to reach the top colour.

### Coordinate transforms (affect the x, y, z passed to the *next* frame's render)

`resetTransform()` · `translate3D(x, y, z)` · `scale3D(x, y, z)` (bigger = denser, so features look smaller) · `rotateX(rad)` · `rotateY(rad)` · `rotateZ(rad)` · `transform(m11, m21, m31, m41, m12, ... m44)` (an arbitrary 4×4 matrix) · 2D: `translate`, `scale`, `rotate`. Up to 31 transforms. Call them in `beforeRender` (after `resetTransform()`) or at load. On the Orcar, prefer explicit maths on x/y/z: the template's landmarks and constants are in **untransformed** coordinates.

### Pixel map

`pixelMapDimensions()` (0, 2 or 3) · `has2DMap()` · `has3DMap()` · `mapPixels(fn)`, which calls `fn(index, x, y, z)` for every pixel with the current transform applied. Use it at load to build per-pixel tables from coordinates.

### Arrays (function form or method form)

`array(n)` · `a.length` / `arrayLength(a)` · `a.forEach(fn)` · `a.mutate(fn)` (in place; `fn(value, index, array)`) · `src.mapTo(dest, fn)` · `a.reduce(fn, init)` (`fn(acc, value, index, array)`) · `a.sum()` · `a.sort()` · `a.sortBy(fn)` (`fn(a, b)` returns < 0 if a comes first) · `a.replace(v0, v1, ...)` · `arrayReplaceAt(a, offset, ...)`.

### Sync group, clock, I/O

- `nodeId()`: this controller's Node ID from Settings. On the Orcar, A = 0 … F = 5.
- `clockYear()`, `clockMonth()`, `clockDay()`, `clockHour()` (0–23), `clockMinute()`, `clockSecond()`, `clockWeekday()` (Sunday = 1). These only work with internet time sync, which you shouldn't count on in the desert.
- `analogRead(pin)` (0..1), `digitalRead(pin)`, `digitalWrite(pin, state)`, `pinMode(pin, mode)` with `INPUT`, `INPUT_PULLUP`, `INPUT_PULLDOWN`, `OUTPUT`, `OUTPUT_OPEN_DRAIN`, `ANALOG`, and `touchRead(pin)`. The Orcar doesn't use these in effects; don't drive pins from a pattern without the electronics lead's OK.

## 6. Pixel maps and world units

`render3D` receives coordinates in **world units**. The Mapper scales the JSON map (here, inches) into a 0..1 world.

- **Fill** stretches every axis to 0..1.
- **Contain** (used on the Orcar) keeps the proportions. The longest axis spans 0..1, and the shorter axes are scaled by the same factor and **centred** in 0..1. This was verified from the v3.51 Mapper source: `e = (v − min) / range; e = e·n + (1 − n)/2` with `n = range / longestRange`. So on the Orcar, x and z don't start at 0. Always use the template's `X_LO … Z_HI`, `nX()`, `nY()`, `nZ()` and `nLen()`.
- Map values are stored at 16-bit precision.
- **`render3D()` is not called for pixels beyond the end of the map** (observed on the Orcar, v3.51). They keep whatever colour they last had, and look "frozen". Every pixel needs a map entry, even unmapped strands; give them placeholder coordinates.
- Every controller stores its **own** map. Pattern code is shared through sync; maps aren't.

## 7. UI controls (exported functions with a magic prefix)

The control shows up when the pattern runs. Saved values persist and are re-sent when the pattern loads, before rendering. **In a sync group, control values replicate from the leader to the followers** (exported variables do not).

| Export | Gets | Notes |
|---|---|---|
| `sliderName(v)` | 0..1 | Store `v` in a global with a sensible default. |
| `hsvPickerName(h, s, v)` | each 0..1 | |
| `rgbPickerName(r, g, b)` | each 0..1 | |
| `toggleName(on)` | 1 or 0 | |
| `triggerName()` | none | A button. Not called at load. |
| `inputNumberName(v)` | any number | |
| `showNumberName()` | returns a number | Display only, polled often. |
| `gaugeName()` | returns 0..1 | Display only, polled often. |

The name after the prefix is shown in the UI (CamelCase or snake_case). Keep `showNumber`/`gauge` functions cheap; they're polled frequently.

## 8. Sensor expansion board

Declare these with `export var`, **with a default**, and the firmware keeps them up to date. The default is what you get when no sensor board is connected:

```js
export var frequencyData = array(32)
export var energyAverage = 0
```

| Variable | Contents |
|---|---|
| `frequencyData` | 32-element array of frequency magnitudes, about 37 Hz (index 0) to 10 kHz (index 31). The raw values are small and depend on volume, so use automatic gain. |
| `energyAverage` | Overall audio volume. |
| `maxFrequency`, `maxFrequencyMagnitude` | The strongest tone (about 39 Hz resolution) and its strength. |
| `accelerometer` | [x, y, z], ±16 g. |
| `light` | Ambient light level. |
| `analogInputs` | 5 values, A0–A4, 0..1. |

**`frequencyData` buckets** (approximate Hz, from the open-source [sensor board firmware](https://github.com/simap/pixelblaze_sensor_board/blob/master/src/output.c)). Buckets 0–5 come from a low-rate FFT with 12.5 Hz resolution (the firmware comment says "12.5–162.5 Hz", but bucket 0 actually starts at FFT bin 3, about 37.5 Hz); buckets 6–31 come from a 20 kHz FFT with 39 Hz resolution, grouped so they get wider toward the top. This is **not linear**: kick drums sit in buckets **1–3**, vocals around 10–20, cymbals 25 and up.

`0: 38 · 1: 50 · 2: 62–75 · 3: 88–100 · 4: 112–125 · 5: 138–162 · 6: 195 · 7: 234 · 8: 273–312 · 9: 352–391 · 10: 430–469 · 11: 508–586 · 12: 625–703 · 13: 742–859 · 14: 898–977 · 15: 1016–1172 · 16: 1211–1367 · 17: 1406–1562 · 18: 1602–1797 · 19: 1836–2070 · 20: 2109–2383 · 21: 2422–2734 · 22: 2773–3125 · 23: 3164–3594 · 24: 3633–4102 · 25: 4141–4648 · 26: 4688–5312 · 27: 5352–6016 · 28: 6055–6836 · 29: 6875–7773 · 30: 7812–8789 · 31: 8828–9961`

In a sync group the leader broadcasts its sensor data over the network (UDP, best effort, no retries). Each follower chooses per sensor whether to use the **remote** (leader's) data or its own local board (Settings → Expansion Data Source).

## 9. Debugging

- Can't find a board? `python3 tools/pbfind.py` (in the Orcar repository) lists every Pixelblaze on the local network by address, in about a second. See "Finding the boards on the network" in the README.

- The Var Watcher shows exported variables and arrays, sampled at the end of each frame.
- Look for compile errors in the editor's status area. Compilation happens as you type, and a valid program is sent to the device immediately (on a leader the sync release notes say live edits reach the whole group, which means **the whole truck**, so edit carefully during a show).
- The FPS readout in the top bar is the performance truth. Check it on the controller with the most pixels.
- Away from the truck, `simulator.html` (repo root, `docs/SIMULATOR.md`) runs a pattern on all six boards' maps in a browser, with line-numbered errors, and can feed the sensor variables from a synthetic beat, a music file or the microphone. It uses floating point, not 16.16 fixed point, and can't measure the device's frame rate.
