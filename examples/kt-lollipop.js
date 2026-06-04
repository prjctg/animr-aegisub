/**
 * SP5 example: Lollipop-style KT script.
 *
 * Demonstrates all SP5 features:
 *   - code once: shared color palette defined once
 *   - template syl noblank: main text layer with per-syl color
 *   - !expression! evaluation: color cycling via Lua expression
 *   - $variable substitution: $scenter, $smiddle, $swidth, $sdur
 *   - retime(): timing relative to syllable boundaries
 *   - template syl noblank loop 5: staggered particle burst per syl
 *   - $j: loop counter used in retime offset and position randomisation
 *
 * Requires SP5+ kt-substrate (isKTScript, expandKTLine).
 */

import { karaskel } from 'https://cdn.jsdelivr.net/gh/prjctg/animr-aegisub@0.1/dist/animr-aegisub.js';

export const luaScript = `
code once
  lp_colors = {"&H69FFF6&", "&HFF69D1&", "&HFFF069&"}
  lp_n = #lp_colors
end

-- Main syllable layer: flip-in entrance, per-syl color, fade out tail
template syl noblank
  local t0, t1 = retime("syl", -300, 400)
  local ci = ((syl.i - 1) % lp_n) + 1
  subs.append({
    layer = 0,
    start_time = t0, end_time = t1,
    text = string.format(
      "{\\\\an5\\\\pos(%d,%d)\\\\fad(200,300)\\\\c%s\\\\t(0,200,\\\\frx0)\\\\frx90}%s",
      syl.center, syl.middle,
      lp_colors[ci],
      syl.text_stripped)
  })
end

-- Particle burst: 5 particles per syl, staggered by j*40ms, random radial scatter
template syl noblank loop 5
  local t0, t1 = retime("syl", (j - 1) * 40, 500)
  $angle = !math.floor((j - 1) * 72 + math.random(-25, 25))!
  $rad   = !math.floor(30 + math.random(0, 50))!
  $dx    = !math.floor(math.cos($angle * 3.14159 / 180) * $rad)!
  $dy    = !math.floor(math.sin($angle * 3.14159 / 180) * $rad)!
  $ci    = !((syl.i + j - 2) % lp_n) + 1!
  subs.append({
    layer = j,
    start_time = t0, end_time = t1,
    text = string.format(
      "{\\\\an5\\\\pos(%d,%d)\\\\move(%d,%d,%d,%d,0,%d)\\\\fad(0,300)\\\\fscx30\\\\fscy30\\\\c%s}*",
      syl.center, syl.middle,
      syl.center, syl.middle,
      syl.center + $dx, syl.middle + $dy,
      500,
      lp_colors[$ci])
  })
end
`;

export const {
  h,
  s,
  default: init,
} = karaskel(luaScript, {
  font: 'sans-serif',
  fontSize: '52px',
  fontWeight: 'bold',
  position: 'center',
});

export default init;
