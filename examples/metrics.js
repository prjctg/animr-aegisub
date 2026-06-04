/**
 * SP2 example: syllables appear at their real measured centers and drift upward.
 *
 * Requires real syl.center/middle values from aegisub.text_extents (SP2+).
 * Uses \an5 (center anchor), \pos for base position, \fad for soft fade,
 * and \move to animate 20 video units upward over the syllable duration.
 */

import { karaskel } from '../src/index.js';

export const luaScript = `
for si, syl in ipairs(line.kara) do
  if syl.text_stripped ~= "" then
    local t0 = line.start_time + syl.start_time
    local t1 = line.start_time + syl.end_time
    local dur = t1 - t0
    subs.append({
      layer = 0,
      start_time = t0 - 100,
      end_time   = t1 + 600,
      text = string.format(
        "{\\an5\\pos(%d,%d)\\fad(100,300)\\move(%d,%d,%d,%d,0,%d)}%s",
        syl.center, syl.middle,
        syl.center, syl.middle,
        syl.center, syl.middle - 20,
        dur + 600,
        syl.text_stripped)
    })
  end
end
`;

export const { h, s, default: init } = karaskel(luaScript, {
  font: 'sans-serif',
  fontSize: '52px',
  fontWeight: 'bold',
  position: 'center',
});

export default init;
