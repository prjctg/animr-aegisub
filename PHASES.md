# animr-aegisub — Sub-phase Breakdown

Each sub-phase adds one layer of capability, introduces a more complex Lua karaskel script,
and extends the unit test suite. Each phase builds on the previous one; nothing is rewritten.

---

## Sub-phase Summary

| SP | What it adds | Lua script complexity | New tests |
|----|--------------|-----------------------|-----------|
| **SP1** ✅ | Fengari VM · aegisub mock (no text_extents) · karaskel stub (timing only) · ASS `\pos \fad \alpha \c` · JIT scheduler · G events | `\pos(x,y)` + `\fad` — syls appear/fade at proportional positions | ass-parser · karaskel-stub · scheduler |
| **SP2** | `aegisub.text_extents` mock via getBBox · full syl layout (left/center/right/width/height) · ASS `\move()` · `\an N` | `\pos($scenter,$smiddle)` from real metrics + `\move()` drift | karaskel-layout · ass-parser (\move, \an) |
| **SP3** | ASS `\t()` piecewise keyframes · `\fscx/y` · `\frz` · `\blur` · `\bord` | Multi-layer per syl: scale bounce + glow duplicate layer | ass-parser (\t algorithm) · transform composition |
| **SP4** | Multi-element DOM (N layers per syl via syl-stack) · `\clip()` · Canvas overlay for particle layers | Clip sweep + particle burst (N ∝ `syl.width × line.height`) | multi-layer scheduling · particle count scaling |
| **SP5** | KT substrate: `code once` · `$variable` substitution · `!expression!` Fengari eval · `loop N + j` · `retime()` | Full KT script (Lollipop-style) with color arrays + looped particles | $var substitution · retime mapping · loop expansion |
| **SP6** | `\p1` ASS drawing → Canvas `Path2D` · `\1c–\4c` color channels · `\shad N` · `\be N` · `\iclip()` · Pause/Resume (`G.TYPE.PAUSE/PLAY`) | Lollipop candy shapes with drawing commands + multi-color glow | ass-drawing · ass-parser (SP6 tags) · scheduler-pause |

---

## SP1 — Core Pipeline (this branch)

**Goal:** Prove the end-to-end pipeline: Lua script → Fengari → ASS output → Web Animations API.

**Lua script (examples/minimal.js):**
```lua
for si, syl in ipairs(line.kara) do
  if syl.text_stripped ~= "" then
    local t0 = line.start_time + syl.start_time
    local t1 = line.start_time + syl.end_time
    subs.append({
      layer = 0,
      start_time = t0 - 300,
      end_time   = t1 + 300,
      style  = "Default",
      text   = string.format("{\\pos(%d,%d)\\fad(300,300)}%s",
                 syl.center, line.middle, syl.text_stripped)
    })
  end
end
```

**Key constraints for SP1:**
- `syl.center` uses equal-width approximation (SP2 replaces with real getBBox)
- ASS parser handles only: `\pos`, `\fad`, `\alpha`, `\c`
- One DOM element per syl (no multi-layer DOM model yet)
- Fengari runs synchronously (pure-JS Lua interpreter, no WASM)

**Files created:**
- `src/fengari.js` — VM init, runScript, collectResults
- `src/karaskel-stub.js` — buildLineTable (timing + equal-width centers)
- `src/ass-parser.js` — parseAssDialogue (SP1 tags only)
- `src/layout.js` — buildStageHtml, createLayerEl, computeSlotYs
- `src/scheduler.js` — compileAndSchedule, cancelLine, cancelAll
- `src/events.js` — G event wiring (INIT/LINE/SEEK/UNINIT/RESIZE)
- `src/index.js` — karaskel() + createKaraskel() public API
- `examples/minimal.js`
- `test/ass-parser.test.js`
- `test/karaskel-stub.test.js`
- `test/scheduler.test.js`

---

## SP2 — Real Text Metrics

**Goal:** Replace equal-width approximation with actual getBBox() measurements, enabling scripts
that use `$scenter`, `$smiddle`, `syl.width`, `syl.height` accurately.

**Changes from SP1:**
- `layout.js`: add `measureLineEls(els, lineId)` — runs getBBox after rAF, returns metrics Map
- `karaskel-stub.js`: add `patchMetrics(lineTable, metricsMap)` — replaces center/width/height
- `events.js`: LINE handler creates DOM elements → rAF → getBBox → patch → runScript
- `ass-parser.js`: add `\move(x1,y1,x2,y2,t1,t2)` → translate keyframes; `\an N` → anchor

**New Lua example (examples/metrics.js):**
```lua
for si, syl in ipairs(line.kara) do
  if syl.text_stripped ~= "" then
    local t0 = line.start_time + syl.start_time
    local t1 = line.start_time + syl.end_time
    -- drift upward after syllable
    subs.append({
      layer = 0, start_time = t0 - 100, end_time = t1 + 600,
      text = string.format(
        "{\\an5\\pos(%d,%d)\\fad(100,300)\\move(%d,%d,%d,%d,0,%d)}%s",
        syl.center, line.middle,
        syl.center, line.middle,
        syl.center, line.middle - 20,
        t1 - t0 + 600,
        syl.text_stripped)
    })
  end
end
```

