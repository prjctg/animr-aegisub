/**
 * SP6 example — Lollipop shapes with \p1 drawing commands.
 *
 * Demonstrates: \p1 candy shape, \1c color array, \3c border color,
 * \shad 2 shadow, \be1 edge blur, loop 7 particles with retime() stagger.
 *
 * Requires SP5 KT substrate + SP6 drawing/tag extensions.
 */
import { karaskel } from 'https://cdn.jsdelivr.net/gh/prjctg/animr-aegisub@0.1/dist/animr-aegisub.js';

export const luaScript = `
code once
  colors = {"&H69FFF6&", "&HFF69B4&", "&HFFF069&"}
end

template syl noblank notext loop 7
  local t0, t1 = retime("syl", (j - 1) * 50, 500)
  subs.append({
    layer = j,
    start_time = t0, end_time = t1,
    text = string.format(
      "{\\\\an5\\\\pos(%d,%d)\\\\blur0\\\\bord0\\\\fscx%d\\\\fscy%d\\\\t(\\\\blur5)\\\\fad(0,300)\\\\p1\\\\be1\\\\c%s}m 0 0 b 21 0 21 25 0 25 b -19 25 -19 0 0 0",
      syl.center, syl.middle,
      math.random(30, 60), math.random(30, 60),
      colors[math.random(3)])
  })
end

template syl noblank
  local t0, t1 = retime("start2syl", -300 + syl.i * 30, 0)
  subs.append({
    layer = 0,
    start_time = t0, end_time = t1,
    text = string.format(
      "{\\\\an5\\\\pos(%d,%d)\\\\bord2\\\\blur3\\\\3c&H000000&\\\\shad2\\\\fscx0\\\\fscy0\\\\t(0,200,\\\\fscx100\\\\fscy100)\\\\fad(200,0)}%s",
      syl.center, syl.middle,
      syl.text_stripped)
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
