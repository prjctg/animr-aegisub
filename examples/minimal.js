/**
 * animr-aegisub SP1 example — minimal karaskel script
 *
 * Each syllable appears 300ms early with a fade-in and fades out 300ms after it ends.
 * Positions are spaced proportionally using the equal-width approximation (SP1).
 * Real text metrics and precise positioning come in SP2.
 *
 * Usage: paste this file's content into the Animr code editor.
 */

import { karaskel } from 'https://cdn.jsdelivr.net/gh/animr/animr-aegisub@0.1/dist/animr-aegisub.esm.js';

// A simple karaskel Lua script:
// - Iterates over syllables in line.kara
// - Appends one ASS dialogue entry per syllable with \pos + \fad
const script = `
for si, syl in ipairs(line.kara) do
  if syl.text_stripped ~= "" then
    local t0 = line.start_time + syl.start_time
    local t1 = line.start_time + syl.end_time
    subs.append({
      layer      = 0,
      start_time = t0 - 300,
      end_time   = t1 + 300,
      style      = "Default",
      text       = string.format("{\\\\pos(%d,%d)\\\\fad(300,300)}%s",
                     syl.center, line.middle, syl.text_stripped)
    })
  end
end
`;

const { h, s, default: init } = karaskel(script, {
  fontSize: '52px',
  position: 'center',
});

export { h, s };
export default init;