---

## SP3 — Transform Animations

**Goal:** Support `\t()` piecewise keyframes and the full transform set, enabling scale bounce
and glow effects that require multiple properties changing over time.

**Changes from SP2:**
- `ass-parser.js`: add `\t(t1,t2,\propN)` → keyframe collection algorithm (feasibility §11)
- `ass-parser.js`: add `\fscx/y`, `\frz`, `\frx/y`, `\blur`, `\bord`
- `scheduler.js`: composite transform (scale + rotate in same keyframe)

**New Lua example (examples/bounce-glow.js):** scale bounce + glow duplicate layer per syl.

---

## SP4 — Multi-layer DOM + Particles

**Goal:** Support N elements per syl (layers 0..N), enabling clip sweeps and particle bursts
that produce many simultaneous animations per syllable.

**Changes from SP3:**
- `layout.js`: add `createSylStack(n, opts)` — `<div class="syl-stack">` with N children
- `ass-parser.js`: add `\clip(x1,y1,x2,y2)` → `clip-path: inset(...)`
- `scheduler.js`: handle `layer > 0` → multiple animations per logical syl position
- For layers with N > 50: use Canvas 2D overlay instead of DOM elements

**New Lua example (examples/clip-particles.js):** clip sweep + particle burst.

---

## SP5 — KT Substrate

**Goal:** Support Karaoke Templater scripts (the majority of elaborate community effects).
A minimal KT engine processes `code once` blocks, substitutes `$variables`, evaluates
`!expressions!`, and expands `loop N` templates.

**Changes from SP4:**
- `kt-substrate.js` (new): parse KT script structure → extract `code once` blocks,
  `template syl loop N` blocks; substitute `$vars`; eval `!expr!` via Fengari; expand loops
- `ass-parser.js`: add `retime(mode, s, e)` → LayerSpec.offsetMs / duration mapping
- `karaskel-stub.js`: expose full `$variable` set ($scenter, $smiddle, $swidth, etc.)

**New Lua example (examples/kt-lollipop.js):** Lollipop-style KT script with color tables + looped particles.

---

---

## SP6 — ASS Drawing Commands + Extended Tags + Pause/Resume

**Goal:** Complete the ASS tag surface for real-world KFX effects. Enable `\p1` vector shapes
(lollipop candy, particle outlines), full multi-color channels, and pause/resume handling.

**Changes from SP5:**
- `src/ass-drawing.js` (new): ASS drawing command parser → Canvas `Path2D`.
  Commands: `m n l b s p c`. Scale: `1/2^(N-1)` for `\pN`.
- `src/ass-parser.js`: add `\p N`, `\iclip(x1,y1,x2,y2)`, `\1c–\4c`, `\shad N`, `\be N`.
  New `LayerSpec` fields: `drawingScale`, `drawingCmds`, `iclip`, `style.color2`,
  `style.borderColor`, `style.shadowColor`, `style.textShadow`.
- `src/layout.js`: `createDrawingEl(spec, opts, stage)` — 400×400 canvas element,
  draws `Path2D` at canvas center (200, 200), positioned at `posX/posY` via CSS.
  Also adds `text-shadow` and `-webkit-text-stroke-color` to `createLayerEl`.
- `src/scheduler.js`: route `drawingScale > 0` specs to `createDrawingEl`; add `pauseAll()`.
- `src/events.js`: wire `G.TYPE.PAUSE` → `pauseAll()`, `G.TYPE.PLAY` → `cancelAll()`.

**Limitations:**
- `\iclip` is parsed and stored in `LayerSpec.iclip` but CSS rendering is deferred
  (inverse clip requires `path(evenodd,…)` with absolute coords; complex for positioned elements).
- `\2c` (karaoke highlight fill) is parsed but not animated (sweep feature is separate).
- B-spline (`s` command) is approximated with line segments.
- Drawing canvas is 400×400px; shapes larger than 200px from origin may be clipped.

**New files:**
- `src/ass-drawing.js`
- `test/ass-drawing.test.js`
- `test/scheduler-pause.test.js`
- `examples/lollipop-shapes.js`

---

## Design Invariants (all sub-phases)

1. **Public API never changes** — `karaskel(luaScript, opts)` signature is stable from SP1.
2. **Fengari VM is warm** — initialized at `G.TYPE.INIT`, reused for all LINE events; no per-line cold start.
3. **All animations scheduled at LINE preview** — `compileAndSchedule()` runs in the 1500ms
   preview window; zero Lua execution at syl-fire time.
4. **Seek is always clean** — `cancelAll()` is called on `G.TYPE.SEEK`; the G scheduler
   re-fires LINE preview for lines near the new position.
5. **Tests are deterministic** — `math.randomseed(lineId)` ensures seek → same particle layout.
