# animr-aegisub

Run Aegisub karaskel Lua scripts as Animr karaoke animations.

If you already write karaskel effects in Aegisub, your script works here with zero changes — pass it as a string and the library handles Fengari VM init, `aegisub.*` / `karaskel` mocks, ASS tag parsing, and Web Animations scheduling.

**New to karaskel?** Start here:
- [Aegisub karaoke scripting tutorial](https://aegisub.org/docs/latest/karaoke_scripting_tutorial/)
- [karaskel.lua reference](https://aegisub.org/docs/latest/automation/lua/modules/karaskel.lua/)
- [Karaoke Templater (KT)](https://aegisub.org/docs/latest/karaoke_templater/) — template-based alternative (SP5 target)

---

## Quick Start (3 lines)

```js
import { karaskel } from 'https://cdn.jsdelivr.net/gh/animr/animr-aegisub@0.1/dist/animr-aegisub.js';

const script = `
  for si, syl in ipairs(line.kara) do
    if syl.text_stripped ~= "" then
      local t0 = line.start_time + syl.start_time
      local t1 = line.start_time + syl.end_time
      subs.append({
        layer = 0, start_time = t0 - 300, end_time = t1 + 300,
        style = "Default",
        text  = string.format("{\\\\pos(%d,%d)\\\\fad(300,300)}%s",
                  syl.center, line.middle, syl.text_stripped)
      })
    end
  end
`;

const { h, s, default: init } = karaskel(script);
export { h, s };
export default init;
```

---

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `xres` | `number` | `640` | Source video width for coordinate normalization |
| `yres` | `number` | `480` | Source video height for coordinate normalization |
| `fps` | `number` | `24` | Frames-per-second for `aegisub.ms_from_frame()` |
| `channel` | `number` | `0` | Lyric channel (0 = primary) |
| `font` | `string` | `'sans-serif'` | Font family |
| `fontSize` | `string` | `'52px'` | Font size |
| `fontWeight` | `string` | `'bold'` | Font weight |
| `position` | `'top'\|'center'\|'bottom'` | `'center'` | Vertical anchor |
| `previewMs` | `number` | `1500` | How far ahead to preview next line (ms) |
| `onError` | `function` | `console.error` | Error handler |

---

## What karaskel fields are available (SP1)

The library populates the `line` and `syl` tables your Lua script reads:

```lua
-- line fields:
line.start_time   -- absolute song start ms (pass to subs.append start_time)
line.end_time
line.duration
line.middle       -- Y center in video coordinates (0..yres)
line.left / right / top / bottom / width / height

-- syl fields (line.kara[i]):
syl.text_stripped  -- lyric text for this syllable
syl.start_time     -- ms relative to line start
syl.end_time
syl.duration
syl.center         -- X center in video coordinates (SP1: equal-width approx)
syl.left / right
syl.middle         -- same as line.middle
syl.width / height -- SP1: approximated from font size; SP2: real getBBox
syl.i              -- 1-based syllable index
```

**Coordinate space:** `syl.center` and `line.middle` are in video space (0..xres, 0..yres).
The library normalizes `\pos(x,y)` to container percentages automatically.

---

## aegisub.* mock surface

| Function | Behavior |
|---|---|
| `aegisub.video_size()` | Returns `(xres, yres)` from options |
| `aegisub.ms_from_frame(n)` | `n × (1000 / fps)` |
| `aegisub.text_extents(style, text)` | Returns `0,0,0,0` (SP1); real in SP2 |
| `aegisub.progress.*` | No-op |
| `aegisub.set_undo_point()` | No-op |
| `aegisub.register_macro(name, desc, fn)` | Calls `fn()` directly |

---

## ASS tags supported (SP1)

| Tag | Effect |
|-----|--------|
| `\pos(x,y)` | Absolute position (normalized to container %) |
| `\fad(in,out)` | Fade in/out opacity |
| `\alpha &HXX&` | Base opacity |
| `\c &HBBGGRR&` | Text color (ASS BGR order reversed to RGB) |

Tags added in later sub-phases: `\move`, `\an`, `\t()`, `\fscx/y`, `\frz`, `\blur`, `\bord`, `\clip`.  
`\p1` vector drawing: SP4+.

---

## Imperative API

```js
import { createKaraskel } from '...';

export const h = `<div id="kstage" style="position:absolute;inset:0"></div>`;
export const s = ``;

export default function(G, shadowRoot, config) {
  createKaraskel(G, shadowRoot, luaScript, { fontSize: '48px' }, config);
}
```

---

## Sub-phases

See [PHASES.md](./PHASES.md) for the incremental roadmap:
- **SP1** (current): basic `\pos` + `\fad`, equal-width layout
- **SP2**: real getBBox text metrics, `\move`, `\an`
- **SP3**: `\t()` piecewise keyframes, scale/rotate/blur/border
- **SP4**: multi-layer per syl, particle Canvas overlay, `\clip`
- **SP5**: KT substrate — `code once`, `$variables`, `!expressions!`, `loop N`, `retime()`

---

## Development

```bash
npm install
npm test       # run Vitest unit tests
npm run build  # rollup → dist/animr-aegisub.js
```
