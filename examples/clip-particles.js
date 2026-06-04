/**
 * SP4 example: clip sweep + particle burst per syllable.
 *
 * Layer 0 (clipped, DOM): 3 successive clip stages reveal the syllable text
 *   left-to-right via syl-stack wrappers with overflow:hidden.
 *
 * Layers 1..60 (unclipped, Canvas): 60 particles per syllable radiate outward
 *   from the syllable center. Group size (60) exceeds the Canvas threshold (50),
 *   so CanvasParticleRenderer handles them — no DOM elements created.
 *
 * Requires SP4+ scheduler (syl grouping, Canvas threshold, createSylStack).
 */

import { karaskel } from 'https://cdn.jsdelivr.net/gh/prjctg/animr-aegisub@0.1/dist/animr-aegisub.js';

export const luaScript = String.raw`
math.randomseed(line.id or 1)

for si, syl in ipairs(line.kara) do
  if syl.text_stripped ~= "" then
    local t0 = line.start_time + syl.start_time
    local t1 = line.start_time + syl.end_time
    local dur = t1 - t0
    local cx, cy = syl.center, syl.middle
    local sw = syl.width
    -- clip top/bottom span a band around the line midpoint
    local clipT = math.floor(cy - 40)
    local clipB = math.floor(cy + 40)
    local sylL  = math.floor(cx - sw / 2)
    local sylR  = math.floor(cx + sw / 2)

    -- Layer 0: 3 clip stages → progressive left-to-right text reveal
    -- Stage 1: reveal left third (t0-50 → t0 + dur/3)
    subs.append({
      layer = 0, start_time = t0 - 50, end_time = math.floor(t0 + dur / 3),
      text = string.format(
        "{\\an5\\pos(%d,%d)\\fad(50,50)\\clip(%d,%d,%d,%d)}%s",
        cx, cy, sylL, clipT, math.floor(cx - sw / 6), clipB,
        syl.text_stripped)
    })
    -- Stage 2: reveal centre (t0 + dur/3 → t0 + 2*dur/3)
    subs.append({
      layer = 0, start_time = math.floor(t0 + dur / 3),
      end_time = math.floor(t0 + 2 * dur / 3),
      text = string.format(
        "{\\an5\\pos(%d,%d)\\fad(30,30)\\clip(%d,%d,%d,%d)}%s",
        cx, cy, sylL, clipT, math.floor(cx + sw / 6), clipB,
        syl.text_stripped)
    })
    -- Stage 3: reveal full width, hold until after syl
    subs.append({
      layer = 0, start_time = math.floor(t0 + 2 * dur / 3),
      end_time = t1 + 400,
      text = string.format(
        "{\\an5\\pos(%d,%d)\\fad(30,200)\\clip(%d,%d,%d,%d)}%s",
        cx, cy, sylL, clipT, sylR, clipB,
        syl.text_stripped)
    })

    -- Layers 1..60: radial particle burst (60 > Canvas threshold → Canvas path)
    for pi = 1, 60 do
      local angle  = (pi - 1) * (2 * 3.14159 / 60)
      local radius = 20 + math.random(0, 40)
      local px = cx + math.cos(angle) * radius
      local py = cy + math.sin(angle) * radius
      local delay = math.random(0, 80)
      subs.append({
        layer = pi,
        start_time = t0 + delay,
        end_time   = t0 + delay + 250 + math.random(0, 150),
        text = string.format(
          "{\\an5\\pos(%d,%d)\\move(%d,%d,%d,%d)\\fad(40,120)\\c&H%02X%02X%02X&}*",
          cx, cy,
          cx, cy, math.floor(px), math.floor(py),
          math.random(150, 255), math.random(80, 180), math.random(0, 80))
      })
    end
  end
end
`;

export const {
  h,
  s,
  default: init,
} = karaskel(luaScript, {
  font: 'sans-serif',
  fontSize: '48px',
  fontWeight: 'bold',
  position: 'center',
});

export default init;
